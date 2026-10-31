// @vitest-environment jsdom
/**
 * Component tests for the Monthly overview's row actions: Record payment,
 * Call / WhatsApp with the remaining balance, and Enter meter.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// The 📝 Log follow-up dialog writes to Firestore; not exercised here.
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({ doc: vi.fn(), updateDoc: vi.fn(), arrayUnion: vi.fn() }));

import { MonthlyOverviewTab } from "@/components/employee/MonthlyOverviewTab";

const MONTH = new Date().toISOString().slice(0, 7);
const LABEL = (() => {
    const [y, m] = MONTH.split("-").map(Number);
    return new Date(y, m - 1).toLocaleString("default", { month: "long", year: "numeric" });
})();

const unit = (id: string, unitNumber: string, extra: Record<string, unknown> = {}) => ({
    id, unitNumber, buildingId: "b1", status: "occupied", tenantName: `Tenant ${unitNumber}`, baseRent: 5000, ...extra,
});
const units = [
    unit("u1", "101", { tenantPhone: "9876543210" }),
    unit("u2", "102"),
    unit("u3", "103"),
    unit("u4", "104", { meterDraft: { billingMonth: MONTH } }),
    unit("u5", "105"),
    unit("u6", "106"),
];
const invoices = [
    { id: "i1", unitId: "u1", billingPeriod: LABEL, status: "pending", totalAmount: 10000, amountPaid: 7000, baseRent: 9000, electricityCharge: 1000 },
    { id: "i2", unitId: "u2", billingPeriod: LABEL, status: "unpaid", totalAmount: 6000, baseRent: 5000, electricityCharge: 1000, masterInvoiceId: "m1" },
    { id: "i5", unitId: "u5", billingPeriod: `${LABEL} (Move-in)`, status: "unpaid", totalAmount: 2500, baseRent: 2500 },
];

function renderTab() {
    const handlers = { onRecordPayment: vi.fn(), onOpenCollections: vi.fn(), onEnterMeter: vi.fn() };
    render(<MonthlyOverviewTab allUnits={units} buildings={[{ id: "b1", name: "Block A" }]} allInvoices={invoices} {...handlers} />);
    return handlers;
}

const row = (unitNumber: string) => screen.getByText(`Tenant ${unitNumber}`).closest("div.px-3") as HTMLElement;

describe("MonthlyOverviewTab — row actions", () => {
    it("Record payment opens that invoice; a corporate-grouped invoice goes to Collections", async () => {
        const user = userEvent.setup();
        const h = renderTab();
        await user.click(within(row("101")).getByRole("button", { name: /Record payment/ }));
        expect(h.onRecordPayment).toHaveBeenCalledWith("i1");

        await user.click(within(row("102")).getByRole("button", { name: /Corporate → Collections/ }));
        expect(h.onOpenCollections).toHaveBeenCalled();
        expect(h.onRecordPayment).toHaveBeenCalledTimes(1);
    });

    it("Call and WhatsApp use the tenant's phone and quote the remaining balance", () => {
        renderTab();
        const r = row("101");
        expect(within(r).getByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:+919876543210");
        const wa = within(r).getByRole("link", { name: /WhatsApp/ }).getAttribute("href") || "";
        expect(wa.startsWith("https://wa.me/919876543210?text=")).toBe(true);
        expect(decodeURIComponent(wa)).toContain("₹3,000 is still due");
        expect(within(row("102")).getByText("No phone saved")).toBeInTheDocument();
    });

    it("No Invoice Yet rows open the Meter tab, and say so when a draft reading is saved", async () => {
        const user = userEvent.setup();
        const h = renderTab();
        await user.click(within(row("103")).getByRole("button", { name: "⚡ Enter meter" }));
        expect(h.onEnterMeter).toHaveBeenCalledWith("u3", MONTH);
        await user.click(within(row("104")).getByRole("button", { name: /Draft saved — generate invoice/ }));
        expect(h.onEnterMeter).toHaveBeenLastCalledWith("u4", MONTH);
    });

    it("counts a move-in invoice as this month's invoice", () => {
        renderTab();
        expect(within(row("105")).queryByRole("button", { name: /Enter meter/ })).not.toBeInTheDocument();
        expect(within(row("105")).getByRole("button", { name: /Record payment/ })).toBeInTheDocument();
    });
});
