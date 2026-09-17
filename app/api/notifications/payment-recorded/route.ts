/**
 * Notification dispatcher for payment settlement events.
 *
 *   POST /api/notifications/payment-recorded
 *   body: {
 *     invoiceId: string,
 *     amount:    number,      // amount just applied in this transaction
 *     fully:     boolean,     // true if this settled the invoice
 *     mode?:     string,
 *     reference?: string,
 *     ledgerId?: string,
 *   }
 *
 * Fires Telegram messages to both admin + tenant, using the "partial" or
 * "received" variant depending on `fully`.
 */

import { NextResponse } from "next/server";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { sendPaymentReceived, sendPaymentPartial, type PaymentContext } from "@/lib/telegram/messages";
import { getAdminChatId, resolveTenantChatIdByEmail } from "@/lib/telegram/recipients";

export const runtime = "nodejs";

interface Body {
    invoiceId?: string;
    amount?: number;
    fully?: boolean;
    mode?: string;
    reference?: string;
    ledgerId?: string;
}

export async function POST(request: Request) {
    let body: Body;
    try {
        body = (await request.json()) as Body;
    } catch {
        return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    if (!body.invoiceId) {
        return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
    }

    try {
        const snap = await getDoc(doc(db, "invoices", body.invoiceId));
        if (!snap.exists()) {
            return NextResponse.json({ error: "invoice not found" }, { status: 404 });
        }
        const inv = snap.data() as {
            tenantEmail?: string;
            tenantName?: string;
            unitNumber?: string;
            billingPeriod?: string;
            totalAmount?: number;
            amountPaid?: number;
        };

        const applied = Number(body.amount || 0);
        const total = Number(inv.totalAmount || 0);
        const paidNow = Number(inv.amountPaid || 0);
        const remaining = Math.max(0, total - paidNow);
        const fully = Boolean(body.fully) || remaining <= 0;

        const ctx: PaymentContext = {
            invoiceId: body.invoiceId,
            ledgerId: body.ledgerId,
            unitNumber: inv.unitNumber,
            tenantName: inv.tenantName,
            billingPeriod: inv.billingPeriod,
            amount: applied,
            remaining,
            mode: body.mode,
            reference: body.reference,
        };

        const results: Record<string, unknown> = {};

        const adminChatId = getAdminChatId();
        if (adminChatId) {
            const r = fully ? await sendPaymentReceived(adminChatId, ctx) : await sendPaymentPartial(adminChatId, ctx);
            results.admin = r;
        }

        const tenantChatId = await resolveTenantChatIdByEmail(inv.tenantEmail);
        if (tenantChatId) {
            const r = fully ? await sendPaymentReceived(tenantChatId, ctx) : await sendPaymentPartial(tenantChatId, ctx);
            results.tenant = r;
        } else {
            results.tenant = { ok: false, error: "tenant not linked" };
        }

        return NextResponse.json({ ok: true, results });
    } catch (e) {
        console.error("[notifications/payment-recorded] failed:", e);
        return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
}
