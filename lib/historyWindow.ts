/**
 * Load only what the employee screens need (§7.1 of
 * `docs/EMPLOYEE_WORKFLOW_IMPROVEMENTS.md`).
 *
 * Large, ever-growing collections (invoices, payment ledger, daily ledger,
 * tickets) are loaded from a *history window* — by default the current month
 * and the 3 before it — instead of in full. Anything still open (unpaid
 * invoices, open tickets) is always loaded whatever its age, so balances,
 * overdue lists and the Today list are unaffected. Screens that need older
 * data (Ledger, older months in Monthly / Daily, the tenant profile) widen
 * the window on demand, or load everything.
 *
 * Pure helpers plus one small subscription helper.
 */

import { onSnapshot, type DocumentData, type Query } from "firebase/firestore";
import { mapSnapshot } from "@/lib/firestore";

/** Months before the current one loaded by default. */
export const DEFAULT_HISTORY_MONTHS = 3;

const pad = (n: number) => String(n).padStart(2, "0");

/** First day of the month `months` before `now`, as YYYY-MM-DD (local). "" = everything. */
export function historyStart(now: Date, months = DEFAULT_HISTORY_MONTHS): string {
    const d = new Date(now.getFullYear(), now.getMonth() - months, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

/**
 * The window needed to show `target` ("YYYY-MM", "YYYY-MM-DD" or "all").
 * Keeps one extra month before a requested month, because screens compare
 * with the previous month (carry-forward, previous-month balance).
 * Never narrows the current window; "" means everything is loaded.
 */
export function extendHistory(current: string, target: string): string {
    if (current === "" || target === "all") return "";
    const [y, m] = target.slice(0, 7).split("-").map(Number);
    if (!y || !m) return current;
    const wanted = historyStart(new Date(y, m - 1, 1), 1);
    return wanted < current ? wanted : current;
}

/** Human label for the window, e.g. "since 1 Jul 2026". */
export function historyLabel(from: string): string {
    if (!from) return "all history";
    return `since ${new Date(`${from}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Merge several result lists by document id (later lists win). */
export function mergeById<T extends { id: string }>(lists: T[][]): T[] {
    const byId = new Map<string, T>();
    for (const list of lists) for (const item of list) byId.set(item.id, item);
    return [...byId.values()];
}

/**
 * Subscribe to several queries and receive their merged documents whenever
 * any of them changes. Waits until every query has answered once, so screens
 * don't flash a partial list. Returns one unsubscribe function.
 */
export function subscribeMerged<T extends { id: string }>(
    queries: Query<DocumentData>[],
    onChange: (docs: T[]) => void,
): () => void {
    const results: (T[] | undefined)[] = queries.map(() => undefined);
    const unsubs = queries.map((q, i) =>
        onSnapshot(q, snapshot => {
            results[i] = mapSnapshot<T>(snapshot);
            if (results.every(r => r !== undefined)) onChange(mergeById(results as T[][]));
        }),
    );
    return () => unsubs.forEach(u => u());
}
