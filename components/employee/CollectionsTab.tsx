/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { doc, updateDoc, addDoc, getDocs, collection, query, where, deleteField } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Invoice, Unit } from "@/types";
import { buildTransactionId, type PaymentMode } from "@/lib/payments";

interface CollectionsTabProps {
    allInvoices: Invoice[];
    occupiedUnits: Unit[];
    electricityRate: number;
    openTenantProfile: (unit: Unit) => void;
}

export function CollectionsTab({ allInvoices, occupiedUnits, electricityRate, openTenantProfile }: CollectionsTabProps) {
    const [collectionFilter, setCollectionFilter] = useState("all");
    const [isSettling, setIsSettling] = useState("");

    const [isEditInvoiceOpen, setIsEditInvoiceOpen] = useState(false);
    const [editInvoice, setEditInvoice] = useState<any>(null);

    // Settle modal (mark as paid with reference)
    const [settleInvoice, setSettleInvoice] = useState<Invoice | null>(null);
    const [settleMode, setSettleMode] = useState<PaymentMode>("cash");
    const [settleReference, setSettleReference] = useState("");
    const [settleNote, setSettleNote] = useState("");
    const [editInvBaseRent, setEditInvBaseRent] = useState("");
    const [editInvElecRate, setEditInvElecRate] = useState("");
    const [editInvUnitsConsumed, setEditInvUnitsConsumed] = useState("");
    const [editInvPrevReading, setEditInvPrevReading] = useState("");
    const [editInvCurrReading, setEditInvCurrReading] = useState("");
    const [editInvBillingMonth, setEditInvBillingMonth] = useState("");
    const [isSavingInvoice, setIsSavingInvoice] = useState(false);

    const isOverdue = (billingPeriod?: string) => {
        if (!billingPeriod) return false;
        const now = new Date();
        const periodDate = new Date(billingPeriod);
        return periodDate.getFullYear() < now.getFullYear() || (periodDate.getFullYear() === now.getFullYear() && periodDate.getMonth() < now.getMonth());
    };

    const pendingInvoices = allInvoices.filter(inv => inv.status === "unpaid" || inv.status === "pending");
    const periods = [...new Set(pendingInvoices.map(inv => inv.billingPeriod).filter(Boolean))].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    const filteredInvoices = collectionFilter === "all"
        ? pendingInvoices
        : collectionFilter === "overdue"
        ? pendingInvoices.filter(inv => isOverdue(inv.billingPeriod))
        : pendingInvoices.filter(inv => inv.billingPeriod === collectionFilter);
    const totalPendingRent = filteredInvoices.reduce((sum, inv) => sum + Number(inv.baseRent || 0), 0);
    const totalPendingElec = filteredInvoices.reduce((sum, inv) => sum + Number(inv.electricityCharge || 0), 0);

    const overdueCount = pendingInvoices.filter(inv => isOverdue(inv.billingPeriod)).length;
    const overdueAmount = pendingInvoices.filter(inv => isOverdue(inv.billingPeriod)).reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);

    const openSettleModal = (inv: Invoice) => {
        setSettleInvoice(inv);
        setSettleMode("cash");
        setSettleReference("");
        setSettleNote("");
    };

    const handleConfirmSettle = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!settleInvoice) return;
        const inv = settleInvoice;
        setIsSettling(inv.id);
        try {
            const txnId = buildTransactionId(settleMode, settleReference);
            await updateDoc(doc(db, "invoices", inv.id), {
                status: "paid",
                paidAt: new Date().toISOString(),
                transactionId: txnId,
                ...(settleNote.trim() ? { paymentNote: settleNote.trim() } : {}),
            });
            const invoiceAmount = Number(inv.totalAmount || 0);
            const amountPaid = Number(inv.amountPaid || invoiceAmount);
            await addDoc(collection(db, "ledger"), {
                tenantEmail: inv.tenantEmail,
                unitId: inv.unitId,
                unitNumber: inv.unitNumber,
                invoiceId: inv.id,
                billingPeriod: inv.billingPeriod || "Ad-Hoc",
                invoiceAmount,
                amountPaid,
                balance: amountPaid - invoiceAmount,
                transactionId: txnId,
                paymentMode: settleMode,
                paymentReference: settleReference.trim() || null,
                paymentNote: settleNote.trim() || null,
                type: "payment",
                settledBy: "employee",
                createdAt: new Date().toISOString(),
            });
            setSettleInvoice(null);
        } catch (error) {
            console.error(error);
            alert("Failed to settle invoice.");
        } finally {
            setIsSettling("");
        }
    };

    const openEditInvoice = (inv: Invoice) => {
        setEditInvoice(inv);
        setEditInvBaseRent(String(inv.baseRent || 0));
        setEditInvElecRate(String(inv.electricityRate || electricityRate));
        setEditInvUnitsConsumed(String(inv.electricityConsumed || 0));
        setEditInvPrevReading(String(inv.previousReading || 0));
        setEditInvCurrReading(String(inv.currentReading || 0));
        setEditInvBillingMonth(inv.billingPeriod || "");
        setIsEditInvoiceOpen(true);
    };

    const handleSaveInvoice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editInvoice) return;
        setIsSavingInvoice(true);
        try {
            const baseRent = Number(editInvBaseRent);
            const rate = Number(editInvElecRate);
            const units = Number(editInvUnitsConsumed);
            const prevReading = Number(editInvPrevReading);
            const currReading = Number(editInvCurrReading);
            const electricityCharge = units * rate;

            const ledgerSnap = await getDocs(query(collection(db, "ledger"), where("tenantEmail", "==", editInvoice.tenantEmail)));
            const runningBalance = ledgerSnap.docs.reduce((sum: number, d: any) => sum + Number(d.data().balance || 0), 0);
            const carryForward = -runningBalance;
            const totalAmount = Math.max(0, baseRent + electricityCharge + carryForward);

            await updateDoc(doc(db, "invoices", editInvoice.id), {
                baseRent,
                electricityRate: rate,
                electricityConsumed: units,
                previousReading: prevReading,
                currentReading: currReading,
                electricityCharge,
                billingPeriod: editInvBillingMonth,
                ...(carryForward !== 0 ? { carryForward } : { carryForward: deleteField() }),
                totalAmount,
            });

            if (editInvoice.unitId && currReading !== Number(editInvoice.currentReading || 0)) {
                await updateDoc(doc(db, "units", editInvoice.unitId), { lastMeterReading: currReading });
            }

            alert("Invoice updated!\n\nRent: \u20B9" + baseRent + "\nElectricity: " + units + " \u00D7 \u20B9" + rate + " = \u20B9" + electricityCharge + "\nTotal: \u20B9" + totalAmount);
            setIsEditInvoiceOpen(false);
            setEditInvoice(null);
        } catch (error) {
            console.error(error);
            alert("Failed to update invoice.");
        } finally {
            setIsSavingInvoice(false);
        }
    };

    return (
        <>
            <div className="space-y-4">
                <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Billing Period</label>
                    <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg font-medium">
                        <option value="all">All Pending ({pendingInvoices.length})</option>
                        {overdueCount > 0 && <option value="overdue">{"\u26A0\uFE0F"} Overdue ({overdueCount})</option>}
                        {periods.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                        <p className="text-xs font-bold text-red-600 uppercase">Pending Rent</p>
                        <p className="text-xl font-bold text-red-800 mt-1">{"\u20B9"}{totalPendingRent.toLocaleString()}</p>
                    </div>
                    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                        <p className="text-xs font-bold text-yellow-600 uppercase">Pending Electricity</p>
                        <p className="text-xl font-bold text-yellow-800 mt-1">{"\u20B9"}{totalPendingElec.toLocaleString()}</p>
                    </div>
                </div>

                {overdueCount > 0 && (
                    <button onClick={() => setCollectionFilter("overdue")} className="w-full bg-red-100 border-2 border-red-300 rounded-xl p-3 flex justify-between items-center hover:bg-red-200 transition">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">{"\u26A0\uFE0F"}</span>
                            <div className="text-left">
                                <p className="text-xs font-bold text-red-800">{overdueCount} Overdue Invoice{overdueCount > 1 ? "s" : ""}</p>
                                <p className="text-[10px] text-red-600">Past billing period, still unpaid</p>
                            </div>
                        </div>
                        <p className="font-bold text-red-800">{"\u20B9"}{overdueAmount.toLocaleString()}</p>
                    </button>
                )}

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex justify-between items-center">
                        <h3 className="text-sm font-bold text-gray-800">Pending Invoices</h3>
                        <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">{filteredInvoices.length} pending</span>
                    </div>
                    <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                        {filteredInvoices.length === 0 ? (
                            <p className="p-6 text-sm text-gray-500 text-center">{"\uD83C\uDF89"} No pending invoices!</p>
                        ) : filteredInvoices.map(inv => {
                                const overdue = isOverdue(inv.billingPeriod);
                                return (
                                    <div key={inv.id} className={`px-5 py-4 flex justify-between items-center ${overdue ? "bg-red-50 hover:bg-red-100 border-l-4 border-l-red-400" : "hover:bg-gray-50"}`}>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <p className="font-bold text-gray-900">{inv.unitNumber}</p>
                                                {overdue && <span className="text-[9px] font-bold bg-red-200 text-red-800 px-1.5 py-0.5 rounded">OVERDUE</span>}
                                            </div>
                                            <p className="text-xs text-gray-500">{inv.tenantEmail}</p>
                                            <p className={`text-xs font-medium mt-0.5 ${overdue ? "text-red-600" : "text-indigo-600"}`}>{inv.billingPeriod}</p>
                                            <button onClick={() => { const unit = occupiedUnits.find(u => u.id === inv.unitId); if (unit) openTenantProfile(unit); }} className="text-[10px] text-indigo-600 hover:underline mt-1">View Profile {"\u2192"}</button>
                                        </div>
                                        <div className="text-right flex flex-col items-end gap-2">
                                            <div>
                                                <p className={`font-bold ${overdue ? "text-red-700" : "text-gray-900"}`}>{"\u20B9"}{Number(inv.totalAmount || 0).toLocaleString()}</p>
                                                <p className="text-[10px] text-gray-400">Rent: {"\u20B9"}{inv.baseRent || 0} | Elec: {"\u20B9"}{inv.electricityCharge || 0}</p>
                                            </div>
                                            <div className="flex gap-1.5">
                                                <button onClick={() => openEditInvoice(inv)} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition">{"\u270F\uFE0F"} Edit</button>
                                                <button onClick={() => openSettleModal(inv)} disabled={isSettling === inv.id} className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-md font-bold hover:bg-green-700 disabled:bg-green-400 transition">
                                                    {isSettling === inv.id ? "..." : "\u2713 Settle"}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        }
                    </div>
                </div>
            </div>

            {isEditInvoiceOpen && editInvoice && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setIsEditInvoiceOpen(false)}>
                    <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800">{"\u270F\uFE0F"} Edit Invoice</h3>
                        <p className="text-xs text-gray-500">{editInvoice.unitNumber} {"\u2014"} {editInvBillingMonth}</p>
                        <form onSubmit={handleSaveInvoice} className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Billing Month / Period</label>
                                <input type="text" required value={editInvBillingMonth} onChange={(e) => setEditInvBillingMonth(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. August 2026" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Base Rent ({"\u20B9"})</label>
                                <input type="number" required min="0" value={editInvBaseRent} onChange={(e) => setEditInvBaseRent(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Prev Reading</label>
                                    <input type="number" min="0" value={editInvPrevReading} onChange={(e) => setEditInvPrevReading(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Curr Reading</label>
                                    <input type="number" min="0" value={editInvCurrReading} onChange={(e) => setEditInvCurrReading(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Units Consumed</label>
                                    <input type="number" required min="0" value={editInvUnitsConsumed} onChange={(e) => setEditInvUnitsConsumed(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Rate ({"\u20B9"}/unit)</label>
                                    <input type="number" required min="0" value={editInvElecRate} onChange={(e) => setEditInvElecRate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                </div>
                            </div>
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-1">
                                <p><strong>Electricity:</strong> {Number(editInvUnitsConsumed) || 0} {"\u00D7"} {"\u20B9"}{Number(editInvElecRate) || 0} = {"\u20B9"}{((Number(editInvUnitsConsumed) || 0) * (Number(editInvElecRate) || 0)).toLocaleString()}</p>
                                <p><strong>Estimated Total:</strong> {"\u20B9"}{((Number(editInvBaseRent) || 0) + (Number(editInvUnitsConsumed) || 0) * (Number(editInvElecRate) || 0)).toLocaleString()} <span className="text-gray-400">(+ carry-forward)</span></p>
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button type="button" onClick={() => setIsEditInvoiceOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                                <button type="submit" disabled={isSavingInvoice} className="flex-1 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-blue-400">{isSavingInvoice ? "Saving..." : "Save Changes"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {settleInvoice && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSettleInvoice(null)}>
                    <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
                        <div>
                            <h3 className="text-lg font-bold text-gray-800">{"\u2713"} Mark as Paid</h3>
                            <p className="text-xs text-gray-500 mt-0.5">{settleInvoice.unitNumber} {"\u2014"} {settleInvoice.billingPeriod} {"\u2014"} {"\u20B9"}{Number(settleInvoice.totalAmount || 0).toLocaleString()}</p>
                        </div>
                        <form onSubmit={handleConfirmSettle} className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Payment Mode</label>
                                <div className="grid grid-cols-5 gap-1">
                                    {(["cash", "upi", "bank", "cheque", "other"] as const satisfies readonly PaymentMode[]).map(m => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => setSettleMode(m)}
                                            className={`px-2 py-2 rounded-md text-xs font-bold border transition ${settleMode === m ? "bg-green-600 text-white border-green-700" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
                                        >
                                            {m.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {settleMode !== "cash" && (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                        {settleMode === "upi" ? "UPI Txn ID" : settleMode === "bank" ? "Bank Ref No." : settleMode === "cheque" ? "Cheque No." : "Reference"}
                                    </label>
                                    <input
                                        type="text"
                                        value={settleReference}
                                        onChange={(e) => setSettleReference(e.target.value)}
                                        placeholder={settleMode === "upi" ? "e.g. 4XXXXXX8291" : settleMode === "cheque" ? "e.g. 000123" : "Reference / transaction id"}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                    />
                                </div>
                            )}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Note (optional)</label>
                                <input
                                    type="text"
                                    value={settleNote}
                                    onChange={(e) => setSettleNote(e.target.value)}
                                    placeholder="e.g. paid to owner directly"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button type="button" onClick={() => setSettleInvoice(null)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                                <button type="submit" disabled={isSettling === settleInvoice.id} className="flex-1 py-2 bg-green-600 text-white rounded-md text-sm font-bold hover:bg-green-700 disabled:bg-green-400">
                                    {isSettling === settleInvoice.id ? "Settling..." : "\u2713 Confirm Paid"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
