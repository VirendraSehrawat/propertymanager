"use client";

import { useState } from "react";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toast } from "@/components/ui";

export interface BillingFields {
    paymentDay?: number;
    securityDeposit?: number;
    securityDepositDate?: string;
    electricityRate?: number;
}

export interface BillingValues {
    paymentDay: string;
    securityDeposit: string;
    electricityRate: string;
}

/**
 * Validate the form and work out what changed. Empty clears a field (the
 * electricity rate then falls back to the default). Returns the Firestore
 * patch (with `remove` keys to delete) and the new local values.
 */
export function billingUpdate(values: BillingValues, current: BillingFields, now: string): {
    errors: string[];
    set: Record<string, number | string>;
    remove: (keyof BillingFields)[];
} {
    const errors: string[] = [];
    const set: Record<string, number | string> = {};
    const remove: (keyof BillingFields)[] = [];
    const field = (key: "paymentDay" | "securityDeposit" | "electricityRate", raw: string, valid: (n: number) => boolean, message: string) => {
        const trimmed = raw.trim();
        if (trimmed === "") {
            if (current[key] !== undefined && current[key] !== null) remove.push(key);
            return;
        }
        const n = Number(trimmed);
        if (!Number.isFinite(n) || !valid(n)) { errors.push(message); return; }
        if (n !== current[key]) set[key] = n;
    };
    field("paymentDay", values.paymentDay, n => Number.isInteger(n) && n >= 1 && n <= 31, "Payment day must be a whole number from 1 to 31.");
    field("securityDeposit", values.securityDeposit, n => n >= 0, "Security deposit can't be negative.");
    field("electricityRate", values.electricityRate, n => n > 0, "Electricity rate must be more than 0 (leave it empty to use the default).");
    if (set.securityDeposit !== undefined && !current.securityDepositDate) set.securityDepositDate = now;
    if (remove.includes("securityDeposit")) remove.push("securityDepositDate");
    return { errors, set, remove };
}

interface ProfileBillingFormProps {
    unit: BillingFields & { id: string };
    defaultElectricityRate: number;
    /** Called after a successful save with the new values, so the profile can update. */
    onSaved: (fields: BillingFields) => void;
}

/**
 * 📅 Payment & Security in the tenant profile (§6.4): one labelled form with a
 * single Save button, replacing three inline ✓ buttons that read inputs via
 * `document.getElementById`. Mount with `key={unit.id}` so it resets per tenant.
 */
export function ProfileBillingForm({ unit, defaultElectricityRate, onSaved }: ProfileBillingFormProps) {
    const [values, setValues] = useState<BillingValues>({
        paymentDay: unit.paymentDay ? String(unit.paymentDay) : "",
        securityDeposit: unit.securityDeposit !== undefined && unit.securityDeposit !== null ? String(unit.securityDeposit) : "",
        electricityRate: Number(unit.electricityRate) > 0 ? String(unit.electricityRate) : "",
    });
    const [isSaving, setIsSaving] = useState(false);
    const update = billingUpdate(values, unit, new Date().toISOString());
    const dirty = Object.keys(update.set).length > 0 || update.remove.length > 0;

    const set = (key: keyof BillingValues) => (e: React.ChangeEvent<HTMLInputElement>) => setValues(v => ({ ...v, [key]: e.target.value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (update.errors.length > 0 || !dirty) return;
        setIsSaving(true);
        try {
            const patch: Record<string, unknown> = { ...update.set };
            for (const key of update.remove) patch[key] = deleteField();
            await updateDoc(doc(db, "units", unit.id), patch);
            const next: BillingFields = { ...unit, ...update.set };
            for (const key of update.remove) delete next[key];
            onSaved(next);
            toast.success("Payment & security details saved.");
        } catch (err) {
            console.error(err);
            toast.error("Failed to save payment & security details.");
        } finally {
            setIsSaving(false);
        }
    };

    const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-md text-sm";
    return (
        <form onSubmit={handleSubmit} className="border-t border-gray-200 pt-4 mb-4 space-y-3">
            <h3 className="text-sm font-bold text-gray-800">📅 Payment & Security</h3>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label htmlFor="pb-day" className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Payment day</label>
                    <input id="pb-day" type="number" inputMode="numeric" min="1" max="31" value={values.paymentDay} onChange={set("paymentDay")} placeholder="1–31" className={inputClass} />
                    <p className="text-[11px] text-gray-500 mt-0.5">{unit.paymentDay ? `Now: day ${unit.paymentDay} of every month` : "Not set — rent is due on the 1st"}</p>
                </div>
                <div>
                    <label htmlFor="pb-deposit" className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Security deposit (₹)</label>
                    <input id="pb-deposit" type="number" inputMode="decimal" min="0" value={values.securityDeposit} onChange={set("securityDeposit")} placeholder="₹" className={inputClass} />
                    {unit.securityDepositDate && <p className="text-[11px] text-gray-500 mt-0.5">Since {new Date(unit.securityDepositDate).toLocaleDateString("en-IN")}</p>}
                </div>
            </div>
            <div>
                <label htmlFor="pb-rate" className="block text-[11px] font-bold text-gray-500 uppercase mb-1">⚡ Electricity rate (₹ per unit)</label>
                <input id="pb-rate" type="number" inputMode="decimal" min="0" step="0.01" value={values.electricityRate} onChange={set("electricityRate")} placeholder={`Default ₹${defaultElectricityRate}/unit`} className={inputClass} />
                <p className="text-[11px] text-gray-500 mt-0.5">
                    {Number(unit.electricityRate) > 0
                        ? `Custom ₹${Number(unit.electricityRate)}/unit for future meter invoices. Clear it to use the default.`
                        : `Using the default ₹${defaultElectricityRate}/unit.`}
                </p>
            </div>
            {update.errors.length > 0 && <ul className="text-[11px] text-red-600 list-disc pl-4">{update.errors.map(m => <li key={m}>{m}</li>)}</ul>}
            <button type="submit" disabled={isSaving || !dirty || update.errors.length > 0} className="w-full min-h-11 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:bg-indigo-300">
                {isSaving ? "Saving…" : dirty || update.errors.length > 0 ? "Save payment & security" : "No changes"}
            </button>
        </form>
    );
}
