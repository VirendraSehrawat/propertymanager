import { describe, it, expect } from "vitest";
import {
    allocatePartialPayment,
    collectedSplit,
    computeCarryForward,
    composeInvoiceTotal,
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
