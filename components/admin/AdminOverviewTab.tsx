"use client";

import type { Invoice, Expense } from "@/types";

interface AdminOverviewTabProps {
    paidInvoices: Invoice[];
    unpaidInvoices: Invoice[];
    pendingInvoices: Invoice[];
    expenses: Expense[];
    dashboardMonth: string;
    setDashboardMonth: (m: string) => void;
    dashboardPeriods: string[];
    exportMonth: string;
    setExportMonth: (m: string) => void;
    handleExportFinancials: () => void;
    isExporting: boolean;
}

export function AdminOverviewTab({
    paidInvoices,
    unpaidInvoices,
    pendingInvoices,
    expenses,
    dashboardMonth,
    setDashboardMonth,
    dashboardPeriods,
    exportMonth,
    setExportMonth,
    handleExportFinancials,
    isExporting,
}: AdminOverviewTabProps) {
    const totalIncome = paidInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);
    const totalExpenses = expenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
    const netProfit = totalIncome - totalExpenses;

    const allInvoicesForDashboard = [...paidInvoices, ...unpaidInvoices, ...pendingInvoices];
    const monthInvoices = allInvoicesForDashboard.filter(inv => inv.billingPeriod === dashboardMonth);
    const monthPaid = monthInvoices.filter(inv => inv.status === "paid");
    const monthUnpaid = monthInvoices.filter(inv => inv.status === "unpaid");
    const monthPending = monthInvoices.filter(inv => inv.status === "pending");

    const monthRentExpected = monthInvoices.reduce((sum, inv) => sum + Number(inv.baseRent || 0), 0);
    const monthElecExpected = monthInvoices.reduce((sum, inv) => sum + Number(inv.electricityCharge || 0), 0);
    const monthTotalExpected = monthInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);

    const monthCollected = monthPaid.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);
    const monthPendingAmount = monthUnpaid.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);
    const monthVerificationAmount = monthPending.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);

    return (
        <div className="space-y-6">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                    <p className="text-xs font-bold text-gray-500 uppercase">Total Revenue (All Time)</p>
                    <p className="text-2xl font-black text-emerald-600 mt-2">₹{totalIncome.toLocaleString()}</p>
                    <p className="text-[11px] text-gray-400 mt-1">{paidInvoices.length} settled payments</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                    <p className="text-xs font-bold text-gray-500 uppercase">Total Expenses</p>
                    <p className="text-2xl font-black text-rose-600 mt-2">₹{totalExpenses.toLocaleString()}</p>
                    <p className="text-[11px] text-gray-400 mt-1">{expenses.length} expense records</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                    <p className="text-xs font-bold text-gray-500 uppercase">Net Profit</p>
                    <p className={`text-2xl font-black mt-2 ${netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        ₹{netProfit.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">Revenue minus expenses</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                    <p className="text-xs font-bold text-gray-500 uppercase">Pending Verification</p>
                    <p className="text-2xl font-black text-amber-600 mt-2">₹{monthVerificationAmount.toLocaleString()}</p>
                    <p className="text-[11px] text-gray-400 mt-1">{pendingInvoices.length} invoices awaiting review</p>
                </div>
            </div>

            {/* Monthly Breakdown Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-700 to-indigo-800 px-6 py-4 text-white flex flex-wrap justify-between items-center gap-3">
                    <div>
                        <h2 className="text-lg font-bold">📊 Monthly Financial Summary</h2>
                        <p className="text-xs text-blue-100 mt-0.5">Billing & collection health for selected period</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={dashboardMonth}
                            onChange={(e) => setDashboardMonth(e.target.value)}
                            className="bg-white text-gray-900 text-xs font-semibold px-3 py-1.5 rounded-lg border border-transparent focus:ring-2 focus:ring-white outline-none"
                        >
                            {dashboardPeriods.map(p => (
                                <option key={p} value={p}>{p}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-4">
                            <p className="text-xs font-bold text-blue-700 uppercase">Total Billed</p>
                            <p className="text-xl font-bold text-gray-900 mt-1">₹{monthTotalExpected.toLocaleString()}</p>
                            <p className="text-[11px] text-gray-500 mt-1">Rent: ₹{monthRentExpected.toLocaleString()} · Elec: ₹{monthElecExpected.toLocaleString()}</p>
                        </div>
                        <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-4">
                            <p className="text-xs font-bold text-emerald-700 uppercase">Total Collected</p>
                            <p className="text-xl font-bold text-emerald-800 mt-1">₹{monthCollected.toLocaleString()}</p>
                            <p className="text-[11px] text-gray-500 mt-1">{monthPaid.length} of {monthInvoices.length} invoices paid</p>
                        </div>
                        <div className="bg-rose-50/60 border border-rose-100 rounded-xl p-4">
                            <p className="text-xs font-bold text-rose-700 uppercase">Uncollected / Pending</p>
                            <p className="text-xl font-bold text-rose-800 mt-1">₹{monthPendingAmount.toLocaleString()}</p>
                            <p className="text-[11px] text-gray-500 mt-1">{monthUnpaid.length} invoices remaining</p>
                        </div>
                    </div>

                    {/* Export Financials Bar */}
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-wrap justify-between items-center gap-3">
                        <div>
                            <h4 className="text-sm font-bold text-gray-800">📥 Export Financials (CSV)</h4>
                            <p className="text-xs text-gray-500 mt-0.5">Download consolidated income and expense ledger for tax & accounting</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="month"
                                value={exportMonth}
                                onChange={(e) => setExportMonth(e.target.value)}
                                className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg bg-white outline-none"
                            />
                            <button
                                onClick={handleExportFinancials}
                                disabled={isExporting}
                                className="bg-gray-900 hover:bg-black text-white text-xs font-bold px-4 py-1.5 rounded-lg transition disabled:opacity-50"
                            >
                                {isExporting ? "Exporting..." : "Download CSV"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
