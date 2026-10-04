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

/** One invoice's worth of writes produced by {@link allocateLumpSum}. */
export interface LumpSumAllocationLine {
    /** Target invoice id. */
    invoiceId: string;
    /** Amount of the lump sum applied to this invoice in this run. */
    applied: number;
    /** Cumulative amountPaid to write back to the invoice. */
    newAmountPaid: number;
    /** Remaining balance after this allocation. */
    remaining: number;
    /** Status to write back ("paid" when fully cleared, else "unpaid"). */
    status: "paid" | "unpaid";
    /** True when this invoice was fully cleared by this allocation. */
    fullySettled: boolean;
}

export interface LumpSumAllocationResult {
    /** Per-invoice writes, in the order the cash was applied (oldest-first). */
    lines: LumpSumAllocationLine[];
    /** Total cash actually applied across all invoices. */
    totalApplied: number;
    /**
     * Cash left over after every eligible invoice is cleared. This should be
     * recorded on the ledger as a tenant credit / advance — it is NOT lost.
     */
    leftover: number;
}

/**
 * Split a single lump-sum payment across a unit's pending invoices,
 * oldest-first (rent-style waterfall).
 *
 * This is the reusable form of the manual workaround documented in
 * `MANAGER_ACTIONS.md` Section 6 and previously replayed only inside
 * `__tests__/lumpsum.test.ts`. A tenant hands over one amount that should
 * clear several months of dues; this computes exactly how much lands on each
 * invoice and how much (if any) remains as a credit.
 *
 * Pure & side-effect-free — the caller is responsible for persisting each
 * returned line to Firestore (and the leftover to the ledger).
 *
 * @param amount    Lump sum received (₹). Values <= 0 yield an empty result.
 * @param invoices  Candidate pool (any units/statuses); filtered internally.
 * @param unitId    Only invoices for this unit are eligible.
 * @param category  Inflow category — must be auto-settle eligible
 *                  ("rent" | "electricity" | "maintenance"), mirroring
 *                  {@link pickInvoiceToAutoSettle}.
 */
export function allocateLumpSum(
    amount: number,
    invoices: InvoiceLike[],
    unitId: string | undefined,
    category: string,
): LumpSumAllocationResult {
    const lines: LumpSumAllocationLine[] = [];
    let remainingCash = Math.max(0, Number(amount) || 0);

    // Work on a shallow clone so we can mutate amountPaid/status as we
    // waterfall without touching the caller's objects.
    const pool = invoices.map((i) => ({ ...i }));

    while (remainingCash > 0) {
        const target = pickInvoiceToAutoSettle(pool, unitId, category);
        if (!target) break;

        const res = computeAutoSettle(remainingCash, target);
        if (res.applied <= 0) break;

        // Mutate the cloned invoice so the next pick sees updated balances.
        target.amountPaid = res.newAmountPaid;
        target.status = res.fullySettled ? "paid" : "unpaid";

        lines.push({
            invoiceId: target.id,
            applied: res.applied,
            newAmountPaid: res.newAmountPaid,
            remaining: res.remaining,
            status: res.status,
            fullySettled: res.fullySettled,
        });

        remainingCash -= res.applied;
    }

    const totalApplied = lines.reduce((sum, l) => sum + l.applied, 0);
    return { lines, totalApplied, leftover: remainingCash };
}
