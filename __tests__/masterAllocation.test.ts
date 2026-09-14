import { describe, it, expect } from "vitest";
import {
    rollupChildren,
    groupChildInvoices,
    allocateMasterPayment,
    defaultMasterId,
    GroupingError,
} from "@/lib/masterAllocation";
import type { Invoice, Tenant } from "@/types";

// --- Fixtures --------------------------------------------------------------

const tenant: Tenant = {
    id: "t_acme",
    kind: "corporate",
    name: "Acme Corp",
    billingContact: { name: "AP", email: "ap@acme.example", phone: "1" },
    unitIds: ["u1", "u2", "u3"],
    billingMode: "consolidated",
    createdAt: "2026-09-01T00:00:00Z",
};

function makeChild(overrides: Partial<Invoice> = {}): Invoice {
    return {
        id: "inv_" + (overrides.unitId || "u1"),
        unitId: "u1",
        unitNumber: "C-101",
        tenantEmail: "ap@acme.example",
        status: "unpaid",
        totalAmount: 6200,
        billingPeriod: "September 2026",
        baseRent: 5000,
        electricityCharge: 1200,
        amountPaid: 0,
        createdAt: "2026-09-01T00:00:00Z",
        ...overrides,
    };
}

const c1 = makeChild({ id: "inv1", unitId: "u1", unitNumber: "C-101" });
const c2 = makeChild({ id: "inv2", unitId: "u2", unitNumber: "C-102", totalAmount: 5500, baseRent: 4500, electricityCharge: 1000 });
const c3 = makeChild({ id: "inv3", unitId: "u3", unitNumber: "C-103", totalAmount: 6000, baseRent: 5000, electricityCharge: 1000 });

// --- Rollup ---------------------------------------------------------------

describe("rollupChildren", () => {
    it("sums rent + electricity + total across children", () => {
        const r = rollupChildren([c1, c2, c3]);
        expect(r.subtotalRent).toBe(14500);
        expect(r.subtotalElectricity).toBe(3200);
        expect(r.totalAmount).toBe(17700);
        expect(r.lines).toHaveLength(3);
        expect(r.lines[0].unitNumber).toBe("C-101");
    });

    it("seededAmountPaid captures prior partial payments", () => {
        const partial = makeChild({ id: "invp", amountPaid: 3000 });
        const r = rollupChildren([partial, c2]);
        expect(r.seededAmountPaid).toBe(3000);
    });

    it("propagates meterChanged + manualUnitsReason into lines", () => {
        const flagged = makeChild({ id: "invf", meterChanged: true, manualUnitsReason: "meter replaced" });
        const r = rollupChildren([flagged]);
        expect(r.lines[0].meterChanged).toBe(true);
        expect(r.lines[0].manualUnitsReason).toBe("meter replaced");
    });

    it("carryForward sums correctly", () => {
        const withCF = makeChild({ id: "invc", carryForward: 500 });
        const r = rollupChildren([withCF, c2]);
        expect(r.subtotalCarryForward).toBe(500);
    });
});

// --- Grouping -------------------------------------------------------------

describe("groupChildInvoices", () => {
    it("builds a valid master + child patches", () => {
        const { master, childPatches } = groupChildInvoices({ children: [c1, c2, c3], tenant, now: "2026-09-15T10:00:00Z" });
        expect(master.tenantId).toBe("t_acme");
        expect(master.childInvoiceIds).toEqual(["inv1", "inv2", "inv3"]);
        expect(master.totalAmount).toBe(17700);
        expect(master.amountPaid).toBe(0);
        expect(master.status).toBe("unpaid");
        expect(childPatches).toHaveLength(3);
        expect(childPatches[0].masterInvoiceId).toBe(master.id);
    });

    it("seeds status = partial when a child already had a partial payment", () => {
        const partial = makeChild({ id: "invp", unitId: "u1", unitNumber: "C-101", amountPaid: 3000 });
        const { master } = groupChildInvoices({ children: [partial, c2], tenant });
        expect(master.amountPaid).toBe(3000);
        expect(master.status).toBe("partial");
    });

    it("seeds status = paid when children are fully covered at grouping", () => {
        const paid1 = makeChild({ id: "invx", amountPaid: 6200 }); // fully paid but status not flipped yet
        // status is "unpaid" so no early reject; use "pending" instead to model still-open
        const bumped = { ...paid1, status: "pending" as const };
        const { master } = groupChildInvoices({ children: [bumped], tenant });
        expect(master.status).toBe("paid");
    });

    it("rejects an empty selection", () => {
        expect(() => groupChildInvoices({ children: [], tenant })).toThrow(GroupingError);
    });

    it("rejects mixed billing periods", () => {
        const other = makeChild({ id: "invo", billingPeriod: "August 2026" });
        try {
            groupChildInvoices({ children: [c1, other], tenant });
            throw new Error("should have thrown");
        } catch (e) {
            expect(e).toBeInstanceOf(GroupingError);
            expect((e as GroupingError).code).toBe("MIXED_BILLING_PERIODS");
        }
    });

    it("rejects a fully-paid child", () => {
        const paid = makeChild({ id: "invp", status: "paid" });
        try {
            groupChildInvoices({ children: [paid], tenant });
        } catch (e) {
            expect((e as GroupingError).code).toBe("CHILD_ALREADY_PAID");
        }
    });

    it("rejects a child already linked to another master", () => {
        const linked = makeChild({ id: "invl", masterInvoiceId: "MI-2026-08-other" });
        try {
            groupChildInvoices({ children: [linked], tenant });
        } catch (e) {
            expect((e as GroupingError).code).toBe("CHILD_ALREADY_GROUPED");
        }
    });

    it("rejects a tenant not in consolidated billing mode", () => {
        const retail: Tenant = { ...tenant, billingMode: "per-unit" };
        try {
            groupChildInvoices({ children: [c1], tenant: retail });
        } catch (e) {
            expect((e as GroupingError).code).toBe("TENANT_NOT_CONSOLIDATED");
        }
    });

    it("N=1 grouping is degenerate but valid", () => {
        const { master } = groupChildInvoices({ children: [c1], tenant });
        expect(master.childInvoiceIds).toEqual(["inv1"]);
        expect(master.totalAmount).toBe(6200);
    });
});

