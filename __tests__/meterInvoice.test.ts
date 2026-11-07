/**
 * Unit tests for lib/meterInvoice.ts — Meter tab sanity checks, safe
 * overrides of existing invoices, and the pro-rated first invoice on move-in.
 */

import { describe, it, expect } from "vitest";
import {
    buildMeterInvoice,
    buildMoveInInvoice,
    checkMeterReading,
    meterOverrideDecision,
    moveInRent,
    recentConsumption,
    type MeterHistoryInvoice,
} from "@/lib/meterInvoice";

const unit = { id: "u1", unitNumber: "101", tenantEmail: "t@x.com", baseRent: 5000, lastMeterReading: 1000 };
const NOW = "2026-10-05T10:00:00.000Z";

// -----------------------------------------------------------------
// recentConsumption / checkMeterReading
// -----------------------------------------------------------------
describe("recentConsumption", () => {
    const invoices: MeterHistoryInvoice[] = [
        { id: "a", unitId: "u1", billingPeriod: "June 2026", electricityConsumed: 60 },
        { id: "b", unitId: "u1", billingPeriod: "July 2026", electricityConsumed: 100 },
        { id: "c", unitId: "u1", billingPeriod: "August 2026", electricityConsumed: 90 },
        { id: "d", unitId: "u1", billingPeriod: "September 2026", electricityConsumed: 110 },
        { id: "e", unitId: "u1", billingPeriod: "October 2026", electricityConsumed: 999 }, // the month being billed
        { id: "f", unitId: "u1", billingPeriod: "September 2026 (Transfer)", electricityConsumed: 5, isCustom: true },
        { id: "g", unitId: "u1", billingPeriod: "May 2026", electricityConsumed: 400, meterChanged: true },
        { id: "h", unitId: "u2", billingPeriod: "September 2026", electricityConsumed: 700 },
    ];

    it("returns the last 3 regular months before the billing month, newest first", () => {
        expect(recentConsumption(invoices, "u1", "2026-10")).toEqual([110, 90, 100]);
    });
});

describe("checkMeterReading", () => {
    it("blocks a reading below the previous one", () => {
        const c = checkMeterReading({ previousReading: 1000, currentReading: 980 });
        expect(c.belowPrevious).toBe(true);
        expect(c.unitsConsumed).toBe(0);
    });

    it("allows a lower reading when the meter changed or manual units are given", () => {
        expect(checkMeterReading({ previousReading: 1000, currentReading: 5, meterChanged: true, manualUnits: 80 }).belowPrevious).toBe(false);
        expect(checkMeterReading({ previousReading: 1000, currentReading: 980, manualUnits: 80 }).belowPrevious).toBe(false);
    });

    it("flags consumption above 2× the recent average", () => {
        const history = [100, 90, 110];
        expect(checkMeterReading({ previousReading: 1000, currentReading: 1200 }, history)).toMatchObject({ average: 100, isSpike: false });
        expect(checkMeterReading({ previousReading: 1000, currentReading: 1201 }, history)).toMatchObject({ unitsConsumed: 201, isSpike: true });
    });

    it("never flags a spike without history", () => {
        expect(checkMeterReading({ previousReading: 0, currentReading: 5000 }, []).isSpike).toBe(false);
    });
});

// -----------------------------------------------------------------
// meterOverrideDecision / buildMeterInvoice
// -----------------------------------------------------------------
describe("meterOverrideDecision", () => {
    it("treats a missing invoice as new and an unpaid one as a plain override", () => {
        expect(meterOverrideDecision(null, 5000)).toEqual({ kind: "new" });
        expect(meterOverrideDecision({ status: "unpaid", totalAmount: 5000 }, 5200)).toEqual({ kind: "override", status: "unpaid", amountPaid: 0 });
    });

    it("keeps payments: paid stays paid when covered, partial becomes pending", () => {
        expect(meterOverrideDecision({ status: "paid", amountPaid: 5500 }, 5500)).toMatchObject({ kind: "override", status: "paid" });
        expect(meterOverrideDecision({ status: "paid", amountPaid: 5500 }, 5800)).toMatchObject({ kind: "override", status: "pending", amountPaid: 5500 });
    });

    it("blocks when the new total is below what was paid, or the invoice is grouped / written off", () => {
        expect(meterOverrideDecision({ status: "paid", amountPaid: 5500 }, 5200).kind).toBe("blocked");
        expect(meterOverrideDecision({ status: "unpaid", masterInvoiceId: "m1" }, 5200).kind).toBe("blocked");
        expect(meterOverrideDecision({ status: "written-off" }, 5200).kind).toBe("blocked");
    });
});

