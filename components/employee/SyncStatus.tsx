"use client";

import { useSyncExternalStore } from "react";
import { clearSyncFailures, getSyncState, subscribeSyncState, type SyncState } from "@/lib/offlineQueue";

const SERVER_STATE: SyncState = { pending: 0, failed: 0 };

function subscribeOnline(cb: () => void) {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
}

/**
 * Header badge for working with poor signal (§7.2): "📴 Offline", "⏳ N
 * waiting to sync" while queued writes haven't reached the server, and
 * "⚠️ N didn't sync" if the server later rejected one. Renders nothing when
 * everything is online and in sync.
 */
export function SyncStatus() {
    const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
    const { pending, failed, lastError } = useSyncExternalStore(subscribeSyncState, getSyncState, () => SERVER_STATE);
    if (online && pending === 0 && failed === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5 text-[11px] font-bold" aria-live="polite">
            {!online && <span className="bg-gray-800 text-white rounded-full px-2 py-1">📴 Offline — entries are saved on this phone</span>}
            {pending > 0 && <span className="bg-amber-100 text-amber-900 rounded-full px-2 py-1">⏳ {pending} waiting to sync</span>}
            {failed > 0 && (
                <button type="button" onClick={clearSyncFailures} title={lastError} className="bg-red-100 text-red-800 rounded-full px-2 py-1">
                    ⚠️ {failed} didn&apos;t sync — tap to dismiss
                </button>
            )}
        </div>
    );
}