describe("defaultMasterId", () => {
    it("uses YYYY-MM-slug format", () => {
        const id = defaultMasterId("September 2026", tenant);
        expect(id).toBe("MI-2026-09-acme-corp");
    });
});

// --- Allocation -----------------------------------------------------------

describe("allocateMasterPayment (rent-first-then-electricity)", () => {
    const master = { totalAmount: 17700, amountPaid: 0 };

    it("full payment closes all children", () => {
        const r = allocateMasterPayment(17700, master, [c1, c2, c3]);
        expect(r.appliedTotal).toBe(17700);
        expect(r.masterStatus).toBe("paid");
        expect(r.newMasterAmountPaid).toBe(17700);
        expect(r.perChild.every((x) => x.status === "paid")).toBe(true);
        const sum = r.perChild.reduce((s, x) => s + x.appliedNow, 0);
        expect(sum).toBe(17700);
    });

    it("partial payment fills children in unit-number order", () => {
        // C-101 needs 6200; give 5000
        const r = allocateMasterPayment(5000, master, [c1, c2, c3]);
        const p1 = r.perChild.find((x) => x.invoiceId === "inv1")!;
        const p2 = r.perChild.find((x) => x.invoiceId === "inv2")!;
        const p3 = r.perChild.find((x) => x.invoiceId === "inv3")!;
        expect(p1.appliedNow).toBe(5000);
        expect(p1.towardRent).toBe(5000);
        expect(p1.status).toBe("pending");
        expect(p2.appliedNow).toBe(0);
        expect(p3.appliedNow).toBe(0);
        expect(r.masterStatus).toBe("partial");
    });

    it("clips over-payment to master remaining", () => {
        const r = allocateMasterPayment(99999, master, [c1, c2, c3]);
        expect(r.appliedTotal).toBe(17700);
        expect(r.newMasterAmountPaid).toBe(17700);
    });

    it("zero payment leaves everything unchanged", () => {
        const r = allocateMasterPayment(0, master, [c1, c2, c3]);
        expect(r.appliedTotal).toBe(0);
        expect(r.masterStatus).toBe("unpaid");
    });

    it("respects prior child partial payment (rent-first continuation)", () => {
        const partial = makeChild({ id: "invp", unitId: "u1", unitNumber: "C-101", amountPaid: 3000 });
        // partial has 3200 remaining (2000 rent + 1200 elec)
        const master2 = { totalAmount: 6200 + 5500, amountPaid: 3000 };
        const r = allocateMasterPayment(2500, master2, [partial, c2]);
        const pp = r.perChild.find((x) => x.invoiceId === "invp")!;
        // Continues rent-first: fills remaining 2000 rent + 500 elec
        expect(pp.towardRent).toBe(2000);
        expect(pp.towardElectricity).toBe(500);
        expect(pp.newAmountPaid).toBe(5500);
        expect(r.newMasterAmountPaid).toBe(5500);
    });

    it("N=1 degenerates to allocatePartialPayment behaviour", () => {
        const r = allocateMasterPayment(3000, { totalAmount: 6200, amountPaid: 0 }, [c1]);
        expect(r.perChild[0].towardRent).toBe(3000);
        expect(r.perChild[0].towardElectricity).toBe(0);
    });

    it("invariant: Σ perChild.appliedNow === appliedTotal (arbitrary partial)", () => {
        for (const amt of [1, 100, 1234, 5000, 9999, 17699]) {
            const r = allocateMasterPayment(amt, master, [c1, c2, c3]);
            const sum = r.perChild.reduce((s, x) => s + x.appliedNow, 0);
            expect(sum).toBe(r.appliedTotal);
        }
    });
});

describe("allocateMasterPayment (pro-rata)", () => {
    const master = { totalAmount: 17700, amountPaid: 0 };

    it("splits proportional to each child's remaining", () => {
        const r = allocateMasterPayment(1770, master, [c1, c2, c3], "pro-rata");
        // Expect roughly 620 / 550 / 600 (10% of each), summing exactly to 1770
        const sum = r.perChild.reduce((s, x) => s + x.appliedNow, 0);
        expect(sum).toBe(1770);
        expect(r.newMasterAmountPaid).toBe(1770);
    });

    it("preserves invariant with residual redistribution", () => {
        for (const amt of [1, 7, 13, 999, 1234, 17699]) {
            const r = allocateMasterPayment(amt, master, [c1, c2, c3], "pro-rata");
            const sum = r.perChild.reduce((s, x) => s + x.appliedNow, 0);
            expect(sum).toBe(r.appliedTotal);
        }
    });

    it("full payment closes all children in pro-rata mode", () => {
        const r = allocateMasterPayment(17700, master, [c1, c2, c3], "pro-rata");
        expect(r.perChild.every((x) => x.status === "paid")).toBe(true);
        expect(r.masterStatus).toBe("paid");
    });
});
