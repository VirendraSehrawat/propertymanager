/**
 * Saving with poor signal (§7.2). With Firestore's persistent cache a write is
 * applied on the phone at once and sent when the connection returns, but its
 * promise only resolves once the server confirms — so `await batch.commit()`
 * would keep a form spinning in a basement. `commitOrQueue` waits a few
 * seconds at most: if the phone is offline or the server hasn't answered, the
 * write is reported as *queued* and the form can close. Pending and failed
 * writes are counted for the "⏳ N waiting to sync" badge.
 */

export type CommitOutcome = "synced" | "queued";

export interface SyncState {
    pending: number;
    /** Writes the server rejected after they were queued (e.g. a rules failure). */
    failed: number;
    lastError?: string;
}

/** How long to wait for the server before treating a write as queued. */
export const QUEUE_AFTER_MS = 6000;

let state: SyncState = { pending: 0, failed: 0 };
const listeners = new Set<() => void>();
const emit = (next: SyncState) => { state = next; listeners.forEach(l => l()); };

export function getSyncState(): SyncState { return state; }

export function subscribeSyncState(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Acknowledge failed writes (after the user has seen them). */
export function clearSyncFailures(): void { emit({ ...state, failed: 0, lastError: undefined }); }

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * Track a commit promise; resolve "synced" when the server confirms in time,
 * "queued" when offline or slower than `timeoutMs`. Errors that arrive
 * *before* it is reported queued are thrown as usual; later ones are counted.
 */
export function commitOrQueue(commit: Promise<unknown>, timeoutMs = QUEUE_AFTER_MS): Promise<CommitOutcome> {
    emit({ ...state, pending: state.pending + 1 });
    let settled = false;
    let reportedQueued = false;
    return new Promise<CommitOutcome>((resolve, reject) => {
        const queue = () => {
            if (settled || reportedQueued) return;
            reportedQueued = true;
            resolve("queued");
        };
        const timer = setTimeout(queue, timeoutMs);
        if (isOffline()) queue();
        Promise.resolve(commit).then(
            () => {
                settled = true;
                clearTimeout(timer);
                emit({ ...state, pending: Math.max(0, state.pending - 1) });
                if (!reportedQueued) resolve("synced");
            },
            (err: unknown) => {
                settled = true;
                clearTimeout(timer);
                const message = err instanceof Error ? err.message : String(err);
                if (reportedQueued) {
                    console.error("[sync] queued write failed", err);
                    emit({ pending: Math.max(0, state.pending - 1), failed: state.failed + 1, lastError: message });
                } else {
                    emit({ ...state, pending: Math.max(0, state.pending - 1) });
                    reject(err);
                }
            },
        );
    });
}

/** Message for a toast after a save, depending on whether it reached the server. */
export function savedMessage(outcome: CommitOutcome, what: string): string {
    return outcome === "synced" ? what : `${what} Saved on this phone — it will sync when you're back online.`;
}
