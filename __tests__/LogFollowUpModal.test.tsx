// @vitest-environment jsdom
/**
 * Component tests for the 📝 Log follow-up dialog (§3.5): it validates the
 * outcome and appends one entry to `units/{id}.followUps`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { localDateKey } from "@/lib/payments";

vi.mock("@/lib/firebase", () => ({ db: {} }));
const updateDoc = vi.fn<(ref: unknown, data: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
vi.mock("firebase/firestore", () => ({
    doc: vi.fn((_db: unknown, col: string, id: string) => ({ col, id })),
    updateDoc: (ref: unknown, data: Record<string, unknown>) => updateDoc(ref, data),
    arrayUnion: (...items: unknown[]) => ({ arrayUnion: items }),
}));

import { LogFollowUpModal } from "@/components/employee/modals/LogFollowUpModal";

const unit = {
    id: "u1", unitNumber: "101", tenantName: "Asha", tenantEmail: "a@x.com",
    followUps: [{ id: "old", at: new Date(Date.now() - 2 * 86_400_000).toISOString(), by: "e@x.com", tenantEmail: "a@x.com", outcome: "noAnswer" as const }],
};
const t = new Date();
t.setDate(t.getDate() + 3);
const inThreeDays = localDateKey(t);

beforeEach(() => updateDoc.mockClear());

describe("LogFollowUpModal", () => {
    it("saves a promise to pay with its date", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<LogFollowUpModal unit={unit} onClose={onClose} currentUserEmail="e@x.com" remaining={5000} />);
        expect(screen.getByText("No answer 2 days ago")).toBeInTheDocument();
        const save = screen.getByRole("button", { name: "Save follow-up" });
        expect(save).toBeDisabled(); // "Promised" needs a date

        await user.type(screen.getByLabelText("Will pay on *"), inThreeDays);
        await user.type(screen.getByLabelText("Note"), "After salary");
        await user.click(save);

        expect(updateDoc).toHaveBeenCalledWith({ col: "units", id: "u1" }, {
            followUps: { arrayUnion: [expect.objectContaining({ outcome: "promised", promisedDate: inThreeDays, note: "After salary", by: "e@x.com", tenantEmail: "a@x.com" })] },
        });
        expect(onClose).toHaveBeenCalled();
    });

    it("logs 'No answer' without a date, and needs a note for a dispute", async () => {
        const user = userEvent.setup();
        render(<LogFollowUpModal unit={unit} onClose={() => {}} currentUserEmail="e@x.com" />);
        await user.click(screen.getByLabelText("⚠️ Disputed"));
        expect(screen.getByText("Add a note on what is disputed.")).toBeInTheDocument();
        await user.click(screen.getByLabelText("📵 No answer"));
        await user.click(screen.getByRole("button", { name: "Save follow-up" }));
        const entry = (updateDoc.mock.calls[0][1].followUps as { arrayUnion: Record<string, unknown>[] }).arrayUnion[0];
        expect(entry).toMatchObject({ outcome: "noAnswer" });
        expect(entry).not.toHaveProperty("promisedDate");
    });

    it("stays closed without a unit", () => {
        render(<LogFollowUpModal unit={null} onClose={() => {}} currentUserEmail="e@x.com" />);
        expect(screen.queryByText(/Log follow-up/)).not.toBeInTheDocument();
    });
});
