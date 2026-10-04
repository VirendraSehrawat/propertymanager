"use client";

import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface AdminSettingsTabProps {
    initialUpiId: string;
    initialPayeeName: string;
}

export function AdminSettingsTab({ initialUpiId, initialPayeeName }: AdminSettingsTabProps) {
    const [upiId, setUpiId] = useState(initialUpiId);
    const [payeeName, setPayeeName] = useState(initialPayeeName);
    const [isSaving, setIsSaving] = useState(false);

    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await setDoc(doc(db, "settings", "payment"), { upiId, payeeName }, { merge: true });
            alert("Payment settings updated successfully!");
        } catch (error) {
            console.error("Failed to save settings:", error);
            alert("Failed to save settings.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="max-w-xl bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h2 className="text-base font-bold text-gray-900 mb-1">⚙️ Payment & Banking Configuration</h2>
            <p className="text-xs text-gray-500 mb-5">These details are embedded into UPI payment QR codes displayed to tenants on invoice settlement screens.</p>

            <form onSubmit={handleSaveSettings} className="space-y-4">
                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">UPI ID (VPA)</label>
                    <input
                        type="text"
                        required
                        placeholder="e.g. propertymanager@okhdfcbank"
                        value={upiId}
                        onChange={(e) => setUpiId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Payee Name (Account Holder)</label>
                    <input
                        type="text"
                        required
                        placeholder="e.g. Sunrise Properties LLC"
                        value={payeeName}
                        onChange={(e) => setPayeeName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                    />
                </div>
                <div className="pt-2">
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 py-2.5 rounded-lg transition disabled:opacity-50"
                    >
                        {isSaving ? "Saving Settings..." : "Save Payment Settings"}
                    </button>
                </div>
            </form>
        </div>
    );
}
