"use client";

import { useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Modal } from "@/components/ui";
import { useUploadWithProgress, UploadProgressBar } from "@/lib/useUpload";
import type { Expense, Building } from "@/types";

interface ExpensesTabProps {
    allExpenses: Expense[];
    buildings: Building[];
}

export function ExpensesTab({ allExpenses, buildings }: ExpensesTabProps) {
    const { uploadFile, uploadProgress, isUploading } = useUploadWithProgress();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [amount, setAmount] = useState("");
    const [category, setCategory] = useState("Maintenance");
    const [desc, setDesc] = useState("");
    const [date, setDate] = useState("");
    const [building, setBuilding] = useState("");
    const [receipt, setReceipt] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const getBuildingName = (buildingId: string) => buildings.find(b => b.id === buildingId)?.name || "Unknown";

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!amount || !desc) return;
        setIsSubmitting(true);
        try {
            let receiptUrl = "";
            if (receipt) {
                const ts = new Date().getTime();
                receiptUrl = await uploadFile(`expense_receipts/${ts}_${receipt.name}`, receipt);
            }
            await addDoc(collection(db, "expenses"), {
                amount: Number(amount), category, description: desc,
                date: date || new Date().toISOString().split("T")[0],
                buildingId: building || "",
                buildingName: building ? getBuildingName(building) : "General",
                ...(receiptUrl ? { receiptUrl } : {}),
                createdBy: "", createdAt: new Date().toISOString(),
            });
            setIsModalOpen(false);
            setAmount(""); setDesc(""); setCategory("Maintenance"); setDate(""); setBuilding(""); setReceipt(null);
            alert("Expense logged!");
        } catch (error) { console.error(error); alert("Failed to log expense."); } finally { setIsSubmitting(false); }
    };

    const thisMonth = new Date().toISOString().slice(0, 7);
    const monthExpenses = allExpenses.filter(e => (e.date || e.createdAt || "").startsWith(thisMonth));
    const monthTotal = monthExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const allTotal = allExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden">
                <div className="bg-amber-50 px-5 py-4 border-b border-amber-200 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-amber-800">💰 Expense Tracker</h2>
                        <p className="text-xs text-amber-600 mt-1">Log maintenance, supplies & other expenses</p>
                    </div>
                    <button onClick={() => { setIsModalOpen(true); setDate(new Date().toISOString().split("T")[0]); }} className="text-sm bg-amber-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-amber-700 transition">+ Add</button>
                </div>
                <div className="p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                            <p className="text-[10px] font-bold text-amber-600 uppercase">This Month</p>
                            <p className="text-xl font-bold text-amber-800">₹{monthTotal.toLocaleString()}</p>
                            <p className="text-[10px] text-amber-500">{monthExpenses.length} entries</p>
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                            <p className="text-[10px] font-bold text-gray-600 uppercase">All Time</p>
                            <p className="text-xl font-bold text-gray-800">₹{allTotal.toLocaleString()}</p>
                            <p className="text-[10px] text-gray-500">{allExpenses.length} entries</p>
                        </div>
                    </div>

                    <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                        {allExpenses.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-6">No expenses logged yet.</p>
                        ) : allExpenses.map(exp => (
                            <div key={exp.id} className="py-3 flex justify-between items-start">
                                <div>
                                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{exp.category}</span>
                                    <p className="font-medium text-gray-900 text-sm mt-1">{exp.description}</p>
                                    <p className="text-[10px] text-gray-500">{exp.buildingName || "General"} · {exp.date || new Date(exp.createdAt).toLocaleDateString()}</p>
                                    {exp.createdBy && <p className="text-[10px] text-gray-400">by {exp.createdBy}</p>}
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="font-bold text-red-700">₹{Number(exp.amount).toLocaleString()}</p>
                                    {exp.receiptUrl && <a href={exp.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:underline">📎 Receipt</a>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
                <h3 className="text-lg font-bold text-gray-800">💰 Log Expense</h3>
                <form onSubmit={handleAdd} className="space-y-3 mt-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Amount (₹) *</label>
                        <input type="number" required min="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Category</label>
                        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            {["Maintenance", "Plumbing", "Electrical", "Cleaning", "Supplies", "Painting", "Security", "Water", "Common Area", "Other"].map(c => <option key={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Building</label>
                        <select value={building} onChange={(e) => setBuilding(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            <option value="">General (All Buildings)</option>
                            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description *</label>
                        <textarea required value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Date</label>
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Receipt Photo (Optional)</label>
                        <input type="file" accept="image/*,.pdf" onChange={(e) => setReceipt(e.target.files?.[0] || null)} className="w-full text-sm text-gray-500" />
                    </div>
                    {isUploading && <UploadProgressBar progress={uploadProgress} />}
                    <div className="flex gap-2 pt-2">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                        <button type="submit" disabled={isSubmitting || isUploading} className="flex-1 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:bg-amber-400">{isSubmitting ? "Saving..." : "Log Expense"}</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
