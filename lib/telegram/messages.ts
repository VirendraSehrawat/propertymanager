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

export interface PaymentReminderContext {
    kind: "dueTomorrow" | "dueToday";
    tenantName?: string;
    unitNumber?: string;
    /** Display date, e.g. "Sat 1 Nov". */
    dueDate: string;
    /** Total still owed on the unit. */
    remaining: number;
    dashboardUrl?: string;
    relatedInvoiceId?: string;
}

/** Tenant reminder the day before / on the payment day (§3.4 of EMPLOYEE_WORKFLOW_IMPROVEMENTS.md). */
export async function sendPaymentReminder(chatId: string, ctx: PaymentReminderContext): Promise<SendMessageResult> {
    const when = ctx.kind === "dueToday" ? "<b>today</b>" : `<b>tomorrow</b> (${esc(ctx.dueDate)})`;
    const body =
        `🔔 <b>Namaste ${esc(ctx.tenantName || "")}</b>\n\n` +
        `Rent for unit <b>${esc(ctx.unitNumber || "")}</b> is due ${when}.\n` +
        `Amount due: <b>₹${ctx.remaining.toLocaleString("en-IN")}</b>\n\n` +
        `Already paid? Please ignore this message.\n\n` +
        `<i>You are receiving this because you linked unit ${esc(ctx.unitNumber || "")}. Send /stop to unsubscribe.</i>`;
    return sendTelegramMessage({
        chatId,
        text: body,
        kind: "paymentReminder",
        inlineKeyboard: ctx.dashboardUrl ? [[{ text: "🌐 View & pay", url: ctx.dashboardUrl }]] : undefined,
        relatedInvoiceId: ctx.relatedInvoiceId,
    });
}

export interface ReminderSummaryLine {
    unitNumber: string;
    tenantName?: string;
    remaining: number;
    kind: "dueTomorrow" | "dueToday";
    sent: boolean;
}

/** Daily summary to the admin channel: who was reminded and who must be chased by phone. */
export async function sendReminderSummary(chatId: string, date: string, lines: ReminderSummaryLine[]): Promise<SendMessageResult> {
    const fmt = (l: ReminderSummaryLine) =>
        `• ${esc(l.unitNumber)}${l.tenantName ? ` (${esc(l.tenantName)})` : ""} — ₹${l.remaining.toLocaleString("en-IN")} due ${l.kind === "dueToday" ? "today" : "tomorrow"}`;
    // Keep well under Telegram's 4,096-character limit.
    const list = (ls: ReminderSummaryLine[]) => ls.slice(0, 30).map(fmt).join("\n") + (ls.length > 30 ? `\n…and ${ls.length - 30} more` : "");
    const sent = lines.filter(l => l.sent);
    const notSent = lines.filter(l => !l.sent);
    const body =
        `🔔 <b>Payment reminders — ${esc(date)}</b>\n\n` +
        (sent.length ? `Sent on Telegram (${sent.length}):\n${list(sent)}\n\n` : "") +
        (notSent.length ? `<b>Not on Telegram — call or WhatsApp (${notSent.length}):</b>\n${list(notSent)}` : "Everyone due was reminded.");
    return sendTelegramMessage({ chatId, text: body, kind: "paymentReminderSummary", silent: true });
}
