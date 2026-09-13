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
