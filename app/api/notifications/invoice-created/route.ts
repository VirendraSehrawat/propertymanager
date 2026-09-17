/**
 * Notification dispatcher for invoice creation events.
 *
 *   POST /api/notifications/invoice-created
 *   body: { invoiceId: string }
 *
 * Fetches the invoice, sends a Telegram message to:
 *   - the admin channel (always, as audit copy)
 *   - the tenant's linked chat (if they opted in)
 *
 * Failures are logged but never fail the response — the caller is
 * fire-and-forget from the invoice-creation code path, and Firestore
 * has already committed the invoice.
 *
 * WhatsApp fan-out can be added here later behind the same tenant
 * preference list (§5.2 of TELEGRAM_INTEGRATION.md).
 */

import { NextResponse } from "next/server";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { sendInvoiceCreated, type InvoiceContext } from "@/lib/telegram/messages";
import { getAdminChatId, resolveTenantChatIdByEmail } from "@/lib/telegram/recipients";

export const runtime = "nodejs";

export async function POST(request: Request) {
    let payload: { invoiceId?: string };
    try {
        payload = (await request.json()) as { invoiceId?: string };
    } catch {
        return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    const invoiceId = payload.invoiceId;
    if (!invoiceId) {
        return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
    }

    try {
        const snap = await getDoc(doc(db, "invoices", invoiceId));
        if (!snap.exists()) {
            return NextResponse.json({ error: "invoice not found" }, { status: 404 });
        }
        const inv = snap.data() as {
            tenantEmail?: string;
            tenantName?: string;
            unitNumber?: string;
            billingPeriod?: string;
            baseRent?: number;
            electricityCharge?: number;
            totalAmount?: number;
            transactionId?: string;
        };

        const dashboardUrl = process.env.APP_PUBLIC_URL || "https://rentalappartment.store";

        const ctx: InvoiceContext = {
            invoiceId,
            tenantName: inv.tenantName,
            unitNumber: inv.unitNumber,
            billingPeriod: inv.billingPeriod,
            baseRent: Number(inv.baseRent || 0),
            electricityCharge: Number(inv.electricityCharge || 0),
            totalAmount: Number(inv.totalAmount || 0),
            dashboardUrl,
        };

        const results: Record<string, unknown> = {};

        const adminChatId = getAdminChatId();
        if (adminChatId) {
            const r = await sendInvoiceCreated(adminChatId, { ...ctx, audit: true });
            results.admin = r;
        }

        const tenantChatId = await resolveTenantChatIdByEmail(inv.tenantEmail);
        if (tenantChatId) {
            const r = await sendInvoiceCreated(tenantChatId, ctx);
            results.tenant = r;
        } else {
            results.tenant = { ok: false, error: "tenant not linked" };
        }

        return NextResponse.json({ ok: true, results });
    } catch (e) {
        console.error("[notifications/invoice-created] failed:", e);
        return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
}
