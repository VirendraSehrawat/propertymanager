"use client";

import { historyLabel } from "@/lib/historyWindow";

interface HistoryNoticeProps {
    /** Start of the loaded history (YYYY-MM-DD); "" when everything is loaded (renders nothing). */
    from: string;
    onLoadAll: () => void;
    /** What is limited, e.g. "Payments" or "Settled invoices". */
    what?: string;
}

/**
 * "Showing … since 1 Jul 2026 · Load all history" (§7.1). Shown on screens
 * whose lists only include the recent history window.
 */
export function HistoryNotice({ from, onLoadAll, what = "Showing history" }: HistoryNoticeProps) {
    if (!from) return null;
    return (
        <div className="flex items-center justify-between gap-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1">
            <span>🕘 {what} {historyLabel(from)}.</span>
            <button type="button" onClick={onLoadAll} className="font-bold text-indigo-700 hover:underline min-h-11 px-1">Load all history</button>
        </div>
    );
}
