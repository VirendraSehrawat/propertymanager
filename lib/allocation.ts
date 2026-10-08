/**
 * Pure helpers for the partial-payment allocation & carry-forward logic.
 *
 * These functions capture the "money math" that used to live inline inside
 * `components/employee/CollectionsTab.tsx` and `app/employee/page.tsx`.
 *
 * By extracting them here we can:
 *   - Unit-test every branch without spinning up Firestore.
 *   - Guarantee the Employee Home tab, the Settle modal preview and the
 *     Admin Per-Building Collections table all use identical math.
 *
 * All functions are side-effect free and framework-free.
 */

export interface InvoiceAllocationInput {
    /** Total invoice amount (₹). */
    totalAmount: number;
    /** Amount already paid on the invoice before this transaction (₹). */
    amountPaid?: number;
    /** Base rent portion of the invoice (₹). */
    baseRent?: number;
    /** Electricity portion of the invoice (₹). */
    electricityCharge?: number;
}

export interface InvoiceAllocationResult {
    /** Total already paid (accumulated across previous settles). */
    prevPaid: number;
    /** Amount still due on the invoice. */
    remaining: number;
    /** Amount of `received` allocated to Rent (rent-first). */
    towardRent: number;
    /** Amount of `received` allocated to Electricity (fills after rent). */
    towardElectricity: number;
    /** New cumulative amountPaid after this transaction. */
    newAmountPaid: number;
    /** New remaining balance after this transaction. */
    newRemaining: number;
    /** Status the invoice should be flipped to. */
    status: "paid" | "pending";
    /** True when this transaction closes the invoice. */
    fullyPaid: boolean;
    /** Still-due Rent portion BEFORE this transaction (used by the "Rent only" chip). */
    rentDueBefore: number;
    /** Still-due Electricity portion BEFORE this transaction (used by the "Elec only" chip). */
    elecDueBefore: number;
}

/**
 * Split a received payment across an invoice using the rent-first rule.
 *
 * Rent-first: money fills Rent up to still-due Rent, then overflows into
 * Electricity. Anything above the invoice total is clipped (never applies
 * a negative allocation and never over-pays).
 *
 * Used by:
 *   - Collections tab Settle modal (live preview + persisted split)
 *   - Employee Home tab monthly "Collected" tile
 *   - Admin Per-Building Collections table
 */
export function allocatePartialPayment(
    received: number,
    invoice: InvoiceAllocationInput,
): InvoiceAllocationResult {
    const total = Math.max(0, Number(invoice.totalAmount) || 0);
    const rent = Math.max(0, Number(invoice.baseRent) || 0);
    const elec = Math.max(0, Number(invoice.electricityCharge) || 0);
    const prevPaid = Math.max(0, Number(invoice.amountPaid) || 0);
    const remaining = Math.max(0, total - prevPaid);

    // Split previous cumulative paid rent-first (same rule)
    const prevRent = Math.min(prevPaid, rent);
    const prevElec = Math.max(0, prevPaid - rent);
    const rentDueBefore = Math.max(0, rent - prevRent);
    const elecDueBefore = Math.max(0, elec - prevElec);

    const applied = Math.max(0, Math.min(Number(received) || 0, remaining));
    const towardRent = Math.min(applied, rentDueBefore);
    const towardElectricity = Math.min(
        Math.max(0, applied - rentDueBefore),
        elecDueBefore,
    );

    const newAmountPaid = prevPaid + applied;
    const newRemaining = Math.max(0, total - newAmountPaid);
    // Tolerate half-rupee rounding drift
    const fullyPaid = newAmountPaid >= total - 0.5;

    return {
        prevPaid,
        remaining,
        towardRent,
        towardElectricity,
        newAmountPaid,
        newRemaining,
        status: fullyPaid ? "paid" : "pending",
        fullyPaid,
        rentDueBefore,
        elecDueBefore,
    };
}

/**
 * Split an invoice's cumulative amountPaid into Rent / Electricity buckets
 * using the same rent-first rule. Used everywhere we display a Collected
 * total (Home tab tiles, Admin Per-Building Collections table).
 *
 * Special case: when `status === "paid"` and `amountPaid` is missing/zero
 * (legacy invoices from before we started writing `amountPaid`), treat the
 * whole billed amount as collected — that's how the app auto-heals older
 * data without needing a migration.
 */
