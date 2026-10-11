/**
 * Pure planner for backfilling Daily Ledger inflow rows for settled invoices
 * and partial payments that were recorded BEFORE Phase 8 of
 * `docs/ATOMIC_TRANSACTIONS_PLAN.md` (when `buildSettlePlan` / Admin "Approve
 * Invoice" did not yet write a matching `dailyLedger` row).
 *
 * Kept framework-free and side-effect-free so every branch is unit-testable
 * without Firestore. The impure runner in `scripts/backfillDailyLedgerInflows.ts`
 * reads Firestore, calls these planners, and writes the results.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * Only `payment` / `partial-payment` rows from `ledger` (single-invoice
 * settlements) and `master-payment` rows from `ledgerEntries` (corporate
 * settlements) are considered — these are real cash inflows tied to an
 * invoice. `credit` rows (unapplied advances) are intentionally excluded:
 * they are not an invoice settlement.
 *
 * Rows whose `transactionId` is `DAILY_LEDGER_AUTOSETTLE` are skipped: those
 * were produced by a manual Daily Ledger inflow entry, which ALREADY created
 * its own `dailyLedger` row at the time — backfilling would double-count the
 * cash.
 *
 * ── De-duplication ──────────────────────────────────────────────────────────
 * Any settlement already mirrored into `dailyLedger` (post Phase-8 fix, or a
 * previous backfill run) is skipped via `dailyLedgerDedupeKey` — keyed on
 * `invoiceId` (or `masterInvoiceId`) + amount + createdAt, which is exactly
 * how `buildSettlePlan` / `buildMasterSettlePlan` stamp their own rows.
 */

export interface LedgerRowForBackfill {
    id: string;
    tenantEmail?: string;
    unitId?: string;
    unitNumber?: string;
    invoiceId?: string;
    billingPeriod?: string;
    amountPaid: number;
    type: string;
    transactionId?: string;
    paymentMode?: string | null;
    paymentReference?: string | null;
    paymentNote?: string | null;
    settledBy?: string;
    createdAt: string;
    deleted?: boolean;
}

export interface MasterLedgerRowForBackfill extends LedgerRowForBackfill {
    masterInvoiceId?: string;
}

/** Shape of an existing `dailyLedger` row, as needed to compute dedupe keys. */
export interface ExistingDailyLedgerRow {
    direction: string;
    invoiceId?: string;
    amount: number;
    createdAt: string;
    deleted?: boolean;
}

export interface BackfillPlanRow {
    /** Dedupe key — also written onto the row so re-runs are idempotent. */
    key: string;
    data: Record<string, unknown>;
}

const DAILY_LEDGER_AUTOSETTLE_TXN = "DAILY_LEDGER_AUTOSETTLE";
const SINGLE_SETTLEMENT_TYPES = new Set(["payment", "partial-payment"]);

/** Stable dedupe key shared by live writes (paymentPlan.ts) and this backfill. */
export function dailyLedgerDedupeKey(invoiceId: string, amount: number, createdAt: string): string {
    return `${invoiceId}|${amount}|${createdAt}`;
}

/** Build the set of dedupe keys already present in `dailyLedger`. */
export function buildExistingInflowKeySet(rows: ExistingDailyLedgerRow[]): Set<string> {
    const set = new Set<string>();
    for (const r of rows) {
        if (r.deleted) continue;
        if (r.direction !== "inflow") continue;
        if (!r.invoiceId) continue;
        set.add(dailyLedgerDedupeKey(r.invoiceId, Number(r.amount) || 0, r.createdAt));
    }
    return set;
}

/**
 * Plan backfill rows for single-invoice settlements (`ledger` collection —
 * Collections tab "Mark as Paid" / partial payment, Admin "Approve Invoice").
 */
export function planLedgerBackfill(
    rows: LedgerRowForBackfill[],
    existingKeys: Set<string>,
    now: string,
): BackfillPlanRow[] {
    const out: BackfillPlanRow[] = [];
    for (const row of rows) {
        if (row.deleted) continue;
        if (!SINGLE_SETTLEMENT_TYPES.has(row.type)) continue;
        if (row.transactionId === DAILY_LEDGER_AUTOSETTLE_TXN) continue;
        if (!row.invoiceId) continue;
        const amount = Math.max(0, Number(row.amountPaid) || 0);
        if (amount <= 0) continue;

        const key = dailyLedgerDedupeKey(row.invoiceId, amount, row.createdAt);
        if (existingKeys.has(key)) continue;

        out.push({
            key,
            data: {
                date: (row.createdAt || now).slice(0, 10),
                direction: "inflow",
                category: "rent",
                amount,
                description: `${row.unitNumber || "Unit"} · ${row.billingPeriod || "Ad-Hoc"}`,
                unitId: row.unitId || "",
                unitNumber: row.unitNumber || "",
                tenantEmail: row.tenantEmail || "",
                invoiceId: row.invoiceId,
                paymentMode: row.paymentMode || null,
                paymentReference: row.paymentReference || null,
                note: row.paymentNote || null,
                recordedBy: row.settledBy || "backfill",
                createdBy: row.settledBy || "backfill",
                createdAt: row.createdAt,
                backfilled: true,
                backfilledAt: now,
                backfilledFromLedgerId: row.id,
            },
        });
    }
    return out;
}

/**
 * Plan backfill rows for corporate master-invoice settlements (`ledgerEntries`
 * collection — one consolidated row per settlement, matching how
 * `buildMasterSettlePlan` writes it live: grouped by
 * (masterInvoiceId, transactionId, createdAt) and summed across children.
 */
export function planMasterLedgerBackfill(
    rows: MasterLedgerRowForBackfill[],
    existingKeys: Set<string>,
    now: string,
): BackfillPlanRow[] {
    const groups = new Map<string, MasterLedgerRowForBackfill[]>();
    for (const row of rows) {
        if (row.deleted) continue;
        if (row.type !== "master-payment") continue;
        if (!row.masterInvoiceId) continue;
        const amount = Number(row.amountPaid) || 0;
        if (amount <= 0) continue;
        const gKey = `${row.masterInvoiceId}|${row.transactionId || ""}|${row.createdAt}`;
        const bucket = groups.get(gKey);
        if (bucket) bucket.push(row);
        else groups.set(gKey, [row]);
    }

    const out: BackfillPlanRow[] = [];
    for (const group of groups.values()) {
        const total = group.reduce((s, r) => s + (Number(r.amountPaid) || 0), 0);
        if (total <= 0) continue;
        const first = group[0];
        const key = dailyLedgerDedupeKey(first.masterInvoiceId!, total, first.createdAt);
        if (existingKeys.has(key)) continue;

        const unitNumbers = group.map((r) => r.unitNumber).filter(Boolean).join(", ");
        out.push({
            key,
            data: {
                date: (first.createdAt || now).slice(0, 10),
                direction: "inflow",
                category: "Rent (Master)",
                amount: total,
                description: `${first.tenantEmail || "Corporate tenant"}${unitNumbers ? ` · ${unitNumbers}` : ""}`,
                invoiceId: first.masterInvoiceId,
                paymentMode: first.paymentMode || null,
                paymentReference: first.paymentReference || null,
                recordedBy: first.settledBy || "backfill",
                createdBy: first.settledBy || "backfill",
                createdAt: first.createdAt,
                backfilled: true,
                backfilledAt: now,
                backfilledFromLedgerIds: group.map((r) => r.id),
            },
        });
    }
    return out;
}
