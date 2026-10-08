/**
 * Unit tests for the pure payment-plan builders (lib/paymentPlan.ts).
 *
 * These cover the three settlement flows (Collections single settle, Daily
 * Ledger lump-sum inflow, corporate master settle) and — most importantly —
 * the core invariant that EVERY invoice patch changing `amountPaid` is paired
 * with a ledger row, so full AND partial payments always show in the ledger.
 */

import { describe, it, expect } from "vitest";
import {
    buildSettlePlan,
    buildInflowPlan,
    buildMasterSettlePlan,
    assertPlanInvariant,
    countPlanWrites,
    PaymentPlanError,
    type PaymentPlan,
    type InflowInvoice,
} from "@/lib/paymentPlan";
import type { Invoice, MasterInvoice } from "@/types";

const NOW = "2026-10-08T10:00:00.000Z";

// Helper: assert every amountPaid patch has a matching ledger row.
function expectInvariantHolds(plan: PaymentPlan) {
    expect(() => assertPlanInvariant(plan)).not.toThrow();
    const ledgerInvoiceIds = new Set(plan.ledgerRows.filter(r => r.invoiceId).map(r => r.invoiceId));
    for (const p of plan.invoicePatches) {
        if ("amountPaid" in p.patch) {
            expect(ledgerInvoiceIds.has(p.invoiceId)).toBe(true);
        }
    }
}

// ---------------------------------------------------------------------------
// 1. buildSettlePlan — Collections single invoice
// ---------------------------------------------------------------------------

describe("buildSettlePlan", () => {
    const baseInvoice = {
        id: "inv1",
        tenantEmail: "t@example.com",
        unitId: "u1",
        unitNumber: "101",
        billingPeriod: "October 2026",
        totalAmount: 10000,
        amountPaid: 0,
        baseRent: 8000,
        electricityCharge: 2000,
    };

    it("full payment → one patch (status paid) + one 'payment' ledger row", () => {
        const plan = buildSettlePlan({
            invoice: baseInvoice, received: 10000, mode: "upi", reference: "ABC", now: NOW,
        });
        expect(plan.invoicePatches).toHaveLength(1);
        expect(plan.invoicePatches[0].patch.status).toBe("paid");
        expect(plan.invoicePatches[0].patch.paidAt).toBe(NOW);
        expect(plan.ledgerRows).toHaveLength(1);
        expect(plan.ledgerRows[0].type).toBe("payment");
        expect(plan.ledgerRows[0].amountPaid).toBe(10000);
        expect(plan.ledgerRows[0].balance).toBe(0);
        expect(plan.ledgerRows[0].transactionId).toBe("UPI:ABC");
        expectInvariantHolds(plan);
    });

    it("partial payment → status pending + 'partial-payment' ledger row with negative balance", () => {
        const plan = buildSettlePlan({
            invoice: baseInvoice, received: 4000, mode: "cash", now: NOW,
        });
        expect(plan.invoicePatches[0].patch.status).toBe("pending");
        expect(plan.invoicePatches[0].patch.paidAt).toBeUndefined();
        expect(plan.ledgerRows[0].type).toBe("partial-payment");
        expect(plan.ledgerRows[0].amountPaid).toBe(4000);
        expect(plan.ledgerRows[0].balance).toBe(-6000);
        expect(plan.ledgerRows[0].transactionId).toBe("CASH_COLLECTED");
        expectInvariantHolds(plan);
    });

    it("partial on an already partly-paid invoice accumulates amountPaid", () => {
        const plan = buildSettlePlan({
            invoice: { ...baseInvoice, amountPaid: 3000 }, received: 2000, mode: "cash", now: NOW,
        });
        expect(plan.invoicePatches[0].patch.amountPaid).toBe(5000);
        expect(plan.ledgerRows[0].amountPaid).toBe(2000);
        expect(plan.ledgerRows[0].balance).toBe(-5000);
    });

    it("carries an optional note into patch + ledger row", () => {
        const plan = buildSettlePlan({
            invoice: baseInvoice, received: 10000, mode: "cash", note: "paid in person", now: NOW,
        });
        expect(plan.invoicePatches[0].patch.paymentNote).toBe("paid in person");
        expect(plan.ledgerRows[0].paymentNote).toBe("paid in person");
    });
});

