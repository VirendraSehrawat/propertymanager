// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { applyVacateAmounts, buildVacateInvoice, buildVacatePlan, vacateAmountErrors } from "@/lib/vacateInvoice";

vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/lib/notify", () => ({ notifyInvoiceCreated: vi.fn() }));
const updateDoc = vi.fn<(ref: unknown, data: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
const setDoc = vi.fn<(ref: unknown, data: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
vi.mock("firebase/firestore", () => ({
    doc: vi.fn((_db: unknown, col: string, id: string) => ({ col, id })),
    updateDoc: (r: unknown, d: Record<string, unknown>) => updateDoc(r, d),
    setDoc: (r: unknown, d: Record<string, unknown>) => setDoc(r, d),
}));

import { VacateInvoiceModal } from "@/components/employee/modals/VacateInvoiceModal";
import type { Invoice } from "@/types";

describe("buildVacatePlan", () => {
    const unit = {
        tenantName: "Asha", tenantEmail: "a@x.com", tenantPhone: "99", moveInDate: "2026-01-01",
        securityDeposit: 20000, lastChecklistDeduction: 3000, coTenants: [{ name: "Bob" }],
    };

    it("computes refund and archives the tenant", () => {
        const p = buildVacatePlan(unit, "2026-11-01T00:00:00Z");
        expect(p.refund).toBe(17000);
        expect(p.historyEntry).toMatchObject({ tenantName: "Asha", moveOutDate: "2026-11-01T00:00:00Z", securityRefund: 17000, coTenants: [{ name: "Bob" }] });
    });

    it("clears tenant fields and marks the unit vacant", () => {
        expect(buildVacatePlan(unit, "x").unitUpdate).toMatchObject({
            status: "vacant", tenantEmail: "", tenantName: "", securityDeposit: "", coTenants: [],
        });
    });

    it("never refunds a negative amount and handles missing deposit/unit", () => {
        expect(buildVacatePlan({ securityDeposit: "1000", lastChecklistDeduction: "5000" }, "x").refund).toBe(0);
        const p = buildVacatePlan(undefined, "x");
        expect(p.deposit).toBe(0);
        expect(p.historyEntry.tenantName).toBe("");
    });
});

describe("final bill helpers", () => {
    it("validates amounts", () => {
        expect(vacateAmountErrors({ rent: 0, electricity: 0 })).toEqual([]);
        expect(vacateAmountErrors({ rent: -1, electricity: 0 })).toHaveLength(1);
        expect(vacateAmountErrors({ rent: 1, electricity: NaN })).toHaveLength(1);
    });

    it("recomputes total keeping carry-forward and custom items", () => {
        expect(applyVacateAmounts({ carryForward: 500, customItems: [{ amount: 200 }] }, { rent: 4000, electricity: 750 }))
            .toEqual({ baseRent: 4000, electricityCharge: 750, totalAmount: 5450 });
    });

    it("builds a new unpaid final invoice", () => {
        const inv = buildVacateInvoice({ unitId: "u1", unitNumber: "101", tenantEmail: "a@x.com", amounts: { rent: 3000, electricity: 400 }, now: "2026-11-05T10:00:00.000Z" });
        expect(inv.invoiceId).toBe("inv_u1_vacate_20261105100000");
        expect(inv.fields).toMatchObject({ totalAmount: 3400, status: "unpaid", billingYm: "2026-11", electricityCharge: 400 });
    });
});

describe("VacateInvoiceModal", () => {
    const vacated = { id: "u1", unitNumber: "101", tenantEmail: "a@x.com", tenantName: "Asha", baseRent: 10000 };
    const inv = { id: "inv1", unitId: "u1", status: "unpaid", baseRent: 10000, electricityCharge: 300, totalAmount: 10300, billingPeriod: "Oct 2026", createdAt: "2026-10-01" } as Invoice;

    beforeEach(() => { updateDoc.mockClear(); setDoc.mockClear(); });

    it("overrides rent and electricity on the open invoice", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<VacateInvoiceModal vacated={vacated} invoices={[inv]} onClose={onClose} />);
        const rent = screen.getByLabelText(/Rent/);
        await user.clear(rent); await user.type(rent, "4500");
        const el = screen.getByLabelText(/Electricity/);
        await user.clear(el); await user.type(el, "900");
        await user.click(screen.getByRole("button", { name: "Update invoice" }));
        expect(updateDoc).toHaveBeenCalledWith({ col: "invoices", id: "inv1" }, { baseRent: 4500, electricityCharge: 900, totalAmount: 5400 });
        expect(onClose).toHaveBeenCalled();
    });

    it("creates a final invoice when none is open", async () => {
        const user = userEvent.setup();
        render(<VacateInvoiceModal vacated={vacated} invoices={[]} onClose={vi.fn()} />);
        await user.click(screen.getByRole("button", { name: "Create invoice" }));
        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(setDoc.mock.calls[0][1]).toMatchObject({ unitId: "u1", baseRent: 10000, totalAmount: 10000, status: "unpaid" });
    });

    it("disables saving on negative amounts", async () => {
        const user = userEvent.setup();
        render(<VacateInvoiceModal vacated={vacated} invoices={[]} onClose={vi.fn()} />);
        const rent = screen.getByLabelText(/Rent/);
        await user.clear(rent); await user.type(rent, "-5");
        expect(screen.getByRole("button", { name: "Create invoice" })).toBeDisabled();
    });
});
