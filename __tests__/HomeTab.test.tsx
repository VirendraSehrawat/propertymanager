// @vitest-environment jsdom
/**
 * Component tests for the Home tab: the "Overdue Invoices" card must show the
 * balance still owed (not the invoice total) and open Record Payment on tap;
 * the "Today" list and Meters Pending follow the meter round's rules.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Invoice, Unit } from "@/types";
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

describe("HomeTab — Today list", () => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

    it("lists rent due with Record payment, the meter round, and leaves drafted units out of Meters Pending", async () => {
        const user = userEvent.setup();
        const units = [
            { id: "u1", buildingId: "b1", unitNumber: "101", status: "occupied", baseRent: 5000, tenantEmail: "a@x.com", tenantName: "Asha", tenantPhone: "9876543210", paymentDay: 1 },
            { id: "u2", buildingId: "b1", unitNumber: "102", status: "occupied", baseRent: 5000, tenantEmail: "b@x.com", meterDraft: { billingMonth: ym, previousReading: 1, savedAt: "" } },
            { id: "u3", buildingId: "b1", unitNumber: "103", status: "occupied", baseRent: 5000, tenantEmail: "c@x.com" },
        ] as unknown as Unit[];
        const onRecordPayment = vi.fn();
        const onNavigate = vi.fn();
        render(
            <HomeTab
                allInvoices={[{ ...inv("a", "101", 0, 5000), unitId: "u1", tenantEmail: "a@x.com" }]}
                occupiedUnits={units}
                allUnits={units}
                vacantUnits={[]}
                activeTickets={[]}
                resolvedTickets={[]}
                allExpenses={[]}
                allLedgerEntries={[]}
                todayCollected={{ rows: [], total: 0 }}
                homeMonth={ym}
                setHomeMonth={() => {}}
                onNavigate={onNavigate}
                onOpenTodayCollections={() => {}}
                onRecordPayment={onRecordPayment}
                openTenantProfile={() => {}}
                buildings={[{ id: "b1", name: "Block A" }]}
            />,
        );
        const today = screen.getByText("📋 Today").closest("div.rounded-xl") as HTMLElement;
        expect(within(today).getByText("🏢 Block A")).toBeInTheDocument();
        expect(within(today).getByText(/2 of 3 done · 1 to read/)).toBeInTheDocument();
        expect(within(today).getByText(/Generate 1 invoice/)).toBeInTheDocument();
        expect(within(today).getByRole("link", { name: /WhatsApp/ })).toHaveAttribute("href", expect.stringContaining("wa.me/919876543210"));
        await user.click(within(today).getByRole("button", { name: /Record payment/ }));
        expect(onRecordPayment).toHaveBeenCalledWith("a");

        // Meters Pending (in "More") lists 103 only: 101 is invoiced, 102 was read as a draft.
        const meters = screen.getByText(/Meters Pending/).closest("div.rounded-xl") as HTMLElement;
        expect(within(meters).getByText("103")).toBeInTheDocument();
        expect(within(meters).queryByText("101")).not.toBeInTheDocument();
        expect(within(meters).queryByText("102")).not.toBeInTheDocument();
        expect(within(meters).getByText(/1 read, waiting to be invoiced/)).toBeInTheDocument();
    });
});
