/**
 * Unit tests for payment helpers used by:
 *   - Collections tab → Mark as Paid (buildTransactionId)
 *   - Daily Ledger  → ➕ Inflow auto-settle (computeAutoSettle, pickInvoiceToAutoSettle)
 */

import { describe, it, expect } from "vitest";
import {
    buildTransactionId,
    computeAutoSettle,
    pickInvoiceToAutoSettle,
    type InvoiceLike,
} from "@/lib/payments";

// -----------------------------------------------------------
// buildTransactionId — Collections "Mark as Paid" modal
// -----------------------------------------------------------

describe("buildTransactionId", () => {
    it("returns CASH_COLLECTED for cash mode (ignoring reference)", () => {
        expect(buildTransactionId("cash", "")).toBe("CASH_COLLECTED");
        expect(buildTransactionId("cash", "ignored-ref")).toBe("CASH_COLLECTED");
    });

    it("encodes UPI txn id as UPI:<ref>", () => {
        expect(buildTransactionId("upi", "4XXXXXX8291")).toBe("UPI:4XXXXXX8291");
    });

    it("encodes bank reference as BANK:<ref>", () => {
        expect(buildTransactionId("bank", "REF-123")).toBe("BANK:REF-123");
    });

    it("encodes cheque number as CHEQUE:<ref>", () => {
        expect(buildTransactionId("cheque", "000123")).toBe("CHEQUE:000123");
    });

    it("trims whitespace from the reference", () => {
        expect(buildTransactionId("upi", "  abc123  ")).toBe("UPI:abc123");
    });

    it("falls back to NO_REF when non-cash reference is empty or blank", () => {
        expect(buildTransactionId("upi", "")).toBe("UPI:NO_REF");
        expect(buildTransactionId("upi", "   ")).toBe("UPI:NO_REF");
        expect(buildTransactionId("bank", null)).toBe("BANK:NO_REF");
        expect(buildTransactionId("cheque", undefined)).toBe("CHEQUE:NO_REF");
    });

    it("handles the generic 'other' mode", () => {
        expect(buildTransactionId("other", "adjustment")).toBe("OTHER:adjustment");
    });
});

// -----------------------------------------------------------
// computeAutoSettle — Daily Ledger auto-settle math
// -----------------------------------------------------------

describe("computeAutoSettle", () => {
    it("fully settles an untouched invoice when inflow equals total", () => {
        const inv: InvoiceLike = { id: "i1", totalAmount: 5000 };
        const r = computeAutoSettle(5000, inv);
        expect(r).toEqual({
            applied: 5000,
            newAmountPaid: 5000,
            remaining: 0,
            status: "paid",
            fullySettled: true,
        });
    });

    it("fully settles when inflow exceeds the due amount and caps at total", () => {
        const inv: InvoiceLike = { id: "i1", totalAmount: 5000 };
        const r = computeAutoSettle(7000, inv);
        expect(r.applied).toBe(5000);
        expect(r.newAmountPaid).toBe(5000);
        expect(r.remaining).toBe(0);
        expect(r.status).toBe("paid");
    });

    it("records a partial payment when inflow is less than the due amount", () => {
        const inv: InvoiceLike = { id: "i1", totalAmount: 5000 };
        const r = computeAutoSettle(2000, inv);
        expect(r).toEqual({
            applied: 2000,
            newAmountPaid: 2000,
            remaining: 3000,
            status: "unpaid",
            fullySettled: false,
        });
    });

    it("adds to an existing partial payment and clears the balance", () => {
        const inv: InvoiceLike = { id: "i1", totalAmount: 5000, amountPaid: 2000 };
        const r = computeAutoSettle(3000, inv);
        expect(r.applied).toBe(3000);
        expect(r.newAmountPaid).toBe(5000);
        expect(r.remaining).toBe(0);
        expect(r.status).toBe("paid");
    });

    it("adds to an existing partial payment but stays unpaid when short", () => {
        const inv: InvoiceLike = { id: "i1", totalAmount: 5000, amountPaid: 2000 };
        const r = computeAutoSettle(1000, inv);
        expect(r.applied).toBe(1000);
        expect(r.newAmountPaid).toBe(3000);
        expect(r.remaining).toBe(2000);
        expect(r.status).toBe("unpaid");
    });

    it("treats missing amountPaid as 0", () => {
        const inv: InvoiceLike = { id: "i1", totalAmount: 1000 };
        expect(computeAutoSettle(400, inv).newAmountPaid).toBe(400);
    });

    it("never records a negative applied amount when inflow is 0", () => {
        const inv: InvoiceLike = { id: "i1", totalAmount: 5000 };
        const r = computeAutoSettle(0, inv);
        expect(r.applied).toBe(0);
        expect(r.newAmountPaid).toBe(0);
        expect(r.status).toBe("unpaid");
        expect(r.fullySettled).toBe(false);
    });

    it("treats invalid inflow as 0", () => {
        const inv: InvoiceLike = { id: "i1", totalAmount: 5000 };
        // @ts-expect-error deliberately invalid to prove coercion
        const r = computeAutoSettle("not-a-number", inv);
        expect(r.applied).toBe(0);
    });
});

