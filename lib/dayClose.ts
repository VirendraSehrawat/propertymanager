/**
 * End-of-day close for the Daily ledger (§3.3 of
 * `docs/EMPLOYEE_WORKFLOW_IMPROVEMENTS.md`). The employee counts the cash in
 * hand, records what was handed to the owner, and the difference against the
 * expected cash is saved as a `dayCloses/{YYYY-MM-DD}` record. The next day's
 * opening cash is the previous close's carried-forward cash.
 *
 * Expected cash = opening cash + cash inflows − outflows. Outflows in the
 * Daily ledger are cash the employee spent on site, so all of them are
 * deducted. UPI / bank / cheque inflows are listed separately to match against
 * the phone or bank statement. Inflows without a payment mode must be given
 * one before the day can be closed.
 *
 * Pure and framework-free so the arithmetic can be unit-tested.
 */

import { splitInflowByMode } from "@/lib/payments";

export interface DayCloseEntry {
    id: string;
    date: string;
    direction: "inflow" | "outflow" | string;
    amount: number;
    paymentMode?: string | null;
    deleted?: boolean;
}

/** Totals for one day, across all buildings. */
export interface DaySummary {
    cashIn: number;
    /** UPI, bank, cheque and other non-cash inflows. */
    digitalIn: number;
    /** Inflows with no payment mode — must be fixed before closing. */
    unspecifiedIn: number;
    unspecifiedIds: string[];
    cashOut: number;
    inflowCount: number;
    outflowCount: number;
}

/** The figures a close froze, kept when an admin reopens the day. */
export interface DayCloseSnapshot {
    openingCash: number;
    cashIn: number;
    digitalIn: number;
    cashOut: number;
    expectedCash: number;
    actualCash: number;
    difference: number;
    handedToOwner: number;
    closingCash: number;
    note: string;
    closedBy: string;
    closedAt: string;
    reopenedBy?: string;
    reopenedAt?: string;
    reopenReason?: string;
}

