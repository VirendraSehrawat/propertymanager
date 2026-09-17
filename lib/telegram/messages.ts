/**
 * Named senders for each notification kind (§6 of TELEGRAM_INTEGRATION.md).
 *
 * All helpers accept the resolved chatId + business context and return the
 * SendMessageResult. They do NOT perform recipient resolution — the caller
 * (typically a `/api/notifications/*` route) decides who gets what.
 */

import { sendTelegramMessage, type SendMessageResult } from "./client";
import { esc } from "./esc";

export interface InvoiceContext {
    invoiceId: string;
    tenantName?: string;
    unitNumber?: string;
    billingPeriod?: string;
    baseRent?: number;
    electricityCharge?: number;
    totalAmount: number;
    dueDate?: string;
    upiDeepLink?: string;
    dashboardUrl?: string;
    payeeName?: string;
    /** When true, omits the tenant-facing "Pay via UPI" button (used for admin audit copies). */
    audit?: boolean;
}

export async function sendInvoiceCreated(chatId: string, ctx: InvoiceContext): Promise<SendMessageResult> {
    const rentLine = ctx.baseRent ? `• Rent:          ₹${ctx.baseRent.toLocaleString()}\n` : "";
    const elecLine = ctx.electricityCharge
        ? `• Electricity:   ₹${ctx.electricityCharge.toLocaleString()}\n`
        : "";
    const greeting = ctx.audit
        ? `🧾 <b>Invoice generated</b>`
        : `🧾 <b>Namaste ${esc(ctx.tenantName || "")}</b>`;
    const header = ctx.audit
        ? `Unit <b>${esc(ctx.unitNumber || "")}</b> · ${esc(ctx.tenantName || "")}`
        : `Your invoice for <b>${esc(ctx.billingPeriod || "")}</b> is ready:`;

    const body =
        `${greeting}\n\n` +
        `${header}\n\n` +
        rentLine +
        elecLine +
        `• <b>Total due:    ₹${ctx.totalAmount.toLocaleString()}</b>\n` +
        (ctx.dueDate ? `\nPlease pay by <b>${esc(ctx.dueDate)}</b>.\n` : "") +
        (ctx.payeeName ? `\n— ${esc(ctx.payeeName)}` : "");

    const buttons: { text: string; url: string }[] = [];
    if (!ctx.audit && ctx.upiDeepLink) buttons.push({ text: "💳 Pay via UPI", url: ctx.upiDeepLink });
    if (ctx.dashboardUrl) buttons.push({ text: "🌐 Dashboard", url: ctx.dashboardUrl });

    return sendTelegramMessage({
        chatId,
        text: body,
        kind: ctx.audit ? "invoiceCreatedAudit" : "invoiceCreated",
        inlineKeyboard: buttons.length ? [buttons] : undefined,
        silent: ctx.audit,
        relatedInvoiceId: ctx.invoiceId,
    });
}

export interface PaymentContext {
    invoiceId: string;
    ledgerId?: string;
    unitNumber?: string;
    tenantName?: string;
    billingPeriod?: string;
    amount: number;
    remaining?: number;
    mode?: string;
    reference?: string;
    dashboardUrl?: string;
}

export async function sendPaymentReceived(chatId: string, ctx: PaymentContext): Promise<SendMessageResult> {
    const body =
        `✅ <b>Payment received</b>\n\n` +
        `Unit <b>${esc(ctx.unitNumber || "")}</b>` +
        (ctx.tenantName ? `  (${esc(ctx.tenantName)})` : "") +
        `\n` +
        `Amount: <b>₹${ctx.amount.toLocaleString()}</b>` +
        (ctx.mode ? `   ·   Mode: ${esc(ctx.mode)}` : "") +
        (ctx.reference ? `   ·   Ref: <code>${esc(ctx.reference)}</code>` : "") +
        `\n` +
        `Invoice <b>${esc(ctx.billingPeriod || "")}</b> is now marked <b>PAID</b>.`;

    return sendTelegramMessage({
        chatId,
        text: body,
        kind: "paymentReceived",
        relatedInvoiceId: ctx.invoiceId,
        relatedLedgerId: ctx.ledgerId,
    });
}

export async function sendPaymentPartial(chatId: string, ctx: PaymentContext): Promise<SendMessageResult> {
    const body =
        `💵 <b>Partial payment</b>\n\n` +
        `Unit <b>${esc(ctx.unitNumber || "")}</b>` +
        (ctx.tenantName ? `  (${esc(ctx.tenantName)})` : "") +
        `\n` +
        `Received <b>₹${ctx.amount.toLocaleString()}</b>` +
        (ctx.mode ? `   ·   Mode: ${esc(ctx.mode)}` : "") +
        `\n` +
        `Remaining <b>₹${(ctx.remaining || 0).toLocaleString()}</b> on invoice ${esc(ctx.billingPeriod || "")}.`;

    return sendTelegramMessage({
        chatId,
        text: body,
        kind: "paymentPartial",
        relatedInvoiceId: ctx.invoiceId,
        relatedLedgerId: ctx.ledgerId,
    });
}
