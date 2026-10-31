/**
 * Unit tests for the Meter tab's "meter round" helpers (lib/meterRound.ts).
 */

import { describe, it, expect } from "vitest";
import { billingMonthLabel, buildMeterRound, meterInvoiceId, nextPendingUnitId } from "@/lib/meterRound";

const MONTH = "2026-10";
const LABEL = billingMonthLabel(MONTH);

const u = (id: string, unitNumber: string, buildingId = "b1") => ({ id, unitNumber, buildingId });
const names = { b1: "Block A", b2: "Block B" };

describe("buildMeterRound", () => {
    it("orders units by building, then unit number numerically", () => {
        const round = buildMeterRound(
            [u("x", "10", "b2"), u("a", "102"), u("b", "11"), u("c", "2", "b2"), u("d", "101")],
            [],
            MONTH,
            names,
        );
        expect(round.stops.map((s) => `${s.buildingName}/${s.unit.unitNumber}`)).toEqual([
            "Block A/11", "Block A/101", "Block A/102", "Block B/2", "Block B/10",
        ]);
    });

    it("marks a unit done via its Meter-tab invoice id, a same-period invoice, or a just-saved id", () => {
        const round = buildMeterRound(
            [u("a", "1"), u("b", "2"), u("c", "3"), u("d", "4")],
            [
                { id: meterInvoiceId("a", MONTH) },
                { id: "bulk-123", unitId: "b", billingPeriod: `${LABEL} (relabelled)` },
                { id: "old", unitId: "d", billingPeriod: "September 2026" },
            ],
            MONTH,
            names,
            new Set(["c"]),
        );
        expect(round.stops.map((s) => s.done)).toEqual([true, true, true, false]);
        expect(round.doneCount).toBe(3);
        expect(round.total).toBe(4);
    });

    it("files units without a known building under 'Other'", () => {
        const round = buildMeterRound([u("a", "1", "missing")], [], MONTH, names);
        expect(round.stops[0].buildingName).toBe("Other");
    });
});

describe("nextPendingUnitId", () => {
    const units = [u("a", "1"), u("b", "2"), u("c", "3"), u("d", "4")];

    it("returns the first pending unit when nothing is selected", () => {
        const round = buildMeterRound(units, [{ id: meterInvoiceId("a", MONTH) }], MONTH, names);
        expect(nextPendingUnitId(round)).toBe("b");
    });

    it("skips done units and wraps around to earlier pending ones", () => {
        const round = buildMeterRound(units, [{ id: meterInvoiceId("d", MONTH) }], MONTH, names);
        expect(nextPendingUnitId(round, "b")).toBe("c");
        expect(nextPendingUnitId(round, "c")).toBe("a"); // d is done → wrap
    });

    it("never returns the current unit, and returns '' when everything else is done", () => {
        const round = buildMeterRound(units, [], MONTH, names, new Set(["a", "b", "d"]));
        expect(nextPendingUnitId(round, "c")).toBe("");
        expect(nextPendingUnitId(round)).toBe("c");
    });
});
