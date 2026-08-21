"use client";

import { useState } from "react";
import { doc, updateDoc, addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Invoice, Unit } from "@/types";

interface CollectionsTabProps {
    allInvoices: Invoice[];
    occupiedUnits: Unit[];
    openTenantProfile: (unit: Unit) => void;
}

export function CollectionsTab({ allInvoices, occupiedUnits, openTenantProfile }: CollectionsTabProps) {
    const [collectionFilter, setCollectionFilter] = useState("all");
    const [isSettling, setIsSettling] = useState("");

    const pendingInvoices = allInvoices.filter(inv => inv.status === "unpaid" || inv.status === "pending");
    const periods = [...new Set(pendingInvoices.map(inv => inv.billingPeriod).filter(Boolean))].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    const filteredInvoices = collectionFilter === "all" ? pendingInvoices : pendingInvoices.filter(inv => inv.billingPeriod === collectionFilter);
    const totalPendingRent = filteredInvoices.reduce((sum, inv) => sum + Number(inv.baseRent || 0), 0);
    const totalPendingElec = filteredInvoices.reduce((sum, inv) => sum + Number(inv.electricityCharge || 0), 0);

    const handleSettleInvoice = async (invId: string) => {
        if (!window.confirm("Mark this invoice as paid (cash collected)?")) return;
        setIsSettling(invId);
        try {
            const inv = allInvoices.find(i => i.id === invId);
            await updateDoc(doc(db, "invoices", invId), { status: "paid", paidAt: new Date().toISOString(), transactionId: "CASH_COLLECTED" });
            if (inv) {
                const invoiceAmount = Number(inv.totalAmount || 0);
                const amountPaid = Number(inv.amountPaid || invoiceAmount);
                await addDoc(collection(db, "ledger"), {
                    tenantEmail: inv.tenantEmail,
                    unitId: inv.unitId,
                    unitNumber: inv.unitNumber,
                    invoiceId: invId,
                    billingPeriod: inv.billingPeriod || "Ad-Hoc",
                    invoiceAmount,
                    amountPaid,
                    balance: amountPaid - invoiceAmount,
                    transactionId: "CASH_COLLECTED",
                    type: "payment",
                    settledBy: "employee",
                    createdAt: new Date().toISOString(),
                });
            }
        } catch (error) {
            console.error(error);
            alert("Failed to settle invoice.");
        } finally {
            setIsSettling("");
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Billing Period</label>
                <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg font-medium">
                    <option value="all">All Pending ({pendingInvoices.length})</option>
                    {periods.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                    <p className="text-xs font-bold text-red-600 uppercase">Pending Rent</p>
                    <p className="text-xl font-bold text-red-800 mt-1">₹{totalPendingRent.toLocaleString()}</p>
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                    <p className="text-xs font-bold text-yellow-600 uppercase">Pending Electricity</p>
                    <p className="text-xl font-bold text-yellow-800 mt-1">₹{totalPendingElec.toLocaleString()}</p>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex justify-between items-center">
                    <h3 className="text-sm font-bold text-gray-800">Pending Invoices</h3>
                    <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">{filteredInvoices.length} pending</span>
                </div>
                <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                    {filteredInvoices.length === 0 ? (
                        <p className="p-6 text-sm text-gray-500 text-center">🎉 No pending invoices!</p>
                    ) : (
                        filteredInvoices.map(inv => (
                            <div key={inv.id} className="px-5 py-4 flex justify-between items-center hover:bg-gray-50">
                                <div>
                                    <p className="font-bold text-gray-900">{inv.unitNumber}</p>
                                    <p className="text-xs text-gray-500">{inv.tenantEmail}</p>
                                    <p className="text-xs text-indigo-600 font-medium mt-0.5">{inv.billingPeriod}</p>
                                    <button onClick={() => { const unit = occupiedUnits.find(u => u.id === inv.unitId); if (unit) openTenantProfile(unit); }} className="text-[10px] text-indigo-600 hover:underline mt-1">View Profile →</button>
                                </div>
                                <div className="text-right flex flex-col items-end gap-2">
                                    <div>
                                        <p className="font-bold text-gray-900">₹{Number(inv.totalAmount || 0).toLocaleString()}</p>
                                        <p className="text-[10px] text-gray-400">Rent: ₹{inv.baseRent || 0} | Elec: ₹{inv.electricityCharge || 0}</p>
                                    </div>
                                    <button
                                        onClick={() => handleSettleInvoice(inv.id)}
                                        disabled={isSettling === inv.id}
                                        className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-md font-bold hover:bg-green-700 disabled:bg-green-400 transition"
                                    >
                                        {isSettling === inv.id ? "..." : "✓ Settle"}
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
