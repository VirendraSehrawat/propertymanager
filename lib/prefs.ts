/**
 * Small per-device conveniences kept in localStorage (§6.3): never required
 * for correctness, so every read and write is guarded and falls back silently.
 */

const LAST_BUILDING_KEY = "employee.lastBuilding";

/** The building last picked in an entry form on this device ("" when none). */
export function rememberedBuilding(): string {
    if (typeof window === "undefined") return "";
    try { return window.localStorage.getItem(LAST_BUILDING_KEY) || ""; } catch { return ""; }
}

export function rememberBuilding(buildingId: string): void {
    if (typeof window === "undefined") return;
    try {
        if (buildingId) window.localStorage.setItem(LAST_BUILDING_KEY, buildingId);
        else window.localStorage.removeItem(LAST_BUILDING_KEY);
    } catch { /* storage blocked */ }
}
