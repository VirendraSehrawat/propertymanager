"use client";

import type { Invoice, Unit, MaintenanceTicket, Expense, LedgerEntry } from "@/types";
import { MonthCollectionsCard } from "./MonthCollectionsCard";

export type HomeTabNavTarget =
    | "home"
    | "active"
    | "resolved"
    | "meter"
    | "collections"
    | "ledger"
    | "daily"
    | "monthly"
    | "units"
    | "occupancy"
    | "checklist"
    | "expenses"
    | "inventory";

interface HomeTabProps {
    allInvoices: Invoice[];
    occupiedUnits: Unit[];
    allUnits: Unit[];
    vacantUnits: Unit[];
    activeTickets: MaintenanceTicket[];
    resolvedTickets: MaintenanceTicket[];
    allExpenses: Expense[];
    allLedgerEntries: LedgerEntry[];
    homeMonth: string;
    setHomeMonth: (m: string) => void;
    onNavigate: (tab: HomeTabNavTarget) => void;
    onOpenTodayCollections: () => void;
    openTenantProfile: (unit: Unit) => void;
}

/**
 * Home / Daily Summary tab — greeting, KPI tiles, monthly collections card,
 * previous-month balance list, quick actions, overdue invoices, meters pending,
 * active tasks preview, and recent activity feed.
 *
 * Extracted from `app/employee/page.tsx` as part of Section 3 step 3 of
 * `docs/REFACTOR_PLAN.md`. Pure presentation — the parent owns all Firestore
 * listeners and the tenant-profile modal.
 */
