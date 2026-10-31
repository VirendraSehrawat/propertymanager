/**
 * Unit tests for lib/dayClose.ts — the end-of-day cash close: expected cash,
 * carried-forward opening, blockers, and detecting changes after a close.
 */

import { describe, it, expect } from "vitest";
import {
    buildDayClose,
    changedSinceClose,
    closesNeedingReview,
    dayCloseErrors,
    isDayClosed,
    previousClose,
    summarizeDay,
    unclosedDaysBefore,
    type DayClose,
    type DayCloseEntry,
} from "@/lib/dayClose";

const D = "2026-10-31";
const entries: DayCloseEntry[] = [
    { id: "a", date: D, direction: "inflow", amount: 5000, paymentMode: "cash" },
    { id: "b", date: D, direction: "inflow", amount: 3000, paymentMode: "upi" },
    { id: "c", date: D, direction: "inflow", amount: 1000, paymentMode: "cheque" },
    { id: "d", date: D, direction: "outflow", amount: 700 },
    { id: "e", date: D, direction: "outflow", amount: 300, deleted: true },
    { id: "f", date: "2026-10-30", direction: "inflow", amount: 9999, paymentMode: "cash" },
];

const close = (date: string, extra: Partial<DayClose> = {}): DayClose => ({
    ...buildDayClose({
        date, summary: summarizeDay([], date), openingCash: 0, actualCash: 0, handedToOwner: 0, note: "", closedBy: "e@x.com", now: "t",
    }),
    ...extra,
});

describe("summarizeDay", () => {
    it("splits the day's inflows by mode and sums outflows, ignoring deleted rows and other days", () => {
        expect(summarizeDay(entries, D)).toEqual({
            cashIn: 5000, digitalIn: 4000, unspecifiedIn: 0, unspecifiedIds: [], cashOut: 700, inflowCount: 3, outflowCount: 1,
        });
    });

    it("lists inflows with no payment mode", () => {
        const s = summarizeDay([...entries, { id: "g", date: D, direction: "inflow", amount: 200 }], D);
        expect(s).toMatchObject({ unspecifiedIn: 200, unspecifiedIds: ["g"] });
    });
});

describe("dayCloseErrors / buildDayClose", () => {
    const summary = summarizeDay(entries, D);
    const base = { date: D, summary, openingCash: 1000, actualCash: 5300, handedToOwner: 0, note: "" };

    it("expected = opening + cash in − outflows; a matching count needs no note", () => {
        expect(dayCloseErrors(base)).toEqual([]);
        const rec = buildDayClose({ ...base, handedToOwner: 5000, closedBy: "e@x.com", now: "2026-10-31T19:00:00Z", openingFrom: { date: "2026-10-30" } });
        expect(rec).toMatchObject({
            status: "closed", expectedCash: 5300, difference: 0, closingCash: 300, openingFromDate: "2026-10-30", digitalIn: 4000,
        });
        expect(rec).not.toHaveProperty("history");
    });

    it("needs a note when the cash doesn't match, and records the shortfall", () => {
        expect(dayCloseErrors({ ...base, actualCash: 5200 })).toEqual(["Add a note explaining the difference."]);
        expect(buildDayClose({ ...base, actualCash: 5200, note: " gave change ", closedBy: "e", now: "t" })).toMatchObject({ difference: -100, note: "gave change" });
    });

    it("blocks inflows without a mode, negative amounts and handing over more than counted", () => {
        const s = summarizeDay([{ id: "g", date: D, direction: "inflow", amount: 200 }], D);
        expect(dayCloseErrors({ ...base, summary: s, actualCash: 1000 })[0]).toMatch(/1 inflow has no payment mode/);
        expect(dayCloseErrors({ ...base, actualCash: -1, note: "x" })).toContain("Amounts can't be negative.");
        expect(dayCloseErrors({ ...base, handedToOwner: 6000 })).toContain("Handed to the owner can't be more than the cash counted.");
    });

    it("keeps the earlier figures in history when a reopened day is closed again", () => {
        const first = { ...buildDayClose({ ...base, closedBy: "e", now: "t1" }), status: "reopened" as const, reopenedBy: "a", reopenReason: "late payment" };
        const again = buildDayClose({ ...base, actualCash: 5400, note: "late cash", closedBy: "e", now: "t2", existing: first });
        expect(again.history).toEqual([expect.objectContaining({ actualCash: 5300, closedAt: "t1", reopenedBy: "a", reopenReason: "late payment" })]);
        expect(again).not.toHaveProperty("reopenedBy");
    });
});

describe("previous close, blockers and locks", () => {
    const closes = [close("2026-10-28"), close("2026-10-29", { status: "reopened" }), close("2026-10-27")];

    it("opens from the latest earlier close in force", () => {
        expect(previousClose(closes, D)?.date).toBe("2026-10-28");
        expect(previousClose(closes, "2026-10-27")).toBeUndefined();
        expect(isDayClosed(closes, "2026-10-28")).toBe(true);
        expect(isDayClosed(closes, "2026-10-29")).toBe(false);
    });

    it("requires unclosed days with entries since the last close to be closed first", () => {
        const rows: DayCloseEntry[] = [
            { id: "1", date: "2026-10-29", direction: "outflow", amount: 1 },
            { id: "2", date: "2026-10-30", direction: "inflow", amount: 1, paymentMode: "cash" },
            { id: "3", date: "2026-10-26", direction: "inflow", amount: 1, paymentMode: "cash" },
        ];
        expect(unclosedDaysBefore(rows, closes, D)).toEqual(["2026-10-29", "2026-10-30"]);
        // No earlier close at all: the first close isn't blocked by old history.
        expect(unclosedDaysBefore(rows, [], D)).toEqual([]);
    });
});

describe("changedSinceClose / closesNeedingReview", () => {
    it("detects entries added after the close", () => {
        const c = buildDayClose({ date: D, summary: summarizeDay(entries, D), openingCash: 0, actualCash: 4300, handedToOwner: 0, note: "", closedBy: "e", now: "t" });
        expect(changedSinceClose(c, summarizeDay(entries, D))).toBe(false);
        const later = summarizeDay([...entries, { id: "z", date: D, direction: "inflow", amount: 500, paymentMode: "cash" }], D);
        expect(changedSinceClose(c, later)).toBe(true);
    });

    it("lists unreviewed closes with a difference, newest first", () => {
        const list = closesNeedingReview([
            close("2026-10-28", { difference: -50 }),
            close("2026-10-30", { difference: 20 }),
            close("2026-10-29", { difference: -10, reviewedAt: "t" }),
            close("2026-10-31"),
            close("2026-10-27", { difference: 5, status: "reopened" }),
        ]);
        expect(list.map(c => c.date)).toEqual(["2026-10-30", "2026-10-28"]);
    });
});
