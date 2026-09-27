import { describe, it, expect } from "vitest";
import {
    allocatePartialPayment,
    collectedSplit,
    computeCarryForward,
    composeInvoiceTotal,
    carryForwardFromInvoices,
    pendingSplit,
} from "@/lib/allocation";

describe("allocatePartialPayment (rent-first)", () => {
    const invoice = {
        totalAmount: 6200,
        baseRent: 5000,
        electricityCharge: 1200,
        amountPaid: 0,
    };

    it("full payment closes the invoice", () => {
        const r = allocatePartialPayment(6200, invoice);
        expect(r.towardRent).toBe(5000);
        expect(r.towardElectricity).toBe(1200);
        expect(r.newAmountPaid).toBe(6200);
        expect(r.newRemaining).toBe(0);
        expect(r.status).toBe("paid");
        expect(r.fullyPaid).toBe(true);
    });

    it("rent-only partial: money under rent stays in rent", () => {
        const r = allocatePartialPayment(3000, invoice);
        expect(r.towardRent).toBe(3000);
        expect(r.towardElectricity).toBe(0);
        expect(r.status).toBe("pending");
    });

    it("elec-only chip when rent already fully paid", () => {
        const r = allocatePartialPayment(1000, { ...invoice, amountPaid: 5000 });
        expect(r.rentDueBefore).toBe(0);
        expect(r.elecDueBefore).toBe(1200);
        expect(r.towardRent).toBe(0);
        expect(r.towardElectricity).toBe(1000);
        expect(r.newAmountPaid).toBe(6000);
        expect(r.status).toBe("pending");
    });

    it("overflow: money above rent spills into electricity", () => {
        const r = allocatePartialPayment(5500, invoice);
        expect(r.towardRent).toBe(5000);
        expect(r.towardElectricity).toBe(500);
    });

    it("clips over-payment to invoice remaining", () => {
        const r = allocatePartialPayment(99999, invoice);
        expect(r.towardRent).toBe(5000);
        expect(r.towardElectricity).toBe(1200);
        expect(r.newAmountPaid).toBe(6200);
        expect(r.fullyPaid).toBe(true);
    });

    it("continuing a partial: previous 3000 rent + new 2000 finishes rent + 0 elec", () => {
        const r = allocatePartialPayment(2000, { ...invoice, amountPaid: 3000 });
        expect(r.rentDueBefore).toBe(2000);
        expect(r.elecDueBefore).toBe(1200);
        expect(r.towardRent).toBe(2000);
        expect(r.towardElectricity).toBe(0);
        expect(r.newAmountPaid).toBe(5000);
        expect(r.status).toBe("pending");
    });

    it("continuing a partial: previous 3000 + new 3200 closes invoice", () => {
        const r = allocatePartialPayment(3200, { ...invoice, amountPaid: 3000 });
        expect(r.towardRent).toBe(2000);
        expect(r.towardElectricity).toBe(1200);
        expect(r.fullyPaid).toBe(true);
    });

    it("zero-due invoice: no allocation", () => {
        const r = allocatePartialPayment(1000, { ...invoice, amountPaid: 6200 });
        expect(r.remaining).toBe(0);
        expect(r.towardRent).toBe(0);
        expect(r.towardElectricity).toBe(0);
    });

    it("negative received is treated as zero", () => {
        const r = allocatePartialPayment(-500, invoice);
        expect(r.towardRent).toBe(0);
        expect(r.towardElectricity).toBe(0);
        expect(r.newAmountPaid).toBe(0);
    });

    it("rent-only invoice (no electricity)", () => {
        const r = allocatePartialPayment(5000, {
            totalAmount: 5000,
            baseRent: 5000,
            electricityCharge: 0,
        });
        expect(r.towardRent).toBe(5000);
        expect(r.towardElectricity).toBe(0);
        expect(r.fullyPaid).toBe(true);
    });

    it("tolerates half-rupee rounding at close", () => {
        const r = allocatePartialPayment(6199.7, invoice);
        // Not clamped up, but fullyPaid tolerance kicks in
        expect(r.fullyPaid).toBe(true);
        expect(r.status).toBe("paid");
    });
});