export function HomeTab({
    allInvoices,
    occupiedUnits,
    allUnits,
    vacantUnits,
    activeTickets,
    resolvedTickets,
    allExpenses,
    allLedgerEntries,
    homeMonth,
    setHomeMonth,
    onNavigate,
    onOpenTodayCollections,
    openTenantProfile,
}: HomeTabProps) {
    const pendingInvoices = allInvoices.filter(inv => inv.status === "unpaid" || inv.status === "pending");
    const totalPendingAmount = pendingInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);

    // Overdue: billing period is a past month
    const now = new Date();
    const overdueInvoices = pendingInvoices.filter(inv => {
        if (!inv.billingPeriod) return false;
        const periodDate = new Date(inv.billingPeriod);
        return periodDate.getFullYear() < now.getFullYear() || (periodDate.getFullYear() === now.getFullYear() && periodDate.getMonth() < now.getMonth());
    });

    // Units without invoices for current month
    const currentMonthName = now.toLocaleString("default", { month: "long", year: "numeric" });
    const unitsWithInvoice = new Set(allInvoices.filter(inv => inv.billingPeriod === currentMonthName).map(inv => inv.unitId));
    const unitsPendingMeter = occupiedUnits.filter(u => !unitsWithInvoice.has(u.id));

    // Today's collections
    const today = now.toISOString().split("T")[0];
    const todayCollections = allInvoices.filter(inv => inv.status === "paid" && inv.paidAt && inv.paidAt.startsWith(today));
    const todayCollectedAmount = todayCollections.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);

    // Previous month balance (relative to selected homeMonth)
    const [yr, mo] = homeMonth.split("-").map(Number);
    const prev = new Date(yr, mo - 2, 1);
    const prevLabel = prev.toLocaleString("default", { month: "long", year: "numeric" });
    const isSameBillingPeriod = (bp: string | undefined) => {
        if (!bp) return false;
        const base = bp.replace(/\s*\(.+\)\s*$/, "").trim();
        return base === prevLabel;
    };
    const outstanding = allInvoices
        .filter(inv => isSameBillingPeriod(inv.billingPeriod))
        .map(inv => {
            const total = Number(inv.totalAmount || 0);
            const paid = Number(inv.amountPaid || 0);
            const remaining = Math.max(0, total - paid);
            return { inv, total, paid, remaining, isPartial: paid > 0 && paid < total, isUnpaid: paid <= 0 && remaining > 0 };
        })
        .filter(x => x.remaining > 0)
        .sort((a, b) => String(a.inv.unitNumber || "").localeCompare(String(b.inv.unitNumber || ""), undefined, { numeric: true, sensitivity: "base" }));
    const totalOutstanding = outstanding.reduce((s, x) => s + x.remaining, 0);

    // Recent activity feed
    const activities: { icon: string; text: string; time: number }[] = [];
    allLedgerEntries.slice(0, 20).forEach(e => activities.push({ icon: "💵", text: `Payment ₹${e.amountPaid} from ${e.unitNumber || "tenant"}`, time: new Date(e.createdAt).getTime() }));
    resolvedTickets.slice(0, 10).forEach(t => activities.push({ icon: "✅", text: `Task resolved: ${t.unitNumber} - ${(t.description || "").slice(0, 30)}`, time: new Date(t.resolvedAt || t.createdAt).getTime() }));
    allExpenses.slice(0, 10).forEach(ex => activities.push({ icon: "🧾", text: `Expense: ${ex.description || ex.category || "item"} ₹${ex.amount}`, time: new Date(ex.date || ex.createdAt).getTime() }));
    activities.sort((a, b) => b.time - a.time);
    const recent = activities.slice(0, 10);

    return (
        <div className="space-y-4">
            {/* Greeting */}
            <div className="bg-linear-to-r from-orange-500 to-amber-500 rounded-xl p-5 text-white shadow-md">
                <h2 className="text-lg font-bold">👋 Good {now.getHours() < 12 ? "Morning" : now.getHours() < 17 ? "Afternoon" : "Evening"}!</h2>
                <p className="text-sm text-orange-100 mt-1">{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 gap-3">
                <button onClick={() => onNavigate("collections")} className="bg-white border border-red-200 rounded-xl p-4 text-left hover:shadow-md transition">
                    <p className="text-[10px] font-bold text-red-600 uppercase">Pending Collections</p>
                    <p className="text-2xl font-bold text-red-800 mt-1">₹{totalPendingAmount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{pendingInvoices.length} invoices</p>
                </button>
                <button type="button" onClick={onOpenTodayCollections} disabled={todayCollections.length === 0} className="bg-white border border-green-200 rounded-xl p-4 text-left hover:shadow-md transition disabled:cursor-default disabled:hover:shadow-none">
                    <p className="text-[10px] font-bold text-green-600 uppercase">Collected Today</p>
                    <p className="text-2xl font-bold text-green-800 mt-1">₹{todayCollectedAmount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{todayCollections.length} payments{todayCollections.length > 0 ? " · tap to view" : ""}</p>
                </button>
                <button onClick={() => onNavigate("active")} className="bg-white border border-orange-200 rounded-xl p-4 text-left hover:shadow-md transition">
                    <p className="text-[10px] font-bold text-orange-600 uppercase">Active Tasks</p>
                    <p className="text-2xl font-bold text-orange-800 mt-1">{activeTickets.length}</p>
                    <p className="text-xs text-gray-500 mt-0.5">maintenance tickets</p>
                </button>
                <button onClick={() => onNavigate("units")} className="bg-white border border-blue-200 rounded-xl p-4 text-left hover:shadow-md transition">
                    <p className="text-[10px] font-bold text-blue-600 uppercase">Occupancy</p>
                    <p className="text-2xl font-bold text-blue-800 mt-1">{occupiedUnits.length}/{allUnits.length}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{vacantUnits.length} vacant</p>
                </button>
            </div>

            {/* MONTHLY COLLECTIONS & PENDING (picker) */}
            <MonthCollectionsCard
                homeMonth={homeMonth}
                setHomeMonth={setHomeMonth}
                allInvoices={allInvoices}
            />

            {/* PREVIOUS MONTH BALANCE */}
            {outstanding.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden">
                    <div className="bg-amber-50 px-4 py-3 border-b border-amber-200 flex justify-between items-center">
                        <div>
                            <h3 className="text-sm font-bold text-amber-800">⚠️ Previous Month Balance — {prevLabel}</h3>
                            <p className="text-[10px] text-amber-600 mt-0.5">{outstanding.length} tenant{outstanding.length !== 1 ? "s" : ""} carrying dues</p>
                        </div>
                        <span className="text-base font-bold text-amber-800">₹{totalOutstanding.toLocaleString()}</span>
                    </div>
                    <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                        {outstanding.map(({ inv, total, paid, remaining, isPartial }) => {
                            const rent = Number(inv.baseRent || 0);
                            const elec = Number(inv.electricityCharge || 0);
                            const rRent = Math.max(0, rent - Math.min(paid, rent));
                            const rElec = Math.max(0, elec - Math.max(0, paid - rent));
                            const u = occupiedUnits.find(x => x.id === inv.unitId);
                            return (
                                <button key={inv.id} onClick={() => { if (u) openTenantProfile(u); }} disabled={!u} className="w-full text-left px-4 py-3 hover:bg-amber-50 transition disabled:cursor-default flex justify-between items-start gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-bold text-gray-900 text-sm">{inv.unitNumber}</span>
                                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${isPartial ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{isPartial ? "Partial" : "Unpaid"}</span>
                                        </div>
                                        <p className="text-[11px] text-gray-600 mt-0.5 truncate">{inv.tenantEmail || "—"}</p>
                                        <p className="text-[10px] text-gray-500 mt-0.5">🏠 Rent ₹{rRent.toLocaleString()} · ⚡ Elec ₹{rElec.toLocaleString()}</p>
                                        {isPartial && <p className="text-[10px] text-amber-700 mt-0.5">Paid ₹{paid.toLocaleString()} of ₹{total.toLocaleString()}</p>}
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="font-bold text-amber-800 text-base">₹{remaining.toLocaleString()}</p>
                                        <p className="text-[10px] text-gray-400">due</p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                    <button onClick={() => onNavigate("collections")} className="w-full text-center text-xs font-bold text-amber-700 py-2 bg-amber-100 hover:bg-amber-200 transition border-t border-amber-200">
                        Open Collections →
                    </button>
                </div>
            )}

            {/* Quick Actions */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">Quick Actions</h3>
                <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => onNavigate("collections")} className="flex flex-col items-center gap-1 py-3 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition">
                        <span className="text-xl">💰</span>
                        <span className="text-[10px] font-bold text-indigo-700">Collect Rent</span>
                    </button>
                    <button onClick={() => onNavigate("meter")} className="flex flex-col items-center gap-1 py-3 bg-purple-50 rounded-lg hover:bg-purple-100 transition">
                        <span className="text-xl">⚡</span>
                        <span className="text-[10px] font-bold text-purple-700">Record Meter</span>
                    </button>
                    <button onClick={() => onNavigate("active")} className="flex flex-col items-center gap-1 py-3 bg-red-50 rounded-lg hover:bg-red-100 transition">
                        <span className="text-xl">🚨</span>
                        <span className="text-[10px] font-bold text-red-700">Report Issue</span>
                    </button>
                    <button onClick={() => onNavigate("expenses")} className="flex flex-col items-center gap-1 py-3 bg-amber-50 rounded-lg hover:bg-amber-100 transition">
                        <span className="text-xl">🧾</span>
                        <span className="text-[10px] font-bold text-amber-700">Add Expense</span>
                    </button>
                    <button onClick={() => onNavigate("checklist")} className="flex flex-col items-center gap-1 py-3 bg-pink-50 rounded-lg hover:bg-pink-100 transition">
                        <span className="text-xl">📋</span>
                        <span className="text-[10px] font-bold text-pink-700">Checklist</span>
                    </button>
                    <button onClick={() => onNavigate("units")} className="flex flex-col items-center gap-1 py-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition">
                        <span className="text-xl">🏠</span>
                        <span className="text-[10px] font-bold text-blue-700">View Units</span>
                    </button>
                </div>
            </div>

            {/* Overdue Invoices Alert */}
            {overdueInvoices.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
                    <div className="bg-red-100 px-4 py-2.5 border-b border-red-200 flex justify-between items-center">
                        <h3 className="text-sm font-bold text-red-800">⚠️ Overdue Invoices</h3>
                        <span className="text-xs font-bold bg-red-200 text-red-800 px-2 py-0.5 rounded-full">{overdueInvoices.length}</span>
                    </div>
                    <div className="divide-y divide-red-100 max-h-48 overflow-y-auto">
                        {overdueInvoices.map(inv => (
                            <div key={inv.id} className="px-4 py-2.5 flex justify-between items-center">
                                <div>
                                    <p className="font-bold text-gray-900 text-sm">{inv.unitNumber}</p>
                                    <p className="text-[10px] text-gray-500">{inv.billingPeriod}</p>
                                </div>
                                <p className="font-bold text-red-700 text-sm">₹{Number(inv.totalAmount || 0).toLocaleString()}</p>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => onNavigate("collections")} className="w-full text-center text-xs font-bold text-red-700 py-2 bg-red-100 hover:bg-red-200 transition border-t border-red-200">
                        View All Collections →
                    </button>
                </div>
            )}

            {/* Meters Pending for Current Month */}
            {unitsPendingMeter.length > 0 && (
                <div className="bg-purple-50 border border-purple-200 rounded-xl overflow-hidden">
                    <div className="bg-purple-100 px-4 py-2.5 border-b border-purple-200 flex justify-between items-center">
                        <h3 className="text-sm font-bold text-purple-800">⚡ Meters Pending — {currentMonthName}</h3>
                        <span className="text-xs font-bold bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full">{unitsPendingMeter.length}</span>
                    </div>
                    <div className="divide-y divide-purple-100 max-h-48 overflow-y-auto">
                        {unitsPendingMeter.map(u => (
                            <div key={u.id} className="px-4 py-2.5 flex justify-between items-center">
                                <div>
                                    <p className="font-bold text-gray-900 text-sm">{u.unitNumber}</p>
                                    <p className="text-[10px] text-gray-500">{u.tenantName || u.tenantEmail || "—"}</p>
                                </div>
                                <p className="text-xs text-purple-600">Last: {u.lastMeterReading || 0}</p>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => onNavigate("meter")} className="w-full text-center text-xs font-bold text-purple-700 py-2 bg-purple-100 hover:bg-purple-200 transition border-t border-purple-200">
                        Record Meter Readings →
                    </button>
                </div>
            )}

            {/* Active Tasks Preview */}
            {activeTickets.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl overflow-hidden">
                    <div className="bg-orange-100 px-4 py-2.5 border-b border-orange-200 flex justify-between items-center">
                        <h3 className="text-sm font-bold text-orange-800">🔧 Active Tasks</h3>
                        <span className="text-xs font-bold bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">{activeTickets.length}</span>
                    </div>
                    <div className="divide-y divide-orange-100 max-h-48 overflow-y-auto">
                        {activeTickets.slice(0, 5).map(t => (
                            <div key={t.id} className="px-4 py-2.5 flex justify-between items-center">
                                <div>
                                    <p className="font-bold text-gray-900 text-sm">{t.unitNumber}</p>
                                    <p className="text-[10px] text-gray-500 line-clamp-1">{t.description}</p>
                                </div>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.status === "in-progress" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>{t.status}</span>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => onNavigate("active")} className="w-full text-center text-xs font-bold text-orange-700 py-2 bg-orange-100 hover:bg-orange-200 transition border-t border-orange-200">
                        View All Tasks →
                    </button>
                </div>
            )}

            {/* Recent Activity Feed */}
            {recent.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-gray-800">🕐 Recent Activity</h3>
                        <span className="text-[10px] text-gray-400">Last {recent.length} actions</span>
                    </div>
                    <div className="divide-y divide-gray-100 max-h-56 overflow-y-auto">
                        {recent.map((a, i) => (
                            <div key={i} className="px-4 py-2.5 flex items-center gap-2">
                                <span className="text-base">{a.icon}</span>
                                <p className="text-xs text-gray-700 flex-1 line-clamp-1">{a.text}</p>
                                <span className="text-[10px] text-gray-400 whitespace-nowrap">{new Date(a.time).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
