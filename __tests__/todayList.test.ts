/**
 * Unit tests for lib/todayList.ts — the Home "Today" list: rent due by
 * payment day, the meter round and drafts, old tickets and lease ends,
 * grouped by building.
 */

import { describe, it, expect } from "vitest";
import { buildTodayList, rentDueDate, invoiceYm, type TodayInvoice, type TodayUnit } from "@/lib/todayList";

// Wed 14 Oct 2026, 10:00 local time.
const NOW = new Date(2026, 9, 14, 10);
const buildingNames = { bA: "Block A", bB: "Block B" };

const unit = (id: string, unitNumber: string, extra: Partial<TodayUnit> = {}): TodayUnit => ({
    id, unitNumber, buildingId: "bA", status: "occupied", tenantEmail: `${id}@x.com`, tenantName: `Tenant ${unitNumber}`, ...extra,
});
const inv = (id: string, unitId: string, unitNumber: string, billingPeriod: string, total: number, extra: Partial<TodayInvoice> = {}): TodayInvoice => ({
    id, unitId, unitNumber, tenantEmail: `${unitId}@x.com`, billingPeriod, status: "unpaid", totalAmount: total, amountPaid: 0, ...extra,
});
const build = (units: TodayUnit[], invoices: TodayInvoice[], activeTickets: Parameters<typeof buildTodayList>[0]["activeTickets"] = []) =>
    buildTodayList({ units, invoices, activeTickets, buildingNames, now: NOW });
const items = (list: ReturnType<typeof buildTodayList>) => list.groups.flatMap(g => g.items);

describe("rentDueDate / invoiceYm", () => {
    it("uses the payment day, clamped to short months, or the 1st of next month without one", () => {
        expect(rentDueDate("2026-10", 5)).toEqual(new Date(2026, 9, 5));
        expect(rentDueDate("2026-02", 31)).toEqual(new Date(2026, 1, 28));
        expect(rentDueDate("2026-10")).toEqual(new Date(2026, 10, 1));
    });

    it("reads billingYm, or the month label with any suffix", () => {
        expect(invoiceYm({ billingYm: "2026-09" })).toBe("2026-09");
        expect(invoiceYm({ billingPeriod: "October 2026 (Move-in)" })).toBe("2026-10");
        expect(invoiceYm({ billingPeriod: "" })).toBe("");
    });
});

describe("buildTodayList — rent due", () => {
    it("lists this month's invoice once the payment day is reached, not before", () => {
        const units = [unit("u1", "101", { paymentDay: 14 }), unit("u2", "102", { paymentDay: 10 }), unit("u3", "103", { paymentDay: 20 })];
        const list = build(units, [
            inv("i1", "u1", "101", "October 2026", 5000),
            inv("i2", "u2", "102", "October 2026", 6000),
            inv("i3", "u3", "103", "October 2026", 7000),
        ]);
        const rent = items(list).filter(i => i.kind === "rent");
        expect(rent).toEqual([
            expect.objectContaining({ unitNumber: "101", daysLate: 0, remaining: 5000 }),
            expect.objectContaining({ unitNumber: "102", daysLate: 4, remaining: 6000 }),
        ]);
    });

    it("without a payment day, only past months are due", () => {
        const list = build([unit("u1", "101")], [
            inv("i1", "u1", "101", "September 2026", 5000),
            inv("i2", "u1", "101", "October 2026", 5000),
        ]);
        const rent = items(list).filter(i => i.kind === "rent");
        expect(rent).toHaveLength(1);
        expect(rent[0]).toMatchObject({ invoiceId: "i1", invoiceCount: 1, daysLate: 13 });
    });

    it("combines a tenant's open invoices into one item on the oldest, with the remaining balance", () => {
        const list = build([unit("u1", "101", { paymentDay: 5 })], [
            inv("i2", "u1", "101", "October 2026", 5000),
            inv("i1", "u1", "101", "September 2026", 5000, { status: "pending", amountPaid: 2000 }),
            inv("i0", "u1", "101", "August 2026", 5000, { status: "paid", amountPaid: 5000 }),
        ]);
        expect(items(list)).toEqual([
            expect.objectContaining({ kind: "rent", invoiceId: "i1", invoiceCount: 2, remaining: 8000, paid: 2000, tenantName: "Tenant 101" }),
        ]);
    });

    it("flags corporate-grouped invoices and skips written-off ones", () => {
        const list = build([unit("u1", "101"), unit("u2", "102")], [
            inv("i1", "u1", "101", "September 2026", 5000, { masterInvoiceId: "M1" }),
            inv("i2", "u2", "102", "September 2026", 5000, { status: "written-off" }),
        ]);
        expect(items(list)).toEqual([expect.objectContaining({ unitNumber: "101", corporate: true })]);
    });

    it("does not use the new occupant's name or payment day for an old tenant's dues", () => {
        const list = build([unit("u1", "101", { paymentDay: 1, tenantEmail: "new@x.com", tenantName: "New" })], [
            inv("i1", "u1", "101", "October 2026", 5000, { tenantEmail: "old@x.com" }),
            inv("i0", "u1", "101", "September 2026", 5000, { tenantEmail: "old@x.com" }),
        ]);
        expect(items(list)).toEqual([expect.objectContaining({ invoiceId: "i0", invoiceCount: 1, tenantName: undefined })]);
    });
});

