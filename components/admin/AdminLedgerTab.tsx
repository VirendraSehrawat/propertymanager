"use client";

import { useState } from "react";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { LedgerEntry } from "@/types";

interface AdminLedgerTabProps {
    ledgerEntries: LedgerEntry[];
    currentUserEmail: string;
}

export function AdminLedgerTab({ ledgerEntries, currentUserEmail }: AdminLedgerTabProps) {
    const [filter, setFilter] = useState("");
    const [editLedger, setEditLedger] = useState<LedgerEntry | null>(null);
    const [editAmount, setEditAmount] = useState("");
    const [editNote, setEditNote] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const handleEditSave = async () => {
        if (!editLedger) return;
        const newAmountPaid = Number(editAmount);
        if (isNaN(newAmountPaid) || newAmountPaid < 0) {
            alert("Enter a valid amount.");
            return;
        }
        if (!editNote.trim()) {
            alert("Please provide a reason for this correction.");
            return;
        }
        const newBalance = newAmountPaid - Number(editLedger.invoiceAmount);
        setIsSaving(true);
        try {
            await updateDoc(doc(db, "ledger", editLedger.id), {
                amountPaid: newAmountPaid,
                balance: newBalance,
                correctedAt: new Date().toISOString(),
                correctionNote: editNote.trim(),
                correctedBy: currentUserEmail || "admin",
                originalAmountPaid: editLedger.originalAmountPaid ?? editLedger.amountPaid,
            });
            setEditLedger(null);
        } catch (error) {
            console.error("Failed to update ledger entry:", error);
            alert("Failed to update ledger entry.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (entry: LedgerEntry) => {
        if (!window.confirm(`Delete ledger entry for ${entry.billingPeriod} (₹${entry.amountPaid} paid)? This cannot be undone.`)) return;
        try {
            await deleteDoc(doc(db, "ledger", entry.id));
        } catch (error) {
            console.error("Failed to delete ledger entry:", error);
            alert("Failed to delete ledger entry.");
        }
    };

    const searchLower = filter.toLowerCase().trim();
    const filteredEntries = ledgerEntries.filter(e =>
        !searchLower ||
        (e.tenantEmail && e.tenantEmail.toLowerCase().includes(searchLower)) ||
        (e.unitNumber && e.unitNumber.toLowerCase().includes(searchLower)) ||
        (e.transactionId && e.transactionId.toLowerCase().includes(searchLower))
    );

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-wrap justify-between items-center gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">📑 Master Payment Ledger</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{ledgerEntries.length} settled payment audit logs with correction history</p>
                </div>
                <div className="w-full sm:w-64">
                    <input
                        type="text"
                        placeholder="🔍 Search unit, tenant, or TxID..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs outline-none focus:border-blue-500"
                    />
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-gray-600">
                        <thead className="bg-gray-50 text-gray-500 uppercase font-bold border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3">Date</th>
                                <th className="px-4 py-3">Unit</th>
                                <th className="px-4 py-3">Tenant Email</th>
                                <th className="px-4 py-3">Billing Period</th>
                                <th className="px-4 py-3 text-right">Invoiced</th>
                                <th className="px-4 py-3 text-right">Paid</th>
                                <th className="px-4 py-3 text-right">Balance</th>
                                <th className="px-4 py-3">TxID / Mode</th>
                                <th className="px-4 py-3 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredEntries.map(e => (
                                <tr key={e.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-gray-500">{new Date(e.createdAt).toLocaleDateString()}</td>
                                    <td className="px-4 py-3 font-bold text-gray-900">{e.unitNumber}</td>
                                    <td className="px-4 py-3">{e.tenantEmail}</td>
                                    <td className="px-4 py-3">{e.billingPeriod}</td>
                                    <td className="px-4 py-3 text-right">₹{Number(e.invoiceAmount || 0).toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right font-bold text-emerald-600">₹{Number(e.amountPaid || 0).toLocaleString()}</td>
                                    <td className={`px-4 py-3 text-right font-bold ${
                                        Number(e.balance || 0) < 0 ? "text-rose-600" : "text-emerald-600"
                                    }`}>
                                        {Number(e.balance || 0) >= 0 ? "+" : ""}₹{Number(e.balance || 0).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-[11px] text-gray-400 truncate max-w-[120px]">{e.transactionId || e.paymentMode || "—"}</td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => { setEditLedger(e); setEditAmount(String(e.amountPaid)); setEditNote(""); }}
                                                className="text-blue-600 hover:text-blue-800 font-bold"
                                            >
                                                ✏️ Edit
                                            </button>
                                            <button
                                                onClick={() => handleDelete(e)}
                                                className="text-red-400 hover:text-red-600 font-bold"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Edit Ledger Entry Modal */}
            {editLedger && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-base font-bold text-gray-900">Correct Ledger Record</h3>
                            <button onClick={() => setEditLedger(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <div className="space-y-3">
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                                <p className="font-bold">Unit {editLedger.unitNumber} · {editLedger.billingPeriod}</p>
                                <p className="mt-0.5">Invoiced Amount: ₹{Number(editLedger.invoiceAmount).toLocaleString()}</p>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Corrected Amount Paid (₹)</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={editAmount}
                                    onChange={(e) => setEditAmount(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Reason for Rectification (Audit Trail)</label>
                                <textarea
                                    required
                                    rows={3}
                                    placeholder="Explain reason for correction (e.g. cash deposit adjusted, bank reversal)..."
                                    value={editNote}
                                    onChange={(e) => setEditNote(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500 resize-none"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-3">
                                <button type="button" onClick={() => setEditLedger(null)} className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                                <button type="button" onClick={handleEditSave} disabled={isSaving} className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
                                    {isSaving ? "Saving..." : "Apply Correction"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
