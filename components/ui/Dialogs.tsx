"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";

/**
 * In-app replacements for `window.alert`, `window.confirm` and `window.prompt`
 * (§6.2 of `docs/EMPLOYEE_WORKFLOW_IMPROVEMENTS.md`).
 *
 *   toast.success("Saved")                      — non-blocking message
 *   toast.error("Failed to save")
 *   toast.info("Done", { action: { label: "Undo", onClick } })
 *   if (!(await confirmAction({ message, destructive: true }))) return;
 *   const reason = await askReason({ title: "Delete entry?" });   // null = cancelled
 *
 * They talk to the one <DialogHost /> mounted on the page. Without a host
 * (other pages, unit tests) they fall back to the browser's own dialogs, so
 * callers never need to check.
 */

export type ToastKind = "success" | "error" | "info";

export interface ToastOptions {
    action?: { label: string; onClick: () => void };
    /** Milliseconds before it disappears; default 4 s (6 s for errors and toasts with an action). */
    durationMs?: number;
}

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Red confirm button, for deletes and other hard-to-undo actions. */
    destructive?: boolean;
}

export interface ReasonOptions {
    title: string;
    message?: string;
    /** One-tap reasons shown above the text box. */
    reasons?: string[];
    confirmLabel?: string;
}

interface ToastItem extends ToastOptions {
    id: number;
    kind: ToastKind;
    message: string;
}

type PendingDialog =
    | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
    | { kind: "reason"; opts: ReasonOptions; resolve: (reason: string | null) => void };

interface Host {
    toast: (t: Omit<ToastItem, "id">) => void;
    open: (d: PendingDialog) => void;
}

let host: Host | null = null;
let nextId = 1;

/** Common reasons for deleting a ledger or expense entry. */
export const DELETE_REASONS = ["Duplicate entry", "Wrong amount", "Wrong date", "Wrong building / unit", "Entered by mistake"];

function show(kind: ToastKind, message: string, opts: ToastOptions = {}) {
    if (!host) {
        if (typeof window !== "undefined") window.alert(message);
        return;
    }
    host.toast({ kind, message, ...opts });
}

export const toast = {
    success: (message: string, opts?: ToastOptions) => show("success", message, opts),
    error: (message: string, opts?: ToastOptions) => show("error", message, opts),
    info: (message: string, opts?: ToastOptions) => show("info", message, opts),
};

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
    if (!host) return Promise.resolve(window.confirm(opts.title ? `${opts.title}\n\n${opts.message}` : opts.message));
    const h = host;
    return new Promise(resolve => h.open({ kind: "confirm", opts, resolve }));
}

/** Ask for a required reason. Resolves to the trimmed reason, or null when cancelled. */
export function askReason(opts: ReasonOptions): Promise<string | null> {
    if (!host) {
        const raw = window.prompt(`${opts.title}${opts.message ? `\n\n${opts.message}` : ""}\n\nPlease provide a reason (required):`, "");
        if (raw === null) return Promise.resolve(null);
        if (!raw.trim()) {
            window.alert("A reason is required.");
            return Promise.resolve(null);
        }
        return Promise.resolve(raw.trim());
    }
    const h = host;
    return new Promise(resolve => h.open({ kind: "reason", opts, resolve }));
}

const TOAST_STYLE: Record<ToastKind, string> = {
    success: "bg-emerald-700",
    error: "bg-red-700",
    info: "bg-gray-800",
};

