"use client";

import { useState } from "react";
import type { LedgerEntry, Unit } from "@/types";

interface LedgerTabProps {
    allLedgerEntries: LedgerEntry[];
    occupiedUnits: Unit[];
}

export function LedgerTab({ allLedgerEntries, occupiedUnits }: LedgerTabProps) {
    const [ledgerFilter, setLedgerFilter] = useState("");

    const filtered = ledgerFilter ? allLedgerEntries.filter(e => e.tenantEmail === ledgerFilter) : allLedgerEntries;
    const tenantBalances: Record<string, { email: string; unitNumber: string; balance: number; count: number }> = {};
    filtered.forEach(entry => {
        if (!tenantBalances[entry.tenantEmail]) tenantBalances[entry.tenantEmail] = { email: entry.tenantEmail, unitNumber: entry.unitNumber, balance: 0, count: 0 };
        tenantBalances[entry.tenantEmail].balance += Number(entry.balance || 0);
        tenantBalances[entry.tenantEmail].count++;
    });

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-teal-50 px-5 py-4 border-b border-teal-200">
                <h2 className="text-lg font-bold text-teal-800">📒 Tenant Payment Ledger</h2>
            </div>
            <div className="p-5 space-y-4">
                <select value={ledgerFilter} onChange={(e) => setLedgerFilter(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                    <option value="">All Tenants</option>
                    {[...new Set(allLedgerEntries.map(e => e.tenantEmail))].map(email => {
                        const u = occupiedUnits.find(u => u.tenantEmail === email);
                        return <option key={email} value={email}>{u ? u.unitNumber + " - " : ""}{email}</option>;
                    })}
                </select>

                {filtered.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">No payment records yet.</p>
                ) : !ledgerFilter ? (
                    <div className="space-y-2">
                        {Object.values(tenantBalances).map(t => (
                            <div key={t.email} className="flex justify-between items-center border border-gray-100 p-3 rounded-md bg-gray-50 hover:bg-gray-100 cursor-pointer" onClick={() => setLedgerFilter(t.email)}>
                                <div><p className="font-medium text-gray-800 text-sm">{t.unitNumber}</p><p className="text-xs text-gray-500">{t.email}</p></div>
                                <div className="text-right"><span className={`font-bold text-sm ${t.balance >= 0 ? "text-green-700" : "text-red-700"}`}>{t.balance >= 0 ? `₹${t.balance} CR` : `₹${Math.abs(t.balance)} DUE`}</span><p className="text-[10px] text-gray-400">{t.count} payments</p></div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div>
                        <div className={`mb-3 p-3 rounded-lg border ${tenantBalances[ledgerFilter]?.balance >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                            <div className="flex justify-between items-center">
                                <span className="text-sm font-medium">Net Balance</span>
                                <span className={`font-bold ${tenantBalances[ledgerFilter]?.balance >= 0 ? "text-green-700" : "text-red-700"}`}>
                                    {tenantBalances[ledgerFilter]?.balance >= 0 ? `₹${tenantBalances[ledgerFilter]?.balance} Credit` : `₹${Math.abs(tenantBalances[ledgerFilter]?.balance || 0)} Due`}
                                </span>
                            </div>
                        </div>
                        <button onClick={() => setLedgerFilter("")} className="text-xs text-blue-600 hover:underline mb-2">← Back to all tenants</button>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b text-gray-500">
                                        <th className="pb-1 text-left">Date</th>
                                        <th className="pb-1 text-left">Period</th>
                                        <th className="pb-1 text-right">Invoice</th>
                                        <th className="pb-1 text-right">Paid</th>
                                        <th className="pb-1 text-right">Bal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(entry => (
                                        <tr key={entry.id} className="border-b border-gray-100">
                                            <td className="py-1.5">{new Date(entry.createdAt).toLocaleDateString()}</td>
                                            <td className="py-1.5">{entry.billingPeriod}</td>
                                            <td className="py-1.5 text-right">₹{entry.invoiceAmount}</td>
                                            <td className="py-1.5 text-right text-green-700">₹{entry.amountPaid}</td>
                                            <td className={`py-1.5 text-right font-bold ${Number(entry.balance) >= 0 ? "text-green-700" : "text-red-700"}`}>
                                                {Number(entry.balance) >= 0 ? "+" : ""}₹{entry.balance}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
