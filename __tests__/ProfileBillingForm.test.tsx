// @vitest-environment jsdom
/**
 * Tests for the tenant profile's Payment & Security form (§6.4): validation,
 * saving only what changed, clearing fields, and one Save button.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/firebase", () => ({ db: {} }));
const updateDoc = vi.fn<(ref: unknown, data: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
vi.mock("firebase/firestore", () => ({
    doc: vi.fn((_db: unknown, col: string, id: string) => ({ col, id })),
    updateDoc: (ref: unknown, data: Record<string, unknown>) => updateDoc(ref, data),
    deleteField: () => "__delete__",
}));

import { ProfileBillingForm, billingUpdate } from "@/components/employee/ProfileBillingForm";

beforeEach(() => updateDoc.mockClear());

describe("billingUpdate", () => {
    const current = { paymentDay: 5, securityDeposit: 10000, securityDepositDate: "2026-01-01", electricityRate: 9 };

    it("returns only changed fields and removes cleared ones", () => {
        expect(billingUpdate({ paymentDay: "5", securityDeposit: "10000", electricityRate: "9" }, current, "t")).toEqual({ errors: [], set: {}, remove: [] });
        expect(billingUpdate({ paymentDay: "7", securityDeposit: "", electricityRate: "" }, current, "t"))
            .toEqual({ errors: [], set: { paymentDay: 7 }, remove: ["securityDeposit", "electricityRate", "securityDepositDate"] });
    });

    it("stamps the deposit date the first time a deposit is entered", () => {
        expect(billingUpdate({ paymentDay: "", securityDeposit: "8000", electricityRate: "" }, {}, "now").set).toEqual({ securityDeposit: 8000, securityDepositDate: "now" });
    });

    it("validates each field", () => {
        expect(billingUpdate({ paymentDay: "32", securityDeposit: "-1", electricityRate: "0" }, {}, "t").errors).toEqual([
            "Payment day must be a whole number from 1 to 31.",
            "Security deposit can't be negative.",
            "Electricity rate must be more than 0 (leave it empty to use the default).",
        ]);
    });
});

describe("ProfileBillingForm", () => {
    it("saves all changes with one button and reports back", async () => {
        const user = userEvent.setup();
        const onSaved = vi.fn();
        vi.spyOn(window, "alert").mockImplementation(() => {});
        render(<ProfileBillingForm unit={{ id: "u1", paymentDay: 5, electricityRate: 9 }} defaultElectricityRate={10} onSaved={onSaved} />);
        const save = screen.getByRole("button", { name: "No changes" });
        expect(save).toBeDisabled();

        await user.clear(screen.getByLabelText("Payment day"));
        await user.type(screen.getByLabelText("Payment day"), "10");
        await user.type(screen.getByLabelText("Security deposit (₹)"), "15000");
        await user.clear(screen.getByLabelText(/Electricity rate/));
        await user.click(screen.getByRole("button", { name: "Save payment & security" }));

        expect(updateDoc).toHaveBeenCalledWith({ col: "units", id: "u1" }, {
            paymentDay: 10, securityDeposit: 15000, securityDepositDate: expect.any(String), electricityRate: "__delete__",
        });
        expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ paymentDay: 10, securityDeposit: 15000 }));
        expect(onSaved.mock.calls[0][0]).not.toHaveProperty("electricityRate");
    });

    it("blocks saving an invalid payment day", async () => {
        const user = userEvent.setup();
        render(<ProfileBillingForm unit={{ id: "u1" }} defaultElectricityRate={10} onSaved={() => {}} />);
        await user.type(screen.getByLabelText("Payment day"), "40");
        expect(screen.getByText("Payment day must be a whole number from 1 to 31.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save payment & security" })).toBeDisabled();
    });
});
