import { describe, it, expect } from "vitest";
import {
    computeAutoSettle,
    pickInvoiceToAutoSettle,
    allocateLumpSum,
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

/**
 * Reusable library form — `allocateLumpSum`. Same waterfall semantics as the
 * manual loop above, but as a single pure function the Daily Ledger / Settle
 * flows can call directly to clear multiple invoices from one payment.
 */
describe("allocateLumpSum — reusable multi-invoice waterfall", () => {
    const buildPool = (): InvoiceLike[] => [
        { id: "inv-jul", unitId: "u1", totalAmount: 5000, amountPaid: 0, status: "unpaid", createdAt: "2025-07-01T00:00:00.000Z" },
        { id: "inv-aug", unitId: "u1", totalAmount: 5000, amountPaid: 0, status: "unpaid", createdAt: "2025-08-01T00:00:00.000Z" },
        { id: "inv-sep", unitId: "u1", totalAmount: 5000, amountPaid: 0, status: "unpaid", createdAt: "2025-09-01T00:00:00.000Z" },
    ];

    it("₹12,500 clears Jul & Aug fully and Sep partially, no leftover", () => {
        const res = allocateLumpSum(12500, buildPool(), "u1", "rent");
        expect(res.lines).toEqual([
            { invoiceId: "inv-jul", applied: 5000, newAmountPaid: 5000, remaining: 0, status: "paid", fullySettled: true },
            { invoiceId: "inv-aug", applied: 5000, newAmountPaid: 5000, remaining: 0, status: "paid", fullySettled: true },
            { invoiceId: "inv-sep", applied: 2500, newAmountPaid: 2500, remaining: 2500, status: "unpaid", fullySettled: false },
        ]);
        expect(res.totalApplied).toBe(12500);
        expect(res.leftover).toBe(0);
    });

    it("exact ₹15,000 clears all three with no leftover", () => {
        const res = allocateLumpSum(15000, buildPool(), "u1", "rent");
        expect(res.lines).toHaveLength(3);
        expect(res.lines.every((l) => l.fullySettled)).toBe(true);
        expect(res.totalApplied).toBe(15000);
        expect(res.leftover).toBe(0);
    });

    it("₹18,000 clears all three and returns ₹3,000 leftover credit", () => {
        const res = allocateLumpSum(18000, buildPool(), "u1", "rent");
        expect(res.lines).toHaveLength(3);
        expect(res.totalApplied).toBe(15000);
        expect(res.leftover).toBe(3000);
    });

    it("does not mutate the caller's invoice objects", () => {
        const pool = buildPool();
        const snapshot = pool.map((i) => ({ ...i }));
        allocateLumpSum(12500, pool, "u1", "rent");
        expect(pool).toEqual(snapshot);
    });

    it("resumes correctly from an already-partly-paid pool", () => {
        const pool: InvoiceLike[] = [
            { id: "inv-jul", unitId: "u1", totalAmount: 5000, amountPaid: 5000, status: "paid", createdAt: "2025-07-01T00:00:00.000Z" },
            { id: "inv-aug", unitId: "u1", totalAmount: 5000, amountPaid: 1000, status: "unpaid", createdAt: "2025-08-01T00:00:00.000Z" },
            { id: "inv-sep", unitId: "u1", totalAmount: 5000, amountPaid: 0, status: "unpaid", createdAt: "2025-09-01T00:00:00.000Z" },
        ];
        const res = allocateLumpSum(4000, pool, "u1", "rent");
        expect(res.lines).toEqual([
            { invoiceId: "inv-aug", applied: 4000, newAmountPaid: 5000, remaining: 0, status: "paid", fullySettled: true },
        ]);
        expect(res.leftover).toBe(0);
    });

    it("ignores invoices for other units", () => {
        const pool = buildPool();
        pool.push({ id: "inv-other", unitId: "u2", totalAmount: 5000, amountPaid: 0, status: "unpaid", createdAt: "2025-06-01T00:00:00.000Z" });
        const res = allocateLumpSum(5000, pool, "u1", "rent");
        expect(res.lines).toEqual([
            { invoiceId: "inv-jul", applied: 5000, newAmountPaid: 5000, remaining: 0, status: "paid", fullySettled: true },
        ]);
    });

    it("returns empty result for a non-settleable category", () => {
        const res = allocateLumpSum(5000, buildPool(), "u1", "deposit");
        expect(res.lines).toEqual([]);
        expect(res.totalApplied).toBe(0);
        expect(res.leftover).toBe(5000);
    });

    it("returns empty result when unitId is missing", () => {
        const res = allocateLumpSum(5000, buildPool(), undefined, "rent");
        expect(res.lines).toEqual([]);
        expect(res.leftover).toBe(5000);
    });

    it("zero / negative amount yields no allocation and no leftover", () => {
        expect(allocateLumpSum(0, buildPool(), "u1", "rent")).toEqual({ lines: [], totalApplied: 0, leftover: 0 });
        expect(allocateLumpSum(-500, buildPool(), "u1", "rent")).toEqual({ lines: [], totalApplied: 0, leftover: 0 });
    });

    it("stops cleanly when no pending invoices remain", () => {
        const pool: InvoiceLike[] = [
            { id: "inv-a", unitId: "u1", totalAmount: 1000, amountPaid: 1000, status: "paid", createdAt: "2025-01-01T00:00:00.000Z" },
        ];
        const res = allocateLumpSum(500, pool, "u1", "rent");
        expect(res.lines).toEqual([]);
        expect(res.leftover).toBe(500);
    });
});
