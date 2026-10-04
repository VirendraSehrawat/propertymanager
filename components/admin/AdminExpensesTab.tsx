"use client";

import { useState } from "react";
import { collection, addDoc, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { EXPENSE_CATEGORIES, categoryEmoji } from "@/lib/expenses";
import type { Expense } from "@/types";

interface AdminExpensesTabProps {
    expenses: Expense[];
    currentUserEmail: string;
}

export function AdminExpensesTab({ expenses, currentUserEmail }: AdminExpensesTabProps) {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [expenseAmount, setExpenseAmount] = useState("");
    const [expenseCategory, setExpenseCategory] = useState("Maintenance");
    const [expenseDesc, setExpenseDesc] = useState("");
    const [expenseDate, setExpenseDate] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleAddExpense = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!expenseAmount || !expenseDesc) return;
        setIsSubmitting(true);
        try {
            const amt = Number(expenseAmount);
            const dateStr = expenseDate || new Date().toISOString().split('T')[0];
            const nowIso = new Date().toISOString();

            // 1) Write expense doc
            const expenseRef = await addDoc(collection(db, "expenses"), {
                amount: amt,
                category: expenseCategory,
                description: expenseDesc,
                date: dateStr,
                buildingId: "",
                buildingName: "General",
                createdBy: currentUserEmail || "admin",
                createdAt: nowIso,
            });

            // 2) Mirror to dailyLedger
            try {
                const ledgerRef = await addDoc(collection(db, "dailyLedger"), {
                    direction: "outflow",
                    category: (expenseCategory || "other").toLowerCase(),
                    date: dateStr,
                    buildingId: "",
                    buildingName: "General",
                    unitId: "",
                    unitNumber: "",
                    tenantName: "",
                    amount: amt,
                    description: expenseDesc,
                    expenseId: expenseRef.id,
                    source: "admin-expense",
                    createdBy: currentUserEmail || "admin",
                    createdAt: nowIso,
                });
                await updateDoc(doc(db, "expenses", expenseRef.id), {
                    dailyLedgerId: ledgerRef.id,
                    source: "admin-expense"
                });
            } catch (mirrorErr) {
                console.warn("Daily-ledger mirror write failed", mirrorErr);
            }

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

    const handleDeleteExpense = async (id: string) => {
        if (window.confirm("Delete this expense record?")) {
            await deleteDoc(doc(db, "expenses", id));
        }
    };

    const totalExpenseSum = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">💸 Property Expenses</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Total spent: ₹{totalExpenseSum.toLocaleString()} across {expenses.length} records</p>
                </div>
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition"
                >
                    + Record Expense
                </button>
            </div>

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
                            {expenses.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                                        No expense records logged yet.
                                    </td>
                                </tr>
                            ) : (
                                expenses.map(exp => (
                                    <tr key={exp.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 font-medium text-gray-900">{exp.date}</td>
                                        <td className="px-4 py-3">
                                            <span className="inline-flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded text-[11px] font-bold text-gray-700">
                                                {categoryEmoji(exp.category)} {exp.category}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">{exp.description}</td>
                                        <td className="px-4 py-3 text-right font-bold text-rose-600">₹{Number(exp.amount || 0).toLocaleString()}</td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                onClick={() => handleDeleteExpense(exp.id)}
                                                className="text-red-400 hover:text-red-600 font-bold"
                                            >
                                                ✕
                                            </button>
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
