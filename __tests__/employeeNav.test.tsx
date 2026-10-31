// @vitest-environment jsdom
/**
 * Tests for the employee navigation (§6.1): grouping, start tab from the URL
 * or the device, URL/storage updates, and the bottom bar + More sheet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { groupOf, initialTab, persistTab, readInitialTab, LAST_TAB_KEY } from "@/lib/employeeNav";
import { EmployeeBottomNav, EmployeeSubTabs } from "@/components/employee/EmployeeNav";

// In-memory localStorage: this jsdom setup doesn't provide one.
const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => store.clear(),
    },
});

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/employee");
});

describe("lib/employeeNav", () => {
    it("groups the 13 screens behind 5 entries", () => {
        expect(groupOf("monthly").id).toBe("collect");
        expect(groupOf("expenses").id).toBe("books");
        expect(groupOf("resolved").id).toBe("tasks");
        expect(groupOf("meter").id).toBe("more");
        expect(groupOf("home").id).toBe("home");
    });

    it("starts on ?tab=, else the remembered tab, else Home; ignores unknown values", () => {
        expect(initialTab("?tab=meter", "daily")).toBe("meter");
        expect(initialTab("?tab=nope", "daily")).toBe("daily");
        expect(initialTab("", "bogus")).toBe("home");
    });

    it("remembers the tab and mirrors it in the URL", () => {
        persistTab("meter");
        expect(window.localStorage.getItem(LAST_TAB_KEY)).toBe("meter");
        expect(window.location.search).toBe("?tab=meter");
        window.history.replaceState(null, "", "/employee");
        expect(readInitialTab()).toBe("meter");
        persistTab("home");
        expect(window.location.search).toBe("");
    });
});

describe("EmployeeBottomNav / EmployeeSubTabs", () => {
    it("opens the first screen of a group, and shows group badges", async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<EmployeeBottomNav activeTab="home" onSelect={onSelect} badges={{ collections: 4, active: 2, meter: 7 }} />);
        const nav = screen.getByRole("navigation", { name: "Main" });
        expect(within(nav).getAllByRole("button").map(b => b.textContent)).toEqual(["🏠Home", "💳Collect4", "📓Books", "🔧Tasks2", "☰More7"]);
        await user.click(within(nav).getByRole("button", { name: /Collect/ }));
        expect(onSelect).toHaveBeenCalledWith("collections");
        expect(within(nav).getByRole("button", { name: /Home/ })).toHaveAttribute("aria-current", "page");
    });

    it("More opens a sheet with the remaining screens and Help", async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<EmployeeBottomNav activeTab="home" onSelect={onSelect} badges={{ meter: 7 }} />);
        await user.click(screen.getByRole("button", { name: /More/ }));
        expect(screen.getByRole("link", { name: /Help/ })).toHaveAttribute("href", "/employee/help");
        await user.click(screen.getByRole("button", { name: /Meter/ }));
        expect(onSelect).toHaveBeenCalledWith("meter");
        expect(screen.queryByRole("link", { name: /Help/ })).not.toBeInTheDocument();
    });

    it("sub-tabs switch between the screens of the current group", async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const { rerender } = render(<EmployeeSubTabs activeTab="daily" onSelect={onSelect} />);
        expect(screen.getAllByRole("tab").map(t => t.textContent)).toEqual(["📓 Daily ", "💰 Expenses ", "📑 Ledger "]);
        expect(screen.getByRole("tab", { name: /Daily/ })).toHaveAttribute("aria-selected", "true");
        await user.click(screen.getByRole("tab", { name: /Expenses/ }));
        expect(onSelect).toHaveBeenCalledWith("expenses");
        rerender(<EmployeeSubTabs activeTab="home" onSelect={onSelect} />);
        expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    });
});