export function collectedSplit(invoice: {
    status?: string;
    amountPaid?: number;
    baseRent?: number;
    electricityCharge?: number;
    totalAmount?: number;
}): { collectedRent: number; collectedElectricity: number; collectedTotal: number } {
    const rent = Math.max(0, Number(invoice.baseRent) || 0);
    const elec = Math.max(0, Number(invoice.electricityCharge) || 0);
    const total = Math.max(0, Number(invoice.totalAmount) || rent + elec);

    let paid: number;
    if (invoice.status === "paid") {
        // Legacy invoices may have status=paid but amountPaid=0
        paid = Number(invoice.amountPaid) > 0 ? Number(invoice.amountPaid) : total;
    } else {
        paid = Math.max(0, Number(invoice.amountPaid) || 0);
    }
    paid = Math.min(paid, total);

    const collectedRent = Math.min(paid, rent);
    const collectedElectricity = Math.min(Math.max(0, paid - rent), elec);
    return {
        collectedRent,
        collectedElectricity,
        collectedTotal: collectedRent + collectedElectricity,
    };
}

/**
 * Split an invoice's still-outstanding balance into Rent / Electricity
 * buckets using the same rent-first rule as `collectedSplit`.
 *
 *   pendingRent        = max(0, rent − collectedRent)
 *   pendingElectricity = max(0, electricity − collectedElectricity)
 *   pendingTotal       = pendingRent + pendingElectricity
 *
 * Written-off invoices contribute zero pending (they're removed from
 * collections, not still due). "paid" invoices also contribute zero.
 *
 * Used by the Employee Home "Pending Collections" tile, the Collections
 * tab "Pending Rent / Electricity" tiles and the Overdue total — so a
 * partially collected invoice no longer overstates what's still due.
 */
export function pendingSplit(invoice: {
    status?: string;
    amountPaid?: number;
    baseRent?: number;
    electricityCharge?: number;
    totalAmount?: number;
}): { pendingRent: number; pendingElectricity: number; pendingTotal: number } {
    if (invoice.status === "paid" || invoice.status === "written-off") {
        return { pendingRent: 0, pendingElectricity: 0, pendingTotal: 0 };
    }
    const rent = Math.max(0, Number(invoice.baseRent) || 0);
    const elec = Math.max(0, Number(invoice.electricityCharge) || 0);
    const { collectedRent, collectedElectricity } = collectedSplit(invoice);
    const pendingRent = Math.max(0, rent - collectedRent);
    const pendingElectricity = Math.max(0, elec - collectedElectricity);
    return {
        pendingRent,
        pendingElectricity,
        pendingTotal: pendingRent + pendingElectricity,
    };
}

/**
 * Compute how much of a previous unpaid balance rolls into this month's
 * invoice.
 *
 * `runningBalance` is the sum of `ledger.balance` for a given tenant across
 * all their past ledger entries. Convention:
 *   -  ledger.balance < 0  → tenant still owes that much
 *   -  ledger.balance > 0  → tenant paid more than owed (advance / credit)
 *   -  ledger.balance == 0 → invoice fully settled with no remainder
 *
 * The invoice should add the OWED amount and subtract any credit.
 *
 *   carryForward =  −runningBalance
 *
 * i.e. runningBalance −₹2,500  →  carryForward +₹2,500 (adds to invoice)
 *      runningBalance +₹500    →  carryForward −₹500   (advance reduces invoice)
 */
export function computeCarryForward(runningBalance: number): number {
    const rounded = Math.round(Number(runningBalance) || 0);
    // Normalize -0 → 0 so tests using toBe(0) don't flake
    return rounded === 0 ? 0 : -rounded;
}

/**
 * Compute carry-forward directly from a tenant's outstanding invoices.
 *
 * This is the invoice-driven replacement for `computeCarryForward` (which
 * derives carry-forward from the ledger balance). Deriving it from the
 * ledger double-counts partial invoices — the same debt sits both in the
 * open invoice AND as a negative ledger balance, so the next monthly
 * invoice pulled `carryForward` on top of a pending amount that was
 * already visible on its own row.
 *
 * Rules:
 *   - Only "unpaid" / "pending" invoices contribute.
 *   - "paid" and "written-off" are excluded.
 *   - Optionally exclude one invoice by id (the one being generated /
 *     edited right now — we don't want it to reference itself).
 *   - Advance credit (a paid invoice with `amountPaid > totalAmount`)
 *     is not captured here; that lives on the ledger. Callers that need
 *     to apply credit can subtract it separately, but the common case
 *     — outstanding debt from prior partials — is fully covered.
 *
 *   carryForward = Σ (ownCharges − amountPaid)   for open invoices
 *
 * IMPORTANT — why `ownCharges`, not `totalAmount`:
 * Each monthly invoice already rolls the previous balance into its own
 * `totalAmount` (`total = rent + electricity + carryForward`). Summing
 * `totalAmount` across every open invoice therefore counts the oldest dues
 * once per subsequent month — a compounding bug that inflated balances
 * (e.g. a 9,372 month showing 22,188 pending). We instead sum each
 * invoice's OWN charges (`baseRent + electricityCharge`), so every month's
 * dues are counted exactly once. For legacy rows that never stored the
 * split fields we fall back to `totalAmount`.
 */
