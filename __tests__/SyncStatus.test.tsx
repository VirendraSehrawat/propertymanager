// @vitest-environment jsdom
/**
 * The header badge for poor signal (§7.2): hidden when online and in sync,
 * "⏳ N waiting to sync" while writes are queued, offline notice.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SyncStatus } from "@/components/employee/SyncStatus";
import { commitOrQueue } from "@/lib/offlineQueue";

afterEach(() => vi.restoreAllMocks());

describe("SyncStatus", () => {
    it("shows queued writes and the offline state", async () => {
        const { container } = render(<SyncStatus />);
        expect(container).toBeEmptyDOMElement();

        let confirm!: () => void;
        await act(async () => { void commitOrQueue(new Promise<void>(r => { confirm = r; }), 10_000); });
        expect(screen.getByText("⏳ 1 waiting to sync")).toBeInTheDocument();

        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        act(() => { window.dispatchEvent(new Event("offline")); });
        expect(screen.getByText(/Offline — entries are saved on this phone/)).toBeInTheDocument();

        vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
        await act(async () => { window.dispatchEvent(new Event("online")); confirm(); });
        expect(container).toBeEmptyDOMElement();
    });
});
