"use client";

import { useState } from "react";
import { collection, doc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { EXPENSE_CATEGORIES, categoryEmoji } from "@/lib/expenses";
import { buildExpenseWrite, closedDayError, orphanedExpenseMirrors, softDeletePatch, todayLocal, type MirrorRow } from "@/lib/expenseWrite";
import type { DayClose } from "@/lib/dayClose";
import type { Expense } from "@/types";

interface AdminExpensesTabProps {
    /** Every expense doc, including soft-deleted ones (shown only with "Show deleted"). */
    expenses: Expense[];
    /** Daily-ledger rows — used to find outflows whose expense no longer exists. */
    dailyLedgerEntries?: MirrorRow[];
    /** End-of-day closes — expenses can't be added to or deleted from a closed day. */
    dayCloses?: DayClose[];
    currentUserEmail: string;
}

export function AdminExpensesTab({ expenses: allExpenses, dailyLedgerEntries = [], dayCloses = [], currentUserEmail }: AdminExpensesTabProps) {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [expenseAmount, setExpenseAmount] = useState("");
    const [expenseCategory, setExpenseCategory] = useState("Maintenance");
    const [expenseDesc, setExpenseDesc] = useState("");
    const [expenseDate, setExpenseDate] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showDeleted, setShowDeleted] = useState(false);
    const [isFixingOrphans, setIsFixingOrphans] = useState(false);

    const by = currentUserEmail || "admin";
    // Totals never include soft-deleted expenses; the list shows them only on request.
    const expenses = allExpenses.filter(e => !e.deleted);
    const deletedCount = allExpenses.length - expenses.length;
    const listed = showDeleted ? allExpenses : expenses;
    const orphans = orphanedExpenseMirrors(dailyLedgerEntries, allExpenses);

    // Expense + Daily-ledger mirror in ONE batch with pre-minted, cross-linked ids.
    const handleAddExpense = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!expenseAmount || !expenseDesc) return;
        const dateStr = expenseDate || todayLocal();
        const closed = closedDayError(dateStr, dayCloses);
        if (closed) { alert(closed); return; }
        setIsSubmitting(true);
        try {
            const expenseRef = doc(collection(db, "expenses"));
            const ledgerRef = doc(collection(db, "dailyLedger"));
            const { expense, ledger } = buildExpenseWrite({
                expenseId: expenseRef.id,
                ledgerId: ledgerRef.id,
                amount: Number(expenseAmount),
                category: expenseCategory,
                description: expenseDesc,
                date: dateStr,
                createdBy: by,
                now: new Date().toISOString(),
                source: "admin-expense",
            });
            const batch = writeBatch(db);
            batch.set(expenseRef, expense);
            batch.set(ledgerRef, ledger);
            await batch.commit();

            setIsAddModalOpen(false);
            setExpenseAmount("");
            setExpenseDesc("");
            setExpenseCategory("Maintenance");
            setExpenseDate("");
        } catch (error) {
            console.error("Failed to add expense:", error);
            alert("Failed to add expense.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Soft delete with a reason, cascading to the Daily-ledger mirror (same as the employee tab).
    const handleDeleteExpense = async (exp: Expense) => {
        const closed = closedDayError(exp.date, dayCloses);
        if (closed) { alert(closed); return; }
        const reason = window.prompt(`Delete expense "${exp.description}" (₹${Number(exp.amount).toLocaleString()})?\n\nPlease provide a reason (required):`, "");
        if (reason === null) return;
        if (!reason.trim()) { alert("A reason is required to delete an expense."); return; }
        try {
            const patch = softDeletePatch(by, reason, new Date().toISOString());
            const batch = writeBatch(db);
            batch.update(doc(db, "expenses", exp.id), patch);
            if (exp.dailyLedgerId) batch.update(doc(db, "dailyLedger", exp.dailyLedgerId), patch);
            await batch.commit();
        } catch (error) {
            console.error("Failed to delete expense:", error);
            alert("Failed to delete expense.");
        }
    };

    // One-off repair: Daily-ledger outflows left behind by hard-deleted expenses.
    const handleFixOrphans = async () => {
        if (!window.confirm(`Remove ${orphans.length} Daily-ledger outflow${orphans.length !== 1 ? "s" : ""} whose expense was deleted? They are soft-deleted with a reason, not erased.`)) return;
        setIsFixingOrphans(true);
        try {
            const patch = softDeletePatch(by, "Expense was deleted — orphaned Daily-ledger mirror", new Date().toISOString());
            const batch = writeBatch(db);
            orphans.forEach(r => batch.update(doc(db, "dailyLedger", r.id), patch));
            await batch.commit();
        } catch (error) {
            console.error("Failed to clean up orphaned rows:", error);
            alert("Failed to clean up the Daily ledger.");
        } finally {
            setIsFixingOrphans(false);
        }
    };

    const totalExpenseSum = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">💸 Property Expenses</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Total spent: ₹{totalExpenseSum.toLocaleString()} across {expenses.length} records</p>
                    {deletedCount > 0 && (
                        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
                            Show {deletedCount} deleted (not counted)
                        </label>
                    )}
                </div>
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition"
                >
                    + Record Expense
                </button>
            </div>

            {orphans.length > 0 && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex justify-between items-center gap-3">
                    <div className="text-xs text-amber-900 min-w-0">
                        <p className="font-bold">⚠️ {orphans.length} Daily-ledger outflow{orphans.length !== 1 ? "s" : ""} (₹{orphans.reduce((s, r) => s + Number(r.amount || 0), 0).toLocaleString()}) belong to deleted expenses</p>
                        <p className="text-[11px] text-amber-800 truncate">They still reduce the Daily totals and day closes: {orphans.slice(0, 3).map(r => `${r.date} ${r.description || ""} ₹${Number(r.amount || 0).toLocaleString()}`).join(" · ")}{orphans.length > 3 ? " …" : ""}</p>
                    </div>
                    <button onClick={handleFixOrphans} disabled={isFixingOrphans} className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50">
                        {isFixingOrphans ? "Fixing…" : "Remove from Daily ledger"}
                    </button>
                </div>
            )}

            {/* Category Breakdown Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {EXPENSE_CATEGORIES.map(cat => {
                    const catTotal = expenses
                        .filter(e => (e.category || "").toLowerCase() === cat.value.toLowerCase())
                        .reduce((sum, e) => sum + Number(e.amount || 0), 0);
                    return (
                        <div key={cat.value} className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                            <span className="text-xl">{cat.emoji}</span>
                            <p className="text-[11px] font-bold text-gray-700 mt-1">{cat.value}</p>
                            <p className="text-xs font-black text-rose-600 mt-0.5">₹{catTotal.toLocaleString()}</p>
                        </div>
                    );
                })}
            </div>

            {/* Expenses List Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-gray-600">
                        <thead className="bg-gray-50 text-gray-500 uppercase font-bold border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3">Date</th>
                                <th className="px-4 py-3">Category</th>
                                <th className="px-4 py-3">Description</th>
                                <th className="px-4 py-3 text-right">Amount</th>
                                <th className="px-4 py-3 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {listed.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                                        No expense records logged yet.
                                    </td>
                                </tr>
                            ) : (
                                listed.map(exp => (
                                    <tr key={exp.id} className={exp.deleted ? "bg-gray-50 text-gray-400" : "hover:bg-gray-50"}>
                                        <td className="px-4 py-3 font-medium text-gray-900">{exp.date}</td>
                                        <td className="px-4 py-3">
                                            <span className="inline-flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded text-[11px] font-bold text-gray-700">
                                                {categoryEmoji(exp.category)} {exp.category}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={exp.deleted ? "line-through" : ""}>{exp.description}</span>
                                            {exp.deleted && (
                                                <span className="block text-[10px] text-gray-500">
                                                    Deleted by {exp.deletedBy}{exp.deletedAt ? ` · ${new Date(exp.deletedAt).toLocaleDateString("en-IN")}` : ""}{exp.deleteReason ? ` — ${exp.deleteReason}` : ""}
                                                </span>
                                            )}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-bold ${exp.deleted ? "line-through" : "text-rose-600"}`}>₹{Number(exp.amount || 0).toLocaleString()}</td>
                                        <td className="px-4 py-3 text-center">
                                            {!exp.deleted && (
                                                <button
                                                    onClick={() => handleDeleteExpense(exp)}
                                                    title="Delete with reason"
                                                    className="text-red-400 hover:text-red-600 font-bold"
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add Expense Modal */}
            {isAddModalOpen && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-base font-bold text-gray-900">Record Property Expense</h3>
                            <button onClick={() => setIsAddModalOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <form onSubmit={handleAddExpense} className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Amount (₹)</label>
                                <input
                                    type="number"
                                    required
                                    min="1"
                                    placeholder="e.g. 1500"
                                    value={expenseAmount}
                                    onChange={(e) => setExpenseAmount(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-rose-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Category</label>
                                <select
                                    value={expenseCategory}
                                    onChange={(e) => setExpenseCategory(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-rose-500"
                                >
                                    {EXPENSE_CATEGORIES.map(cat => (
                                        <option key={cat.value} value={cat.value}>{cat.emoji} {cat.value}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Date</label>
                                <input
                                    type="date"
                                    value={expenseDate}
                                    onChange={(e) => setExpenseDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-rose-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Description / Vendor</label>
                                <textarea
                                    required
                                    placeholder="Describe expense details or vendor name..."
                                    rows={3}
                                    value={expenseDesc}
                                    onChange={(e) => setExpenseDesc(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-rose-500 resize-none"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-3">
                                <button
                                    type="button"
                                    onClick={() => setIsAddModalOpen(false)}
                                    className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition disabled:opacity-50"
                                >
                                    {isSubmitting ? "Saving..." : "Save Expense"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
