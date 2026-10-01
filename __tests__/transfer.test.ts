import { describe, it, expect } from "vitest";
import { buildTransferPlan } from "@/lib/transfer";
import type { CoTenant, Unit } from "@/types";

const makeUnit = (overrides: Partial<Unit> = {}): Unit => ({
    id: "unit_A101",
    buildingId: "bldg_1",
    unitNumber: "A101",
    baseRent: 10000,
    status: "occupied",
    tenantEmail: "alice@test.com",
    tenantName: "Alice",
    tenantPhone: "9999900001",
    moveInDate: "2026-01-15",
    paymentDay: 8,
    securityDeposit: 20000,
    securityDepositDate: "2026-01-15",
    lastMeterReading: 1234,
    coTenants: [],
    ...overrides,
});

const bob: CoTenant = {
    name: "Bob",
    phone: "9999900002",
    email: "BOB@test.com", // uppercase on purpose — plan should lowercase
    addedAt: "2026-02-01T00:00:00Z",
};
const carol: CoTenant = {
    name: "Carol",
    phone: "9999900003",
    email: "carol@test.com",
    addedAt: "2026-03-01T00:00:00Z",
};

const BASE_INPUT = {
    destUnitId: "unit_B202",
    destUnitNumber: "B202",
    transferDate: "2026-10-01",
    now: "2026-10-01T10:00:00.000Z",
};

describe("buildTransferPlan — no co-tenants (legacy behaviour)", () => {
    const source = makeUnit();

    it("source becomes vacant and is cleared", () => {
        const plan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: false });
        expect(plan.keepCoTenantsInSource).toBe(false);
        expect(plan.promotedCoTenant).toBeNull();
        expect(plan.sourceUpdate).toMatchObject({
            status: "vacant",
            tenantEmail: "",
            tenantName: "",
            tenantPhone: "",
            moveInDate: "",
            paymentDay: "",
            coTenants: [],
        });
    });

    it("destination receives the primary tenant and no co-tenants", () => {
        const plan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: false });
        expect(plan.destUpdate).toMatchObject({
            status: "occupied",
            tenantEmail: "alice@test.com",
            tenantName: "Alice",
            tenantPhone: "9999900001",
            moveInDate: "2026-10-01",
            paymentDay: 8,
            securityDeposit: 20000,
            coTenants: [],
        });
    });

    it("history entry captures the departing tenant with transfer note", () => {
        const plan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: false });
        expect(plan.historyEntry).toMatchObject({
            tenantName: "Alice",
            tenantEmail: "alice@test.com",
            moveInDate: "2026-01-15",
            moveOutDate: BASE_INPUT.now,
            securityDeposit: 20000,
            securityRefund: 0,
            coTenants: [],
            note: "Transferred to B202",
        });
    });

    it("coTenantsStay=true but no co-tenants → falls back to vacant", () => {
        const plan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: true });
        expect(plan.keepCoTenantsInSource).toBe(false);
        expect(plan.sourceUpdate.status).toBe("vacant");
    });
});

describe("buildTransferPlan — co-tenants move with primary", () => {
    const source = makeUnit({ coTenants: [bob, carol] });

    it("source cleared, destination gets both co-tenants", () => {
        const plan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: false });
        expect(plan.keepCoTenantsInSource).toBe(false);
        expect(plan.sourceUpdate).toMatchObject({ status: "vacant", coTenants: [] });
        expect(plan.destUpdate.coTenants).toEqual([bob, carol]);
    });

    it("history entry preserves the full original co-tenant list for audit", () => {
        const plan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: false });
        expect(plan.historyEntry.coTenants).toEqual([bob, carol]);
    });
});

