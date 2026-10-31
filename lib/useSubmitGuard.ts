"use client";

import { useCallback, useRef } from "react";

/**
 * Ignore a second submit while the first is still running (§7.3). Disabling
 * the button relies on a re-render, so a fast double tap can still get two
 * calls in; this ref-based guard can't.
 *
 *   const guard = useSubmitGuard();
 *   const handleSave = (e) => guard(async () => { ... });
 */
export function useSubmitGuard() {
    const busy = useRef(false);
    return useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
        if (busy.current) return undefined;
        busy.current = true;
        try {
            return await fn();
        } finally {
            busy.current = false;
        }
    }, []);
}
