import { describe, it, expect } from "vitest";
import { searchTenantsAndUnits, buildTenantPaymentSummary, UnitLike, InvoiceLike, LedgerRowLike } from "../lib/paymentLookup";

describe("searchTenantsAndUnits", () => {
    const units: UnitLike[] = [
        {
            id: "u1",
            unitNumber: "101",
            status: "occupied",
            tenantEmail: "alice@example.com",
            tenantName: "Alice Smith",
            tenantPhone: "9999900001",
        },
        {
            id: "u2",
            unitNumber: "102",
            status: "vacant",
            tenantHistory: [
                { tenantEmail: "bob@example.com", tenantName: "Bob Jones", tenantPhone: "9999900002", moveOutDate: "2023-01-01" },
            ],
        },
    ];

    it("finds current occupant by name", () => {
        const res = searchTenantsAndUnits("alice", units);
        expect(res).toHaveLength(1);
        expect(res[0].kind).toBe("current");
        expect(res[0].unitNumber).toBe("101");
    });

    it("finds historical tenant by email", () => {
        const res = searchTenantsAndUnits("bob@example.com", units);
        expect(res).toHaveLength(1);
        expect(res[0].kind).toBe("historical");
    });

    it("finds by unit number", () => {
        const res = searchTenantsAndUnits("102", units);
        expect(res).toHaveLength(1);
        expect(res[0].tenantEmail).toBe("bob@example.com");
    });

    it("returns empty for blank query", () => {
        expect(searchTenantsAndUnits("", units)).toEqual([]);
    });

    it("de-dupes a historical entry matching the current occupant", () => {
        const dupe: UnitLike[] = [
            {
                id: "u3",
                unitNumber: "201",
                status: "occupied",
                tenantEmail: "carol@example.com",
                tenantName: "Carol",
                tenantHistory: [{ tenantEmail: "carol@example.com", tenantName: "Carol" }],
            },
        ];
        const res = searchTenantsAndUnits("carol", dupe);
        expect(res).toHaveLength(1);
        expect(res[0].kind).toBe("current");
    });
});

describe("buildTenantPaymentSummary", () => {
    const invoices: InvoiceLike[] = [
        { id: "inv1", unitId: "u1", tenantEmail: "alice@example.com", billingPeriod: "2024-01", totalAmount: 10000, amountPaid: 10000, status: "paid", createdAt: "2024-01-01" },
        { id: "inv2", unitId: "u1", tenantEmail: "alice@example.com", billingPeriod: "2024-02", totalAmount: 10000, amountPaid: 4000, status: "partial", createdAt: "2024-02-01" },
    ];
    const ledgerRows: LedgerRowLike[] = [
        { id: "l1", invoiceId: "inv1", unitId: "u1", tenantEmail: "alice@example.com", amountPaid: 10000, paymentMode: "UPI", createdAt: "2024-01-05" },
        { id: "l2", invoiceId: "inv2", unitId: "u1", tenantEmail: "alice@example.com", amountPaid: 4000, paymentMode: "Cash", createdAt: "2024-02-10" },
        { id: "l3", unitId: "u1", tenantEmail: "alice@example.com", amountPaid: 500, paymentMode: "Cash", createdAt: "2024-02-15" },
    ];

    it("aggregates invoices, payments, and totals for a tenant", () => {
        const summary = buildTenantPaymentSummary("u1", "alice@example.com", invoices, ledgerRows);
        expect(summary.totals.invoiced).toBe(20000);
        expect(summary.totals.collected).toBe(14500);
        expect(summary.totals.due).toBe(6000);
        expect(summary.totals.invoiceCount).toBe(2);
        expect(summary.totals.paymentCount).toBe(3);
        // Newest invoice first, then the synthetic credit row prepended.
        expect(summary.invoices[0].id).toBe("__credit__");
        expect(summary.invoices[1].id).toBe("inv2");
        expect(summary.invoices[1].payments).toHaveLength(1);
        expect(summary.invoices[2].id).toBe("inv1");
    });

    it("returns empty summary when no matches", () => {
        const summary = buildTenantPaymentSummary("u99", "nobody@example.com", invoices, ledgerRows);
        expect(summary.invoices).toEqual([]);
        expect(summary.totals.invoiced).toBe(0);
    });
});
