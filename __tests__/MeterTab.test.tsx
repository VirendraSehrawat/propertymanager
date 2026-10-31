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

function renderTab(invoices: Invoice[] = []) {
    return render(<MeterTab occupiedUnits={units} allInvoices={invoices} electricityRate={10} buildings={buildings} />);
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
