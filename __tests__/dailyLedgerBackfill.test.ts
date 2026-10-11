/**
 * Unit tests for the pure Daily Ledger backfill planner
 * (lib/dailyLedgerBackfill.ts) — see docs/ATOMIC_TRANSACTIONS_PLAN.md Phase 8b.
 */

import { describe, it, expect } from "vitest";
import {
    buildExistingInflowKeySet,
    planLedgerBackfill,
    planMasterLedgerBackfill,
    dailyLedgerDedupeKey,
    type LedgerRowForBackfill,
    type MasterLedgerRowForBackfill,
    type ExistingDailyLedgerRow,
} from "@/lib/dailyLedgerBackfill";

const NOW = "2026-10-10T10:00:00.000Z";

describe("planLedgerBackfill", () => {
    const baseRow: LedgerRowForBackfill = {
        id: "l1",
        tenantEmail: "t@example.com",
        unitId: "u1",
        unitNumber: "101",
        invoiceId: "inv1",
        billingPeriod: "September 2026",
        amountPaid: 6000,
        type: "payment",
        transactionId: "UPI:ABC",
        paymentMode: "upi",
        paymentReference: "ABC",
        settledBy: "employee@x.com",
        createdAt: "2026-09-05T08:00:00.000Z",
    };

    it("creates a backfill row for a historical full settlement", () => {
        const plan = planLedgerBackfill([baseRow], new Set(), NOW);
        expect(plan).toHaveLength(1);
        expect(plan[0].data.direction).toBe("inflow");
        expect(plan[0].data.amount).toBe(6000);
        expect(plan[0].data.invoiceId).toBe("inv1");
        expect(plan[0].data.backfilled).toBe(true);
        expect(plan[0].data.date).toBe("2026-09-05");
    });

    it("creates a backfill row for a partial payment", () => {
        const partial = { ...baseRow, id: "l2", type: "partial-payment", amountPaid: 2000 };
        const plan = planLedgerBackfill([partial], new Set(), NOW);
        expect(plan).toHaveLength(1);
        expect(plan[0].data.amount).toBe(2000);
    });

    it("skips rows already mirrored into dailyLedger (dedupe)", () => {
        const key = dailyLedgerDedupeKey("inv1", 6000, baseRow.createdAt);
        const plan = planLedgerBackfill([baseRow], new Set([key]), NOW);
        expect(plan).toHaveLength(0);
    });

    it("skips Daily-Ledger-sourced auto-settle rows (already visible via the manual entry)", () => {
        const autoSettle = { ...baseRow, id: "l3", transactionId: "DAILY_LEDGER_AUTOSETTLE" };
        const plan = planLedgerBackfill([autoSettle], new Set(), NOW);
        expect(plan).toHaveLength(0);
    });

    it("skips credit rows (not an invoice settlement)", () => {
        const credit = { ...baseRow, id: "l4", type: "credit", invoiceId: "" };
        const plan = planLedgerBackfill([credit], new Set(), NOW);
        expect(plan).toHaveLength(0);
    });

    it("skips soft-deleted rows", () => {
        const deleted = { ...baseRow, id: "l5", deleted: true };
        const plan = planLedgerBackfill([deleted], new Set(), NOW);
        expect(plan).toHaveLength(0);
    });

    it("skips rows with no invoiceId or non-positive amount", () => {
        const noInvoice = { ...baseRow, id: "l6", invoiceId: "" };
        const zero = { ...baseRow, id: "l7", amountPaid: 0 };
        expect(planLedgerBackfill([noInvoice, zero], new Set(), NOW)).toHaveLength(0);
    });
});

describe("buildExistingInflowKeySet", () => {
    it("indexes only non-deleted inflow rows with an invoiceId", () => {
        const rows: ExistingDailyLedgerRow[] = [
            { direction: "inflow", invoiceId: "inv1", amount: 6000, createdAt: "2026-09-05T08:00:00.000Z" },
            { direction: "outflow", invoiceId: "inv2", amount: 500, createdAt: "2026-09-06T08:00:00.000Z" },
            { direction: "inflow", invoiceId: "inv3", amount: 100, createdAt: "2026-09-07T08:00:00.000Z", deleted: true },
            { direction: "inflow", amount: 200, createdAt: "2026-09-08T08:00:00.000Z" },
        ];
        const set = buildExistingInflowKeySet(rows);
        expect(set.size).toBe(1);
        expect(set.has(dailyLedgerDedupeKey("inv1", 6000, "2026-09-05T08:00:00.000Z"))).toBe(true);
    });
});

describe("planMasterLedgerBackfill", () => {
    const child1: MasterLedgerRowForBackfill = {
        id: "le1", tenantEmail: "acme@corp.com", unitId: "u1", unitNumber: "101",
        invoiceId: "c1", masterInvoiceId: "MI-1", billingPeriod: "October 2026",
        amountPaid: 10000, type: "master-payment", transactionId: "BANK:NEFT1",
        paymentMode: "bank", paymentReference: "NEFT1", settledBy: "employee@x.com",
        createdAt: "2026-10-01T09:00:00.000Z",
    };
    const child2: MasterLedgerRowForBackfill = {
        ...child1, id: "le2", unitId: "u2", unitNumber: "102", invoiceId: "c2", amountPaid: 10000,
    };

    it("groups children of the same settlement into ONE consolidated row", () => {
        const plan = planMasterLedgerBackfill([child1, child2], new Set(), NOW);
        expect(plan).toHaveLength(1);
        expect(plan[0].data.amount).toBe(20000);
        expect(plan[0].data.invoiceId).toBe("MI-1");
        expect(plan[0].data.category).toBe("Rent (Master)");
        expect((plan[0].data.description as string)).toContain("101");
        expect((plan[0].data.description as string)).toContain("102");
    });

    it("does not group settlements from different transactions", () => {
        const laterSettle = { ...child1, id: "le3", transactionId: "BANK:NEFT2", createdAt: "2026-10-02T09:00:00.000Z" };
        const plan = planMasterLedgerBackfill([child1, child2, laterSettle], new Set(), NOW);
        expect(plan).toHaveLength(2);
    });

    it("skips groups already mirrored into dailyLedger", () => {
        const key = dailyLedgerDedupeKey("MI-1", 20000, child1.createdAt);
        const plan = planMasterLedgerBackfill([child1, child2], new Set([key]), NOW);
        expect(plan).toHaveLength(0);
    });
});
