"use client";

import { useState } from "react";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COL } from "@/lib/collections";
import { Modal } from "@/components/ui";
import {
    buildDayClose,
    changedSinceClose,
    closesNeedingReview,
    dayCloseErrors,
    expectedCash,
    previousClose,
    summarizeDay,
    unclosedDaysBefore,
    type DayClose,
    type DayCloseEntry,
} from "@/lib/dayClose";
import { useSubmitGuard } from "@/lib/useSubmitGuard";
import { commitOrQueue, savedMessage } from "@/lib/offlineQueue";
import { toast } from "@/components/ui";

interface DayClosePanelProps {
    /** Day shown in the Daily tab (YYYY-MM-DD). */
    date: string;
    /** Today's local date — future days can't be closed. */
    today: string;
    /** All non-deleted Daily ledger rows (every building). */
    entries: DayCloseEntry[];
    closes: DayClose[];
    currentUserEmail: string;
    /** Admin only: reopen a closed day and mark differences as reviewed. */
    canReopen?: boolean;
    onSelectDate: (date: string) => void;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * End-of-day close for the Daily tab (§3.3): shows the day's close, or the
 * 🔒 Close day action with the cash reconciliation form. Admins can reopen a
 * closed day and review closes whose cash didn't match.
 */
export function DayClosePanel({ date, today, entries, closes, currentUserEmail, canReopen, onSelectDate }: DayClosePanelProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [openingInput, setOpeningInput] = useState("");
    const [actualInput, setActualInput] = useState("");
    const [handedInput, setHandedInput] = useState("");
    const [note, setNote] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const submitGuard = useSubmitGuard(); // ignore a double tap on Close day (§7.3)
    const [saveError, setSaveError] = useState("");
    const [reopenReason, setReopenReason] = useState("");
    const [isReopening, setIsReopening] = useState(false);

    const close = closes.find(c => c.date === date);
    const summary = summarizeDay(entries, date);
    const prev = previousClose(closes, date);
    const blockers = unclosedDaysBefore(entries, closes, date);
    const openingCash = prev ? prev.closingCash : Number(openingInput || 0);
    const expected = expectedCash(openingCash, summary);
    const actualCash = Number(actualInput || 0);
    const handedToOwner = Number(handedInput || 0);
    const difference = Math.round((actualCash - expected) * 100) / 100;
    const errors = actualInput === ""
        ? ["Enter the cash you counted."]
        : dayCloseErrors({ date, summary, openingCash, openingFrom: prev, actualCash, handedToOwner, note });
    const review = canReopen ? closesNeedingReview(closes) : [];

    const openModal = () => {
        setOpeningInput(""); setActualInput(""); setHandedInput(""); setNote(""); setSaveError("");
        setIsOpen(true);
    };

    const handleClose = (e: React.FormEvent) => submitGuard(async () => {
        e.preventDefault();
        if (errors.length > 0) return;
        setIsSaving(true);
        setSaveError("");
        try {
            const record = buildDayClose({
                date, summary, openingCash, openingFrom: prev, actualCash, handedToOwner, note,
                closedBy: currentUserEmail, now: new Date().toISOString(),
                existing: close?.status === "reopened" ? close : null,
            });
            const outcome = await commitOrQueue(setDoc(doc(db, COL.dayCloses, date), record));
            toast.success(savedMessage(outcome, `${date} closed.`));
            setIsOpen(false);
        } catch (err) {
            console.error(err);
            setSaveError("Couldn't save the close. Check your connection and try again.");
        } finally {
            setIsSaving(false);
        }
    });

    const handleReopen = async () => {
        if (!reopenReason.trim()) return;
        try {
            await updateDoc(doc(db, COL.dayCloses, date), {
                status: "reopened",
                reopenedBy: currentUserEmail,
                reopenedAt: new Date().toISOString(),
                reopenReason: reopenReason.trim(),
            });
            setIsReopening(false);
            setReopenReason("");
        } catch (err) {
            console.error(err);
            setSaveError("Couldn't reopen the day.");
        }
    };

    const markReviewed = async (c: DayClose) => {
        try {
            await updateDoc(doc(db, COL.dayCloses, c.date), { reviewedBy: currentUserEmail, reviewedAt: new Date().toISOString() });
        } catch (err) {
            console.error(err);
        }
    };

    const isClosed = close?.status === "closed";
    const changed = isClosed && changedSinceClose(close, summary);

    return (
        <div className="space-y-2">
            {review.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg overflow-hidden">
                    <p className="px-3 py-2 text-xs font-bold text-red-800 border-b border-red-200">⚠️ Day closes with a cash difference — {review.length} to review</p>
                    <div className="divide-y divide-red-100">
                        {review.map(c => (
                            <div key={c.date} className="px-3 py-2 flex justify-between items-center gap-2 text-[11px]">
                                <button type="button" onClick={() => onSelectDate(c.date)} className="text-left min-w-0">
                                    <span className="font-bold text-gray-900">{fmtDate(c.date)}</span>
                                    <span className={`ml-2 font-bold ${c.difference < 0 ? "text-red-700" : "text-amber-700"}`}>{c.difference < 0 ? "short" : "over"} {inr(Math.abs(c.difference))}</span>
                                    <span className="block text-gray-500 truncate">{c.closedBy} · {c.note}</span>
                                </button>
                                <button type="button" onClick={() => markReviewed(c)} className="shrink-0 font-bold text-red-700 border border-red-300 rounded px-2 py-1 hover:bg-red-100">✓ Reviewed</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {isClosed ? (
                <div className={`border rounded-lg px-3 py-2.5 text-[11px] ${close.difference === 0 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                    <div className="flex justify-between items-start gap-2">
                        <p className="font-bold text-gray-900 text-xs">🔒 Day closed <span className="font-normal text-gray-500">by {close.closedBy} · {fmtTime(close.closedAt)}</span></p>
                        {canReopen && !isReopening && (
                            <button type="button" onClick={() => setIsReopening(true)} className="shrink-0 font-bold text-gray-700 border border-gray-300 rounded px-2 py-0.5 bg-white hover:bg-gray-50">🔓 Reopen</button>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1.5 text-gray-700">
                        <span>Expected cash</span><span className="text-right font-bold">{inr(close.expectedCash)}</span>
                        <span>Counted</span><span className="text-right font-bold">{inr(close.actualCash)}</span>
                        <span>Difference</span>
                        <span className={`text-right font-bold ${close.difference === 0 ? "text-emerald-700" : close.difference < 0 ? "text-red-700" : "text-amber-700"}`}>
                            {close.difference === 0 ? "✓ matches" : `${close.difference < 0 ? "short" : "over"} ${inr(Math.abs(close.difference))}`}
                        </span>
                        <span>Handed to owner</span><span className="text-right font-bold">{inr(close.handedToOwner)}</span>
                        <span>Carried to next day</span><span className="text-right font-bold">{inr(close.closingCash)}</span>
                        <span>UPI / Bank</span><span className="text-right font-bold">{inr(close.digitalIn)}</span>
                    </div>
                    {close.note && <p className="mt-1.5 text-gray-600">📝 {close.note}</p>}
                    {close.reviewedBy && <p className="mt-1 text-gray-500">✓ Reviewed by {close.reviewedBy}</p>}
                    {changed && (
                        <p className="mt-1.5 font-bold text-red-700">⚠️ Entries for this day changed after it was closed (e.g. a payment recorded later). {canReopen ? "Reopen it so it can be closed again." : "Ask the admin to reopen it."}</p>
                    )}
                    {isReopening && (
                        <div className="mt-2 flex gap-2">
                            <input value={reopenReason} onChange={e => setReopenReason(e.target.value)} placeholder="Reason for reopening (required)" className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" />
                            <button type="button" onClick={handleReopen} disabled={!reopenReason.trim()} className="font-bold text-white bg-gray-700 rounded px-2 py-1 disabled:bg-gray-300">Reopen</button>
                            <button type="button" onClick={() => setIsReopening(false)} className="text-gray-500 px-1">✕</button>
                        </div>
                    )}
                </div>
            ) : date <= today ? (
                <div className="flex justify-between items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <p className="text-[11px] text-gray-600">
                        {close?.status === "reopened"
                            ? <>🔓 Reopened by {close.reopenedBy}: <i>{close.reopenReason}</i></>
                            : "Not closed yet. Count the cash at the end of the day."}
                    </p>
                    <button type="button" onClick={openModal} className="shrink-0 text-xs font-bold text-white bg-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-900">🔒 Close day</button>
                </div>
            ) : null}
            {saveError && !isOpen && <p className="text-[11px] text-red-600">{saveError}</p>}

            <Modal isOpen={isOpen} onClose={() => setIsOpen(false)}>
                <h3 className="text-lg font-bold text-gray-800">🔒 Close {fmtDate(date)}</h3>
                <p className="text-xs text-gray-500 mt-0.5">All buildings. Outflows are counted as cash spent.</p>
                {blockers.length > 0 ? (
                    <div className="mt-4 space-y-3">
                        <p className="text-sm text-red-700">Close the earlier day{blockers.length !== 1 ? "s" : ""} first, so the opening cash carries forward correctly:</p>
                        <div className="flex flex-wrap gap-2">
                            {blockers.map(d => (
                                <button key={d} type="button" onClick={() => { setIsOpen(false); onSelectDate(d); }} className="text-xs font-bold border border-gray-300 rounded px-2 py-1 hover:bg-gray-50">{fmtDate(d)} →</button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleClose} className="space-y-3 mt-4">
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm space-y-1">
                            <div className="flex justify-between items-center">
                                <span className="text-gray-600">Opening cash</span>
                                {prev ? (
                                    <span className="font-bold">{inr(openingCash)} <span className="text-[10px] font-normal text-gray-500">from {fmtDate(prev.date)}</span></span>
                                ) : (
                                    <input type="number" inputMode="decimal" min="0" step="any" value={openingInput} onChange={e => setOpeningInput(e.target.value)} placeholder="0" aria-label="Opening cash" className="w-28 px-2 py-1 border border-gray-300 rounded text-right" />
                                )}
                            </div>
                            {!prev && <p className="text-[10px] text-gray-500">No earlier close — enter the cash you started the day with.</p>}
                            <div className="flex justify-between"><span className="text-gray-600">+ Cash received</span><span className="font-bold text-green-700">{inr(summary.cashIn)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-600">− Spent (outflows)</span><span className="font-bold text-red-700">{inr(summary.cashOut)}</span></div>
                            <div className="flex justify-between border-t border-gray-200 pt-1"><span className="font-bold text-gray-800">= Expected cash</span><span className="font-bold">{inr(expected)}</span></div>
                        </div>
                        <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1.5">📱 UPI / Bank today: <b>{inr(summary.digitalIn)}</b> — check it against the phone or bank statement.</p>
                        {summary.unspecifiedIds.length > 0 && (
                            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">❔ {inr(summary.unspecifiedIn)} in {summary.unspecifiedIds.length} inflow{summary.unspecifiedIds.length !== 1 ? "s" : ""} has no payment mode. Close this dialog and set the mode on each row.</p>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="dc-actual" className="block text-xs font-bold text-gray-500 uppercase mb-1">Cash counted *</label>
                                <input id="dc-actual" type="number" inputMode="decimal" min="0" step="any" required value={actualInput} onChange={e => setActualInput(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                            <div>
                                <label htmlFor="dc-handed" className="block text-xs font-bold text-gray-500 uppercase mb-1">Handed to owner</label>
                                <input id="dc-handed" type="number" inputMode="decimal" min="0" step="any" value={handedInput} onChange={e => setHandedInput(e.target.value)} placeholder="0" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                        </div>
                        {actualInput !== "" && (
                            <p className={`text-sm font-bold ${difference === 0 ? "text-emerald-700" : difference < 0 ? "text-red-700" : "text-amber-700"}`}>
                                {difference === 0 ? "✓ Cash matches" : `${difference < 0 ? "Short" : "Over"} by ${inr(Math.abs(difference))}`}
                                <span className="font-normal text-gray-500"> · carry forward {inr(Math.max(0, actualCash - handedToOwner))}</span>
                            </p>
                        )}
                        <div>
                            <label htmlFor="dc-note" className="block text-xs font-bold text-gray-500 uppercase mb-1">Note{difference !== 0 && actualInput !== "" ? " *" : ""}</label>
                            <textarea id="dc-note" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={difference !== 0 ? "Why doesn't the cash match?" : "Optional"} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                        </div>
                        {actualInput !== "" && errors.length > 0 && (
                            <ul className="text-[11px] text-red-600 list-disc pl-4">{errors.map(m => <li key={m}>{m}</li>)}</ul>
                        )}
                        {saveError && <p className="text-[11px] text-red-600">{saveError}</p>}
                        <div className="flex gap-2 pt-1 sticky bottom-0 bg-white pb-1">
                            <button type="button" onClick={() => setIsOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                            <button type="submit" disabled={isSaving || errors.length > 0} className="flex-1 py-2 rounded-md text-sm font-bold text-white bg-gray-800 hover:bg-gray-900 disabled:bg-gray-400">
                                {isSaving ? "Saving…" : "🔒 Close day"}
                            </button>
                        </div>
                    </form>
                )}
            </Modal>
        </div>
    );
}
