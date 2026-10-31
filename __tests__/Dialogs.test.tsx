// @vitest-environment jsdom
/**
 * Tests for the in-app dialogs (§6.2): toasts with Undo, confirm and
 * reason dialogs through <DialogHost />, and the browser fallback when no
 * host is mounted.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DialogHost, askReason, confirmAction, toast } from "@/components/ui/Dialogs";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("with <DialogHost />", () => {
    it("shows toasts, runs the action and lets the user dismiss them", async () => {
        const user = userEvent.setup();
        const undo = vi.fn();
        render(<DialogHost />);
        act(() => { toast.success("Settled ₹500", { action: { label: "Undo", onClick: undo } }); });
        expect(screen.getByRole("status")).toHaveTextContent("Settled ₹500");
        await user.click(screen.getByRole("button", { name: "Undo" }));
        expect(undo).toHaveBeenCalled();
        expect(screen.queryByText("Settled ₹500")).not.toBeInTheDocument();

        act(() => { toast.error("Failed to save"); });
        expect(screen.getByRole("alert")).toHaveTextContent("Failed to save");
        await user.click(screen.getByRole("button", { name: "Dismiss" }));
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("confirmAction resolves with the user's choice, destructive button on the right", async () => {
        const user = userEvent.setup();
        render(<DialogHost />);
        let result: Promise<boolean>;
        act(() => { result = confirmAction({ title: "Remove tenant?", message: "Deposit ₹5,000", confirmLabel: "Remove", destructive: true }); });
        const buttons = screen.getAllByRole("button");
        expect(buttons.map(b => b.textContent)).toEqual(["Cancel", "Remove"]);
        expect(buttons[1].className).toMatch(/bg-red-600/);
        await user.click(buttons[1]);
        await expect(result!).resolves.toBe(true);

        act(() => { result = confirmAction({ message: "Sure?" }); });
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        await expect(result!).resolves.toBe(false);
    });

    it("askReason needs a reason, offers one-tap reasons, and returns null on cancel", async () => {
        const user = userEvent.setup();
        render(<DialogHost />);
        let result: Promise<string | null>;
        act(() => { result = askReason({ title: "Delete entry?" }); });
        const del = screen.getByRole("button", { name: "Delete" });
        expect(del).toBeDisabled();
        await user.click(screen.getByRole("button", { name: "Duplicate entry" }));
        await user.click(del);
        await expect(result!).resolves.toBe("Duplicate entry");

        act(() => { result = askReason({ title: "Write off?", reasons: ["Tenant absconded"], confirmLabel: "Write off" }); });
        await user.type(screen.getByLabelText("Reason"), "  Left town  ");
        await user.click(screen.getByRole("button", { name: "Write off" }));
        await expect(result!).resolves.toBe("Left town");

        act(() => { result = askReason({ title: "Delete?" }); });
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        await expect(result!).resolves.toBeNull();
    });
});

describe("without a host (other pages, tests)", () => {
    it("falls back to the browser dialogs", async () => {
        const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
        vi.spyOn(window, "confirm").mockReturnValue(true);
        const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce(" typo ").mockReturnValueOnce("  ");
        toast.info("Hello");
        expect(alert).toHaveBeenCalledWith("Hello");
        await expect(confirmAction({ message: "Sure?" })).resolves.toBe(true);
        await expect(askReason({ title: "Delete?" })).resolves.toBe("typo");
        await expect(askReason({ title: "Delete?" })).resolves.toBeNull(); // blank reason refused
        expect(prompt).toHaveBeenCalledTimes(2);
    });
});