describe("buildTodayList — meter round, tickets, leases, grouping", () => {
    it("counts drafts and move-in invoices as read, and lists drafts to generate", () => {
        const units = [
            unit("u1", "101"),
            unit("u2", "102", { meterDraft: { billingMonth: "2026-10" } }),
            unit("u3", "103"),
            unit("u4", "104", { status: "vacant" }),
        ];
        const list = build(units, [inv("m", "u3", "103", "October 2026 (Move-in)", 3000, { status: "paid", amountPaid: 3000 })]);
        expect(list.general).toEqual([
            expect.objectContaining({ kind: "meterRound", done: 2, total: 3, pending: 1 }),
            expect.objectContaining({ kind: "drafts", count: 1 }),
        ]);
    });

    it("drops the meter round once every unit is read", () => {
        const list = build([unit("u1", "101")], [inv("x", "u1", "101", "October 2026", 5000, { status: "paid", amountPaid: 5000 })]);
        expect(list.general).toEqual([]);
        expect(list.count).toBe(0);
    });

    it("shows tickets open 3+ days and leases ending within 7 days, grouped by building", () => {
        const units = [
            unit("u1", "101", { leaseEnd: "2026-10-20" }),
            unit("u2", "201", { buildingId: "bB", leaseEnd: "2026-10-30" }),
            unit("u3", "202", { buildingId: "bB", leaseEnd: "2026-10-10" }),
        ];
        const paid = units.map(u => inv(`p${u.id}`, u.id, u.unitNumber, "October 2026", 1, { status: "paid", amountPaid: 1 }));
        const list = build(units, paid, [
            { id: "t1", unitId: "u2", unitNumber: "201", description: "Leak", status: "pending", createdAt: new Date(2026, 9, 10).toISOString() },
            { id: "t2", unitId: "u1", unitNumber: "101", description: "Fan", status: "in-progress", createdAt: new Date(2026, 9, 13).toISOString() },
            { id: "t3", unitNumber: "G1", buildingName: "Annex", description: "Gate", status: "pending", createdAt: new Date(2026, 8, 1).toISOString() },
        ]);
        expect(list.groups.map(g => [g.buildingName, g.items.map(i => `${i.kind}:${i.unitNumber}`)])).toEqual([
            ["Annex", ["ticket:G1"]],
            ["Block A", ["leaseEnd:101"]],
            ["Block B", ["leaseEnd:202", "ticket:201"]],
        ]);
        expect(items(list).find(i => i.kind === "leaseEnd" && i.unitNumber === "202")).toMatchObject({ daysLeft: -4 });
    });
});
