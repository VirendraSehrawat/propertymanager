// @vitest-environment jsdom
/**
 * Component tests for §4.4 / §4.5: the employee and admin Expenses tabs save
 * the expense and its Daily-ledger mirror in one batch, refuse closed days,
 * soft-delete both together, and the admin never counts deleted expenses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Expense } from "@/types";
import type { DayClose } from "@/lib/dayClose";
import { localDateKey } from "@/lib/payments";

vi.mock("@/lib/firebase", () => ({ db: {} }));

type Op = { op: "set" | "update"; ref: { col: string; id: string }; data: Record<string, unknown> };
let batches: Op[][] = [];
let ids = 0;
vi.mock("firebase/firestore", () => ({
    collection: vi.fn((_db: unknown, col: string) => ({ col })),
    doc: vi.fn((parent: { col?: string }, col?: string, id?: string) =>
        typeof col === "string" ? { col, id } : { col: parent.col, id: `new${++ids}` }),
    writeBatch: vi.fn(() => {
        const ops: Op[] = [];
        return {
            set: (ref: Op["ref"], data: Op["data"]) => ops.push({ op: "set", ref, data }),
            update: (ref: Op["ref"], data: Op["data"]) => ops.push({ op: "update", ref, data }),
            commit: async () => { batches.push(ops); },
        };
    }),
    addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), deleteField: vi.fn(),
}));

import { ExpensesTab } from "@/components/employee/ExpensesTab";
import { AdminExpensesTab } from "@/components/admin/AdminExpensesTab";

const today = localDateKey(new Date());
const exp = (id: string, amount: number, extra: Partial<Expense> = {}): Expense => ({
    id, amount, category: "Plumbing", description: `Job ${id}`, date: today, createdAt: new Date().toISOString(), dailyLedgerId: `L-${id}`, ...extra,
});

beforeEach(() => {
    batches = [];
    ids = 0;
    vi.spyOn(window, "alert").mockImplementation(() => {});
});

async function logExpense(user: ReturnType<typeof userEvent.setup>, amount: string, date?: string) {
    await user.type(screen.getByPlaceholderText("e.g. 500"), amount);
    await user.type(screen.getByPlaceholderText("What was the expense for?"), "Tap washer");
    if (date) {
        const input = document.querySelector('form input[type="date"]') as HTMLInputElement;
        await user.clear(input);
        await user.type(input, date);
    }
    await user.click(screen.getByRole("button", { name: "Log Expense" }));
}

describe("Employee Expenses tab", () => {
    it("saves the expense and its Daily-ledger row in one batch, dated today (local)", async () => {
        const user = userEvent.setup();
        render(<ExpensesTab allExpenses={[]} allAllocations={[]} buildings={[]} userEmail="e@x.com" />);
        await user.click(screen.getByRole("button", { name: "+ Add" }));
        await logExpense(user, "450");

        expect(batches).toHaveLength(1);
        const [expenseOp, ledgerOp] = batches[0];
        expect(expenseOp).toMatchObject({ op: "set", ref: { col: "expenses" }, data: { amount: 450, date: today, dailyLedgerId: ledgerOp.ref.id } });
        expect(ledgerOp).toMatchObject({ op: "set", ref: { col: "dailyLedger" }, data: { direction: "outflow", amount: 450, date: today, expenseId: expenseOp.ref.id } });
    });

    it("refuses a closed day", async () => {
        const user = userEvent.setup();
        const closes = [{ date: today, status: "closed" }] as DayClose[];
        render(<ExpensesTab allExpenses={[]} allAllocations={[]} buildings={[]} userEmail="e@x.com" dayCloses={closes} />);
        await user.click(screen.getByRole("button", { name: "+ Add" }));
        await logExpense(user, "450");
        expect(batches).toHaveLength(0);
        expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/is closed/));
    });

    it("soft-deletes the expense and its mirror together", async () => {
        const user = userEvent.setup();
        vi.spyOn(window, "prompt").mockReturnValue("Duplicate");
        render(<ExpensesTab allExpenses={[exp("a", 300)]} allAllocations={[]} buildings={[]} userEmail="e@x.com" />);
        await user.click(screen.getByTitle("Delete with reason"));
        expect(batches[0]).toEqual([
            expect.objectContaining({ op: "update", ref: { col: "expenses", id: "a" }, data: expect.objectContaining({ deleted: true, deleteReason: "Duplicate", deletedBy: "e@x.com" }) }),
            expect.objectContaining({ op: "update", ref: { col: "dailyLedger", id: "L-a" }, data: expect.objectContaining({ deleted: true }) }),
        ]);
    });
});

describe("Admin Expenses tab", () => {
    const expenses = [exp("a", 1000), exp("b", 500, { deleted: true, deletedBy: "e@x.com", deleteReason: "Duplicate" })];

    it("doesn't count deleted expenses, and shows them only on request", async () => {
        const user = userEvent.setup();
        render(<AdminExpensesTab expenses={expenses} currentUserEmail="a@x.com" />);
        expect(screen.getByText(/Total spent: ₹1,000 across 1 records/)).toBeInTheDocument();
        expect(screen.queryByText("Job b")).not.toBeInTheDocument();
        await user.click(screen.getByLabelText(/Show 1 deleted/));
        expect(screen.getByText("Job b")).toBeInTheDocument();
        expect(screen.getByText(/Deleted by e@x.com.*Duplicate/)).toBeInTheDocument();
    });

    it("soft-deletes with a reason instead of erasing, cascading to the Daily ledger", async () => {
        const user = userEvent.setup();
        vi.spyOn(window, "prompt").mockReturnValue("Wrong amount");
        render(<AdminExpensesTab expenses={expenses} currentUserEmail="a@x.com" />);
        await user.click(screen.getByTitle("Delete with reason"));
        expect(batches[0].map(o => [o.op, o.ref.col, o.ref.id, o.data.deleted])).toEqual([
            ["update", "expenses", "a", true],
            ["update", "dailyLedger", "L-a", true],
        ]);
    });

    it("lists Daily-ledger outflows left behind by deleted expenses and removes them", async () => {
        const user = userEvent.setup();
        vi.spyOn(window, "confirm").mockReturnValue(true);
        const ledger = [
            { id: "L-a", direction: "outflow", expenseId: "a", amount: 1000 },
            { id: "L-old", direction: "outflow", expenseId: "hard-deleted", amount: 700, date: "2026-09-02", description: "Paint" },
        ];
        render(<AdminExpensesTab expenses={expenses} dailyLedgerEntries={ledger} currentUserEmail="a@x.com" />);
        const banner = screen.getByText(/1 Daily-ledger outflow \(₹700\) belong to deleted expenses/).closest("div.rounded-xl") as HTMLElement;
        await user.click(within(banner).getByRole("button", { name: "Remove from Daily ledger" }));
        expect(batches[0]).toEqual([expect.objectContaining({ op: "update", ref: { col: "dailyLedger", id: "L-old" }, data: expect.objectContaining({ deleted: true, deletedBy: "a@x.com" }) })]);
    });

    it("adds an expense in one batch with a local date", async () => {
        const user = userEvent.setup();
        render(<AdminExpensesTab expenses={[]} currentUserEmail="a@x.com" />);
        await user.click(screen.getByRole("button", { name: "+ Record Expense" }));
        await user.type(screen.getByPlaceholderText("e.g. 1500"), "900");
        await user.type(screen.getByPlaceholderText(/Describe expense/), "Gate lock");
        await user.click(screen.getByRole("button", { name: "Save Expense" }));
        expect(batches[0].map(o => [o.ref.col, o.data.date, o.data.source])).toEqual([
            ["expenses", today, "admin-expense"],
            ["dailyLedger", today, "admin-expense"],
        ]);
    });
});
