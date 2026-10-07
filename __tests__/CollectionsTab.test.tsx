// @vitest-environment jsdom
/**
 * Component tests for the Employee Collections tab (backlog B5).
 *
 * Covers two user-facing flows:
 *   1. Settle flow — clicking "Settle" opens the Record Payment modal; saving a
 *      full payment writes the invoice + ledger row and fires the Telegram
 *      notification with the correct amount.
 *   2. Carry-forward preview — an unpaid invoice from the *previous* month
 *      surfaces in the "Carry Forward" section for the right unit/period.
 *
 * Firestore + notification side-effects are mocked so the test asserts on the
 * payloads the component produces, not on real network writes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Invoice, Unit } from "@/types";

// ---- Mocks ---------------------------------------------------------------

vi.mock("@/lib/firebase", () => ({ db: {} }));

const notifyPaymentRecorded = vi.fn();
vi.mock("@/lib/notify", () => ({
    notifyPaymentRecorded: (payload: unknown) => notifyPaymentRecorded(payload),
}));

const updateDoc = vi.fn<(ref: unknown, data: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve(),
);
const addDoc = vi.fn<(ref: unknown, data: Record<string, unknown>) => Promise<{ id: string }>>(
    () => Promise.resolve({ id: "ledger1" }),
);
vi.mock("firebase/firestore", () => ({
    doc: vi.fn(() => ({ __doc: true })),
    collection: vi.fn(() => ({ __collection: true })),
    updateDoc: (ref: unknown, data: Record<string, unknown>) => updateDoc(ref, data),
    addDoc: (ref: unknown, data: Record<string, unknown>) => addDoc(ref, data),
    deleteField: vi.fn(() => "__delete__"),
    writeBatch: vi.fn(() => ({
        update: vi.fn(),
        commit: vi.fn(() => Promise.resolve()),
    })),
}));

// Import AFTER mocks are registered.
import { CollectionsTab } from "@/components/employee/CollectionsTab";

// ---- Fixtures ------------------------------------------------------------

const currentMonth = new Date().toLocaleString("default", { month: "long", year: "numeric" });
const prevMonthDate = new Date();
prevMonthDate.setDate(1);
prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
const previousMonth = prevMonthDate.toLocaleString("default", { month: "long", year: "numeric" });

const unitA: Unit = {
    id: "u1", buildingId: "b1", unitNumber: "101", baseRent: 5000,
    status: "occupied", tenantEmail: "alice@x.com", tenantName: "Alice",
};
const unitB: Unit = {
    id: "u2", buildingId: "b1", unitNumber: "102", baseRent: 4000,
    status: "occupied", tenantEmail: "bob@x.com", tenantName: "Bob",
};

/** Current-month unpaid invoice for unit 101 — the one we settle. */
const invoiceCurrent: Invoice = {
    id: "inv-current", unitId: "u1", unitNumber: "101", tenantEmail: "alice@x.com",
    status: "unpaid", totalAmount: 6000, billingPeriod: currentMonth,
    baseRent: 5000, electricityCharge: 1000, createdAt: new Date().toISOString(),
};

/** Previous-month unpaid invoice for unit 102 — the carry-forward source. */
const invoicePrev: Invoice = {
    id: "inv-prev", unitId: "u2", unitNumber: "102", tenantEmail: "bob@x.com",
    status: "unpaid", totalAmount: 4000, billingPeriod: previousMonth,
    baseRent: 4000, electricityCharge: 0, createdAt: prevMonthDate.toISOString(),
};

function renderTab(invoices: Invoice[]) {
    return render(
        <CollectionsTab
            allInvoices={invoices}
            occupiedUnits={[unitA, unitB]}
            electricityRate={10}
            openTenantProfile={() => {}}
            allLedgerEntries={[]}
            masterInvoices={[]}
            userEmail="employee@x.com"
        />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ---- Tests ---------------------------------------------------------------

describe("CollectionsTab — settle flow", () => {
    it("opens the Record Payment modal and persists a full settlement", async () => {
        const user = userEvent.setup();
        renderTab([invoiceCurrent]);

        // The pending row exposes a Settle action.
        await user.click(screen.getByRole("button", { name: /Settle/ }));

        // Modal is open.
        const dialogHeading = await screen.findByText("✓ Record Payment");
        expect(dialogHeading).toBeInTheDocument();

        // Default kind = full, received = remaining (6000). Save it.
        await user.click(screen.getByRole("button", { name: /Save ₹6,000/ }));

        // Invoice doc updated: fully paid + full amount.
        expect(updateDoc).toHaveBeenCalledTimes(1);
        const invoicePatch = updateDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(invoicePatch.status).toBe("paid");
        expect(invoicePatch.amountPaid).toBe(6000);
        expect(invoicePatch).toHaveProperty("paidAt");

        // Ledger row written for the full amount.
        expect(addDoc).toHaveBeenCalledTimes(1);
        const ledgerRow = addDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(ledgerRow.amountPaid).toBe(6000);
        expect(ledgerRow.invoiceId).toBe("inv-current");
        expect(ledgerRow.type).toBe("payment");

        // Notification fired with the right amount.
        expect(notifyPaymentRecorded).toHaveBeenCalledTimes(1);
        expect(notifyPaymentRecorded.mock.calls[0][0]).toMatchObject({
            invoiceId: "inv-current", amount: 6000, fully: true,
        });
    });

    it("records a partial payment without closing the invoice", async () => {
        const user = userEvent.setup();
        renderTab([invoiceCurrent]);

        await user.click(screen.getByRole("button", { name: /Settle/ }));
        await screen.findByText("✓ Record Payment");

        // Switch to Partial and enter 2000 (covers rent-first portion only).
        await user.click(screen.getByRole("button", { name: /Partial/ }));
        const amountInput = screen.getByPlaceholderText(/Up to/i);
        await user.clear(amountInput);
        await user.type(amountInput, "2000");

        await user.click(screen.getByRole("button", { name: /Save ₹2,000/ }));

        const invoicePatch = updateDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(invoicePatch.status).toBe("pending");
        expect(invoicePatch.amountPaid).toBe(2000);
        expect(invoicePatch).not.toHaveProperty("paidAt");

        const ledgerRow = addDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(ledgerRow.type).toBe("partial-payment");
        expect(notifyPaymentRecorded.mock.calls[0][0]).toMatchObject({ amount: 2000, fully: false });
    });
});

describe("CollectionsTab — carry-forward preview", () => {
    it("surfaces a previous-month unpaid invoice for the correct unit", () => {
        renderTab([invoiceCurrent, invoicePrev]);

        const heading = screen.getByText(/Carry Forward \(Outstanding from Previous Month\)/i);
        const section = heading.closest("div")!;

        // Unit 102's previous-month balance shows; it is NOT in the current
        // month's pending list (filtered out by the month selector default).
        expect(within(section).getByText("102")).toBeInTheDocument();
        expect(within(section).getByText(new RegExp(previousMonth))).toBeInTheDocument();
        expect(within(section).getByText("₹4,000")).toBeInTheDocument();
    });

    it("shows an empty-state when no previous-month dues exist", () => {
        renderTab([invoiceCurrent]);
        expect(
            screen.getByText(/No outstanding carry forward for any unit/i),
        ).toBeInTheDocument();
    });
});
