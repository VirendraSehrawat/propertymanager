"use client";

import { useState } from "react";
import { arrayUnion, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COL } from "@/lib/collections";
import { Modal } from "@/components/ui";
import { dateKey } from "@/lib/paymentDue";
import { buildFollowUp, followUpErrors, followUpStatus, FOLLOW_UP_OUTCOMES, tenantFollowUps, type FollowUpOutcome, type FollowUpPayment, type FollowUpUnit } from "@/lib/followUp";
import { commitOrQueue, savedMessage } from "@/lib/offlineQueue";
import { toast } from "@/components/ui";

export interface FollowUpTarget extends FollowUpUnit {
    unitNumber: string;
    tenantName?: string;
}

interface LogFollowUpModalProps {
    /** The unit being chased; `null` keeps the dialog closed. */
    unit: FollowUpTarget | null;
    onClose: () => void;
    currentUserEmail: string;
    /** Balance still owed — shown for context and as the partial-amount hint. */
    remaining?: number;
    /** Ledger rows, so the dialog can show whether the last promise was kept. */
    payments?: FollowUpPayment[];
}

const outcomeLabel = (o: FollowUpOutcome) => FOLLOW_UP_OUTCOMES.find(x => x.value === o)?.label || o;

/**
 * 📞 Log follow-up (§3.5): record what the tenant said when chased — no
 * answer, a promise to pay on a date, a part-payment promise, or a dispute.
 * Appends to `units/{id}.followUps`. Used from Home → Today, Collections and
 * the Monthly overview.
 */
export function LogFollowUpModal({ unit, ...rest }: LogFollowUpModalProps) {
    return (
        <Modal isOpen={!!unit} onClose={rest.onClose}>
            {/* Keyed by unit so the form starts fresh for each tenant. */}
            {unit && <FollowUpForm key={unit.id} unit={unit} {...rest} />}
        </Modal>
    );
}

function FollowUpForm({ unit, onClose, currentUserEmail, remaining, payments = [] }: LogFollowUpModalProps & { unit: FollowUpTarget }) {
    const [outcome, setOutcome] = useState<FollowUpOutcome>("promised");
    const [promisedDate, setPromisedDate] = useState("");
    const [promisedAmount, setPromisedAmount] = useState("");
    const [note, setNote] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    const now = new Date();
    const input = { outcome, promisedDate, promisedAmount: Number(promisedAmount || 0), note };
    const errors = followUpErrors(input, now);
    const status = followUpStatus(unit, payments, now);
    const history = tenantFollowUps(unit).slice(-3).reverse();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (errors.length > 0) return;
        setIsSaving(true);
        setSaveError("");
        try {
            const entry = buildFollowUp({
                ...input,
                tenantEmail: unit.tenantEmail,
                by: currentUserEmail,
                now: now.toISOString(),
                id: `fu_${now.getTime()}`,
            });
            const outcome = await commitOrQueue(updateDoc(doc(db, COL.units, unit.id), { followUps: arrayUnion(entry) }));
            if (outcome === "queued") toast.info(savedMessage(outcome, "Follow-up logged."));
            onClose();
        } catch (err) {
            console.error(err);
            setSaveError("Couldn't save the follow-up. Try again.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <>
            <h3 className="text-lg font-bold text-gray-800">📞 Log follow-up — {unit.unitNumber}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
                {unit.tenantName || unit.tenantEmail || "Tenant"}
                {remaining ? <> · <b className="text-red-700">₹{remaining.toLocaleString("en-IN")}</b> due</> : null}
            </p>
            {status.label && <p className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1 mt-2">{status.label}</p>}
            <form onSubmit={handleSubmit} className="space-y-3 mt-4">
                <fieldset>
                    <legend className="block text-xs font-bold text-gray-500 uppercase mb-1">What did they say?</legend>
                    <div className="grid grid-cols-2 gap-2">
                        {FOLLOW_UP_OUTCOMES.map(o => (
                            <label key={o.value} className={`text-xs font-bold border rounded-md px-2 py-2 cursor-pointer text-center ${outcome === o.value ? "bg-indigo-600 text-white border-indigo-700" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}>
                                <input type="radio" name="outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="sr-only" />
                                {o.label}
                            </label>
                        ))}
                    </div>
                </fieldset>
                {(outcome === "promised" || outcome === "partial") && (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="fu-date" className="block text-xs font-bold text-gray-500 uppercase mb-1">Will pay on *</label>
                            <input id="fu-date" type="date" min={dateKey(now)} value={promisedDate} onChange={e => setPromisedDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                        </div>
                        {outcome === "partial" && (
                            <div>
                                <label htmlFor="fu-amount" className="block text-xs font-bold text-gray-500 uppercase mb-1">Amount (₹) *</label>
                                <input id="fu-amount" type="number" inputMode="decimal" min="1" value={promisedAmount} onChange={e => setPromisedAmount(e.target.value)} placeholder={remaining ? String(remaining) : ""} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                        )}
                    </div>
                )}
                <div>
                    <label htmlFor="fu-note" className="block text-xs font-bold text-gray-500 uppercase mb-1">Note{outcome === "disputed" ? " *" : ""}</label>
                    <textarea id="fu-note" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={outcome === "disputed" ? "What do they dispute?" : "Optional"} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                </div>
                {errors.length > 0 && (outcome !== "promised" || promisedDate !== "") && (
                    <ul className="text-[11px] text-red-600 list-disc pl-4">{errors.map(m => <li key={m}>{m}</li>)}</ul>
                )}
                {saveError && <p className="text-[11px] text-red-600">{saveError}</p>}
                {history.length > 0 && (
                    <div className="text-[11px] text-gray-500 border-t border-gray-100 pt-2 space-y-0.5">
                        <p className="font-bold text-gray-600">Recent</p>
                        {history.map(f => (
                            <p key={f.id}>
                                {new Date(f.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {outcomeLabel(f.outcome)}
                                {f.promisedDate ? ` → ${f.promisedDate}` : ""}{f.promisedAmount ? ` (₹${f.promisedAmount.toLocaleString("en-IN")})` : ""}
                                {f.note ? ` — ${f.note}` : ""} <span className="text-gray-400">· {f.by}</span>
                            </p>
                        ))}
                    </div>
                )}
                <div className="flex gap-2 pt-1 sticky bottom-0 bg-white pb-1">
                    <button type="button" onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                    <button type="submit" disabled={isSaving || errors.length > 0} className="flex-1 py-2 rounded-md text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300">
                        {isSaving ? "Saving…" : "Save follow-up"}
                    </button>
                </div>
            </form>
        </>
    );
}
