/**
 * Unit tests for lib/paymentDue.ts — due dates from the unit's payment day,
 * the Collections due-date order, and which tenants get today's reminder.
 */

import { describe, it, expect } from "vitest";
import { dueInfo, dueLabel, paymentRemindersDue, sortByDue, type DueInvoice, type DueUnit } from "@/lib/paymentDue";

// Wed 14 Oct 2026, 10:00 local time.
const NOW = new Date(2026, 9, 14, 10);

const unit = (id: string, paymentDay?: number, extra: Partial<DueUnit> = {}): DueUnit => ({
    id, unitNumber: id.replace("u", "1"), tenantEmail: `${id}@x.com`, tenantName: `T${id}`, paymentDay, ...extra,
});
const inv = (id: string, unitId: string, billingPeriod: string, total = 5000, extra: Partial<DueInvoice> = {}): DueInvoice => ({
    id, unitId, unitNumber: unitId.replace("u", "1"), tenantEmail: `${unitId}@x.com`, billingPeriod, status: "unpaid", totalAmount: total, amountPaid: 0, ...extra,
});

describe("dueInfo / dueLabel", () => {
    it("buckets by the unit's payment day", () => {
        const cases: [number, string, RegExp][] = [
            [14, "today", /^Due today$/],
            [10, "overdue", /^4d late$/],
            [15, "week", /^Due tomorrow$/],
            [21, "week", /^Due Wed,? 21 Oct$/],
            [25, "later", /^Due Sun,? 25 Oct$/],
        ];
        for (const [day, bucket, label] of cases) {
            const info = dueInfo(inv("i", "u1", "October 2026"), unit("u1", day), NOW)!;
            expect(info.bucket).toBe(bucket);
            expect(dueLabel(info)).toMatch(label);
        }
    });

    it("without a payment day, rent is due on the 1st of the next month", () => {
        expect(dueInfo(inv("i", "u1", "October 2026"), unit("u1"), NOW)).toMatchObject({ daysUntil: 18, bucket: "later" });
        expect(dueInfo(inv("i", "u1", "September 2026"), unit("u1"), NOW)).toMatchObject({ daysUntil: -13, bucket: "overdue" });
    });

    it("ignores the payment day of a new occupant for an old tenant's invoice", () => {
        const info = dueInfo(inv("i", "u1", "October 2026", 5000, { tenantEmail: "old@x.com" }), unit("u1", 2), NOW)!;
        expect(info.daysUntil).toBe(18);
    });

    it("returns null when the billing month can't be read", () => {
        expect(dueInfo(inv("i", "u1", "Adjustment"), unit("u1", 5), NOW)).toBeNull();
    });
});

describe("sortByDue", () => {
    it("orders due today → overdue (latest first) → this week → later → unknown", () => {
        const units = new Map([
            ["u1", unit("u1", 14)], ["u2", unit("u2", 2)], ["u3", unit("u3", 16)], ["u4", unit("u4", 28)], ["u5", unit("u5", 12)],
        ]);
        const sorted = sortByDue([
            inv("later", "u4", "October 2026"),
            inv("unknown", "u1", "Adjustment"),
            inv("week", "u3", "October 2026"),
            inv("late2", "u5", "October 2026"),
            inv("today", "u1", "October 2026"),
            inv("late12", "u2", "October 2026"),
        ], units, NOW);
        expect(sorted.map(i => i.id)).toEqual(["today", "late12", "late2", "week", "later", "unknown"]);
    });
});

describe("paymentRemindersDue", () => {
    it("reminds the day before and on the day, quoting everything owed on the unit", () => {
        const reminders = paymentRemindersDue({
            now: NOW,
            units: [unit("u1", 15), unit("u2", 14), unit("u3", 20)],
            invoices: [
                inv("a", "u1", "October 2026", 5000),
                inv("a0", "u1", "September 2026", 4000, { status: "pending", amountPaid: 1000 }),
                inv("b", "u2", "October 2026", 6000),
                inv("c", "u3", "October 2026", 7000),
            ],
        });
        expect(reminders).toEqual([
            expect.objectContaining({ unitNumber: "11", kind: "dueTomorrow", dueDate: "2026-10-15", remaining: 8000, invoiceIds: ["a", "a0"], tenantName: "Tu1" }),
            expect.objectContaining({ unitNumber: "12", kind: "dueToday", dueDate: "2026-10-14", remaining: 6000 }),
        ]);
        expect(reminders[0].key).toBe("u1_u1-x-com_dueTomorrow_2026-10-15");
    });

    it("skips paid, written-off, corporate and old tenants' invoices", () => {
        const reminders = paymentRemindersDue({
            now: NOW,
            units: [unit("u1", 14), unit("u2", 14), unit("u3", 14), unit("u4", 14)],
            invoices: [
                inv("a", "u1", "October 2026", 5000, { status: "paid", amountPaid: 5000 }),
                inv("b", "u2", "October 2026", 5000, { status: "written-off" }),
                inv("c", "u3", "October 2026", 5000, { masterInvoiceId: "M1" }),
                inv("d", "u4", "October 2026", 5000, { tenantEmail: "old@x.com" }),
            ],
        });
        expect(reminders).toEqual([]);
    });
});
