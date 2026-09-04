"use client";

import { useMemo, useState } from "react";

interface Unit {
    id: string;
    unitNumber: string;
    buildingId?: string;
    status?: string;
    tenantName?: string;
    tenantEmail?: string;
    baseRent?: number;
}

interface Building { id: string; name: string; }

interface Invoice {
    id: string;
    unitId: string;
    unitNumber?: string;
    tenantEmail?: string;
    billingPeriod?: string;
    status?: string;
    baseRent?: number;
    electricityCharge?: number;
    totalAmount?: number;
    amountPaid?: number;
}

interface Props {
    allUnits: Unit[];
    buildings: Building[];
    allInvoices: Invoice[];
}

const currentMonthISO = () => new Date().toISOString().slice(0, 7);

// "September 2026" ↔ "2026-09"
const monthNameFromISO = (iso: string) => {
    const [y, m] = iso.split("-");
    return new Date(Number(y), Number(m) - 1).toLocaleString("default", { month: "long", year: "numeric" });
};

type Group = "paid" | "rentPending" | "electricityPending" | "noInvoice";

const GROUP_META: Record<Group, { label: string; emoji: string; color: string; bg: string; border: string }> = {
    paid: { label: "Rent Paid", emoji: "✅", color: "text-green-800", bg: "bg-green-50", border: "border-green-200" },
    rentPending: { label: "Rent Pending", emoji: "⏳", color: "text-red-800", bg: "bg-red-50", border: "border-red-200" },
    electricityPending: { label: "Electricity Pending", emoji: "⚡", color: "text-amber-800", bg: "bg-amber-50", border: "border-amber-200" },
    noInvoice: { label: "No Invoice Yet", emoji: "📭", color: "text-gray-700", bg: "bg-gray-50", border: "border-gray-200" },
};

