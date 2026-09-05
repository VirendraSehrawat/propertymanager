/**
 * Pure helpers for recording tenant payments.
 *
 * Two flows use these:
 *   1. Collections tab → Mark as Paid (manual settle with UPI / bank / cheque ref)
 *   2. Daily Ledger tab → ➕ Inflow (auto-settle oldest pending invoice)
 *
 * Kept framework-free and side-effect-free so they can be unit-tested
 * without Firestore.
 */

export type PaymentMode = "cash" | "upi" | "bank" | "cheque" | "other";

export interface InvoiceLike {
    id: string;
    totalAmount?: number;
    amountPaid?: number;
    billingPeriod?: string;
    status?: string;
    unitId?: string;
    createdAt?: string;
}

/**
 * Build a transactionId string from a payment mode + reference.
 *
 *  - `cash`              → "CASH_COLLECTED"
 *  - `upi` / `bank` / …  → "UPI:<ref>"  (falls back to "NO_REF" when ref is empty)
 */
export function buildTransactionId(mode: PaymentMode, reference: string | null | undefined): string {
    if (mode === "cash") return "CASH_COLLECTED";
    const ref = (reference || "").trim();
    return `${mode.toUpperCase()}:${ref || "NO_REF"}`;
}

export interface AutoSettleResult {
    /** How much of the inflow was actually applied to the invoice. */
    applied: number;
    /** Cumulative amountPaid on the invoice after this payment. */
    newAmountPaid: number;
    /** Remaining balance on the invoice after this payment. */
    remaining: number;
    /** Final status after this payment ("paid" or "unpaid"). */
    status: "paid" | "unpaid";
    /** True when the invoice was fully cleared by this payment. */
    fullySettled: boolean;
}

/**
 * Given an inflow amount and the target invoice, compute what should be
 * written back to Firestore. Pure — no writes.
 */
export function computeAutoSettle(inflowAmount: number, invoice: InvoiceLike): AutoSettleResult {
    const paying = Math.max(0, Number(inflowAmount) || 0);
    const total = Math.max(0, Number(invoice.totalAmount) || 0);
    const alreadyPaid = Math.max(0, Number(invoice.amountPaid) || 0);
    const dueBefore = Math.max(0, total - alreadyPaid);
    const applied = Math.min(paying, dueBefore);
    const newAmountPaid = alreadyPaid + applied;
    const remaining = Math.max(0, total - newAmountPaid);
    const fullySettled = remaining === 0 && total > 0;
    return {
        applied,
        newAmountPaid,
        remaining,
        status: fullySettled ? "paid" : "unpaid",
        fullySettled,
    };
}

const AUTO_SETTLE_CATEGORIES = new Set(["rent", "electricity", "maintenance"]);

/**
 * Pick the oldest pending invoice for the given unit that matches the inflow
 * category. Returns `null` if none apply (in which case no auto-settle happens).
 */
export function pickInvoiceToAutoSettle(
    invoices: InvoiceLike[],
    unitId: string | undefined,
    category: string,
): InvoiceLike | null {
    if (!unitId) return null;
    if (!AUTO_SETTLE_CATEGORIES.has(category)) return null;
    const candidates = invoices
        .filter(
            (inv) =>
                inv.unitId === unitId &&
                (inv.status === "unpaid" || inv.status === "pending") &&
                Math.max(0, Number(inv.totalAmount) || 0) -
                    Math.max(0, Number(inv.amountPaid) || 0) >
                    0,
        )
        .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    return candidates[0] || null;
}
