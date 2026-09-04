/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Modal } from "@/components/ui";

interface DailyLedgerEntry {
    id: string;
    date: string; // YYYY-MM-DD
    direction: "inflow" | "outflow";
    category: string;
    buildingId?: string;
    buildingName?: string;
    unitId?: string;
    unitNumber?: string;
    tenantName?: string;
    amount: number;
    description?: string;
    workerName?: string;
    hoursWorked?: number;
    quantity?: number;
    vendor?: string;
    createdBy?: string;
    createdAt: string;
}

interface Building { id: string; name: string; }
interface Unit { id: string; unitNumber: string; buildingId?: string; status?: string; tenantName?: string; tenantEmail?: string; }

interface Props {
    entries: DailyLedgerEntry[];
    buildings: Building[];
    allUnits: Unit[];
    currentUserEmail?: string;
}

const INFLOW_CATEGORIES = ["rent", "electricity", "maintenance", "deposit", "other"];
const OUTFLOW_CATEGORIES = ["labour", "material", "utilities", "repair", "other"];

const todayISO = () => new Date().toISOString().slice(0, 10);
const currentMonthISO = () => new Date().toISOString().slice(0, 7);

export function DailyLedgerTab({ entries, buildings, allUnits, currentUserEmail }: Props) {
    const [viewMode, setViewMode] = useState<"daily" | "monthly">("daily");
    const [selectedDate, setSelectedDate] = useState(todayISO());
    const [selectedMonth, setSelectedMonth] = useState(currentMonthISO());
    const [buildingFilter, setBuildingFilter] = useState("");

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [direction, setDirection] = useState<"inflow" | "outflow">("inflow");
    const [category, setCategory] = useState("rent");
    const [buildingId, setBuildingId] = useState("");
    const [unitId, setUnitId] = useState("");
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [entryDate, setEntryDate] = useState(todayISO());
    const [workerName, setWorkerName] = useState("");
    const [hoursWorked, setHoursWorked] = useState("");
    const [quantity, setQuantity] = useState("");
    const [vendor, setVendor] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const resetForm = () => {
        setDirection("inflow"); setCategory("rent"); setBuildingId(""); setUnitId("");
        setAmount(""); setDescription(""); setEntryDate(todayISO());
        setWorkerName(""); setHoursWorked(""); setQuantity(""); setVendor("");
    };

    const openModal = (dir: "inflow" | "outflow") => {
        resetForm();
        setDirection(dir);
        setCategory(dir === "inflow" ? INFLOW_CATEGORIES[0] : OUTFLOW_CATEGORIES[0]);
        setIsModalOpen(true);
    };

    const buildingUnits = useMemo(
        () => allUnits.filter(u => !buildingId || u.buildingId === buildingId),
        [allUnits, buildingId]
    );

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!amount || Number(amount) <= 0) { alert("Enter a valid amount."); return; }
        setIsSaving(true);
        try {
            const bldg = buildings.find(b => b.id === buildingId);
            const unit = allUnits.find(u => u.id === unitId);
            const payload: any = {
                date: entryDate || todayISO(),
                direction,
                category,
                buildingId: buildingId || "",
                buildingName: bldg?.name || "General",
                unitId: unitId || "",
                unitNumber: unit?.unitNumber || "",
                tenantName: unit?.tenantName || "",
                amount: Number(amount),
                description: description || "",
                createdBy: currentUserEmail || "",
                createdAt: new Date().toISOString(),
            };
            if (direction === "outflow" && category === "labour") {
                payload.workerName = workerName || "";
                payload.hoursWorked = hoursWorked ? Number(hoursWorked) : 0;
            }
            if (direction === "outflow" && category === "material") {
                payload.quantity = quantity ? Number(quantity) : 0;
                payload.vendor = vendor || "";
            }
            await addDoc(collection(db, "dailyLedger"), payload);
            setIsModalOpen(false);
            resetForm();
        } catch (err) {
            console.error(err);
            alert("Failed to save entry.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (entry: DailyLedgerEntry) => {
        if (!window.confirm(`Delete ${entry.direction} entry of ₹${entry.amount}?`)) return;
        try { await deleteDoc(doc(db, "dailyLedger", entry.id)); }
        catch (err) { console.error(err); alert("Failed to delete."); }
    };

    // Filtering by view mode
    const scopedEntries = useMemo(() => {
        return entries.filter(e => {
            if (buildingFilter && e.buildingId !== buildingFilter) return false;
            if (viewMode === "daily") return e.date === selectedDate;
            return (e.date || "").startsWith(selectedMonth);
        });
    }, [entries, viewMode, selectedDate, selectedMonth, buildingFilter]);

    const totals = useMemo(() => {
        const inflow = scopedEntries.filter(e => e.direction === "inflow").reduce((s, e) => s + Number(e.amount || 0), 0);
        const outflow = scopedEntries.filter(e => e.direction === "outflow").reduce((s, e) => s + Number(e.amount || 0), 0);
        return { inflow, outflow, net: inflow - outflow };
    }, [scopedEntries]);

    // Monthly grouping by day
    const groupedByDay = useMemo(() => {
        if (viewMode !== "monthly") return null;
        const map: Record<string, DailyLedgerEntry[]> = {};
        scopedEntries.forEach(e => {
            (map[e.date] = map[e.date] || []).push(e);
        });
        return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
    }, [scopedEntries, viewMode]);

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-teal-200 overflow-hidden">
                <div className="bg-teal-50 px-5 py-4 border-b border-teal-200 flex justify-between items-center flex-wrap gap-2">
                    <div>
                        <h2 className="text-lg font-bold text-teal-800">📓 Daily Ledger</h2>
                        <p className="text-xs text-teal-600 mt-0.5">Log inflows (rent, electricity, maintenance) & outflows (labour, material)</p>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => openModal("inflow")} className="text-sm bg-green-600 text-white px-3 py-2 rounded-lg font-bold hover:bg-green-700">+ Inflow</button>
                        <button onClick={() => openModal("outflow")} className="text-sm bg-red-600 text-white px-3 py-2 rounded-lg font-bold hover:bg-red-700">− Outflow</button>
                    </div>
                </div>

                <div className="p-4 space-y-4">
                    {/* View toggle */}
                    <div className="flex gap-2">
                        <button onClick={() => setViewMode("daily")} className={`flex-1 text-xs font-bold py-2 rounded-lg transition ${viewMode === "daily" ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>📅 Daily</button>
                        <button onClick={() => setViewMode("monthly")} className={`flex-1 text-xs font-bold py-2 rounded-lg transition ${viewMode === "monthly" ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>🗓 Monthly</button>
                    </div>

                    {/* Date/Month + Building filter */}
                    <div className="grid grid-cols-2 gap-2">
                        {viewMode === "daily" ? (
                            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        ) : (
                            <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        )}
                        <select value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                            <option value="">All Buildings</option>
                            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>

                    {/* Totals */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                            <p className="text-[10px] font-bold text-green-600 uppercase">Inflow</p>
                            <p className="text-lg font-bold text-green-700">₹{totals.inflow.toLocaleString()}</p>
                        </div>
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                            <p className="text-[10px] font-bold text-red-600 uppercase">Outflow</p>
                            <p className="text-lg font-bold text-red-700">₹{totals.outflow.toLocaleString()}</p>
                        </div>
                        <div className={`border rounded-xl p-3 text-center ${totals.net >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-orange-50 border-orange-200"}`}>
                            <p className="text-[10px] font-bold uppercase text-gray-600">Net</p>
                            <p className={`text-lg font-bold ${totals.net >= 0 ? "text-emerald-700" : "text-orange-700"}`}>₹{totals.net.toLocaleString()}</p>
                        </div>
                    </div>

                    {/* Entry List */}
                    {scopedEntries.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-8">No entries for this {viewMode === "daily" ? "day" : "month"}.</p>
                    ) : viewMode === "daily" ? (
                        <div className="divide-y divide-gray-100">
                            {scopedEntries.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).map(entry => (
                                <EntryRow key={entry.id} entry={entry} onDelete={handleDelete} />
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {groupedByDay!.map(([date, list]) => {
                                const dayIn = list.filter(e => e.direction === "inflow").reduce((s, e) => s + Number(e.amount || 0), 0);
                                const dayOut = list.filter(e => e.direction === "outflow").reduce((s, e) => s + Number(e.amount || 0), 0);
                                return (
                                    <div key={date} className="border border-gray-200 rounded-lg overflow-hidden">
                                        <div className="bg-gray-50 px-3 py-2 flex justify-between items-center">
                                            <div>
                                                <p className="text-xs font-bold text-gray-800">{new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</p>
                                                <p className="text-[10px] text-gray-500">{list.length} entries</p>
                                            </div>
                                            <div className="flex gap-3 text-[11px]">
                                                <span className="text-green-700 font-bold">+₹{dayIn.toLocaleString()}</span>
                                                <span className="text-red-700 font-bold">−₹{dayOut.toLocaleString()}</span>
                                            </div>
                                        </div>
                                        <div className="divide-y divide-gray-100">
                                            {list.map(entry => <EntryRow key={entry.id} entry={entry} onDelete={handleDelete} compact />)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Entry Modal */}
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
                <h3 className="text-lg font-bold text-gray-800">{direction === "inflow" ? "➕ Inflow Entry" : "➖ Outflow Entry"}</h3>
                <form onSubmit={handleSubmit} className="space-y-3 mt-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Date</label>
                            <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Amount (₹) *</label>
                            <input type="number" min="1" required value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Type</label>
                        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm capitalize">
                            {(direction === "inflow" ? INFLOW_CATEGORIES : OUTFLOW_CATEGORIES).map(c => (
                                <option key={c} value={c} className="capitalize">{c}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Building</label>
                        <select value={buildingId} onChange={(e) => { setBuildingId(e.target.value); setUnitId(""); }} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            <option value="">General (no building)</option>
                            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>

                    {buildingId && (
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Apartment / Unit</label>
                            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                                <option value="">(No specific unit)</option>
                                {buildingUnits.map(u => (
                                    <option key={u.id} value={u.id}>{u.unitNumber}{u.tenantName ? ` — ${u.tenantName}` : ""}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {direction === "outflow" && category === "labour" && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Worker Name</label>
                                <input type="text" value={workerName} onChange={(e) => setWorkerName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. Ramesh" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Hours</label>
                                <input type="number" min="0" step="0.5" value={hoursWorked} onChange={(e) => setHoursWorked(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                        </div>
                    )}

                    {direction === "outflow" && category === "material" && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Qty</label>
                                <input type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Vendor</label>
                                <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. Local hardware" />
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description</label>
                        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Optional notes" />
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                        <button type="submit" disabled={isSaving} className={`flex-1 py-2 rounded-md text-sm font-medium text-white ${direction === "inflow" ? "bg-green-600 hover:bg-green-700 disabled:bg-green-400" : "bg-red-600 hover:bg-red-700 disabled:bg-red-400"}`}>
                            {isSaving ? "Saving..." : "Save Entry"}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}

function EntryRow({ entry, onDelete, compact }: { entry: DailyLedgerEntry; onDelete: (e: DailyLedgerEntry) => void; compact?: boolean }) {
    const isInflow = entry.direction === "inflow";
    return (
        <div className={`flex justify-between items-start gap-3 ${compact ? "px-3 py-2" : "py-3"}`}>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${isInflow ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {isInflow ? "IN" : "OUT"} · {entry.category}
                    </span>
                    {entry.unitNumber && <span className="text-[10px] font-medium text-gray-500">{entry.buildingName} / {entry.unitNumber}</span>}
                    {!entry.unitNumber && entry.buildingName && <span className="text-[10px] font-medium text-gray-500">{entry.buildingName}</span>}
                </div>
                {entry.description && <p className="text-xs text-gray-700 mt-1 line-clamp-2">{entry.description}</p>}
                <div className="text-[10px] text-gray-400 mt-0.5 flex gap-2 flex-wrap">
                    {entry.tenantName && <span>👤 {entry.tenantName}</span>}
                    {entry.workerName && <span>👷 {entry.workerName}{entry.hoursWorked ? ` · ${entry.hoursWorked}h` : ""}</span>}
                    {entry.vendor && <span>🏪 {entry.vendor}{entry.quantity ? ` · qty ${entry.quantity}` : ""}</span>}
                    {entry.createdBy && <span>by {entry.createdBy}</span>}
                </div>
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-1">
                <p className={`font-bold ${isInflow ? "text-green-700" : "text-red-700"}`}>{isInflow ? "+" : "−"}₹{Number(entry.amount).toLocaleString()}</p>
                <button onClick={() => onDelete(entry)} className="text-[10px] text-gray-400 hover:text-red-600">Delete</button>
            </div>
        </div>
    );
}