export interface CarryForwardInvoice {
    id: string;
    status?: string;
    totalAmount?: number;
    amountPaid?: number;
    /** This invoice's own rent charge (excludes any carried-forward balance). */
    baseRent?: number;
    /** This invoice's own electricity charge (excludes any carried-forward balance). */
    electricityCharge?: number;
    /** Human-readable billing period label, e.g. "October 2026". Used to
     *  exclude same-month invoices when `excludeBillingPeriod` is supplied. */
    billingPeriod?: string;
}

/**
 * Outstanding amount contributed by a single invoice toward a tenant's
 * carry-forward, using the invoice's OWN charges (never `totalAmount`, which
 * already embeds prior carry-forwards and would double-count).
 *
 * Falls back to `totalAmount` only for legacy rows that never stored the
 * `baseRent` / `electricityCharge` split.
 */
export function invoiceOwnDue(inv: CarryForwardInvoice): number {
    const hasSplit = inv.baseRent !== undefined || inv.electricityCharge !== undefined;
    const ownCharges = hasSplit
        ? Math.max(0, Number(inv.baseRent || 0)) + Math.max(0, Number(inv.electricityCharge || 0))
        : Number(inv.totalAmount || 0);
    const paid = Number(inv.amountPaid || 0);
    return Math.max(0, ownCharges - paid);
}

export function carryForwardFromInvoices(
    invoices: CarryForwardInvoice[],
    opts: {
        excludeInvoiceId?: string;
        /**
         * When provided, any invoice whose `billingPeriod` matches this value
         * is excluded from the carry-forward sum. Use this to prevent the
         * current month's own (still-unpaid) invoices from inflating the
         * carry-forward of the invoice being generated for that same month.
         *
         * Only invoices from **previous** months should carry forward.
         */
        excludeBillingPeriod?: string;
    } = {},
): number {
    const { excludeInvoiceId, excludeBillingPeriod } = opts;
    let owed = 0;
    for (const inv of invoices) {
        if (!inv) continue;
        if (excludeInvoiceId && inv.id === excludeInvoiceId) continue;
        // Skip invoices that belong to the same billing month as the invoice
        // being generated — carry forward only applies to previous months.
        if (excludeBillingPeriod && inv.billingPeriod === excludeBillingPeriod) continue;
        const status = inv.status || "unpaid";
        if (status !== "unpaid" && status !== "pending") continue;
        owed += invoiceOwnDue(inv);
    }
    return Math.round(owed);
}

/** A single source invoice contributing to a carry-forward balance. */
export interface CarryForwardSource {
    /** The source invoice id. */
    invoiceId: string;
    /** Human-readable billing period the balance is owed for, e.g. "September 2026". */
    billingPeriod: string;
    /** Outstanding amount (₹) still due on that invoice. */
    amount: number;
}

/**
 * Itemised breakdown of a carry-forward balance — which previous month(s)
 * the outstanding dues come from. Mirrors the filtering of
 * {@link carryForwardFromInvoices} but returns one entry per contributing
 * invoice (oldest-first) instead of a single sum.
 *
 * Persist this alongside the invoice so the billing UI can show "Previous
 * Balance Due (September 2026): +₹2,500" instead of an opaque number.
 */
export function carryForwardBreakdown(
    invoices: CarryForwardInvoice[],
    opts: {
        excludeInvoiceId?: string;
        excludeBillingPeriod?: string;
    } = {},
): CarryForwardSource[] {
    const { excludeInvoiceId, excludeBillingPeriod } = opts;
    const sources: CarryForwardSource[] = [];
    for (const inv of invoices) {
        if (!inv) continue;
        if (excludeInvoiceId && inv.id === excludeInvoiceId) continue;
        if (excludeBillingPeriod && inv.billingPeriod === excludeBillingPeriod) continue;
        const status = inv.status || "unpaid";
        if (status !== "unpaid" && status !== "pending") continue;
        const due = Math.round(invoiceOwnDue(inv));
        if (due <= 0) continue;
        sources.push({
            invoiceId: inv.id,
            billingPeriod: inv.billingPeriod || "Previous period",
            amount: due,
        });
    }
    // Oldest-first so the earliest unpaid month shows at the top.
    return sources.sort((a, b) => {
        const da = new Date(a.billingPeriod).getTime();
        const db = new Date(b.billingPeriod).getTime();
        if (isNaN(da) || isNaN(db)) return 0;
        return da - db;
    });
}

