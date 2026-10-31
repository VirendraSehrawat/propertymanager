/**
 * Unit tests for lib/followUp.ts — follow-up log and promise-to-pay: promise
 * state (upcoming / due today / broken / kept), labels and validation.
 */

import { describe, it, expect } from "vitest";
import { buildFollowUp, followUpErrors, followUpStatus, type FollowUp, type FollowUpUnit } from "@/lib/followUp";

// Wed 14 Oct 2026, 10:00 local time.
const NOW = new Date(2026, 9, 14, 10);
const at = (day: number, hour = 9) => new Date(2026, 9, day, hour).toISOString();
const fu = (id: string, day: number, outcome: FollowUp["outcome"], extra: Partial<FollowUp> = {}): FollowUp => ({
    id, at: at(day), by: "e@x.com", tenantEmail: "t@x.com", outcome, ...extra,
});
const unit = (followUps: FollowUp[]): FollowUpUnit => ({ id: "u1", tenantEmail: "t@x.com", followUps });

describe("followUpStatus", () => {
    it("is empty when the tenant was never contacted", () => {
        expect(followUpStatus(unit([]), [], NOW)).toEqual({ label: "" });
    });

    it("tracks a promise: upcoming, due today, then broken", () => {
        const promise = (date: string) => followUpStatus(unit([fu("a", 12, "promised", { promisedDate: date })]), [], NOW);
        expect(promise("2026-10-16").promise?.state).toBe("upcoming");
        expect(promise("2026-10-16").label).toMatch(/^Contacted 2 days ago · promised Fri,? 16 Oct$/);
        expect(promise("2026-10-14")).toMatchObject({ promise: { state: "dueToday" }, label: "Contacted 2 days ago · promised today" });
        expect(promise("2026-10-13").promise?.state).toBe("broken");
        expect(promise("2026-10-13").label).toMatch(/broke promise of Tue,? 13 Oct/);
    });

    it("a payment for the unit after the promise keeps it; earlier or other-unit payments don't", () => {
        const u = unit([fu("a", 10, "partial", { promisedDate: "2026-10-12", promisedAmount: 2000 })]);
        expect(followUpStatus(u, [{ unitId: "u1", amountPaid: 500, createdAt: at(9) }, { unitId: "u2", amountPaid: 500, createdAt: at(11) }], NOW).promise?.state).toBe("broken");
        const kept = followUpStatus(u, [{ unitId: "u1", tenantEmail: "T@x.com", amountPaid: 2000, createdAt: at(11) }], NOW);
        expect(kept.promise?.state).toBe("kept");
        expect(kept.label).toBe("Contacted 4 days ago");
    });

    it("uses the latest entry for 'last contacted', and a later dispute cancels the promise", () => {
        const s = followUpStatus(unit([fu("a", 10, "promised", { promisedDate: "2026-10-20" }), fu("b", 13, "noAnswer")]), [], NOW);
        expect(s).toMatchObject({ last: { id: "b" }, lastDaysAgo: 1, promise: { state: "upcoming" } });
        expect(s.label).toMatch(/^No answer yesterday · promised/);
        const d = followUpStatus(unit([fu("a", 10, "promised", { promisedDate: "2026-10-20" }), fu("b", 14, "disputed", { note: "meter" })]), [], NOW);
        expect(d.promise).toBeUndefined();
        expect(d.label).toBe("Contacted today · disputed");
    });

    it("ignores a previous tenant's follow-ups", () => {
        expect(followUpStatus(unit([fu("a", 10, "noAnswer", { tenantEmail: "old@x.com" })]), [], NOW).label).toBe("");
    });
});

describe("followUpErrors / buildFollowUp", () => {
    it("requires a future date for promises, an amount for part-payments and a note for disputes", () => {
        expect(followUpErrors({ outcome: "noAnswer" }, NOW)).toEqual([]);
        expect(followUpErrors({ outcome: "promised" }, NOW)).toEqual(["Pick the date they promised to pay."]);
        expect(followUpErrors({ outcome: "promised", promisedDate: "2026-10-13" }, NOW)).toEqual(["The promised date can't be in the past."]);
        expect(followUpErrors({ outcome: "promised", promisedDate: "2026-10-14" }, NOW)).toEqual([]);
        expect(followUpErrors({ outcome: "partial", promisedDate: "2026-10-15" }, NOW)).toEqual(["Enter the amount they will pay."]);
        expect(followUpErrors({ outcome: "disputed", note: " " }, NOW)).toEqual(["Add a note on what is disputed."]);
    });

    it("leaves out fields that don't apply (Firestore rejects undefined)", () => {
        expect(buildFollowUp({ outcome: "noAnswer", promisedDate: "2026-10-20", note: " ", by: "e", now: "t", id: "f1" }))
            .toEqual({ id: "f1", at: "t", by: "e", outcome: "noAnswer" });
        expect(buildFollowUp({ outcome: "partial", promisedDate: "2026-10-20", promisedAmount: 1500, note: " half now ", tenantEmail: "t@x.com", by: "e", now: "t", id: "f2" }))
            .toEqual({ id: "f2", at: "t", by: "e", tenantEmail: "t@x.com", outcome: "partial", promisedDate: "2026-10-20", promisedAmount: 1500, note: "half now" });
    });
});
