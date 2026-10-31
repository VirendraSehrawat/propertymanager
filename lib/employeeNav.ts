/**
 * Employee dashboard navigation (§6.1 of `docs/EMPLOYEE_WORKFLOW_IMPROVEMENTS.md`):
 * 13 screens grouped behind a 5-item bottom bar. The chosen screen is kept in
 * the URL (`/employee?tab=meter`, so admins can send direct links) and
 * remembered on the device for the next visit.
 *
 * Pure apart from the small, guarded storage helpers at the bottom.
 */

export const EMPLOYEE_TABS = [
    "home", "collections", "monthly", "daily", "expenses", "ledger",
    "active", "resolved", "meter", "units", "occupancy", "checklist", "inventory",
] as const;

export type EmployeeTab = (typeof EMPLOYEE_TABS)[number];

export const TAB_LABELS: Record<EmployeeTab, { icon: string; label: string }> = {
    home: { icon: "🏠", label: "Home" },
    collections: { icon: "💳", label: "Collections" },
    monthly: { icon: "🏘", label: "Monthly" },
    daily: { icon: "📓", label: "Daily" },
    expenses: { icon: "💰", label: "Expenses" },
    ledger: { icon: "📑", label: "Ledger" },
    active: { icon: "🔧", label: "Open" },
    resolved: { icon: "✅", label: "Done" },
    meter: { icon: "⚡", label: "Meter" },
    units: { icon: "🏠", label: "Units" },
    occupancy: { icon: "📊", label: "Occupancy" },
    checklist: { icon: "📋", label: "Checklist" },
    inventory: { icon: "📦", label: "Inventory" },
};

export type NavGroupId = "home" | "collect" | "books" | "tasks" | "more";

export interface NavGroup {
    id: NavGroupId;
    icon: string;
    label: string;
    /** Screens in this group; the first is opened when the group is tapped. */
    tabs: EmployeeTab[];
}

export const NAV_GROUPS: NavGroup[] = [
    { id: "home", icon: "🏠", label: "Home", tabs: ["home"] },
    { id: "collect", icon: "💳", label: "Collect", tabs: ["collections", "monthly"] },
    { id: "books", icon: "📓", label: "Books", tabs: ["daily", "expenses", "ledger"] },
    { id: "tasks", icon: "🔧", label: "Tasks", tabs: ["active", "resolved"] },
    { id: "more", icon: "☰", label: "More", tabs: ["meter", "units", "occupancy", "checklist", "inventory"] },
];

export function groupOf(tab: EmployeeTab): NavGroup {
    return NAV_GROUPS.find(g => g.tabs.includes(tab)) ?? NAV_GROUPS[0];
}

export function isEmployeeTab(value: unknown): value is EmployeeTab {
    return typeof value === "string" && (EMPLOYEE_TABS as readonly string[]).includes(value);
}

/** The screen to open: `?tab=` from the URL, else the remembered one, else Home. */
export function initialTab(search: string, remembered: string | null): EmployeeTab {
    const fromUrl = new URLSearchParams(search).get("tab");
    if (isEmployeeTab(fromUrl)) return fromUrl;
    return isEmployeeTab(remembered) ? remembered : "home";
}

export const LAST_TAB_KEY = "employee.lastTab";

/** Read the start tab in the browser; "home" during server rendering or if storage is blocked. */
export function readInitialTab(): EmployeeTab {
    if (typeof window === "undefined") return "home";
    let remembered: string | null = null;
    try { remembered = window.localStorage.getItem(LAST_TAB_KEY); } catch { /* storage blocked */ }
    return initialTab(window.location.search, remembered);
}

/** Remember the tab and reflect it in the URL without adding history entries. */
export function persistTab(tab: EmployeeTab): void {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch { /* storage blocked */ }
    try {
        const url = new URL(window.location.href);
        if (tab === "home") url.searchParams.delete("tab");
        else url.searchParams.set("tab", tab);
        window.history.replaceState(null, "", url.toString());
    } catch { /* non-browser environment */ }
}
