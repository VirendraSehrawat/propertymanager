import { describe, it, expect } from "vitest";
import {
    computeAutoSettle,
    pickInvoiceToAutoSettle,
    type InvoiceLike,
} from "@/lib/payments";

/**
 * MANAGER_ACTIONS Section 6 manual workaround:
 *
 *   Tenant walks in and hands over a lump-sum ₹12,500 that should
 *   clear three unpaid rent invoices (Jul, Aug, Sep).
 *
 * The Daily Ledger inflow only auto-settles ONE invoice at a time, so
 * the manager currently records 3 sequential inflows. These tests
 * assert that iterating pickInvoiceToAutoSettle → computeAutoSettle
 * produces the correct sequence and final state.
 */
describe("Section 6 — lump-sum multi-invoice settle", () => {
    function settleLoop(pool: InvoiceLike[], unitId: string, total: number) {
        // Simulates what the Daily Ledger would do if we iterated it
        const invoices = pool.map((i) => ({ ...i }));
        let remainingCash = total;
        const applied: { id: string; applied: number; newAmountPaid: number }[] = [];
        while (remainingCash > 0) {
            const target = pickInvoiceToAutoSettle(invoices, unitId, "rent");
            if (!target) break;
            const res = computeAutoSettle(remainingCash, target);
            if (res.applied <= 0) break;
            target.amountPaid = res.newAmountPaid;
            target.status = res.status === "paid" ? "paid" : "unpaid";
            applied.push({
                id: target.id,
                applied: res.applied,
                newAmountPaid: res.newAmountPaid,
            });
            remainingCash -= res.applied;
        }
        return { applied, invoices, leftover: remainingCash };
    }

    const buildPool = (): InvoiceLike[] => [
        {
            id: "inv-jul",
            unitId: "u1",
            totalAmount: 5000,
            amountPaid: 0,
            status: "unpaid",
            createdAt: "2025-07-01T00:00:00.000Z",
        },
        {
            id: "inv-aug",
            unitId: "u1",
            totalAmount: 5000,
            amountPaid: 0,
            status: "unpaid",
            createdAt: "2025-08-01T00:00:00.000Z",
        },
        {
            id: "inv-sep",
            unitId: "u1",
            totalAmount: 5000,
            amountPaid: 0,
            status: "unpaid",
            createdAt: "2025-09-01T00:00:00.000Z",
        },
    ];

    it("₹12,500 lump-sum: Jul paid, Aug paid, Sep partial ₹2500", () => {
        const { applied, invoices, leftover } = settleLoop(buildPool(), "u1", 12500);
        expect(applied).toEqual([
            { id: "inv-jul", applied: 5000, newAmountPaid: 5000 },
            { id: "inv-aug", applied: 5000, newAmountPaid: 5000 },
            { id: "inv-sep", applied: 2500, newAmountPaid: 2500 },
        ]);
        expect(leftover).toBe(0);

        const jul = invoices.find((i) => i.id === "inv-jul")!;
        const aug = invoices.find((i) => i.id === "inv-aug")!;
        const sep = invoices.find((i) => i.id === "inv-sep")!;
        expect(jul.status).toBe("paid");
        expect(aug.status).toBe("paid");
        expect(sep.status).toBe("unpaid");
        expect(sep.amountPaid).toBe(2500);
    });

    it("exact ₹15,000 clears all three", () => {
        const { applied, invoices, leftover } = settleLoop(buildPool(), "u1", 15000);
        expect(applied).toHaveLength(3);
        expect(leftover).toBe(0);
        expect(invoices.every((i) => i.status === "paid")).toBe(true);
    });

    it("₹18,000 clears all three and leaves ₹3,000 unallocated (goes to ledger as credit)", () => {
        const { applied, leftover, invoices } = settleLoop(buildPool(), "u1", 18000);
        expect(applied).toHaveLength(3);
        expect(leftover).toBe(3000);
        expect(invoices.every((i) => i.status === "paid")).toBe(true);
    });

    it("partial payment resumes from where the last one stopped", () => {
        const pool = buildPool();
        // Manager records first ₹6,000
        const round1 = settleLoop(pool, "u1", 6000);
        expect(round1.applied).toEqual([
            { id: "inv-jul", applied: 5000, newAmountPaid: 5000 },
            { id: "inv-aug", applied: 1000, newAmountPaid: 1000 },
        ]);
        // Later manager records another ₹4,000 using the mutated pool
        const round2 = settleLoop(round1.invoices, "u1", 4000);
        expect(round2.applied).toEqual([
            { id: "inv-aug", applied: 4000, newAmountPaid: 5000 },
        ]);
        const aug = round2.invoices.find((i) => i.id === "inv-aug")!;
        expect(aug.status).toBe("paid");
        // Sep still untouched
        const sep = round2.invoices.find((i) => i.id === "inv-sep")!;
        expect(sep.amountPaid).toBe(0);
    });

    it("skips invoices for a different unit", () => {
        const pool = buildPool();
        pool.push({
            id: "inv-other",
            unitId: "u2",
            totalAmount: 5000,
            amountPaid: 0,
            status: "unpaid",
            createdAt: "2025-06-01T00:00:00.000Z",
        });
        const { applied } = settleLoop(pool, "u1", 5000);
        expect(applied).toEqual([
            { id: "inv-jul", applied: 5000, newAmountPaid: 5000 },
        ]);
    });

    it("stops when there are no more pending invoices", () => {
        const pool: InvoiceLike[] = [
            {
                id: "inv-a",
                unitId: "u1",
                totalAmount: 1000,
                amountPaid: 1000,
                status: "paid",
                createdAt: "2025-01-01T00:00:00.000Z",
            },
        ];
        const { applied, leftover } = settleLoop(pool, "u1", 500);
        expect(applied).toEqual([]);
        expect(leftover).toBe(500);
    });
});