// ---------------------------------------------------------------------------
// 2. buildInflowPlan — Daily Ledger lump-sum waterfall
// ---------------------------------------------------------------------------

describe("buildInflowPlan", () => {
    const mkInv = (id: string, created: string, total: number, paid = 0): InflowInvoice => ({
        id, unitId: "u1", unitNumber: "101", tenantEmail: "t@example.com",
        totalAmount: total, amountPaid: paid, billingPeriod: created, status: "unpaid", createdAt: created,
    });

    it("lump sum clears multiple invoices oldest-first", () => {
        const pool = [
            mkInv("a", "2026-08-01", 5000),
            mkInv("b", "2026-09-01", 5000),
        ];
        const plan = buildInflowPlan({
            amount: 10000, pool, unitId: "u1", category: "rent",
            tenantEmail: "t@example.com", unitNumber: "101", now: NOW,
        });
        expect(plan.invoicePatches).toHaveLength(2);
        expect(plan.ledgerRows).toHaveLength(2);
        expect(plan.ledgerRows.every(r => r.type === "payment")).toBe(true);
        expectInvariantHolds(plan);
    });

    it("partial inflow produces a 'partial-payment' row", () => {
        const pool = [mkInv("a", "2026-08-01", 5000)];
        const plan = buildInflowPlan({
            amount: 2000, pool, unitId: "u1", category: "rent",
            tenantEmail: "t@example.com", unitNumber: "101", now: NOW,
        });
        expect(plan.invoicePatches[0].patch.amountPaid).toBe(2000);
        expect(plan.ledgerRows[0].type).toBe("partial-payment");
        expect(plan.ledgerRows[0].balance).toBe(-3000);
        expectInvariantHolds(plan);
    });

    it("leftover cash becomes a 'credit' ledger row", () => {
        const pool = [mkInv("a", "2026-08-01", 5000)];
        const plan = buildInflowPlan({
            amount: 8000, pool, unitId: "u1", category: "rent",
            tenantEmail: "t@example.com", unitNumber: "101", now: NOW,
        });
        const credit = plan.ledgerRows.find(r => r.type === "credit");
        expect(credit).toBeDefined();
        expect(credit!.amountPaid).toBe(3000);
        expect(credit!.balance).toBe(3000);
        expect(credit!.invoiceId).toBe("");
        expectInvariantHolds(plan);
    });

    it("seeds an auto-created invoice when the pool is empty", () => {
        const plan = buildInflowPlan({
            amount: 5000, pool: [], unitId: "u1", category: "rent",
            tenantEmail: "t@example.com", unitNumber: "101", now: NOW,
            autoInvoice: {
                invoiceId: "auto1",
                data: { unitId: "u1", totalAmount: 8000, status: "unpaid" },
                totalAmount: 8000,
                billingPeriod: "October 2026",
            },
        });
        expect(plan.invoiceCreates).toHaveLength(1);
        expect(plan.invoiceCreates[0].invoiceId).toBe("auto1");
        expect(plan.invoicePatches[0].invoiceId).toBe("auto1");
        expect(plan.ledgerRows[0].invoiceId).toBe("auto1");
        expectInvariantHolds(plan);
    });

    it("empty pool with no auto-invoice records the whole amount as a credit", () => {
        const plan = buildInflowPlan({
            amount: 5000, pool: [], unitId: "u1", category: "rent",
            tenantEmail: "t@example.com", unitNumber: "101", now: NOW,
        });
        expect(plan.invoicePatches).toHaveLength(0);
        expect(plan.ledgerRows).toHaveLength(1);
        expect(plan.ledgerRows[0].type).toBe("credit");
        expect(plan.ledgerRows[0].amountPaid).toBe(5000);
        expectInvariantHolds(plan);
    });
});

// ---------------------------------------------------------------------------
// 3. buildMasterSettlePlan — corporate master + children
// ---------------------------------------------------------------------------

