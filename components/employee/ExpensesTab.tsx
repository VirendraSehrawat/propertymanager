"use client";

import { useState } from "react";
import { doc, updateDoc, addDoc, collection, deleteDoc, deleteField } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Modal } from "@/components/ui";
import { useUploadWithProgress, UploadProgressBar } from "@/lib/useUpload";
import { calculateFundSummary, filterExpenses, buildSettlementUpdate } from "@/lib/expenses";
import type { Allocation, Building, Expense } from "@/types";

interface ExpensesTabProps {
    allExpenses: Expense[];
    allAllocations: Allocation[];
    buildings: Building[];
    userEmail: string;
}

/**
 * Expenses tab — logs expenses, tracks allocated funds, and settles
 * expenses against those funds. Extracted from `app/employee/page.tsx`
 * as Section 3 step 3 of `docs/REFACTOR_PLAN.md`.
 *
 * Every expense write is mirrored to the `dailyLedger` collection as an
 * outflow (with cross-linked `expenseId`/`dailyLedgerId` for cascading
 * soft-deletes) so the Daily Ledger view stays consistent.
 */
export function ExpensesTab({ allExpenses, allAllocations, buildings, userEmail }: ExpensesTabProps) {
    const { uploadFile, uploadProgress, isUploading } = useUploadWithProgress();

    const getBuildingName = (buildingId: string) => buildings.find((b) => b.id === buildingId)?.name || "Unknown";

    // --- Expense modal ---
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [expenseAmount, setExpenseAmount] = useState("");
    const [expenseCategory, setExpenseCategory] = useState("Maintenance");
    const [expenseDesc, setExpenseDesc] = useState("");
    const [expenseDate, setExpenseDate] = useState("");
    const [expenseBuilding, setExpenseBuilding] = useState("");
    const [expenseReceipt, setExpenseReceipt] = useState<File | null>(null);
    const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);

    // --- Allocation modal ---
    const [isAllocationModalOpen, setIsAllocationModalOpen] = useState(false);
    const [allocAmount, setAllocAmount] = useState("");
    const [allocNote, setAllocNote] = useState("");
    const [allocDate, setAllocDate] = useState("");
    const [allocBuilding, setAllocBuilding] = useState("");
    const [isSubmittingAllocation, setIsSubmittingAllocation] = useState(false);
    const [editingAllocationId, setEditingAllocationId] = useState<string | null>(null);

    // --- View filters ---
    const [expenseFilter, setExpenseFilter] = useState<"all" | "unsettled" | "settled">("all");
    const [expenseViewMode, setExpenseViewMode] = useState<"all" | "daily" | "monthly">("all");
    const [expenseSelectedDate, setExpenseSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
    const [expenseSelectedMonth, setExpenseSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));

    const openAddExpense = () => {
        setIsExpenseModalOpen(true);
        setExpenseDate(new Date().toISOString().split("T")[0]);
    };

    const openAddAllocation = () => {
        setIsAllocationModalOpen(true);
        setAllocDate(new Date().toISOString().split("T")[0]);
    };

    const openEditAllocation = (a: Allocation) => {
        setEditingAllocationId(a.id);
        setAllocAmount(String(a.amount ?? ""));
        setAllocNote(a.note || "");
        setAllocDate(a.date || (a.createdAt ? a.createdAt.slice(0, 10) : new Date().toISOString().split("T")[0]));
        setAllocBuilding(a.buildingId || "");
        setIsAllocationModalOpen(true);
    };

    const closeAllocationModal = () => {
        setIsAllocationModalOpen(false);
        setEditingAllocationId(null);
        setAllocAmount("");
        setAllocNote("");
        setAllocDate("");
        setAllocBuilding("");
    };

    // Writes to `expenses` and mirrors to `dailyLedger`; both docs are
    // cross-linked (`expenses.dailyLedgerId` <-> `dailyLedger.expenseId`)
    // so soft-delete cascades across both.
    const handleAddExpense = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!expenseAmount || !expenseDesc) return;
        setIsSubmittingExpense(true);
        try {
            let receiptUrl = "";
            if (expenseReceipt) {
                receiptUrl = await uploadFile(`expense_receipts/${new Date().getTime()}_${expenseReceipt.name}`, expenseReceipt);
            }
            const nowIso = new Date().toISOString();
            const dateStr = expenseDate || nowIso.split("T")[0];
            const buildingName = expenseBuilding ? getBuildingName(expenseBuilding) : "General";
            const amountNum = Number(expenseAmount);

            const expenseRef = await addDoc(collection(db, "expenses"), {
                amount: amountNum,
                category: expenseCategory,
                description: expenseDesc,
                date: dateStr,
                buildingId: expenseBuilding || "",
                buildingName,
                ...(receiptUrl ? { receiptUrl } : {}),
                createdBy: userEmail,
                createdAt: nowIso,
            });

            const ledgerRef = await addDoc(collection(db, "dailyLedger"), {
                date: dateStr,
                direction: "outflow",
                category: (expenseCategory || "other").toLowerCase(),
                buildingId: expenseBuilding || "",
                buildingName,
                unitId: "",
                unitNumber: "",
                amount: amountNum,
                description: expenseDesc,
                expenseId: expenseRef.id,
                createdBy: userEmail,
                createdAt: nowIso,
            });

            await updateDoc(doc(db, "expenses", expenseRef.id), { dailyLedgerId: ledgerRef.id });

            setIsExpenseModalOpen(false);
            setExpenseAmount("");
            setExpenseDesc("");
            setExpenseCategory("Maintenance");
            setExpenseDate("");
            setExpenseBuilding("");
            setExpenseReceipt(null);
            alert("Expense logged (also visible in Daily Ledger)!");
        } catch (error) {
            console.error(error);
            alert("Failed to log expense.");
        } finally {
            setIsSubmittingExpense(false);
        }
    };

    const handleSoftDeleteExpense = async (exp: Expense) => {
        if (exp.deleted) return;
        const reason = window.prompt(`Delete expense "${exp.description}" (₹${Number(exp.amount).toLocaleString()})?\n\nPlease provide a reason (required):`, "");
        if (reason === null) return;
        const trimmed = reason.trim();
        if (!trimmed) { alert("A reason is required to delete an expense."); return; }
        try {
            const patch = {
                deleted: true,
                deleteReason: trimmed,
                deletedBy: userEmail,
                deletedAt: new Date().toISOString(),
            } as const;
            await updateDoc(doc(db, "expenses", exp.id), patch);
            if (exp.dailyLedgerId) {
                await updateDoc(doc(db, "dailyLedger", exp.dailyLedgerId), patch);
            }
        } catch (error) { console.error(error); alert("Failed to delete expense."); }
    };

    const handleAddAllocation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!allocAmount) return;
        setIsSubmittingAllocation(true);
        try {
            const payload = {
                amount: Number(allocAmount),
                note: allocNote || "",
                date: allocDate || new Date().toISOString().split("T")[0],
                buildingId: allocBuilding || "",
                buildingName: allocBuilding ? getBuildingName(allocBuilding) : "General",
            };
            if (editingAllocationId) {
                await updateDoc(doc(db, "allocations", editingAllocationId), {
                    ...payload,
                    updatedBy: userEmail,
                    updatedAt: new Date().toISOString(),
                });
                alert("Allocation updated!");
            } else {
                await addDoc(collection(db, "allocations"), {
                    ...payload,
                    createdBy: userEmail,
                    createdAt: new Date().toISOString(),
                });
                alert("Allocated amount added!");
            }
            closeAllocationModal();
        } catch (error) {
            console.error(error);
            alert("Failed to save allocation.");
        } finally {
            setIsSubmittingAllocation(false);
        }
    };

    const handleDeleteAllocation = async (a: Allocation) => {
        if (!window.confirm(`Delete allocation of ₹${Number(a.amount).toLocaleString()} (${a.note || "no note"})?\n\nThis will reduce the total allocated fund.`)) return;
        try {
            await deleteDoc(doc(db, "allocations", a.id));
        } catch (error) { console.error(error); alert("Failed to delete allocation."); }
    };

    const handleToggleExpenseSettled = async (exp: Expense) => {
        const nextSettled = !exp.settled;
        if (nextSettled && !window.confirm(`Mark "${exp.description}" (₹${Number(exp.amount).toLocaleString()}) as settled? This will be deducted from the allocated amount.`)) return;
        try {
            await updateDoc(doc(db, "expenses", exp.id), buildSettlementUpdate(exp.settled, userEmail, deleteField()) as Record<string, unknown>);
        } catch (error) { console.error(error); alert("Failed to update expense."); }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden">
                <div className="bg-amber-50 px-5 py-4 border-b border-amber-200 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-amber-800">💰 Expense Tracker</h2>
                        <p className="text-xs text-amber-600 mt-1">Log maintenance, supplies & other expenses</p>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={openAddAllocation} className="text-sm bg-emerald-600 text-white px-3 py-2 rounded-lg font-bold hover:bg-emerald-700 transition">+ Allocate</button>
                        <button onClick={openAddExpense} className="text-sm bg-amber-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-amber-700 transition">+ Add</button>
                    </div>
                </div>
                <div className="p-4 space-y-4">
                    {/* Allocated Fund Summary */}
                    {(() => {
                        const { totalAllocated, settledTotal, pendingTotal, remaining, isOverspent, overspentBy } = calculateFundSummary(allAllocations, allExpenses);
                        return (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                                <div className="flex justify-between items-center mb-3">
                                    <h3 className="text-sm font-bold text-emerald-800">🏦 Allocated Fund</h3>
                                    <span className="text-[10px] text-emerald-600">{allAllocations.length} allocation(s)</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-500 uppercase">Allocated</p>
                                        <p className="text-base font-bold text-emerald-700">₹{totalAllocated.toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-500 uppercase">Settled</p>
                                        <p className="text-base font-bold text-red-600">−₹{settledTotal.toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-500 uppercase">Remaining</p>
                                        <p className={`text-base font-bold ${isOverspent ? "text-red-700" : "text-emerald-800"}`}>₹{remaining.toLocaleString()}</p>
                                    </div>
                                </div>
                                {pendingTotal > 0 && (
                                    <p className="text-[10px] text-amber-700 bg-amber-100 rounded px-2 py-1 mt-3 text-center">⏳ ₹{pendingTotal.toLocaleString()} in unsettled expenses pending</p>
                                )}
                                {isOverspent && (
                                    <p className="text-[10px] text-red-700 bg-red-100 rounded px-2 py-1 mt-2 text-center font-bold">⚠️ Allocated fund exceeded by ₹{overspentBy.toLocaleString()}</p>
                                )}
                                {allAllocations.length > 0 && (
                                    <details className="mt-3">
                                        <summary className="text-[10px] font-bold text-emerald-700 uppercase cursor-pointer hover:text-emerald-900">📜 Allocation History</summary>
                                        <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                                            {allAllocations.map((a) => (
                                                <div key={a.id} className="flex justify-between items-center bg-white rounded-lg px-2.5 py-2 border border-emerald-100">
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-medium text-gray-800 truncate">{a.note || "Fund allocation"}</p>
                                                        <p className="text-[10px] text-gray-500">{a.buildingName || "General"} · {a.date || new Date(a.createdAt).toLocaleDateString()}</p>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <p className="text-sm font-bold text-emerald-700">+₹{Number(a.amount).toLocaleString()}</p>
                                                        <button type="button" onClick={() => openEditAllocation(a)} title="Edit" className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">✏️</button>
                                                        <button type="button" onClick={() => handleDeleteAllocation(a)} title="Delete" className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">🗑</button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                )}
                            </div>
                        );
                    })()}

                    {/* Summary */}
                    {(() => {
                        const thisMonth = new Date().toISOString().slice(0, 7);
                        const monthExpenses = allExpenses.filter((e) => (e.date || e.createdAt || "").startsWith(thisMonth));
                        const monthTotal = monthExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
                        const allTotal = allExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
                        return (
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
                        );
                    })()}

                    {/* View mode toggle */}
                    <div className="flex gap-2">
                        {(["all", "daily", "monthly"] as const).map((v) => (
                            <button key={v} onClick={() => setExpenseViewMode(v)} className={`flex-1 text-xs font-bold py-2 rounded-lg capitalize transition ${expenseViewMode === v ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                                {v === "all" ? "🗂 All" : v === "daily" ? "📅 Daily" : "🗓 Monthly"}
                            </button>
                        ))}
                    </div>

                    {expenseViewMode === "daily" && (
                        <input type="date" value={expenseSelectedDate} onChange={(e) => setExpenseSelectedDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    )}
                    {expenseViewMode === "monthly" && (
                        <input type="month" value={expenseSelectedMonth} onChange={(e) => setExpenseSelectedMonth(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    )}

                    <div className="flex gap-2">
                        {(["all", "unsettled", "settled"] as const).map((f) => (
                            <button key={f} onClick={() => setExpenseFilter(f)} className={`flex-1 text-xs font-bold py-2 rounded-lg capitalize transition ${expenseFilter === f ? "bg-amber-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{f}</button>
                        ))}
                    </div>

                    {/* Expense List */}
                    <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                        {(() => {
                            const dateScoped = allExpenses.filter((e) => {
                                const d = e.date || (e.createdAt || "").slice(0, 10);
                                if (expenseViewMode === "daily") return d === expenseSelectedDate;
                                if (expenseViewMode === "monthly") return (d || "").startsWith(expenseSelectedMonth);
                                return true;
                            });
                            const filtered = filterExpenses(dateScoped, expenseFilter);
                            const scopedTotal = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);
                            return filtered.length === 0 ? (
                                <p className="text-sm text-gray-500 text-center py-6">No {expenseFilter === "all" ? "" : expenseFilter} expenses for this {expenseViewMode === "daily" ? "day" : expenseViewMode === "monthly" ? "month" : "period"}.</p>
                            ) : (
                                <>
                                    {expenseViewMode !== "all" && (
                                        <div className="py-2 px-2 bg-teal-50 border border-teal-200 rounded-lg mb-2 flex justify-between items-center">
                                            <span className="text-xs font-bold text-teal-800">{filtered.length} entries {expenseViewMode === "daily" ? `on ${new Date(expenseSelectedDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : `in ${new Date(expenseSelectedMonth + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`}</span>
                                            <span className="text-sm font-bold text-teal-800">₹{scopedTotal.toLocaleString()}</span>
                                        </div>
                                    )}
                                    {filtered.map((exp) => (
                                        <div key={exp.id} className={`py-3 flex justify-between items-start gap-3 ${exp.settled ? "opacity-70" : ""}`}>
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{exp.category}</span>
                                                    {exp.settled ? (
                                                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-green-100 text-green-700">✓ Settled</span>
                                                    ) : (
                                                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Pending</span>
                                                    )}
                                                </div>
                                                <p className={`font-medium text-gray-900 text-sm mt-1 ${exp.settled ? "line-through text-gray-500" : ""}`}>{exp.description}</p>
                                                <p className="text-[10px] text-gray-500">{exp.buildingName || "General"} · {exp.date || new Date(exp.createdAt).toLocaleDateString()}</p>
                                                {exp.createdBy && <p className="text-[10px] text-gray-400">by {exp.createdBy}</p>}
                                                {exp.settled && exp.settledAt && <p className="text-[10px] text-green-600">Settled {new Date(exp.settledAt).toLocaleDateString()}{exp.settledBy ? ` by ${exp.settledBy}` : ""}</p>}
                                            </div>
                                            <div className="text-right shrink-0 flex flex-col items-end gap-2">
                                                <p className="font-bold text-red-700">₹{Number(exp.amount).toLocaleString()}</p>
                                                {exp.receiptUrl && <a href={exp.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:underline">📎 Receipt</a>}
                                                <div className="flex gap-1">
                                                    <button onClick={() => handleToggleExpenseSettled(exp)} className={`text-[10px] font-bold px-2 py-1 rounded-md transition ${exp.settled ? "bg-gray-100 text-gray-600 hover:bg-gray-200" : "bg-green-600 text-white hover:bg-green-700"}`}>
                                                        {exp.settled ? "Undo" : "✓ Settle"}
                                                    </button>
                                                    <button onClick={() => handleSoftDeleteExpense(exp)} title="Delete with reason" className="text-[10px] font-bold px-2 py-1 rounded-md bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition">🗑</button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </>
                            );
                        })()}
                    </div>
                </div>
            </div>

            {/* Allocation modal */}
            <Modal isOpen={isAllocationModalOpen} onClose={closeAllocationModal}>
                <h3 className="text-lg font-bold text-gray-800">🏦 {editingAllocationId ? "Edit Allocated Amount" : "Add Allocated Amount"}</h3>
                <p className="text-xs text-gray-500 mt-1 mb-3">Funds allocated for expenses. Settled expenses are deducted from this amount.</p>
                <form onSubmit={handleAddAllocation} className="space-y-3">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Amount (₹) *</label>
                        <input type="number" required min="1" value={allocAmount} onChange={(e) => setAllocAmount(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. 20000" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Building</label>
                        <select value={allocBuilding} onChange={(e) => setAllocBuilding(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            <option value="">General (All Buildings)</option>
                            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Note</label>
                        <input type="text" value={allocNote} onChange={(e) => setAllocNote(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. Monthly maintenance fund" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Date</label>
                        <input type="date" value={allocDate} onChange={(e) => setAllocDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div className="flex gap-2 pt-2">
                        <button type="button" onClick={closeAllocationModal} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                        <button type="submit" disabled={isSubmittingAllocation} className="flex-1 py-2 bg-emerald-600 text-white rounded-md text-sm font-medium hover:bg-emerald-700 disabled:bg-emerald-400">{isSubmittingAllocation ? "Saving..." : (editingAllocationId ? "Save Changes" : "Add Allocation")}</button>
                    </div>
                </form>
            </Modal>

            {/* Expense modal */}
            <Modal isOpen={isExpenseModalOpen} onClose={() => setIsExpenseModalOpen(false)}>
                <h3 className="text-lg font-bold text-gray-800">💰 Log Expense</h3>
                <form onSubmit={handleAddExpense} className="space-y-3 mt-3">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Amount (₹) *</label>
                        <input type="number" required min="1" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. 500" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Category</label>
                        <select value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            {["Maintenance", "Plumbing", "Electrical", "Cleaning", "Supplies", "Painting", "Security", "Water", "Common Area", "Other"].map((c) => <option key={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Building</label>
                        <select value={expenseBuilding} onChange={(e) => setExpenseBuilding(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            <option value="">General (All Buildings)</option>
                            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description *</label>
                        <textarea required value={expenseDesc} onChange={(e) => setExpenseDesc(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="What was the expense for?" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Date</label>
                        <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Receipt Photo (Optional)</label>
                        <input type="file" accept="image/*,.pdf" onChange={(e) => setExpenseReceipt(e.target.files?.[0] || null)} className="w-full text-sm text-gray-500" />
                    </div>
                    {isUploading && <UploadProgressBar progress={uploadProgress} />}
                    <div className="flex gap-2 pt-2">
                        <button type="button" onClick={() => setIsExpenseModalOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                        <button type="submit" disabled={isSubmittingExpense || isUploading} className="flex-1 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:bg-amber-400">{isSubmittingExpense ? "Saving..." : "Log Expense"}</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
