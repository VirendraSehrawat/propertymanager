/**
 * Pure ledger-consistency audit — shared by the CLI script
 * (`scripts/auditLedgerConsistency.ts`) and the admin API route
 * (`app/api/admin/audit-ledger`).
 *
 * Verifies the core invariant that the atomic-transactions work upholds
 * (see `docs/ATOMIC_TRANSACTIONS_PLAN.md`):
 *
 *     for each invoice:  Σ(ledger.amountPaid where ledger.invoiceId == invoice.id)
 *                        === invoice.amountPaid
 *
 * Side-effect-free and framework-free so it can be unit-tested and reused on
 * both client and server.
 */

/** Minimal invoice shape the audit needs. */
export interface AuditInvoice {
    id: string;
    unitNumber?: string;
    billingPeriod?: string;
    status?: string;
    amountPaid?: number;
    deleted?: boolean;
}

/** Minimal ledger-row shape the audit needs (from `ledger` or `ledgerEntries`). */
export interface AuditLedgerRow {
    invoiceId?: string;
    amountPaid?: number;
    deleted?: boolean;
}

export interface LedgerDriftRow {
    invoiceId: string;
    unitNumber: string;
    billingPeriod: string;
    status: string;
    invoiceAmountPaid: number;
    ledgerSum: number;
    /** invoiceAmountPaid − ledgerSum. >0: invoice claims more than ledger proves. */
    diff: number;
    ledgerRowCount: number;
}

export interface LedgerAuditReport {
    invoicesScanned: number;
    ledgerRowsScanned: number;
    tolerance: number;
    drift: LedgerDriftRow[];
    /** Invoices whose recorded amountPaid exceeds their ledger sum. */
    invoiceOverLedger: number;
    /** Invoices whose ledger sum exceeds their recorded amountPaid. */
    ledgerOverInvoice: number;
    /** Convenience flag — true when no drift beyond tolerance was found. */
    balanced: boolean;
}

/**
 * Compute the ledger-vs-invoice drift report.
 *
 * @param invoices    All invoices (soft-deleted ones are skipped).
 * @param ledgerRows  All ledger rows across `ledger` + `ledgerEntries`
 *                    (soft-deleted and non-invoice credit rows are skipped).
 * @param tolerance   Rounding tolerance (₹) before a row counts as drift.
 */
export function computeLedgerDrift(
    invoices: AuditInvoice[],
    ledgerRows: AuditLedgerRow[],
    tolerance = 1,
): LedgerAuditReport {
    const sumByInvoice = new Map<string, number>();
    const countByInvoice = new Map<string, number>();
    let ledgerRowsScanned = 0;

    for (const r of ledgerRows) {
        if (!r || r.deleted === true) continue;
        const invoiceId = r.invoiceId;
        if (!invoiceId) continue; // pure credit/advance rows aren't invoice-linked
        const amt = Number(r.amountPaid) || 0;
        sumByInvoice.set(invoiceId, (sumByInvoice.get(invoiceId) || 0) + amt);
        countByInvoice.set(invoiceId, (countByInvoice.get(invoiceId) || 0) + 1);
        ledgerRowsScanned++;
    }

    const drift: LedgerDriftRow[] = [];
    let invoicesScanned = 0;

    for (const inv of invoices) {
        if (!inv || inv.deleted === true) continue;
        invoicesScanned++;
        const invoiceAmountPaid = Math.round(Number(inv.amountPaid) || 0);
        const ledgerSum = Math.round(sumByInvoice.get(inv.id) || 0);
        const diff = invoiceAmountPaid - ledgerSum;
        if (Math.abs(diff) > tolerance) {
            drift.push({
                invoiceId: inv.id,
                unitNumber: String(inv.unitNumber || "?"),
                billingPeriod: String(inv.billingPeriod || "?"),
                status: String(inv.status || "?"),
                invoiceAmountPaid,
                ledgerSum,
                diff,
                ledgerRowCount: countByInvoice.get(inv.id) || 0,
            });
        }
    }

    // Worst-first by absolute difference.
    drift.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const invoiceOverLedger = drift.filter((r) => r.diff > 0).length;
    const ledgerOverInvoice = drift.filter((r) => r.diff < 0).length;

    return {
        invoicesScanned,
        ledgerRowsScanned,
        tolerance,
        drift,
        invoiceOverLedger,
        ledgerOverInvoice,
        balanced: drift.length === 0,
    };
}
