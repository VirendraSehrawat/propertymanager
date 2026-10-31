// @vitest-environment jsdom
/**
 * Component tests for the Meter tab's "meter round" (Save & next).
 *
 * Firestore and notifications are mocked so the test asserts on the invoice
 * the component writes and on which unit it moves to next.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Invoice, Unit } from "@/types";

vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/lib/notify", () => ({ notifyInvoiceCreated: vi.fn() }));

const batchSet = vi.fn<(ref: unknown, data: Record<string, unknown>) => void>();
const batchUpdate = vi.fn<(ref: unknown, data: Record<string, unknown>) => void>();
vi.mock("firebase/firestore", () => ({
    doc: vi.fn((_db: unknown, col: string, id: string) => ({ col, id })),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
    deleteField: vi.fn(() => "__delete__"),
    writeBatch: vi.fn(() => ({
        set: (ref: unknown, data: Record<string, unknown>) => batchSet(ref, data),
        update: (ref: unknown, data: Record<string, unknown>) => batchUpdate(ref, data),
        commit: () => Promise.resolve(),
    })),
}));

import { MeterTab } from "@/components/employee/MeterTab";
import { meterInvoiceId } from "@/lib/meterRound";

const now = new Date();
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

const unit = (id: string, unitNumber: string, buildingId: string, last: number): Unit => ({
    id, unitNumber, buildingId, baseRent: 5000, status: "occupied",
    tenantName: `Tenant ${unitNumber}`, tenantEmail: `${id}@x.com`, lastMeterReading: last,
});
// Deliberately out of order: the round must sort Block A before Block B, then by unit number.
const units = [unit("u3", "201", "b2", 300), unit("u2", "102", "b1", 200), unit("u1", "101", "b1", 100)];
const buildings = [{ id: "b1", name: "Block A" }, { id: "b2", name: "Block B" }];

function renderTab(invoices: Invoice[] = [], unitList: Unit[] = units) {
    return render(<MeterTab occupiedUnits={unitList} allInvoices={invoices} electricityRate={10} buildings={buildings} />);
}

const unitSelect = () => screen.getByLabelText("Unit") as HTMLSelectElement;

beforeEach(() => vi.clearAllMocks());

describe("MeterTab — meter round", () => {
    it("starts on the first pending unit in walking order and shows progress", () => {
        renderTab([{ id: meterInvoiceId("u1", thisMonth) } as Invoice]);
        expect(unitSelect().value).toBe("u2"); // 101 already billed → 102 is first pending
        expect(screen.getByText(/1 of 3 done · Block A/)).toBeInTheDocument();
    });

    it("Save & next writes the invoice, shows a toast and moves to the next pending unit", async () => {
        const user = userEvent.setup();
        renderTab();
        expect(unitSelect().value).toBe("u1");

        await user.type(screen.getByPlaceholderText("e.g. 1250"), "150");
        await user.click(screen.getByRole("button", { name: /Save & next/ }));

        // Invoice for 101: 50 units × ₹10 + ₹5,000 rent.
        const [ref, data] = batchSet.mock.calls[0];
        expect(ref).toMatchObject({ id: meterInvoiceId("u1", thisMonth) });
        expect(data).toMatchObject({ unitId: "u1", electricityConsumed: 50, totalAmount: 5500 });

        // Non-blocking toast instead of alert, and the form moved on to 102 with a cleared reading.
        expect(await screen.findByRole("status")).toHaveTextContent("101: ₹5,500 invoice (50 units) · Next: 102");
        expect(unitSelect().value).toBe("u2");
        expect((screen.getByPlaceholderText("e.g. 1250") as HTMLInputElement).value).toBe("");
        expect(screen.getByText(/1 of 3 done/)).toBeInTheDocument();
    });

    it("on the last pending unit there is no Skip, and the button is a plain Generate Invoice", () => {
        renderTab([
            { id: meterInvoiceId("u1", thisMonth) } as Invoice,
            { id: meterInvoiceId("u2", thisMonth) } as Invoice,
        ]);
        expect(unitSelect().value).toBe("u3");
        expect(screen.queryByRole("button", { name: /Skip/ })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Generate Invoice" })).toBeInTheDocument();
    });

    it("Skip jumps to the next pending unit", async () => {
        const user = userEvent.setup();
        renderTab();
        await user.click(screen.getByRole("button", { name: /Skip/ }));
        expect(unitSelect().value).toBe("u2");
        expect(batchSet).not.toHaveBeenCalled();
    });
});

describe("MeterTab — reading checks, drafts and photo", () => {
    it("blocks a reading below the previous one and points to Meter changed", async () => {
        const user = userEvent.setup();
        renderTab();
        await user.type(screen.getByPlaceholderText("e.g. 1250"), "90"); // 101's last reading is 100
        expect(screen.getByRole("alert")).toHaveTextContent("lower than the previous reading 100");
        expect(screen.getByRole("button", { name: /Save & next/ })).toBeDisabled();
        expect(screen.getByRole("button", { name: /Save reading only/ })).toBeDisabled();
    });

    it("shows units × rate live and asks for a re-check on an unusual spike", async () => {
        const user = userEvent.setup();
        const history = ["July", "August", "September"].map((m, i) => ({
            id: `h${i}`, unitId: "u1", billingPeriod: `${m} 2000`, electricityConsumed: 20,
        }) as Invoice);
        renderTab(history);
        await user.type(screen.getByPlaceholderText("e.g. 1250"), "150"); // 50 units vs avg 20
        expect(screen.getByText(/= 50 units × ₹10 =/)).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent("50 units is more than 2× this unit's usual 20 units");

        await user.click(screen.getByRole("button", { name: /Save & next/ }));
        expect(batchSet).not.toHaveBeenCalled();

        await user.click(screen.getByLabelText(/re-checked the meter/));
        await user.click(screen.getByRole("button", { name: /Save & next/ }));
        expect(batchSet).toHaveBeenCalledTimes(1);
    });

    it("Save reading only stores a draft on the unit and moves on without an invoice", async () => {
        const user = userEvent.setup();
        renderTab();
        await user.type(screen.getByPlaceholderText("e.g. 1250"), "150");
        await user.click(screen.getByRole("button", { name: /Save reading only/ }));

        expect(batchSet).not.toHaveBeenCalled();
        const [ref, data] = batchUpdate.mock.calls[0];
        expect(ref).toMatchObject({ col: "units", id: "u1" });
        expect(data.meterDraft).toMatchObject({ billingMonth: thisMonth, previousReading: 100, currentReading: 150 });
        expect(await screen.findByRole("status")).toHaveTextContent("101: reading 150 saved as draft · Next: 102");
        expect(unitSelect().value).toBe("u2");
        expect(screen.getByRole("button", { name: "Generate 1 invoice" })).toBeInTheDocument();
    });

    it("generates invoices for every draft in one go and clears the drafts", async () => {
        const user = userEvent.setup();
        vi.spyOn(window, "confirm").mockReturnValue(true);
        const drafted = units.map((u) => u.id === "u3" ? u : {
            ...u, meterDraft: { billingMonth: thisMonth, previousReading: u.lastMeterReading ?? 0, currentReading: (u.lastMeterReading ?? 0) + 30, savedAt: "x" },
        });
        renderTab([], drafted);
        expect(unitSelect().value).toBe("u3"); // drafted units are not pending

        await user.click(screen.getByRole("button", { name: "Generate 2 invoices" }));

        expect(batchSet.mock.calls.map(([ref]) => (ref as { id: string }).id).sort()).toEqual(
            [meterInvoiceId("u1", thisMonth), meterInvoiceId("u2", thisMonth)].sort(),
        );
        expect(batchSet.mock.calls[0][1]).toMatchObject({ electricityConsumed: 30, totalAmount: 5300 });
        expect(batchUpdate.mock.calls.every(([, data]) => data.meterDraft === "__delete__")).toBe(true);
        expect(await screen.findByRole("status")).toHaveTextContent("2 invoices generated");
        expect(screen.getByText(/2 of 3 done/)).toBeInTheDocument();
    });

    it("refuses to replace an invoice when more was paid than the new total", async () => {
        const user = userEvent.setup();
        const paid = { id: meterInvoiceId("u1", thisMonth), unitId: "u1", status: "paid", amountPaid: 9000, totalAmount: 9000 } as Invoice;
        renderTab([paid]);
        await user.click(screen.getByRole("button", { name: "All units" }));
        await user.selectOptions(unitSelect(), "u1");
        await user.type(screen.getByPlaceholderText("e.g. 1250"), "150");
        expect(screen.getByRole("alert")).toHaveTextContent("can't be replaced here");
        expect(screen.getByRole("button", { name: "Generate Invoice" })).toBeDisabled();
    });
});
