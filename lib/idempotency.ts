/**
 * Idempotent payment writes (§7.3). Every attempt to record one payment
 * carries the same key, and the key fixes the ids of the documents the
 * payment creates (ledger rows, Daily-ledger inflow). Re-sending the same
 * plan with the same key — a double tap, a retry after a timeout, or the
 * offline queue replaying it — overwrites those documents with identical
 * data instead of adding a second payment. Invoice patches are absolute
 * values (amountPaid = X), so re-applying the same plan is harmless too.
 *
 * The caller must keep the *plan* together with the key and reuse both on a
 * retry: rebuilding the plan from invoices that already include the payment
 * would add it a second time.
 */

/** A fresh key, e.g. "pay_lx3k9f_8f2c1a7d". */
export function newIdempotencyKey(prefix = "pay"): string {
    const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** Deterministic document ids derived from the key. */
export const ledgerRowId = (key: string, index: number) => `${key}_l${index}`;
export const dailyRowId = (key: string) => `${key}_d`;

/** Remembers the plan for one in-progress payment so a retry reuses it. */
export interface PendingPayment<P> {
    key: string;
    /** What the payment was for (invoice id + amount + mode + reference …). */
    signature: string;
    plan: P;
}

/**
 * Reuse the pending key and plan when the user retries the *same* payment;
 * otherwise start a new one with a fresh key and a freshly built plan.
 */
export function reuseOrStart<P>(
    pending: PendingPayment<P> | null,
    signature: string,
    build: () => P,
): PendingPayment<P> {
    if (pending && pending.signature === signature) return pending;
    return { key: newIdempotencyKey(), signature, plan: build() };
}
