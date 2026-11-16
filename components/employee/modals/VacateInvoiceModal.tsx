"use client";

import { useState } from "react";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COL } from "@/lib/collections";
import { Modal, toast } from "@/components/ui";
import type { Invoice } from "@/types";
import { applyVacateAmounts, buildVacateInvoice, vacateAmountErrors } from "@/lib/vacateInvoice";
import { notifyInvoiceCreated } from "@/lib/notify";

export interface VacatedUnit {
    id: string;
    unitNumber: string;
    tenantEmail: string;
    tenantName: string;
    baseRent: number;
}

interface Props {
    vacated: VacatedUnit | null;
    invoices: Invoice[];
    onClose: () => void;
}

/** Shown after a unit is vacated: set the final rent and electricity bill. */
export function VacateInvoiceModal({ vacated, invoices, onClose }: Props) {
    return (
        <Modal isOpen={!!vacated} onClose={onClose} className="max-w-md">
            {vacated && <VacateForm key={vacated.id} vacated={vacated} invoices={invoices} onClose={onClose} />}
        </Modal>
    );
}

function VacateForm({ vacated, invoices, onClose }: Props & { vacated: VacatedUnit }) {
    const open = invoices
        .filter(i => i.unitId === vacated.id && (i.status === "unpaid" || i.status === "pending"))
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const [targetId, setTargetId] = useState(open[0]?.id || "new");
    const target = open.find(i => i.id === targetId);
    const [rent, setRent] = useState(String(target ? target.baseRent ?? 0 : vacated.baseRent || 0));
    const [elec, setElec] = useState(String(target ? target.electricityCharge ?? 0 : 0));
    const [isSaving, setIsSaving] = useState(false);

    const amounts = { rent: Number(rent), electricity: Number(elec) };
    const errors = vacateAmountErrors(amounts);

    const pick = (id: string) => {
        setTargetId(id);
        const inv = open.find(i => i.id === id);
        setRent(String(inv ? inv.baseRent ?? 0 : vacated.baseRent || 0));
        setElec(String(inv ? inv.electricityCharge ?? 0 : 0));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (errors.length > 0) return;
        setIsSaving(true);
        try {
            if (target) {
                const patch = applyVacateAmounts(target, amounts);
                await updateDoc(doc(db, COL.invoices, target.id), patch);
                toast.success(`Invoice updated: ₹${patch.totalAmount.toLocaleString()} for ${vacated.unitNumber}.`);
            } else {
                const inv = buildVacateInvoice({ unitId: vacated.id, unitNumber: vacated.unitNumber, tenantEmail: vacated.tenantEmail, amounts });
                await setDoc(doc(db, COL.invoices, inv.invoiceId), inv.fields);
                notifyInvoiceCreated(inv.invoiceId);
                toast.success(`Final invoice ₹${(amounts.rent + amounts.electricity).toLocaleString()} created for ${vacated.unitNumber}.`);
            }
            onClose();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSaving(false);
        }
    };

    const total = target ? applyVacateAmounts(target, amounts).totalAmount : amounts.rent + amounts.electricity;

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Final bill — {vacated.unitNumber}</h3>
            <p className="text-xs text-gray-500">{vacated.tenantName || vacated.tenantEmail} has vacated. Set any rent and electricity amount.</p>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Invoice</label>
                <select value={targetId} onChange={e => pick(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    {open.map(i => <option key={i.id} value={i.id}>Update: {i.billingPeriod} (₹{i.totalAmount.toLocaleString()})</option>)}
                    <option value="new">Create new final invoice</option>
                </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-gray-600">Rent (₹)
                    <input type="number" min="0" value={rent} onChange={e => setRent(e.target.value)} className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </label>
                <label className="text-xs text-gray-600">Electricity bill (₹)
                    <input type="number" min="0" value={elec} onChange={e => setElec(e.target.value)} className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </label>
            </div>
            {errors.length > 0 && <p className="text-xs text-red-600">{errors[0]}</p>}
            <div className="flex items-center justify-between gap-3">
                <p className="font-bold text-gray-900">Total ₹{total.toLocaleString()}</p>
                <div className="flex gap-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Skip</button>
                    <button type="submit" disabled={isSaving || errors.length > 0} className="px-4 py-2 text-sm font-bold bg-indigo-600 text-white rounded-lg disabled:opacity-50">{isSaving ? "Saving…" : target ? "Update invoice" : "Create invoice"}</button>
                </div>
            </div>
        </form>
    );
}