/** Mount once per page (employee and admin dashboards). */
export function DialogHost() {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const [queue, setQueue] = useState<PendingDialog[]>([]);

    useEffect(() => {
        host = {
            toast: t => {
                const id = nextId++;
                setToasts(list => [...list.slice(-2), { ...t, id }]);
                const ms = t.durationMs ?? (t.kind === "error" || t.action ? 6000 : 4000);
                setTimeout(() => setToasts(list => list.filter(x => x.id !== id)), ms);
            },
            open: d => setQueue(q => [...q, d]),
        };
        return () => { host = null; };
    }, []);

    const current = queue[0];
    const finish = (value: boolean | string | null) => {
        if (!current) return;
        if (current.kind === "confirm") current.resolve(value === true);
        else current.resolve(typeof value === "string" ? value : null);
        setQueue(q => q.slice(1));
    };

    return (
        <>
            <div className="fixed bottom-20 inset-x-0 z-60 flex flex-col items-center gap-2 px-4 pointer-events-none" aria-live="polite">
                {toasts.map(t => (
                    <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={`pointer-events-auto max-w-md w-full ${TOAST_STYLE[t.kind]} text-white text-sm rounded-lg shadow-lg px-4 py-3 flex items-start gap-3`}>
                        <p className="flex-1 whitespace-pre-line">{t.message}</p>
                        {t.action && (
                            <button
                                type="button"
                                onClick={() => { t.action!.onClick(); setToasts(list => list.filter(x => x.id !== t.id)); }}
                                className="shrink-0 font-bold underline underline-offset-2 min-h-11 -my-3 px-1"
                            >
                                {t.action.label}
                            </button>
                        )}
                        <button type="button" aria-label="Dismiss" onClick={() => setToasts(list => list.filter(x => x.id !== t.id))} className="shrink-0 opacity-70 hover:opacity-100 min-h-11 min-w-11 -my-3 -mr-3">✕</button>
                    </div>
                ))}
            </div>
            {current?.kind === "confirm" && <ConfirmDialog key={queue.length} opts={current.opts} onDone={finish} />}
            {current?.kind === "reason" && <ReasonDialog key={queue.length} opts={current.opts} onDone={finish} />}
        </>
    );
}

function ConfirmDialog({ opts, onDone }: { opts: ConfirmOptions; onDone: (ok: boolean) => void }) {
    return (
        <Modal isOpen onClose={() => onDone(false)} bottomSheet>
            <div role="alertdialog" aria-labelledby="confirm-title">
                <h3 id="confirm-title" className="text-lg font-bold text-gray-800">{opts.title || "Are you sure?"}</h3>
                <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{opts.message}</p>
                <div className="flex gap-2 mt-5">
                    <button type="button" onClick={() => onDone(false)} className="flex-1 min-h-11 border border-gray-300 rounded-md text-sm text-gray-700">{opts.cancelLabel || "Cancel"}</button>
                    <button type="button" autoFocus onClick={() => onDone(true)} className={`flex-1 min-h-11 rounded-md text-sm font-bold text-white ${opts.destructive ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"}`}>
                        {opts.confirmLabel || "OK"}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

function ReasonDialog({ opts, onDone }: { opts: ReasonOptions; onDone: (reason: string | null) => void }) {
    const [reason, setReason] = useState("");
    const reasons = opts.reasons ?? DELETE_REASONS;
    return (
        <Modal isOpen onClose={() => onDone(null)} bottomSheet>
            <form onSubmit={e => { e.preventDefault(); if (reason.trim()) onDone(reason.trim()); }}>
                <h3 className="text-lg font-bold text-gray-800">{opts.title}</h3>
                {opts.message && <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{opts.message}</p>}
                <p className="block text-xs font-bold text-gray-500 uppercase mt-4 mb-1">Reason *</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {reasons.map(r => (
                        <button key={r} type="button" onClick={() => setReason(r)} className={`text-xs font-bold px-2.5 min-h-9 rounded-full border ${reason === r ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-700 border-gray-300"}`}>{r}</button>
                    ))}
                </div>
                <textarea aria-label="Reason" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="Or type a reason" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                <div className="flex gap-2 mt-4">
                    <button type="button" onClick={() => onDone(null)} className="flex-1 min-h-11 border border-gray-300 rounded-md text-sm text-gray-700">Cancel</button>
                    <button type="submit" disabled={!reason.trim()} className="flex-1 min-h-11 rounded-md text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300">
                        {opts.confirmLabel || "Delete"}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
