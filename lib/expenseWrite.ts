/**
 * Writing expenses (§4.4 / §4.5 of `docs/EMPLOYEE_WORKFLOW_IMPROVEMENTS.md`).
 *
 * Every expense has a mirrored `dailyLedger` outflow, cross-linked both ways
 * (`expenses.dailyLedgerId` ↔ `dailyLedger.expenseId`). These helpers build
 * both documents so callers can commit them in ONE `writeBatch` with pre-minted
 * ids — no half-written expense if the connection drops — and build the soft
 * delete that is applied to both. Dates are local (IST), not UTC, and closed
 * days (`dayCloses`, §3.3) are refused.
 *
 * Pure and framework-free so the payloads can be unit-tested.
 */

import { isDayClosed, type DayClose } from "@/lib/dayClose";
import { localDateKey } from "@/lib/payments";

export interface ExpenseWriteInput {
    expenseId: string;
    ledgerId: string;
    amount: number;
    category: string;
    description: string;
    /** YYYY-MM-DD; defaults to today's local date. */
    date?: string;
    buildingId?: string;
    buildingName?: string;
    receiptUrl?: string;
    createdBy: string;
    /** ISO timestamp. */
    now: string;
    /** Where it was entered, e.g. "admin-expense". */
    source?: string;
}

/** Today's date in the device's local time zone (IST for staff). */
export const todayLocal = () => localDateKey(new Date());

/** The expense document and its `dailyLedger` mirror, already cross-linked. */
export function buildExpenseWrite(input: ExpenseWriteInput): { expense: Record<string, unknown>; ledger: Record<string, unknown> } {
    const date = input.date || localDateKey(new Date(input.now));
    const buildingName = input.buildingName || "General";
    const extra = {
        ...(input.receiptUrl ? { receiptUrl: input.receiptUrl } : {}),
        ...(input.source ? { source: input.source } : {}),
    };
    return {
        expense: {
            amount: input.amount,
            category: input.category,
            description: input.description,
            date,
            buildingId: input.buildingId || "",
            buildingName,
            dailyLedgerId: input.ledgerId,
            ...extra,
            createdBy: input.createdBy,
            createdAt: input.now,
        },
        ledger: {
            date,
            direction: "outflow",
            category: (input.category || "other").toLowerCase(),
            buildingId: input.buildingId || "",
            buildingName,
            unitId: "",
            unitNumber: "",
            amount: input.amount,
            description: input.description,
            expenseId: input.expenseId,
            ...extra,
            createdBy: input.createdBy,
            createdAt: input.now,
        },
    };
}

/** Message when an expense can't be saved / deleted on this date, or null when it can. */
export function closedDayError(date: string, closes: Pick<DayClose, "date" | "status">[]): string | null {
    return isDayClosed(closes, date)
        ? `${date} is closed in the Daily ledger. Pick another date, or ask the admin to reopen that day.`
        : null;
}

/** Soft-delete patch applied to the expense and its `dailyLedger` mirror (rules require who + when). */
export function softDeletePatch(by: string, reason: string, now: string) {
    return { deleted: true, deleteReason: reason.trim(), deletedBy: by, deletedAt: now } as const;
}

export interface MirrorRow {
    id: string;
    direction?: string;
    expenseId?: string;
    deleted?: boolean;
    amount?: number;
    date?: string;
    description?: string;
}

export interface ExpenseDocLike {
    id: string;
    deleted?: boolean;
}

/**
 * Daily-ledger outflows still counted although their expense is gone: the
 * expense was hard-deleted (old admin 🗑), or soft-deleted without the
 * cascade reaching the mirror. They distort the Daily totals and day closes.
 */
export function orphanedExpenseMirrors<R extends MirrorRow>(ledger: R[], expenses: ExpenseDocLike[]): R[] {
    const byId = new Map(expenses.map(e => [e.id, e]));
    return ledger.filter(r => {
        if (r.direction !== "outflow" || r.deleted || !r.expenseId) return false;
        const exp = byId.get(r.expenseId);
        return !exp || exp.deleted === true;
    });
}
