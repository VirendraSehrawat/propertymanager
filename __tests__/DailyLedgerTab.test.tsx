// @vitest-environment jsdom
/**
 * Component tests for the Daily tab's end-of-day close: missing payment modes
 * must be set first, the close saves the counted cash and difference, and a
 * closed day is read-only (admins can reopen it).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DayClose } from "@/lib/dayClose";
import { localDateKey } from "@/lib/payments";

vi.mock("@/lib/firebase", () => ({ db: {} }));

const setDoc = vi.fn<(ref: unknown, data: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
const updateDoc = vi.fn<(ref: unknown, data: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
vi.mock("firebase/firestore", () => ({
    collection: vi.fn(() => ({})),
    doc: vi.fn((_db: unknown, col: string, id: string) => ({ col, id })),
    setDoc: (ref: unknown, data: Record<string, unknown>) => setDoc(ref, data),
    updateDoc: (ref: unknown, data: Record<string, unknown>) => updateDoc(ref, data),
    writeBatch: vi.fn(),
}));

import { DailyLedgerTab } from "@/components/employee/DailyLedgerTab";

const today = localDateKey(new Date());
const y = new Date();
y.setDate(y.getDate() - 1);
const yesterday = localDateKey(y);

const row = (id: string, direction: "inflow" | "outflow", amount: number, paymentMode?: string) => ({
    id, date: today, direction, category: direction === "inflow" ? "rent" : "material", amount, createdAt: new Date().toISOString(),
    ...(paymentMode ? { paymentMode } : {}),
});
const entries = [row("i1", "inflow", 5000, "cash"), row("i2", "inflow", 3000, "upi"), row("o1", "outflow", 700)];

const prevClose = { date: yesterday, status: "closed", closingCash: 300 } as DayClose;

function renderTab(rows = entries, dayCloses: DayClose[] = [prevClose], canReopenDays = false) {
    render(<DailyLedgerTab entries={rows} buildings={[]} allUnits={[]} currentUserEmail="e@x.com" dayCloses={dayCloses} canReopenDays={canReopenDays} />);
}

beforeEach(() => {
    setDoc.mockClear();
    updateDoc.mockClear();
});

describe("DailyLedgerTab — end-of-day close", () => {
    it("closes the day with opening cash carried from yesterday and records a shortfall", async () => {
        const user = userEvent.setup();
        renderTab();
        await user.click(screen.getByRole("button", { name: "🔒 Close day" }));
        expect(screen.getByText("= Expected cash").parentElement).toHaveTextContent("₹4,600"); // 300 + 5,000 − 700
        expect(screen.getByText(/UPI \/ Bank today/)).toHaveTextContent("₹3,000");

        await user.type(screen.getByLabelText("Cash counted *"), "4500");
        await user.type(screen.getByLabelText("Handed to owner"), "4000");
        expect(screen.getByText(/Short by ₹100/)).toBeInTheDocument();
        const submit = screen.getAllByRole("button", { name: "🔒 Close day" }).at(-1)!;
        expect(submit).toBeDisabled(); // a note is required for a difference
        await user.type(screen.getByLabelText(/^Note/), "Gave change to 102");
        await user.click(submit);

        expect(setDoc).toHaveBeenCalledWith({ col: "dayCloses", id: today }, expect.objectContaining({
            date: today, status: "closed", openingCash: 300, openingFromDate: yesterday,
            cashIn: 5000, digitalIn: 3000, cashOut: 700, expectedCash: 4600,
            actualCash: 4500, difference: -100, handedToOwner: 4000, closingCash: 500,
            note: "Gave change to 102", closedBy: "e@x.com",
        }));
    });

    it("an inflow without a payment mode blocks the close until the mode is set on the row", async () => {
        const user = userEvent.setup();
        renderTab([...entries, row("i3", "inflow", 200)]);
        await user.click(screen.getByRole("button", { name: "🔒 Close day" }));
        expect(screen.getByText(/has no payment mode/)).toBeInTheDocument();
        await user.type(screen.getByLabelText("Cash counted *"), "4800");
        expect(screen.getAllByRole("button", { name: "🔒 Close day" }).at(-1)).toBeDisabled();
        await user.click(screen.getByRole("button", { name: "Cancel" }));

        await user.selectOptions(screen.getByLabelText("Set payment mode"), "cash");
        expect(updateDoc).toHaveBeenCalledWith({ col: "dailyLedger", id: "i3" }, expect.objectContaining({ paymentMode: "cash", modeSetBy: "e@x.com" }));
    });

    it("a closed day is read-only, warns when entries changed afterwards, and only admins can reopen", async () => {
        const closed = {
            date: today, status: "closed", openingCash: 300, openingFromDate: yesterday, cashIn: 5000, digitalIn: 3000, cashOut: 700,
            inflowCount: 2, outflowCount: 1, expectedCash: 4600, actualCash: 4600, difference: 0, handedToOwner: 4600, closingCash: 0,
            note: "", closedBy: "e@x.com", closedAt: new Date().toISOString(),
        } as DayClose;
        renderTab(entries, [prevClose, closed]);
        expect(screen.getByText(/Day closed/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "🔒 Close day" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Reopen/ })).not.toBeInTheDocument();
        expect(screen.queryByText(/changed after it was closed/)).not.toBeInTheDocument();
    });

    it("admin sees the late-change warning and can reopen with a reason", async () => {
        const user = userEvent.setup();
        const closed = {
            date: today, status: "closed", cashIn: 4000, digitalIn: 3000, cashOut: 700, inflowCount: 2, outflowCount: 1,
            expectedCash: 3600, actualCash: 3600, difference: 0, handedToOwner: 0, closingCash: 3600, note: "",
            closedBy: "e@x.com", closedAt: new Date().toISOString(),
        } as DayClose;
        renderTab(entries, [prevClose, closed], true);
        expect(screen.getByText(/changed after it was closed/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Reopen/ }));
        const reopen = screen.getByPlaceholderText(/Reason for reopening/);
        await user.type(reopen, "Late cash payment");
        await user.click(within(reopen.parentElement as HTMLElement).getByRole("button", { name: "Reopen" }));
        expect(updateDoc).toHaveBeenCalledWith({ col: "dayCloses", id: today }, expect.objectContaining({
            status: "reopened", reopenedBy: "e@x.com", reopenReason: "Late cash payment",
        }));
    });
});