/**
 * Compose the final total for a new monthly invoice.
 *
 *   total = max(0, rent + electricity + carryForward)
 *
 * Clamped at zero so a big tenant credit can't produce a negative invoice;
 * any excess credit is left on the ledger for next month.
 */
export function composeInvoiceTotal(input: {
    baseRent: number;
    electricityCharge: number;
    carryForward?: number;
}): { rent: number; electricity: number; carryForward: number; total: number } {
    const rent = Math.max(0, Number(input.baseRent) || 0);
    const electricity = Math.max(0, Number(input.electricityCharge) || 0);
    const carryForward = Math.round(Number(input.carryForward) || 0);
    const total = Math.max(0, rent + electricity + carryForward);
    return { rent, electricity, carryForward, total };
}

/**
 * Strip a human-readable suffix from a billing-period label so that
 * `"October 2026 (relabelled)"` compares equal to `"October 2026"`.
 */
export function stripBillingPeriodSuffix(billingPeriod?: string): string {
    return (billingPeriod || "").replace(/\s*\(.+\)\s*$/, "").trim();
}

/**
 * Month label immediately preceding the given anchor month.
 *
 *   previousMonthLabel("October 2026")  → "September 2026"
 *   previousMonthLabel("January 2026")  → "December 2025"
 *
 * Returns `""` when the anchor is not a parseable month label (e.g. the
 * "all" / "overdue" pseudo-filters used by the Collections tab).
 */
export function previousMonthLabel(anchorMonth?: string): string {
    const anchor = stripBillingPeriodSuffix(anchorMonth);
    if (!anchor) return "";
    const anchorDate = new Date(anchor);
    if (isNaN(anchorDate.getTime())) return "";
    const d = new Date(anchorDate);
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleString("default", { month: "long", year: "numeric" });
}

/** An open invoice considered for carry-forward display. */
export interface CarryForwardItemInput {
    id: string;
    tenantEmail?: string;
    status?: string;
    billingPeriod?: string;
    baseRent?: number;
    electricityCharge?: number;
    totalAmount?: number;
    amountPaid?: number;
    rentPeriod?: string;
    electricityPeriod?: string;
}

/** A single carry-forward line produced by {@link carryForwardItems}. */
export interface CarryForwardItem {
    id: string;
    billingPeriod?: string;
    rentDue: number;
    elecDue: number;
    totalDue: number;
    baseRent?: number;
    electricityCharge?: number;
    rentPeriod?: string;
    electricityPeriod?: string;
}

/**
 * Carry-forward line items for a tenant, scoped to the month *immediately
 * preceding* the anchor month.
 *
 * Business rule: an invoice for the anchor (current) month is NOT
 * carry-forward — carry-forward is strictly the unpaid balance from the
 * previous month. So when October is the anchor only September's open
 * invoices count; when September is the anchor only August's do.
 *
 * When `anchorMonth` is not a parseable month label (e.g. the "all" /
 * "overdue" pseudo-filters) we fall back to every open invoice except those
 * in the anchor period itself.
 *
 * Pure & side-effect-free so the Collections tab UI and regression tests
 * share identical logic.
 */
export function carryForwardItems(
    invoices: CarryForwardItemInput[],
    opts: {
        tenantEmail: string;
        excludeInvoiceId?: string;
        anchorMonth?: string;
    },
): CarryForwardItem[] {
    const { tenantEmail, excludeInvoiceId, anchorMonth } = opts;
    const anchor = stripBillingPeriodSuffix(anchorMonth);
    const prevMonth = previousMonthLabel(anchorMonth);
    const anchorValid = prevMonth !== "";

    return invoices
        .filter(i => (i.tenantEmail || "") === tenantEmail)
        .filter(i => i.status === "unpaid" || i.status === "pending")
        .filter(i => !excludeInvoiceId || i.id !== excludeInvoiceId)
        .filter(i => {
            const bp = stripBillingPeriodSuffix(i.billingPeriod);
            if (anchorValid) {
                // Only the single previous month qualifies as carry-forward.
                return bp === prevMonth;
            }
            // "all" / "overdue": show every open invoice except the anchor itself.
            return !anchor || bp !== anchor;
        })
        .map(i => ({
            id: i.id,
            billingPeriod: i.billingPeriod,
            rentDue: Math.max(0, Number(i.baseRent || 0) - Number(i.amountPaid || 0)),
            elecDue: Math.max(0, Number(i.electricityCharge || 0) - Number(i.amountPaid || 0)),
            totalDue: Math.max(0, Number(i.totalAmount || 0) - Number(i.amountPaid || 0)),
            baseRent: i.baseRent,
            electricityCharge: i.electricityCharge,
            rentPeriod: i.rentPeriod,
            electricityPeriod: i.electricityPeriod,
        }))
        .filter(i => i.totalDue > 0);
}