export interface DayClose extends DayCloseSnapshot {
    /** Same as the document id. */
    date: string;
    status: "closed" | "reopened";
    /** Date of the close the opening cash was carried from; null when typed in. */
    openingFromDate: string | null;
    inflowCount: number;
    outflowCount: number;
    /** Set by an admin once a non-zero difference has been looked at. */
    reviewedBy?: string;
    reviewedAt?: string;
    /** Earlier closes of this day, oldest first (each followed by a reopen). */
    history?: DayCloseSnapshot[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeDay(entries: DayCloseEntry[], date: string): DaySummary {
    const rows = entries.filter(e => e.date === date && !e.deleted);
    const split = splitInflowByMode(rows);
    const inflows = rows.filter(e => e.direction === "inflow");
    const outflows = rows.filter(e => e.direction === "outflow");
    return {
        cashIn: round2(split.cash),
        digitalIn: round2(split.digital),
        unspecifiedIn: round2(split.unspecified),
        unspecifiedIds: inflows.filter(e => !e.paymentMode).map(e => e.id),
        cashOut: round2(outflows.reduce((s, e) => s + Number(e.amount || 0), 0)),
        inflowCount: inflows.length,
        outflowCount: outflows.length,
    };
}

/** True when the day has a close in force (not reopened). */
export function isDayClosed(closes: Pick<DayClose, "date" | "status">[], date: string): boolean {
    return closes.some(c => c.date === date && c.status === "closed");
}

/** The latest close strictly before `date`, if any. */
export function previousClose<C extends Pick<DayClose, "date" | "status">>(closes: C[], date: string): C | undefined {
    return closes
        .filter(c => c.status === "closed" && c.date < date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
}

/**
 * Days with ledger entries between the previous close and `date` that were
 * never closed. Their cash would be skipped in the carried-forward opening, so
 * they must be closed first (oldest first).
 */
export function unclosedDaysBefore(
    entries: DayCloseEntry[],
    closes: Pick<DayClose, "date" | "status">[],
    date: string,
): string[] {
    const prev = previousClose(closes, date);
    // Without any earlier close there is nothing to carry forward from, so
    // older history doesn't block the first close.
    if (!prev) return [];
    const closed = new Set(closes.filter(c => c.status === "closed").map(c => c.date));
    const days = new Set(
        entries.filter(e => !e.deleted && e.date > prev.date && e.date < date && !closed.has(e.date)).map(e => e.date),
    );
    return [...days].sort();
}

export interface DayCloseInput {
    date: string;
    summary: DaySummary;
    /** Carried forward from `openingFrom`, or typed in when there is no earlier close. */
    openingCash: number;
    openingFrom?: Pick<DayClose, "date"> | null;
    actualCash: number;
    handedToOwner: number;
    note: string;
    closedBy: string;
    now: string;
    /** The reopened close being replaced, if any. */
    existing?: DayClose | null;
}

export function expectedCash(openingCash: number, summary: Pick<DaySummary, "cashIn" | "cashOut">): number {
    return round2(openingCash + summary.cashIn - summary.cashOut);
}

/** Problems that stop the close from being saved; empty when it can be saved. */
export function dayCloseErrors(input: Omit<DayCloseInput, "closedBy" | "now" | "existing">): string[] {
    const errors: string[] = [];
    const { summary, actualCash, handedToOwner, openingCash, note } = input;
    if (summary.unspecifiedIds.length > 0) {
        errors.push(`${summary.unspecifiedIds.length} inflow${summary.unspecifiedIds.length !== 1 ? "s have" : " has"} no payment mode — set it on each row first.`);
    }
    if (![actualCash, handedToOwner, openingCash].every(n => Number.isFinite(n) && n >= 0)) {
        errors.push("Amounts can't be negative.");
    }
    if (handedToOwner > actualCash) errors.push("Handed to the owner can't be more than the cash counted.");
    const diff = round2(actualCash - expectedCash(openingCash, summary));
    if (diff !== 0 && !note.trim()) errors.push("Add a note explaining the difference.");
    return errors;
}

/** The `dayCloses/{date}` document for a close. */
export function buildDayClose(input: DayCloseInput): DayClose {
    const { date, summary, openingCash, openingFrom, actualCash, handedToOwner, note, closedBy, now, existing } = input;
    const expected = expectedCash(openingCash, summary);
    const history = existing
        ? [...(existing.history || []), snapshotOf(existing)]
        : undefined;
    return {
        date,
        status: "closed",
        openingCash: round2(openingCash),
        openingFromDate: openingFrom?.date ?? null,
        cashIn: summary.cashIn,
        digitalIn: summary.digitalIn,
        cashOut: summary.cashOut,
        inflowCount: summary.inflowCount,
        outflowCount: summary.outflowCount,
        expectedCash: expected,
        actualCash: round2(actualCash),
        difference: round2(actualCash - expected),
        handedToOwner: round2(handedToOwner),
        closingCash: round2(actualCash - handedToOwner),
        note: note.trim(),
        closedBy,
        closedAt: now,
        ...(history ? { history } : {}),
    };
}

function snapshotOf(c: DayClose): DayCloseSnapshot {
    const snap: DayCloseSnapshot = {
        openingCash: c.openingCash, cashIn: c.cashIn, digitalIn: c.digitalIn, cashOut: c.cashOut,
        expectedCash: c.expectedCash, actualCash: c.actualCash, difference: c.difference,
        handedToOwner: c.handedToOwner, closingCash: c.closingCash, note: c.note,
        closedBy: c.closedBy, closedAt: c.closedAt,
    };
    if (c.reopenedBy) snap.reopenedBy = c.reopenedBy;
    if (c.reopenedAt) snap.reopenedAt = c.reopenedAt;
    if (c.reopenReason) snap.reopenReason = c.reopenReason;
    return snap;
}

/**
 * True when the day's entries no longer match what the close froze — e.g. a
 * payment recorded in Collections after the day was closed.
 */
export function changedSinceClose(close: DayClose, summary: DaySummary): boolean {
    return close.cashIn !== summary.cashIn
        || close.digitalIn !== summary.digitalIn
        || close.cashOut !== summary.cashOut
        || close.inflowCount !== summary.inflowCount
        || close.outflowCount !== summary.outflowCount
        || summary.unspecifiedIn > 0;
}

/** Closes with a non-zero difference that no admin has reviewed yet, newest first. */
export function closesNeedingReview<C extends Pick<DayClose, "date" | "status" | "difference" | "reviewedAt">>(closes: C[]): C[] {
    return closes
        .filter(c => c.status === "closed" && c.difference !== 0 && !c.reviewedAt)
        .sort((a, b) => b.date.localeCompare(a.date));
}
