/**
 * Daily payment-day reminders (§3.4 of docs/EMPLOYEE_WORKFLOW_IMPROVEMENTS.md).
 *
 *   GET /api/notifications/payment-reminders[?dryRun=1]
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Meant to run once a day (09:00 IST — see `vercel.json`, or a Cloud Scheduler
 * job on Firebase App Hosting). For every tenant whose rent falls due tomorrow
 * or today (unit `paymentDay`, see lib/paymentDue.ts) it sends a Telegram
 * reminder quoting the balance still owed, if the tenant has linked Telegram.
 * The admin channel then gets one summary listing who was reminded and who
 * isn't on Telegram, so staff only chase the rest by phone / WhatsApp.
 *
 * Each reminder is recorded as `paymentReminders/{key}` (created atomically,
 * so a second run on the same day never sends twice). `dryRun=1` returns the
 * list without sending or recording anything.
 *
 * Uses the Admin SDK — the job has no signed-in user.
 */

import { NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "@/lib/serverAuth";
import { paymentRemindersDue, type DueInvoice, type DueUnit } from "@/lib/paymentDue";
import { sendPaymentReminder, sendReminderSummary, type ReminderSummaryLine } from "@/lib/telegram/messages";
import { getAdminChatId } from "@/lib/telegram/recipients";

export const runtime = "nodejs";

const TIME_ZONE = "Asia/Kolkata";

/** Today's calendar date in IST as a local Date, whatever the server's time zone. */
function todayInIst(): { now: Date; key: string } {
    const key = new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE }); // YYYY-MM-DD
    const [y, m, d] = key.split("-").map(Number);
    return { now: new Date(y, m - 1, d, 12), key };
}

function authorized(request: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
    if (!authorized(request)) {
        return NextResponse.json({ error: process.env.CRON_SECRET ? "unauthorized" : "CRON_SECRET not configured" }, { status: 401 });
    }
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

    try {
        const db = getFirestore(getAdminApp());
        const { now, key: today } = todayInIst();

        const [unitSnap, invoiceSnap, userSnap] = await Promise.all([
            db.collection("units").where("status", "==", "occupied").get(),
            db.collection("invoices").where("status", "in", ["unpaid", "pending"]).get(),
            db.collection("users").where("telegramOptIn", "==", true).get(),
        ]);
        const units = unitSnap.docs.map(d => ({ id: d.id, ...d.data() }) as DueUnit);
        const invoices = invoiceSnap.docs.map(d => ({ id: d.id, ...d.data() }) as DueInvoice);
        const chatByEmail = new Map<string, string>();
        for (const d of userSnap.docs) {
            const u = d.data() as { email?: string; telegramChatId?: string | number };
            if (u.email && u.telegramChatId) chatByEmail.set(u.email.toLowerCase(), String(u.telegramChatId));
        }

        const reminders = paymentRemindersDue({ units, invoices, now });
        if (dryRun) {
            return NextResponse.json({
                ok: true, dryRun: true, date: today,
                reminders: reminders.map(r => ({ ...r, telegramLinked: chatByEmail.has(r.tenantEmail.toLowerCase()) })),
            });
        }

        const dashboardUrl = process.env.APP_PUBLIC_URL || "https://rentalappartment.store";
        const summary: ReminderSummaryLine[] = [];
        let skipped = 0;
        for (const r of reminders) {
            const ref = db.collection("paymentReminders").doc(r.key);
            const chatId = chatByEmail.get(r.tenantEmail.toLowerCase());
            try {
                // Fails if this reminder was already recorded (e.g. the job ran twice).
                await ref.create({ ...r, sentOn: today, channel: chatId ? "telegram" : "none", ok: false, createdAt: new Date().toISOString() });
            } catch {
                skipped++;
                continue;
            }
            let sent = false;
            if (chatId) {
                const dueDate = new Date(`${r.dueDate}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
                const res = await sendPaymentReminder(chatId, {
                    kind: r.kind, tenantName: r.tenantName, unitNumber: r.unitNumber, dueDate,
                    remaining: r.remaining, dashboardUrl, relatedInvoiceId: r.invoiceIds[0],
                });
                sent = res.ok;
                await ref.update({ ok: res.ok, ...(res.ok ? {} : { error: String(res.error || "send failed") }) });
            }
            summary.push({ unitNumber: r.unitNumber, tenantName: r.tenantName, remaining: r.remaining, kind: r.kind, sent });
        }

        const adminChatId = getAdminChatId();
        if (adminChatId && summary.length > 0) {
            await sendReminderSummary(adminChatId, today, summary);
        }

        return NextResponse.json({
            ok: true, date: today,
            sent: summary.filter(s => s.sent).length,
            notOnTelegram: summary.filter(s => !s.sent).length,
            alreadyDone: skipped,
        });
    } catch (e) {
        console.error("[notifications/payment-reminders] failed:", e);
        return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
}
