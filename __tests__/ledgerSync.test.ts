import { describe, it, expect } from "vitest";
import {
    sumLedgerPaidForInvoice,
    deriveInvoiceStatus,
    syncInvoiceFromLedger,
    deriveMasterStatus,
    syncMasterFromChildren,
    type LedgerRowLike,
} from "@/lib/ledgerSync";

/**
 * Regression coverage for the Admin "Master Payment Ledger" correction bug:
 * correcting a ledger row's amountPaid must propagate to the linked apartment
 * invoice (amountPaid + status) and any parent master invoice.
 */
describe("sumLedgerPaidForInvoice", () => {
    const rows: LedgerRowLike[] = [
        { id: "l1", invoiceId: "inv-1", amountPaid: 500 },
        { id: "l2", invoiceId: "inv-1", amountPaid: 256 },
        { id: "l3", invoiceId: "inv-2", amountPaid: 9000 }, // different invoice
    ];

    it("sums all ledger rows for the given invoice", () => {
        expect(sumLedgerPaidForInvoice(rows, "inv-1")).toBe(756);
    });

    it("ignores rows for other invoices", () => {
        expect(sumLedgerPaidForInvoice(rows, "inv-2")).toBe(9000);
    });

    it("applies an override to a single row (pre-snapshot correction)", () => {
        // Correct l2 from 256 → 579 so the invoice total becomes 1079.
        expect(sumLedgerPaidForInvoice(rows, "inv-1", { id: "l2", amountPaid: 579 })).toBe(1079);
    });

    it("returns 0 when no rows match", () => {
        expect(sumLedgerPaidForInvoice(rows, "missing")).toBe(0);
    });

    it("clamps a negative aggregate to 0", () => {
        const bad: LedgerRowLike[] = [{ id: "x", invoiceId: "inv-9", amountPaid: -100 }];
        expect(sumLedgerPaidForInvoice(bad, "inv-9")).toBe(0);
    });
});

describe("deriveInvoiceStatus", () => {
    it("is 'paid' when paid meets total (within tolerance)", () => {
        expect(deriveInvoiceStatus(1079, 1079)).toBe("paid");
        expect(deriveInvoiceStatus(1078.6, 1079)).toBe("paid"); // 0.5 tolerance
    });

    it("is 'pending' for a partial payment", () => {
        expect(deriveInvoiceStatus(756, 1079)).toBe("pending");
    });

    it("is 'unpaid' when nothing is paid", () => {
        expect(deriveInvoiceStatus(0, 1079)).toBe("unpaid");
        expect(deriveInvoiceStatus(-50, 1079)).toBe("unpaid");
    });

    it("is 'unpaid' when the invoice total is zero (nothing to pay)", () => {
        expect(deriveInvoiceStatus(0, 0)).toBe("unpaid");
    });
});

describe("syncInvoiceFromLedger", () => {
    const rows: LedgerRowLike[] = [
        { id: "l1", invoiceId: "inv-1", amountPaid: 756 },
    ];

    it("models the reported bug: correcting 756 → 1079 fully settles the invoice", () => {
        const patch = syncInvoiceFromLedger(1079, rows, "inv-1", { id: "l1", amountPaid: 1079 });
        expect(patch).toEqual({ amountPaid: 1079, status: "paid", fullyPaid: true });
    });

    it("correcting downward re-opens a 'paid' invoice as 'pending'", () => {
        const paidRows: LedgerRowLike[] = [{ id: "l1", invoiceId: "inv-1", amountPaid: 1079 }];
        const patch = syncInvoiceFromLedger(1079, paidRows, "inv-1", { id: "l1", amountPaid: 756 });
        expect(patch).toEqual({ amountPaid: 756, status: "pending", fullyPaid: false });
    });

    it("aggregates multiple partial rows", () => {
        const multi: LedgerRowLike[] = [
            { id: "l1", invoiceId: "inv-1", amountPaid: 500 },
            { id: "l2", invoiceId: "inv-1", amountPaid: 300 },
        ];
        const patch = syncInvoiceFromLedger(1000, multi, "inv-1");
        expect(patch).toEqual({ amountPaid: 800, status: "pending", fullyPaid: false });
    });
});

describe("deriveMasterStatus", () => {
    it("is 'unpaid' at zero", () => {
        expect(deriveMasterStatus(0, 5000)).toBe("unpaid");
    });
    it("is 'partial' between zero and total", () => {
        expect(deriveMasterStatus(2000, 5000)).toBe("partial");
    });
    it("is 'paid' at/above total (within tolerance)", () => {
        expect(deriveMasterStatus(5000, 5000)).toBe("paid");
        expect(deriveMasterStatus(4999.6, 5000)).toBe("paid");
    });
});

describe("syncMasterFromChildren", () => {
    it("sums children and derives 'partial' when one child is short", () => {
        const children = [
            { id: "c1", amountPaid: 1079, totalAmount: 1079 },
            { id: "c2", amountPaid: 756, totalAmount: 1079 }, // short
        ];
        const patch = syncMasterFromChildren(2158, children);
        expect(patch).toEqual({ amountPaid: 1835, status: "partial", fullyPaid: false });
    });

    it("marks the master 'paid' once every child is cleared", () => {
        const children = [
            { id: "c1", amountPaid: 1079, totalAmount: 1079 },
            { id: "c2", amountPaid: 1079, totalAmount: 1079 },
        ];
        const patch = syncMasterFromChildren(2158, children);
        expect(patch).toEqual({ amountPaid: 2158, status: "paid", fullyPaid: true });
    });

    it("is 'unpaid' when no child has paid", () => {
        const children = [
            { id: "c1", amountPaid: 0, totalAmount: 1079 },
            { id: "c2", amountPaid: 0, totalAmount: 1079 },
        ];
        const patch = syncMasterFromChildren(2158, children);
        expect(patch).toEqual({ amountPaid: 0, status: "unpaid", fullyPaid: false });
    });
});