describe("collectedSplit", () => {
    it("splits amountPaid rent-first", () => {
        const s = collectedSplit({
            status: "pending",
            amountPaid: 5500,
            baseRent: 5000,
            electricityCharge: 1200,
            totalAmount: 6200,
        });
        expect(s.collectedRent).toBe(5000);
        expect(s.collectedElectricity).toBe(500);
        expect(s.collectedTotal).toBe(5500);
    });

    it("legacy paid invoice with amountPaid=0 counts as fully collected", () => {
        const s = collectedSplit({
            status: "paid",
            amountPaid: 0,
            baseRent: 5000,
            electricityCharge: 1200,
            totalAmount: 6200,
        });
        expect(s.collectedTotal).toBe(6200);
        expect(s.collectedRent).toBe(5000);
        expect(s.collectedElectricity).toBe(1200);
    });

    it("pending with no amountPaid = 0 collected", () => {
        const s = collectedSplit({
            status: "pending",
            baseRent: 5000,
            electricityCharge: 1200,
            totalAmount: 6200,
        });
        expect(s.collectedTotal).toBe(0);
    });

    it("amountPaid can never exceed total (clipped)", () => {
        const s = collectedSplit({
            status: "paid",
            amountPaid: 99999,
            baseRent: 5000,
            electricityCharge: 1200,
            totalAmount: 6200,
        });
        expect(s.collectedTotal).toBe(6200);
    });
});

describe("computeCarryForward", () => {
    it("no history → zero carry-forward", () => {
        expect(computeCarryForward(0)).toBe(0);
    });

    it("tenant owes ₹2,500 → +₹2,500 added to next invoice", () => {
        expect(computeCarryForward(-2500)).toBe(2500);
    });

    it("tenant has ₹500 advance → −₹500 reduces next invoice", () => {
        expect(computeCarryForward(500)).toBe(-500);
    });

    it("rounds half-rupees", () => {
        expect(computeCarryForward(-2499.6)).toBe(2500);
    });
});

describe("composeInvoiceTotal", () => {
    it("basic sum", () => {
        const r = composeInvoiceTotal({ baseRent: 5000, electricityCharge: 1200 });
        expect(r.total).toBe(6200);
    });

    it("adds owed carry-forward", () => {
        const r = composeInvoiceTotal({
            baseRent: 5000,
            electricityCharge: 1200,
            carryForward: 2500,
        });
        expect(r.total).toBe(8700);
    });

    it("credit reduces invoice", () => {
        const r = composeInvoiceTotal({
            baseRent: 5000,
            electricityCharge: 1200,
            carryForward: -500,
        });
        expect(r.total).toBe(5700);
    });

    it("huge credit is clamped to zero (excess stays on ledger)", () => {
        const r = composeInvoiceTotal({
            baseRent: 5000,
            electricityCharge: 1200,
            carryForward: -20000,
        });
        expect(r.total).toBe(0);
    });
});

describe("carryForwardFromInvoices", () => {
    it("sums remaining on unpaid + pending invoices", () => {
        const cf = carryForwardFromInvoices([
            { id: "a", status: "unpaid", totalAmount: 5000, amountPaid: 0 },
            { id: "b", status: "pending", totalAmount: 3000, amountPaid: 1000 },
        ]);
        expect(cf).toBe(7000);
    });

    it("ignores paid and written-off invoices", () => {
        const cf = carryForwardFromInvoices([
            { id: "a", status: "paid", totalAmount: 5000, amountPaid: 5000 },
            { id: "b", status: "written-off", totalAmount: 4000, amountPaid: 0 },
            { id: "c", status: "unpaid", totalAmount: 2000, amountPaid: 0 },
        ]);
        expect(cf).toBe(2000);
    });

    it("excludes the invoice being generated / edited", () => {
        const cf = carryForwardFromInvoices(
            [
                { id: "self", status: "unpaid", totalAmount: 10000, amountPaid: 0 },
                { id: "old", status: "unpaid", totalAmount: 2988, amountPaid: 0 },
            ],
            { excludeInvoiceId: "self" },
        );
        expect(cf).toBe(2988);
    });

    it("SA-406 regression: prior partial 2988 rolls forward exactly once", () => {
        // Reproduces the reported bug scenario.
        // A prior electricity invoice of 2988 was fully unpaid, and this
        // month's rent+elec invoice should show carryForward = 2988 only
        // (not 2988 + 2988).
        const cf = carryForwardFromInvoices(
            [
                { id: "prior", status: "unpaid", totalAmount: 2988, amountPaid: 0 },
                { id: "current", status: "unpaid", totalAmount: 10488, amountPaid: 0 },
            ],
            { excludeInvoiceId: "current" },
        );
        expect(cf).toBe(2988);
        const composed = composeInvoiceTotal({ baseRent: 7500, electricityCharge: 2988, carryForward: cf });
        expect(composed.total).toBe(7500 + 2988 + 2988); // owed = current rent+elec + prior 2988
    });

    it("returns 0 when nothing is outstanding", () => {
        expect(carryForwardFromInvoices([])).toBe(0);
        expect(
            carryForwardFromInvoices([{ id: "a", status: "paid", totalAmount: 5000, amountPaid: 5000 }]),
        ).toBe(0);
    });

    it("clamps per-invoice due at zero (overpaid rows contribute nothing)", () => {
        const cf = carryForwardFromInvoices([
            { id: "a", status: "unpaid", totalAmount: 5000, amountPaid: 6000 },
        ]);
        expect(cf).toBe(0);
    });
});