describe("buildMeterInvoice", () => {
    const base = { unit, billingMonth: "2026-10", defaultRate: 10, invoices: [], now: NOW };

    it("builds a new invoice with rent, electricity and a meter photo", () => {
        const r = buildMeterInvoice({ ...base, input: { previousReading: 1000, currentReading: 1050, meterPhotoUrl: "https://img/1.jpg" } });
        expect(r.invoiceId).toBe("inv_u1_10_2026");
        expect(r.totalAmount).toBe(5500);
        expect(r.lastMeterReading).toBe(1050);
        expect(r.fields).toMatchObject({
            status: "unpaid", transactionId: "", electricityConsumed: 50, billingPeriod: "October 2026",
            billingYm: "2026-10", meterPhotoUrl: "https://img/1.jpg",
        });
        expect(r.clearKeys).toEqual(expect.arrayContaining(["meterChanged", "manualUnitsReason", "carryForward"]));
    });

    it("does not reopen a paid invoice: keeps its transaction id and paidAt", () => {
        const existing = { status: "paid", amountPaid: 5500, paidAt: "2026-10-02T00:00:00Z", transactionId: "UPI:1" };
        const r = buildMeterInvoice({ ...base, existing, input: { previousReading: 1000, currentReading: 1050 } });
        expect(r.fields.status).toBe("paid");
        expect(r.fields).not.toHaveProperty("transactionId");
        expect(r.fields).not.toHaveProperty("paidAt");
        expect(r.clearKeys).not.toContain("paidAt");
    });

    it("turns a paid invoice into a partial one when the corrected total is higher", () => {
        const existing = { status: "paid", amountPaid: 5500, paidAt: "2026-10-02T00:00:00Z" };
        const r = buildMeterInvoice({ ...base, existing, input: { previousReading: 1000, currentReading: 1080 } });
        expect(r.totalAmount).toBe(5800);
        expect(r.fields.status).toBe("pending");
        expect(r.clearKeys).toContain("paidAt");
    });

    it("returns no fields when blocked", () => {
        const r = buildMeterInvoice({ ...base, existing: { status: "paid", amountPaid: 6000 }, input: { previousReading: 1000, currentReading: 1050 } });
        expect(r.decision.kind).toBe("blocked");
        expect(r.fields).toEqual({});
    });

    it("stores the new meter's starting reading when the meter changed", () => {
        const r = buildMeterInvoice({ ...base, input: { previousReading: 1000, meterChanged: true, manualUnits: 70, newMeterReading: 3 } });
        expect(r.unitsConsumed).toBe(70);
        expect(r.lastMeterReading).toBe(3);
        expect(r.fields.meterChanged).toBe(true);
    });
});

// -----------------------------------------------------------------
// Move-in
// -----------------------------------------------------------------
describe("moveInRent", () => {
    it("pro-rates to the 1st of next month when no payment day is set", () => {
        const r = moveInRent(31000, "2026-10-15");
        expect(r).toMatchObject({ days: 17, rent: 17000, fullMonth: false, billingMonth: "2026-10" });
        expect(r.rentPeriod).toBe("15 Oct 2026 – 1 Nov 2026");
    });

    it("charges a full month when moving in on the payment day", () => {
        expect(moveInRent(9000, "2026-10-08", 8)).toMatchObject({ rent: 9000, fullMonth: true, days: 31 });
    });

    it("runs past a full month when the payment day is later in the month", () => {
        // 3 Oct → 5 Nov = 33 days at the October daily rate.
        expect(moveInRent(31000, "2026-10-03", 5)).toMatchObject({ days: 33, rent: 33000 });
    });

    it("clamps the payment day to a short following month", () => {
        expect(moveInRent(3100, "2026-01-31", 31)).toMatchObject({ fullMonth: true, rentPeriod: "31 Jan 2026 – 28 Feb 2026" });
    });
});

describe("buildMoveInInvoice", () => {
    it("creates a rent-only invoice stamped as the move-in month", () => {
        const { invoiceId, fields } = buildMoveInInvoice({
            unit: { ...unit, baseRent: 31000 }, tenantEmail: "new@x.com", moveInDate: "2026-10-15", openingReading: 1234, now: NOW,
        });
        expect(invoiceId).toBe("inv_u1_movein_2026-10-15");
        expect(fields).toMatchObject({
            tenantEmail: "new@x.com", baseRent: 17000, totalAmount: 17000, electricityCharge: 0,
            previousReading: 1234, currentReading: 1234, billingPeriod: "October 2026 (Move-in)",
            status: "unpaid", isCustom: true,
        });
    });
});

import { buildCustomInvoice, inclusiveDays, proratedRent } from "@/lib/customInvoice";

describe("custom invoice", () => {
    it("counts inclusive days and prorates rent per day", () => {
        expect(inclusiveDays("2026-10-10", "2026-10-14")).toBe(5);
        expect(inclusiveDays("2026-10-14", "2026-10-10")).toBe(0);
        expect(proratedRent(3100, "2026-10-10", "2026-10-14")).toBe(500);
    });
    it("adds tasks to rent and drops blank ones", () => {
        const inv = buildCustomInvoice({
            unit: { id: "u1", unitNumber: "101", baseRent: 3100 },
            tenantEmail: "t@x.com", from: "2026-10-10", to: "2026-10-14", includeRent: true,
            tasks: [{ description: "Plumbing", amount: 250 }, { description: "", amount: 0 }],
        });
        expect(inv.total).toBe(750);
        expect(inv.fields.billingPeriod).toBe("October 2026 (Custom)");
        expect(inv.fields.customItems).toHaveLength(1);
    });
});