describe("buildMasterSettlePlan", () => {
    const master: Pick<MasterInvoice, "id" | "tenantName" | "billingPeriod" | "totalAmount" | "amountPaid"> & { paidAt?: string | null } = {
        id: "MI-2026-10-acme",
        tenantName: "Acme Corp",
        billingPeriod: "October 2026",
        totalAmount: 20000,
        amountPaid: 0,
        paidAt: null,
    };
    const children = [
        { id: "c1", unitId: "u1", unitNumber: "101", tenantEmail: "a@acme.com", totalAmount: 10000, amountPaid: 0, baseRent: 8000, electricityCharge: 2000, billingPeriod: "October 2026" },
        { id: "c2", unitId: "u2", unitNumber: "102", tenantEmail: "b@acme.com", totalAmount: 10000, amountPaid: 0, baseRent: 8000, electricityCharge: 2000, billingPeriod: "October 2026" },
    ] as unknown as Invoice[];

    it("full master payment patches master + both children + ledger rows + daily inflow", () => {
        const plan = buildMasterSettlePlan({
            master, children, received: 20000, mode: "bank", reference: "NEFT1", now: NOW,
        });
        expect(plan.masterPatch?.masterInvoiceId).toBe("MI-2026-10-acme");
        expect(plan.masterPatch?.patch.status).toBe("paid");
        expect(plan.invoicePatches).toHaveLength(2);
        expect(plan.ledgerRows).toHaveLength(2);
        expect(plan.ledgerRows.every(r => r.type === "master-payment")).toBe(true);
        expect(plan.ledgerRows.every(r => r.collection === "ledgerEntries")).toBe(true);
        expect(plan.ledgerRows.every(r => r.masterInvoiceId === "MI-2026-10-acme")).toBe(true);
        expect(plan.dailyLedgerRow).toBeDefined();
        expect(plan.dailyLedgerRow!.data.amount).toBe(20000);
        expectInvariantHolds(plan);
    });

    it("partial master payment only touches funded children", () => {
        const plan = buildMasterSettlePlan({
            master, children, received: 10000, mode: "cash", now: NOW,
        });
        expect(plan.masterPatch?.patch.status).toBe("partial");
        // Sequential rent-first fills c1 fully before c2.
        expect(plan.invoicePatches.length).toBeGreaterThanOrEqual(1);
        expectInvariantHolds(plan);
    });

    it("throws when nothing can be applied", () => {
        expect(() => buildMasterSettlePlan({
            master, children, received: 0, mode: "cash", now: NOW,
        })).toThrow(PaymentPlanError);
    });
});

// ---------------------------------------------------------------------------
// 4. Invariant guard + write counting
// ---------------------------------------------------------------------------

describe("assertPlanInvariant", () => {
    it("throws when an amountPaid patch has no ledger row", () => {
        const bad: PaymentPlan = {
            invoiceCreates: [],
            invoicePatches: [{ invoiceId: "x", patch: { amountPaid: 100, status: "paid" } }],
            ledgerRows: [],
        };
        expect(() => assertPlanInvariant(bad)).toThrow(PaymentPlanError);
    });

    it("passes when a patch does not change amountPaid", () => {
        const ok: PaymentPlan = {
            invoiceCreates: [],
            invoicePatches: [{ invoiceId: "x", patch: { billingPeriod: "Oct" } }],
            ledgerRows: [],
        };
        expect(() => assertPlanInvariant(ok)).not.toThrow();
    });
});

describe("countPlanWrites", () => {
    it("sums creates + patches + ledger rows + master + daily", () => {
        const plan = buildMasterSettlePlan({
            master: {
                id: "m", tenantName: "T", billingPeriod: "Oct", totalAmount: 20000, amountPaid: 0, paidAt: null,
            },
            children: [
                { id: "c1", unitId: "u1", unitNumber: "101", totalAmount: 10000, amountPaid: 0, baseRent: 10000, electricityCharge: 0, billingPeriod: "Oct" },
                { id: "c2", unitId: "u2", unitNumber: "102", totalAmount: 10000, amountPaid: 0, baseRent: 10000, electricityCharge: 0, billingPeriod: "Oct" },
            ] as unknown as Invoice[],
            received: 20000, mode: "cash", now: NOW,
        });
        // 2 patches + 2 ledger rows + 1 master + 1 daily = 6
        expect(countPlanWrites(plan)).toBe(6);
    });
});