describe("pendingSplit (rent-first outstanding)", () => {
    const invoice = {
        status: "pending",
        totalAmount: 6200,
        baseRent: 5000,
        electricityCharge: 1200,
        amountPaid: 0,
    };

    it("fully unpaid invoice → rent + elec are fully pending", () => {
        const p = pendingSplit({ ...invoice, status: "unpaid" });
        expect(p.pendingRent).toBe(5000);
        expect(p.pendingElectricity).toBe(1200);
        expect(p.pendingTotal).toBe(6200);
    });

    it("partial under rent → only rent pending shrinks; electricity still fully due", () => {
        const p = pendingSplit({ ...invoice, amountPaid: 3000 });
        expect(p.pendingRent).toBe(2000);
        expect(p.pendingElectricity).toBe(1200);
        expect(p.pendingTotal).toBe(3200);
    });

    it("partial that exactly covers rent → only electricity pending", () => {
        const p = pendingSplit({ ...invoice, amountPaid: 5000 });
        expect(p.pendingRent).toBe(0);
        expect(p.pendingElectricity).toBe(1200);
        expect(p.pendingTotal).toBe(1200);
    });

    it("partial overflowing into electricity → shrinks both buckets", () => {
        const p = pendingSplit({ ...invoice, amountPaid: 5500 });
        expect(p.pendingRent).toBe(0);
        expect(p.pendingElectricity).toBe(700);
        expect(p.pendingTotal).toBe(700);
    });

    it("paid status → nothing pending", () => {
        expect(
            pendingSplit({ ...invoice, status: "paid", amountPaid: 6200 }).pendingTotal,
        ).toBe(0);
    });

    it("written-off status → nothing pending (excluded from collections)", () => {
        expect(
            pendingSplit({ ...invoice, status: "written-off", amountPaid: 0 }).pendingTotal,
        ).toBe(0);
    });

    it("collectedSplit + pendingSplit always sum to totalAmount for open invoices", () => {
        const inv = { ...invoice, amountPaid: 4200 };
        const c = collectedSplit(inv);
        const p = pendingSplit(inv);
        expect(c.collectedTotal + p.pendingTotal).toBe(inv.totalAmount);
    });
});

describe("employee page — pending totals include partial payments", () => {
    // Simulates the three fixed call sites: HomeTab "Pending Collections",
    // CollectionsTab "Pending Rent / Electricity", CollectionsTab "Overdue".
    const invoices = [
        // Fully unpaid rent+elec
        { id: "a", status: "unpaid", totalAmount: 6200, baseRent: 5000, electricityCharge: 1200, amountPaid: 0 },
        // Partial: ₹3000 already collected (rent-first → 3000 rent, 0 elec)
        { id: "b", status: "pending", totalAmount: 6200, baseRent: 5000, electricityCharge: 1200, amountPaid: 3000 },
        // Partial: rent fully paid, elec half paid (5000 + 600)
        { id: "c", status: "pending", totalAmount: 6200, baseRent: 5000, electricityCharge: 1200, amountPaid: 5600 },
        // Paid — must NOT contribute
        { id: "d", status: "paid", totalAmount: 6200, baseRent: 5000, electricityCharge: 1200, amountPaid: 6200 },
    ];

    it("total pending amount = Σ (total − paid) across open invoices", () => {
        const total = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingTotal, 0);
        // a: 6200 due, b: 3200 due, c: 600 due, d: 0
        expect(total).toBe(6200 + 3200 + 600);
    });

    it("pending rent tile uses rent-first split (partials shrink rent bucket)", () => {
        const totalRent = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingRent, 0);
        // a: 5000, b: 2000 (5000−3000), c: 0, d: 0
        expect(totalRent).toBe(5000 + 2000);
    });

    it("pending electricity tile only fills after rent (partials shrink elec bucket)", () => {
        const totalElec = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingElectricity, 0);
        // a: 1200, b: 1200 (rent not fully covered → elec fully due), c: 600, d: 0
        expect(totalElec).toBe(1200 + 1200 + 600);
    });

    it("rent + elec pending tiles reconcile to the pending-collections KPI", () => {
        const rent = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingRent, 0);
        const elec = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingElectricity, 0);
        const total = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingTotal, 0);
        expect(rent + elec).toBe(total);
    });
});
