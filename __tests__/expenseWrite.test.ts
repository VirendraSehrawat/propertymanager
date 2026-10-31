/**
 * Unit tests for lib/expenseWrite.ts — the expense + Daily-ledger mirror
 * payloads (one batch, cross-linked, local date), closed-day checks, and
 * finding Daily-ledger outflows whose expense is gone.
 */

import { describe, it, expect } from "vitest";
import { buildExpenseWrite, closedDayError, orphanedExpenseMirrors, softDeletePatch } from "@/lib/expenseWrite";
import { localDateKey } from "@/lib/payments";

describe("buildExpenseWrite", () => {
    const base = { expenseId: "E1", ledgerId: "L1", amount: 1200, category: "Common Area", description: "Tank cleaning", createdBy: "e@x.com", now: "2026-10-31T10:00:00.000Z" };

    it("cross-links the expense and its Daily-ledger outflow", () => {
        const { expense, ledger } = buildExpenseWrite({ ...base, date: "2026-10-30", buildingId: "b1", buildingName: "Block A", receiptUrl: "https://r" });
        expect(expense).toEqual({
            amount: 1200, category: "Common Area", description: "Tank cleaning", date: "2026-10-30",
            buildingId: "b1", buildingName: "Block A", dailyLedgerId: "L1", receiptUrl: "https://r",
            createdBy: "e@x.com", createdAt: base.now,
        });
        expect(ledger).toMatchObject({
            date: "2026-10-30", direction: "outflow", category: "common area", amount: 1200, expenseId: "E1",
            buildingName: "Block A", unitId: "", receiptUrl: "https://r", createdBy: "e@x.com",
        });
    });

    it("defaults to the local date (not UTC) and General, and leaves out empty optional fields", () => {
        // 00:30 IST on 1 Nov is still 31 Oct in UTC.
        const now = new Date(2026, 10, 1, 0, 30).toISOString();
        const { expense, ledger } = buildExpenseWrite({ ...base, now, source: "admin-expense" });
        expect(expense.date).toBe(localDateKey(new Date(2026, 10, 1, 0, 30)));
        expect(ledger.date).toBe(expense.date);
        expect(expense).toMatchObject({ buildingId: "", buildingName: "General", source: "admin-expense" });
        expect(expense).not.toHaveProperty("receiptUrl");
    });
});

describe("closedDayError / softDeletePatch", () => {
    it("refuses closed days only", () => {
        const closes = [{ date: "2026-10-30", status: "closed" as const }, { date: "2026-10-29", status: "reopened" as const }];
        expect(closedDayError("2026-10-30", closes)).toMatch(/2026-10-30 is closed/);
        expect(closedDayError("2026-10-29", closes)).toBeNull();
        expect(closedDayError("2026-10-31", closes)).toBeNull();
    });

    it("builds an audited soft delete", () => {
        expect(softDeletePatch("a@x.com", "  duplicate ", "t")).toEqual({ deleted: true, deleteReason: "duplicate", deletedBy: "a@x.com", deletedAt: "t" });
    });
});

describe("orphanedExpenseMirrors", () => {
    it("finds live outflows whose expense was hard-deleted or soft-deleted without the cascade", () => {
        const ledger = [
            { id: "l1", direction: "outflow", expenseId: "e1" },            // expense alive
            { id: "l2", direction: "outflow", expenseId: "gone" },          // expense hard-deleted
            { id: "l3", direction: "outflow", expenseId: "e3" },            // expense soft-deleted, mirror not
            { id: "l4", direction: "outflow", expenseId: "e3", deleted: true },
            { id: "l5", direction: "outflow" },                             // labour row from Daily (has its own expense link) / legacy
            { id: "l6", direction: "inflow", expenseId: "gone" },
        ];
        const expenses = [{ id: "e1" }, { id: "e3", deleted: true }];
        expect(orphanedExpenseMirrors(ledger, expenses).map(r => r.id)).toEqual(["l2", "l3"]);
    });
});
