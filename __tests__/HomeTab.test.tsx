// @vitest-environment jsdom
/**
 * Component tests for the Home tab's "Overdue Invoices" card: it must show the
 * balance still owed (not the invoice total) and open Record Payment on tap.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Invoice } from "@/types";
import { HomeTab } from "@/components/employee/HomeTab";

const monthLabel = (monthsAgo: number) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - monthsAgo);
    return d.toLocaleString("default", { month: "long", year: "numeric" });
};

const inv = (id: string, unitNumber: string, monthsAgo: number, total: number, paid = 0, extra: Partial<Invoice> = {}) => ({
    id, unitId: `u-${id}`, unitNumber, tenantEmail: `${id}@x.com`, status: paid > 0 ? "pending" : "unpaid",
    totalAmount: total, amountPaid: paid, baseRent: total, electricityCharge: 0,
    billingPeriod: monthLabel(monthsAgo), createdAt: new Date().toISOString(), ...extra,
}) as Invoice;

function renderHome(invoices: Invoice[], onRecordPayment = vi.fn(), onNavigate = vi.fn()) {
    render(
        <HomeTab
            allInvoices={invoices}
            occupiedUnits={[]}
            allUnits={[]}
            vacantUnits={[]}
            activeTickets={[]}
            resolvedTickets={[]}
            allExpenses={[]}
            allLedgerEntries={[]}
            todayCollected={{ rows: [], total: 0 }}
            homeMonth={new Date().toISOString().slice(0, 7)}
            setHomeMonth={() => {}}
            onNavigate={onNavigate}
            onOpenTodayCollections={() => {}}
            onRecordPayment={onRecordPayment}
            openTenantProfile={() => {}}
        />,
    );
    const heading = screen.getByText("⚠️ Overdue Invoices");
    return { card: heading.closest("div.rounded-xl") as HTMLElement, onRecordPayment, onNavigate };
}

describe("HomeTab — Overdue Invoices", () => {
    it("shows the remaining balance with a PARTIAL badge, oldest first, and a total of what's owed", () => {
        const { card } = renderHome([
            inv("b", "102", 1, 6000),             // unpaid
            inv("a", "101", 2, 10000, 7000),      // partial: 3,000 left
            inv("c", "103", 1, 4000, 4000),       // fully covered → hidden
            inv("d", "104", 0, 5000),             // current month → not overdue
        ]);
        const rows = within(card).getAllByRole("button").filter(b => /due/.test(b.textContent || ""));
        expect(rows.map(r => r.textContent)).toEqual([
            expect.stringMatching(/^101.*Partial.*Paid ₹7,000 of ₹10,000.*₹3,000/),
            expect.stringMatching(/^102.*₹6,000/),
        ]);
        expect(within(card).queryByText("₹10,000")).not.toBeInTheDocument();
        expect(within(card).getByText("₹9,000")).toBeInTheDocument(); // header total
        expect(within(card).queryByText(/^103$/)).not.toBeInTheDocument();
        expect(within(card).queryByText(/^104$/)).not.toBeInTheDocument();
    });

    it("tapping a row opens Record Payment for that invoice", async () => {
        const user = userEvent.setup();
        const { card, onRecordPayment } = renderHome([inv("a", "101", 2, 10000, 7000)]);
        await user.click(within(card).getByText("101"));
        expect(onRecordPayment).toHaveBeenCalledWith("a");
    });

    it("corporate (grouped) invoices go to Collections instead of settling one child", async () => {
        const user = userEvent.setup();
        const { card, onRecordPayment, onNavigate } = renderHome([inv("m", "301", 1, 8000, 0, { masterInvoiceId: "M1" })]);
        expect(within(card).getByText("Corporate")).toBeInTheDocument();
        await user.click(within(card).getByText("301"));
        expect(onRecordPayment).not.toHaveBeenCalled();
        expect(onNavigate).toHaveBeenCalledWith("collections");
    });
});
