"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

const keyFor = (id: string) => `employee.hint.${id}.dismissed`;

function isDismissed(id: string): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(keyFor(id)) === "1"; } catch { return false; }
}

interface FirstTimeHintProps {
    /** Stable id; dismissal is remembered per device under this id. */
    id: string;
    title: string;
    children: ReactNode;
    /** Guide section for "Read more", e.g. "/employee/help#meter". */
    helpHref?: string;
}

/**
 * A short "first time here?" card (§8) shown at the top of a screen until the
 * employee taps **Got it**. Remembered on the device; if storage is blocked
 * it simply shows again next time.
 */
export function FirstTimeHint({ id, title, children, helpHref }: FirstTimeHintProps) {
    const [hidden, setHidden] = useState(() => isDismissed(id));
    if (hidden) return null;
    const dismiss = () => {
        setHidden(true);
        try { window.localStorage.setItem(keyFor(id), "1"); } catch { /* storage blocked */ }
    };
    return (
        <aside aria-label={title} className="bg-sky-50 border border-sky-200 rounded-xl p-4 text-sm text-sky-900">
            <p className="font-bold">💡 {title}</p>
            <div className="mt-1.5 space-y-1 text-[13px] leading-snug">{children}</div>
            <div className="flex items-center gap-4 mt-2">
                <button type="button" onClick={dismiss} className="min-h-11 px-4 rounded-lg bg-sky-600 text-white text-xs font-bold hover:bg-sky-700">Got it</button>
                {helpHref && <Link href={helpHref} className="text-xs font-bold text-sky-800 underline">Read more</Link>}
            </div>
        </aside>
    );
}