describe("buildTransferPlan — co-tenants stay in old unit", () => {
    const source = makeUnit({ coTenants: [bob, carol] });

    it("promotes first co-tenant by default and keeps the second behind", () => {
        const plan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: true });
        expect(plan.keepCoTenantsInSource).toBe(true);
        expect(plan.promotedCoTenant).toEqual(bob);
        expect(plan.sourceUpdate).toMatchObject({
            status: "occupied",
            tenantEmail: "bob@test.com", // lowercased
            tenantName: "Bob",
            tenantPhone: "9999900002",
            coTenants: [carol],
        });
        // moveInDate / paymentDay must NOT be cleared when the unit stays occupied
        expect(plan.sourceUpdate.moveInDate).toBeUndefined();
        expect(plan.sourceUpdate.paymentDay).toBeUndefined();
    });

    it("promotes the chosen co-tenant via promoteCoTenantIdx", () => {
        const plan = buildTransferPlan({
            ...BASE_INPUT,
            source,
            coTenantsStay: true,
            promoteCoTenantIdx: 1,
        });
        expect(plan.promotedCoTenant).toEqual(carol);
        expect(plan.sourceUpdate).toMatchObject({
            tenantEmail: "carol@test.com",
            tenantName: "Carol",
            coTenants: [bob],
        });
    });

    it("clamps promoteCoTenantIdx into range", () => {
        const high = buildTransferPlan({
            ...BASE_INPUT,
            source,
            coTenantsStay: true,
            promoteCoTenantIdx: 99,
        });
        expect(high.promotedCoTenant).toEqual(carol); // clamped to last

        const low = buildTransferPlan({
            ...BASE_INPUT,
            source,
            coTenantsStay: true,
            promoteCoTenantIdx: -5,
        });
        expect(low.promotedCoTenant).toEqual(bob); // clamped to first
    });

    it("destination does NOT receive the stayed co-tenants", () => {
        const plan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: true });
        expect(plan.destUpdate.coTenants).toEqual([]);
    });

    it("destination still receives the primary tenant fields", () => {
        const plan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: true });
        expect(plan.destUpdate).toMatchObject({
            status: "occupied",
            tenantEmail: "alice@test.com",
            tenantName: "Alice",
            moveInDate: "2026-10-01",
        });
    });

    it("handles promoted co-tenant with empty email (no login)", () => {
        const noEmailBob: CoTenant = { ...bob, email: "" };
        const src = makeUnit({ coTenants: [noEmailBob] });
        const plan = buildTransferPlan({ ...BASE_INPUT, source: src, coTenantsStay: true });
        expect(plan.sourceUpdate.tenantEmail).toBe("");
        expect(plan.sourceUpdate.tenantName).toBe("Bob");
        expect(plan.sourceUpdate.coTenants).toEqual([]);
    });

    it("single co-tenant stay → source has empty coTenants after promotion", () => {
        const src = makeUnit({ coTenants: [bob] });
        const plan = buildTransferPlan({ ...BASE_INPUT, source: src, coTenantsStay: true });
        expect(plan.promotedCoTenant).toEqual(bob);
        expect(plan.sourceUpdate.coTenants).toEqual([]);
    });
});

describe("buildTransferPlan — invariants", () => {
    it("history always records the original primary tenant even if a co-tenant is promoted", () => {
        const source = makeUnit({ coTenants: [bob, carol] });
        const plan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: true });
        expect(plan.historyEntry.tenantEmail).toBe("alice@test.com");
        expect(plan.historyEntry.tenantName).toBe("Alice");
    });

    it("source + destination are never both vacant", () => {
        const source = makeUnit({ coTenants: [bob] });
        const stayPlan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: true });
        expect(stayPlan.sourceUpdate.status).toBe("occupied");
        expect(stayPlan.destUpdate.status).toBe("occupied");

        const movePlan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: false });
        expect(movePlan.sourceUpdate.status).toBe("vacant");
        expect(movePlan.destUpdate.status).toBe("occupied");
    });

    it("no co-tenant appears in both source and destination simultaneously", () => {
        const source = makeUnit({ coTenants: [bob, carol] });
        const plan = buildTransferPlan({ ...BASE_INPUT, source, coTenantsStay: true });
        const srcCo = (plan.sourceUpdate.coTenants as CoTenant[]) || [];
        const dstCo = (plan.destUpdate.coTenants as CoTenant[]) || [];
        const srcEmails = new Set(srcCo.map(c => c.email.toLowerCase()));
        const dstEmails = new Set(dstCo.map(c => c.email.toLowerCase()));
        for (const e of srcEmails) expect(dstEmails.has(e)).toBe(false);
    });
});
