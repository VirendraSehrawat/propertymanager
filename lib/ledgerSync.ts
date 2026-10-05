/**
 * Pure helpers for keeping invoices (and corporate master invoices) in sync
 * with their `ledger` payment rows.
 *
 * Context: the Admin "Master Payment Ledger" (see
 * `components/admin/AdminLedgerTab.tsx`) lets an admin correct the
 * `amountPaid` recorded on an individual ledger row (e.g. a cash deposit was
 * mis-keyed). Historically that correction was written ONLY to the ledger
 * document, so the linked apartment invoice — and the master invoice it rolls
 * up into — kept their stale `amountPaid` / `status`. These helpers derive the
 * corrected invoice + master state so the write-back can be done atomically.
 *
 * All functions are side-effect-free and framework-free so every branch can be
 * unit-tested without Firestore.
 */

export type InvoiceStatus = "paid" | "pending" | "unpaid";
export type MasterStatus = "unpaid" | "partial" | "paid" | "void";

/** Rounding tolerance (₹) so paise-level drift can't leave an invoice stuck. */
const PAID_TOLERANCE = 0.5;

export interface LedgerRowLike {
    id: string;
    invoiceId?: string;
    amountPaid?: number;
}

/**
 * Sum the `amountPaid` across every ledger row for a given invoice.
 *
 * When `override` is supplied, the row with that id uses the override amount
 * instead of its stored value. This lets callers compute the post-correction
 * total *before* the Firestore snapshot round-trips the new value back.
 */
export function sumLedgerPaidForInvoice(
    entries: LedgerRowLike[],
    invoiceId: string,
    override?: { id: string; amountPaid: number },
): number {
    let sum = 0;
    for (const e of entries) {
        if (!e || e.invoiceId !== invoiceId) continue;
        const amt = override && e.id === override.id
            ? Number(override.amountPaid) || 0
            : Number(e.amountPaid) || 0;
        sum += amt;
    }
    // Guard against a negative aggregate from bad data.
    return Math.max(0, Math.round(sum));
}

/**
 * Derive an invoice's status from how much has been paid against its total.
 *
 *   paid >= total (within tolerance) & total > 0 → "paid"
 *   0 < paid < total                             → "pending"  (partial)
 *   paid <= 0                                    → "unpaid"
 */
export function deriveInvoiceStatus(paid: number, total: number): InvoiceStatus {
    const p = Number(paid) || 0;
    const t = Number(total) || 0;
    if (t > 0 && p >= t - PAID_TOLERANCE) return "paid";
    if (p > 0) return "pending";
    return "unpaid";
}

export interface InvoiceSyncPatch {
    amountPaid: number;
    status: InvoiceStatus;
    /** True when the invoice is now fully settled (caller may set `paidAt`). */
    fullyPaid: boolean;
}

/**
 * Compute the invoice patch (amountPaid + status) implied by the ledger rows.
 *
 * @param invoiceTotal  The invoice's `totalAmount`.
 * @param entries       All ledger rows (any invoices); filtered internally.
 * @param invoiceId     The invoice to recompute.
 * @param override      Optional corrected value for a single ledger row that
 *                      hasn't been reflected in `entries` yet.
 */
export function syncInvoiceFromLedger(
    invoiceTotal: number,
    entries: LedgerRowLike[],
    invoiceId: string,
    override?: { id: string; amountPaid: number },
): InvoiceSyncPatch {
    const amountPaid = sumLedgerPaidForInvoice(entries, invoiceId, override);
    const status = deriveInvoiceStatus(amountPaid, invoiceTotal);
    return { amountPaid, status, fullyPaid: status === "paid" };
}

export interface MasterChildLike {
    id: string;
    amountPaid?: number;
    totalAmount?: number;
}

export interface MasterSyncPatch {
    amountPaid: number;
    status: MasterStatus;
    fullyPaid: boolean;
}

/**
 * Derive a master invoice's status from the aggregate paid vs its total.
 *
 *   paid <= 0        → "unpaid"
 *   paid >= total    → "paid"
 *   otherwise        → "partial"
 *
 * `"void"` is a lifecycle state set elsewhere and is never produced here.
 */
export function deriveMasterStatus(paid: number, total: number): MasterStatus {
    const p = Number(paid) || 0;
    const t = Number(total) || 0;
    if (p <= 0) return "unpaid";
    if (p >= t - PAID_TOLERANCE) return "paid";
    return "partial";
}

/**
 * Compute the master-invoice patch from its children's (post-correction)
 * `amountPaid`. The master's `amountPaid` is the sum of its children's.
 *
 * @param masterTotal  The master's `totalAmount`.
 * @param children     The child invoices belonging to this master. Pass the
 *                     already-corrected `amountPaid` for the edited child.
 */
export function syncMasterFromChildren(
    masterTotal: number,
    children: MasterChildLike[],
): MasterSyncPatch {
    const amountPaid = Math.max(
        0,
        Math.round(children.reduce((s, c) => s + (Number(c.amountPaid) || 0), 0)),
    );
    const status = deriveMasterStatus(amountPaid, masterTotal);
    return { amountPaid, status, fullyPaid: status === "paid" };
}
