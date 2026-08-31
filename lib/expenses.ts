/**
 * Pure helpers for expense allocation & settlement calculations.
 * Kept free of Firebase imports so they can be unit tested in isolation.
 */

export interface ExpenseLike {
    amount: number | string;
    settled?: boolean;
}

export interface AllocationLike {
    amount: number | string;
}

export interface FundSummary {
    /** Sum of every allocation added. */
    totalAllocated: number;
    /** Sum of expenses that have been marked settled (deducted from the fund). */
    settledTotal: number;
    /** Sum of expenses still awaiting settlement. */
    pendingTotal: number;
    /** totalAllocated - settledTotal. Negative means the fund was overspent. */
    remaining: number;
    /** True when settled expenses exceed the allocated amount. */
    isOverspent: boolean;
    /** Amount by which the fund was exceeded (0 when not overspent). */
    overspentBy: number;
}

const toNumber = (v: number | string | undefined | null): number => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
};

export const sumAmounts = (items: { amount: number | string }[]): number =>
    items.reduce((sum, i) => sum + toNumber(i.amount), 0);

/**
 * Computes the allocated-fund summary given all allocations and all expenses.
 * Only *settled* expenses are deducted from the allocated amount.
 */
export function calculateFundSummary(
    allocations: AllocationLike[],
    expenses: ExpenseLike[]
): FundSummary {
    const totalAllocated = sumAmounts(allocations);
    const settledTotal = sumAmounts(expenses.filter(e => e.settled === true));
    const pendingTotal = sumAmounts(expenses.filter(e => e.settled !== true));
    const remaining = totalAllocated - settledTotal;

    return {
        totalAllocated,
        settledTotal,
        pendingTotal,
        remaining,
        isOverspent: remaining < 0,
        overspentBy: remaining < 0 ? Math.abs(remaining) : 0,
    };
}

export type ExpenseFilter = "all" | "unsettled" | "settled";

/** Filters an expense list by settlement status. */
export function filterExpenses<T extends ExpenseLike>(expenses: T[], filter: ExpenseFilter): T[] {
    if (filter === "settled") return expenses.filter(e => e.settled === true);
    if (filter === "unsettled") return expenses.filter(e => e.settled !== true);
    return expenses;
}

/**
 * Builds the Firestore update payload for toggling an expense's settled state.
 * `deleteSentinel` is passed in so callers can supply firestore's deleteField().
 */
export function buildSettlementUpdate(
    currentlySettled: boolean | undefined,
    settledBy: string,
    deleteSentinel: unknown,
    now: string = new Date().toISOString()
) {
    const nextSettled = !currentlySettled;
    return nextSettled
        ? { settled: true, settledAt: now, settledBy }
        : { settled: false, settledAt: deleteSentinel, settledBy: deleteSentinel };
}