// -----------------------------------------------------------
// pickInvoiceToAutoSettle — chooses which invoice gets settled
// -----------------------------------------------------------

describe("pickInvoiceToAutoSettle", () => {
    const invoices: InvoiceLike[] = [
        // unit A, older, unpaid, still due
        { id: "a-jul", unitId: "unit-A", status: "unpaid", totalAmount: 5000, amountPaid: 0, createdAt: "2026-07-01T00:00:00Z" },
        // unit A, newer, unpaid, still due
        { id: "a-aug", unitId: "unit-A", status: "unpaid", totalAmount: 5000, amountPaid: 0, createdAt: "2026-08-01T00:00:00Z" },
        // unit A, oldest, but fully paid → should be ignored
        { id: "a-jun", unitId: "unit-A", status: "paid",   totalAmount: 5000, amountPaid: 5000, createdAt: "2026-06-01T00:00:00Z" },
        // unit B invoice — must never be picked for unit A
        { id: "b-aug", unitId: "unit-B", status: "unpaid", totalAmount: 5000, amountPaid: 0, createdAt: "2026-05-01T00:00:00Z" },
    ];

    it("picks the oldest still-due invoice for the given unit + rent category", () => {
        const picked = pickInvoiceToAutoSettle(invoices, "unit-A", "rent");
        expect(picked?.id).toBe("a-jul");
    });

    it("works for electricity and maintenance categories too", () => {
        expect(pickInvoiceToAutoSettle(invoices, "unit-A", "electricity")?.id).toBe("a-jul");
        expect(pickInvoiceToAutoSettle(invoices, "unit-A", "maintenance")?.id).toBe("a-jul");
    });

    it("never picks an invoice belonging to a different unit", () => {
        const picked = pickInvoiceToAutoSettle(invoices, "unit-A", "rent");
        expect(picked?.unitId).toBe("unit-A");
    });

    it("returns null for non-settle categories like deposit or other", () => {
        expect(pickInvoiceToAutoSettle(invoices, "unit-A", "deposit")).toBeNull();
        expect(pickInvoiceToAutoSettle(invoices, "unit-A", "other")).toBeNull();
    });

    it("returns null when no unit is provided", () => {
        expect(pickInvoiceToAutoSettle(invoices, undefined, "rent")).toBeNull();
    });

    it("returns null when the unit has no outstanding invoices", () => {
        const allPaid: InvoiceLike[] = [
            { id: "x", unitId: "unit-C", status: "paid", totalAmount: 1000, amountPaid: 1000, createdAt: "2026-01-01" },
        ];
        expect(pickInvoiceToAutoSettle(allPaid, "unit-C", "rent")).toBeNull();
    });

    it("skips invoices whose balance is already 0 even if status is not 'paid'", () => {
        const edgeCase: InvoiceLike[] = [
            { id: "zero-due", unitId: "unit-D", status: "unpaid", totalAmount: 1000, amountPaid: 1000, createdAt: "2026-01-01" },
            { id: "real-due", unitId: "unit-D", status: "unpaid", totalAmount: 1000, amountPaid: 0,    createdAt: "2026-02-01" },
        ];
        expect(pickInvoiceToAutoSettle(edgeCase, "unit-D", "rent")?.id).toBe("real-due");
    });
});
