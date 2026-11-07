"use client";

import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COL } from "@/lib/collections";
import { Modal, toast } from "@/components/ui";
import type { Unit } from "@/types";
import { buildCustomInvoice, customInvoiceErrors, inclusiveDays, proratedRent } from "@/lib/customInvoice";
import { notifyInvoiceCreated } from "@/lib/notify";

interface CustomInvoiceModalProps {
    isOpen: boolean;
    onClose: () => void;
    units: Unit[];
}

/**
 * Employee-made invoice for a date range (a few days of a month) and/or
 * one-off tasks. Lands in Collections as an unpaid custom invoice.
 */
export function CustomInvoiceModal({ isOpen, onClose, units }: CustomInvoiceModalProps) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg">
            {isOpen && <CustomInvoiceForm units={units} onClose={onClose} />}
        </Modal>
    );
}

function CustomInvoiceForm({ units, onClose }: { units: Unit[]; onClose: () => void }) {
    const today = new Date().toISOString().slice(0, 10);
    const billable = units.filter(u => u.tenantEmail);
    const [unitId, setUnitId] = useState(billable[0]?.id || "");
    const [includeRent, setIncludeRent] = useState(true);
    const [from, setFrom] = useState(today);
    const [to, setTo] = useState(today);
    const [tasks, setTasks] = useState<{ description: string; amount: string }[]>([]);
    const [note, setNote] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const unit = billable.find(u => u.id === unitId);
    const parsedTasks = tasks.map(t => ({ description: t.description, amount: Number(t.amount) || 0 }));
    const errors = unit ? customInvoiceErrors({ from, to, includeRent, tasks: parsedTasks }) : ["Pick a unit."];
    const rent = unit && includeRent ? proratedRent(Number(unit.baseRent || 0), from, to) : 0;
    const total = rent + parsedTasks.reduce((s, t) => s + (t.description.trim() && t.amount > 0 ? t.amount : 0), 0);

    const updateTask = (i: number, patch: Partial<{ description: string; amount: string }>) =>
        setTasks(ts => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!unit || errors.length > 0) return;
        setIsSaving(true);
        try {
            const inv = buildCustomInvoice({ unit, tenantEmail: unit.tenantEmail || "", from, to, includeRent, tasks: parsedTasks, note });
            await setDoc(doc(db, COL.invoices, inv.invoiceId), inv.fields);
            notifyInvoiceCreated(inv.invoiceId);
            toast.success(`📄 Invoice ₹${inv.total.toLocaleString()} created for ${unit.unitNumber}. It's in Collections.`);
            onClose();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Custom invoice</h3>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <select value={unitId} onChange={e => setUnitId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                    {billable.map(u => <option key={u.id} value={u.id}>{u.unitNumber} — {u.tenantName || u.tenantEmail}</option>)}
                </select>
            </div>

            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input type="checkbox" checked={includeRent} onChange={e => setIncludeRent(e.target.checked)} />
                Charge rent for specific days
            </label>
            {includeRent && (
                <div>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs text-gray-600">From
                            <input type="date" value={from} onChange={e => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        </label>
                        <label className="text-xs text-gray-600">To (inclusive)
                            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        </label>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{inclusiveDays(from, to)} day(s) · ₹{rent.toLocaleString()} (monthly rent ₹{Number(unit?.baseRent || 0).toLocaleString()} prorated per day)</p>
                </div>
            )}

            <div>
                <div className="flex justify-between items-center mb-1">
                    <label className="text-sm font-medium text-gray-700">Tasks / extra charges</label>
                    <button type="button" onClick={() => setTasks(ts => [...ts, { description: "", amount: "" }])} className="text-xs font-bold text-indigo-600">+ Add task</button>
                </div>
                <div className="space-y-2">
                    {tasks.map((t, i) => (
                        <div key={i} className="flex gap-2">
                            <input value={t.description} onChange={e => updateTask(i, { description: e.target.value })} placeholder="e.g. Plumbing repair" className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                            <input type="number" min="0" value={t.amount} onChange={e => updateTask(i, { amount: e.target.value })} placeholder="₹" className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                            <button type="button" onClick={() => setTasks(ts => ts.filter((_, j) => j !== i))} aria-label="Remove task" className="text-gray-400 hover:text-red-600">✕</button>
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                <input value={note} onChange={e => setNote(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>

            {errors.length > 0 && <p className="text-xs text-red-600">{errors[0]}</p>}
            <div className="sticky bottom-0 bg-white pt-2 flex items-center justify-between gap-3">
                <p className="font-bold text-gray-900">Total ₹{total.toLocaleString()}</p>
                <div className="flex gap-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
                    <button type="submit" disabled={isSaving || errors.length > 0} className="px-4 py-2 text-sm font-bold bg-indigo-600 text-white rounded-lg disabled:opacity-50">{isSaving ? "Creating…" : "Create invoice"}</button>
                </div>
            </div>
        </form>
    );
}