export function MonthlyOverviewTab({ allUnits, buildings, allInvoices }: Props) {
    const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthISO());
    const [buildingFilter, setBuildingFilter] = useState<string>("");
    const [expandedGroups, setExpandedGroups] = useState<Record<Group, boolean>>({
        paid: false,
        rentPending: true,
        electricityPending: true,
        noInvoice: true,
    });

    const monthLabel = useMemo(() => monthNameFromISO(selectedMonth), [selectedMonth]);

    // Occupied units, optionally filtered by building
    const scopedUnits = useMemo(() => {
        return allUnits
            .filter(u => u.status === "occupied")
            .filter(u => !buildingFilter || u.buildingId === buildingFilter);
    }, [allUnits, buildingFilter]);

    // Group each occupied unit by its invoice status for the selected month
    const grouped = useMemo(() => {
        const groups: Record<Group, Array<{ unit: Unit; invoice?: Invoice; buildingName: string }>> = {
            paid: [], rentPending: [], electricityPending: [], noInvoice: []
        };

        scopedUnits.forEach(unit => {
            const invoice = allInvoices.find(
                inv => inv.unitId === unit.id && inv.billingPeriod === monthLabel
            );
            const buildingName = buildings.find(b => b.id === unit.buildingId)?.name || "—";

            if (!invoice) {
                groups.noInvoice.push({ unit, buildingName });
                return;
            }

            const total = Number(invoice.totalAmount || 0);
            const paid = Number(invoice.amountPaid || 0);
            const rent = Number(invoice.baseRent || 0);
            const electricity = Number(invoice.electricityCharge || 0);

            const isFullyPaid = invoice.status === "paid" || paid >= total;

            if (isFullyPaid) {
                groups.paid.push({ unit, invoice, buildingName });
            } else {
                // Split unpaid heuristic: if electricity is a significant portion, tag as electricity pending too
                const rentUnpaid = rent > paid; // rough: rent > amountPaid so rent portion outstanding
                const electricityUnpaid = electricity > 0 && paid < total; // any electricity + not fully paid

                if (rentUnpaid) groups.rentPending.push({ unit, invoice, buildingName });
                else if (electricityUnpaid) groups.electricityPending.push({ unit, invoice, buildingName });
                else groups.rentPending.push({ unit, invoice, buildingName });
            }
        });

        return groups;
    }, [scopedUnits, allInvoices, monthLabel, buildings]);

    const totals = useMemo(() => {
        const collectAmounts = (arr: Array<{ invoice?: Invoice }>) => {
            const totalAmt = arr.reduce((s, r) => s + Number(r.invoice?.totalAmount || 0), 0);
            const paidAmt = arr.reduce((s, r) => s + Number(r.invoice?.amountPaid || 0), 0);
            return { total: totalAmt, paid: paidAmt, due: totalAmt - paidAmt };
        };
        return {
            paid: collectAmounts(grouped.paid),
            rentPending: collectAmounts(grouped.rentPending),
            electricityPending: collectAmounts(grouped.electricityPending),
            noInvoice: { total: 0, paid: 0, due: 0 },
        };
    }, [grouped]);

    const toggleGroup = (g: Group) => setExpandedGroups(prev => ({ ...prev, [g]: !prev[g] }));

    const renderRow = (entry: { unit: Unit; invoice?: Invoice; buildingName: string }, group: Group) => {
        const { unit, invoice, buildingName } = entry;
        return (
            <div key={unit.id} className="px-3 py-2 flex justify-between items-start gap-3 border-b border-gray-100 last:border-0">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900">{unit.unitNumber} <span className="text-[10px] text-gray-500 font-normal">· {buildingName}</span></p>
                    <p className="text-[11px] text-gray-600">{unit.tenantName || "—"}{unit.tenantEmail ? ` · ${unit.tenantEmail}` : ""}</p>
                    {invoice && (
                        <div className="mt-1 text-[10px] text-gray-500 flex gap-2 flex-wrap">
                            <span>Rent ₹{Number(invoice.baseRent || 0).toLocaleString()}</span>
                            <span>Elec ₹{Number(invoice.electricityCharge || 0).toLocaleString()}</span>
                            <span>Paid ₹{Number(invoice.amountPaid || 0).toLocaleString()}</span>
                        </div>
                    )}
                </div>
                <div className="text-right shrink-0">
                    {invoice ? (
                        <>
                            <p className="text-sm font-bold text-gray-900">₹{Number(invoice.totalAmount || 0).toLocaleString()}</p>
                            {group !== "paid" && (
                                <p className="text-[10px] font-bold text-red-600">DUE ₹{(Number(invoice.totalAmount || 0) - Number(invoice.amountPaid || 0)).toLocaleString()}</p>
                            )}
                        </>
                    ) : (
                        <p className="text-[10px] text-gray-400">Base rent ₹{Number(unit.baseRent || 0).toLocaleString()}</p>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-emerald-200 overflow-hidden">
                <div className="bg-emerald-50 px-5 py-4 border-b border-emerald-200">
                    <h2 className="text-lg font-bold text-emerald-800">🏘 Monthly Property Overview</h2>
                    <p className="text-xs text-emerald-600 mt-0.5">Apartments grouped by rent & electricity status for the selected month</p>
                </div>

                <div className="p-4 space-y-4">
                    {/* Month & Building selectors */}
                    <div className="grid grid-cols-2 gap-2">
                        <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <select value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                            <option value="">All Buildings</option>
                            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>

                    {/* KPI cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                            <p className="text-[10px] font-bold text-green-700 uppercase">Paid</p>
                            <p className="text-lg font-bold text-green-800">{grouped.paid.length}</p>
                            <p className="text-[10px] text-green-600">₹{totals.paid.paid.toLocaleString()}</p>
                        </div>
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                            <p className="text-[10px] font-bold text-red-700 uppercase">Rent Due</p>
                            <p className="text-lg font-bold text-red-800">{grouped.rentPending.length}</p>
                            <p className="text-[10px] text-red-600">₹{totals.rentPending.due.toLocaleString()}</p>
                        </div>
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                            <p className="text-[10px] font-bold text-amber-700 uppercase">Elec. Due</p>
                            <p className="text-lg font-bold text-amber-800">{grouped.electricityPending.length}</p>
                            <p className="text-[10px] text-amber-600">₹{totals.electricityPending.due.toLocaleString()}</p>
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                            <p className="text-[10px] font-bold text-gray-700 uppercase">No Invoice</p>
                            <p className="text-lg font-bold text-gray-800">{grouped.noInvoice.length}</p>
                            <p className="text-[10px] text-gray-500">to bill</p>
                        </div>
                    </div>

                    {/* Groups */}
                    {(Object.keys(GROUP_META) as Group[]).map(g => {
                        const meta = GROUP_META[g];
                        const list = grouped[g];
                        const expanded = expandedGroups[g];
                        return (
                            <div key={g} className={`border rounded-lg overflow-hidden ${meta.border}`}>
                                <button onClick={() => toggleGroup(g)} className={`w-full ${meta.bg} px-4 py-2.5 flex justify-between items-center hover:opacity-90`}>
                                    <div className="flex items-center gap-2">
                                        <span>{meta.emoji}</span>
                                        <span className={`text-sm font-bold ${meta.color}`}>{meta.label}</span>
                                        <span className="text-[10px] bg-white/60 rounded-full px-2 py-0.5 font-medium">{list.length}</span>
                                    </div>
                                    <span className={`text-xs ${meta.color}`}>{expanded ? "▲" : "▼"}</span>
                                </button>
                                {expanded && (
                                    <div className="bg-white">
                                        {list.length === 0 ? (
                                            <p className="text-xs text-gray-400 text-center py-4">No units in this group.</p>
                                        ) : (
                                            list.map(entry => renderRow(entry, g))
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    <p className="text-[10px] text-gray-400 text-center">Showing {scopedUnits.length} occupied unit(s) for {monthLabel}</p>
                </div>
            </div>
        </div>
    );
}
