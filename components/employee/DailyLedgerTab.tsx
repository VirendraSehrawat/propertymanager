/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMemo, useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Modal } from "@/components/ui";
import { useUploadWithProgress, UploadProgressBar } from "@/lib/useUpload";

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
    receiptUrl?: string;
    createdBy?: string;
    createdAt: string;
}

interface Building { id: string; name: string; }
interface Unit { id: string; unitNumber: string; buildingId?: string; status?: string; tenantName?: string; tenantEmail?: string; baseRent?: number; lastMeterReading?: number; electricityRate?: number; }
interface Invoice { id: string; unitId: string; unitNumber?: string; tenantEmail?: string; totalAmount?: number; amountPaid?: number; billingPeriod?: string; status?: string; }

interface Props {
    entries: DailyLedgerEntry[];
    buildings: Building[];
    allUnits: Unit[];
    allInvoices?: Invoice[];
    currentUserEmail?: string;
}

const INFLOW_CATEGORIES = ["rent", "electricity", "maintenance", "deposit", "other"];
const OUTFLOW_CATEGORIES = ["labour", "material", "utilities", "repair", "other"];

const todayISO = () => new Date().toISOString().slice(0, 10);
const currentMonthISO = () => new Date().toISOString().slice(0, 7);

export function DailyLedgerTab({ entries, buildings, allUnits, allInvoices = [], currentUserEmail }: Props) {
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
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const { uploadFile, uploadProgress, isUploading, resetProgress } = useUploadWithProgress();

    const resetForm = () => {
        setDirection("inflow"); setCategory("rent"); setBuildingId(""); setUnitId("");
        setAmount(""); setDescription(""); setEntryDate(todayISO());
        setWorkerName(""); setHoursWorked(""); setQuantity(""); setVendor("");
        setReceiptFile(null); resetProgress();
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

    // Find pending invoices for the selected unit
    const pendingInvoicesForUnit = useMemo(() => {
        if (!unitId) return [];
        return allInvoices
            .filter(inv => inv.unitId === unitId && (inv.status === "unpaid" || inv.status === "pending"))
            .sort((a, b) => new Date(a.billingPeriod || "").getTime() - new Date(b.billingPeriod || "").getTime());
    }, [unitId, allInvoices]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!amount || Number(amount) <= 0) { alert("Enter a valid amount."); return; }
        setIsSaving(true);
        try {
            // Upload receipt image first (if any). Fail-safe: entry still saves without it if upload fails.
            let receiptUrl = "";
            if (receiptFile) {
                try {
                    receiptUrl = await uploadFile(`daily_ledger_receipts/${Date.now()}_${receiptFile.name}`, receiptFile);
                } catch (upErr) {
                    console.warn("Receipt upload failed, saving entry without it", upErr);
                }
            }

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
                ...(receiptUrl ? { receiptUrl } : {}),
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
            const ledgerRef = await addDoc(collection(db, "dailyLedger"), payload);

            // Merge: an "outflow" in the Daily Ledger is the same thing as an
            // Expense. Mirror it to the `expenses` collection so it appears in
            // the Expenses tab, fund summary and reports. Both docs are linked
            // via `expenseId` / `dailyLedgerId` so soft-delete cascades.
            if (direction === "outflow") {
                try {
                    const expenseRef = await addDoc(collection(db, "expenses"), {
                        amount: Number(amount),
                        category,
                        description: description || category,
                        date: entryDate || todayISO(),
                        buildingId: buildingId || "",
                        buildingName: bldg?.name || "General",
                        dailyLedgerId: ledgerRef.id,
                        source: "dailyLedger",
                        ...(receiptUrl ? { receiptUrl } : {}),
                        createdBy: currentUserEmail || "",
                        createdAt: new Date().toISOString(),
                    });
                    await updateDoc(doc(db, "dailyLedger", ledgerRef.id), { expenseId: expenseRef.id });
                } catch (mirrorErr) {
                    console.warn("Expense mirror write failed", mirrorErr);
                }
            }

            // Auto-settle matching invoice: inflow + specific unit + settlement-eligible category.
            // NEW: if no invoice exists yet (manager collected before the monthly bill
            // was generated), we auto-create an "on-the-fly" invoice for the current
            // month and immediately settle it. This keeps `invoices` + `ledger`
            // canonical even when collection happens before invoicing.
            const settleCategories = ["rent", "electricity", "maintenance"];
            if (
                direction === "inflow" &&
                unitId &&
                settleCategories.includes(category)
            ) {
                let targetInvoice = pendingInvoicesForUnit[0];

                // No pending invoice → create one on the fly using the unit's rent
                // and the amount paid (electricity charge is inferred as the delta).
                if (!targetInvoice) {
                    const paying = Number(amount);
                    const baseRent = Number(unit?.baseRent || 0);
                    const inferredElectricity = category === "rent"
                        ? 0
                        : category === "electricity"
                            ? paying
                            : 0; // maintenance → treat whole amount as base
                    const totalAmount = category === "rent"
                        ? Math.max(baseRent, paying)
                        : category === "electricity"
                            ? baseRent + inferredElectricity
                            : paying;
                    const monthName = new Date((entryDate || todayISO()) + "T00:00:00").toLocaleString("default", { month: "long", year: "numeric" });
                    const newInvRef = await addDoc(collection(db, "invoices"), {
                        unitId,
                        unitNumber: unit?.unitNumber || "",
                        tenantEmail: unit?.tenantEmail || "",
                        baseRent,
                        electricityCharge: inferredElectricity,
                        totalAmount,
                        billingPeriod: monthName,
                        status: "unpaid",
                        isCustom: false,
                        autoCreated: true,
                        autoCreatedReason: `Auto-created from Daily Ledger inflow (${category})`,
                        transactionId: "",
                        createdBy: currentUserEmail || "",
                        createdAt: new Date().toISOString(),
                    });
                    targetInvoice = {
                        id: newInvRef.id,
                        unitId,
                        unitNumber: unit?.unitNumber,
                        tenantEmail: unit?.tenantEmail,
                        totalAmount,
                        amountPaid: 0,
                        billingPeriod: monthName,
                        status: "unpaid",
                    };
                }

                const invoiceTotal = Number(targetInvoice.totalAmount || 0);
                const alreadyPaid = Number(targetInvoice.amountPaid || 0);
                const remaining = Math.max(0, invoiceTotal - alreadyPaid);
                const paying = Number(amount);
                const applied = Math.min(paying, remaining);
                const newPaid = alreadyPaid + applied;
                const fullySettled = newPaid >= invoiceTotal;

                if (fullySettled) {
                    await updateDoc(doc(db, "invoices", targetInvoice.id), {
                        status: "paid",
                        paidAt: new Date().toISOString(),
                        amountPaid: newPaid,
                        transactionId: "DAILY_LEDGER_AUTOSETTLE",
                    });
                } else {
                    await updateDoc(doc(db, "invoices", targetInvoice.id), {
                        amountPaid: newPaid,
                    });
                }

                await addDoc(collection(db, "ledger"), {
                    tenantEmail: targetInvoice.tenantEmail || unit?.tenantEmail || "",
                    unitId: targetInvoice.unitId,
                    unitNumber: targetInvoice.unitNumber || unit?.unitNumber || "",
                    invoiceId: targetInvoice.id,
                    billingPeriod: targetInvoice.billingPeriod || "Ad-Hoc",
                    invoiceAmount: invoiceTotal,
                    amountPaid: applied,
                    balance: applied - invoiceTotal + alreadyPaid,
                    transactionId: "DAILY_LEDGER_AUTOSETTLE",
                    type: "payment",
                    settledBy: "employee-daily-ledger",
                    category,
                    createdAt: new Date().toISOString(),
                });

                if (fullySettled) {
                    alert(`✅ Invoice ${targetInvoice.billingPeriod} settled for ${targetInvoice.unitNumber}.`);
                } else {
                    alert(`💵 Partial payment ₹${applied} applied. Remaining ₹${(invoiceTotal - newPaid).toLocaleString()} on ${targetInvoice.billingPeriod}.`);
                }
            }

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
        const reason = window.prompt(`Delete ${entry.direction} entry of ₹${entry.amount}?\n\nPlease provide a reason (required):`, "");
        if (reason === null) return; // cancelled
        const trimmed = reason.trim();
        if (!trimmed) { alert("A reason is required to delete an entry."); return; }
        try {
            const patch = {
                deleted: true,
                deleteReason: trimmed,
                deletedBy: currentUserEmail || "",
                deletedAt: new Date().toISOString(),
            } as const;
            await updateDoc(doc(db, "dailyLedger", entry.id), patch);
            const anyEntry = entry as any;
            if (anyEntry.expenseId) {
                await updateDoc(doc(db, "expenses", anyEntry.expenseId), patch);
            }
        }
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

                    {/* Pending invoice hint for auto-settle */}
                    {direction === "inflow" && unitId && ["rent", "electricity", "maintenance"].includes(category) && pendingInvoicesForUnit.length > 0 && (
                        <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-xs">
                            <p className="font-bold text-teal-800 mb-1">💡 Auto-settle preview</p>
                            <p className="text-teal-700">Oldest pending invoice for this unit will be updated on save:</p>
                            <p className="mt-1 text-teal-900 font-medium">{pendingInvoicesForUnit[0].billingPeriod} — ₹{Number(pendingInvoicesForUnit[0].totalAmount || 0).toLocaleString()} due</p>
                            {pendingInvoicesForUnit.length > 1 && (
                                <p className="mt-0.5 text-[10px] text-teal-600">({pendingInvoicesForUnit.length - 1} more pending)</p>
                            )}
                        </div>
                    )}

                    {/* No pending invoice — will be auto-created */}
                    {direction === "inflow" && unitId && ["rent", "electricity", "maintenance"].includes(category) && pendingInvoicesForUnit.length === 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
                            <p className="font-bold text-amber-800 mb-1">🧾 Auto-invoice preview</p>
                            <p className="text-amber-700">
                                No invoice found for this unit. On save, a new invoice for{" "}
                                <span className="font-semibold">
                                    {new Date((entryDate || todayISO()) + "T00:00:00").toLocaleString("default", { month: "long", year: "numeric" })}
                                </span>{" "}
                                will be created and settled with this payment.
                            </p>
                            {(() => {
                                const u = allUnits.find(x => x.id === unitId);
                                const rent = Number(u?.baseRent || 0);
                                if (rent > 0) {
                                    return <p className="mt-1 text-[10px] text-amber-600">Base rent on file: ₹{rent.toLocaleString()}</p>;
                                }
                                return <p className="mt-1 text-[10px] text-amber-600">No base rent on file — invoice total will match the amount paid.</p>;
                            })()}
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

                    {direction === "outflow" && (
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">📷 Receipt / Bill Image (optional)</label>
                            <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                                className="w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-bold file:bg-red-50 file:text-red-700 hover:file:bg-red-100"
                            />
                            {receiptFile && (
                                <div className="mt-2 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded p-2">
                                    <span className="text-[10px] text-gray-600 truncate flex-1">📎 {receiptFile.name}</span>
                                    <button type="button" onClick={() => setReceiptFile(null)} className="text-[10px] text-red-600 hover:text-red-800 font-bold">✕ Remove</button>
                                </div>
                            )}
                            <UploadProgressBar progress={uploadProgress} />
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description</label>
                        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Optional notes" />
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                        <button type="submit" disabled={isSaving || isUploading} className={`flex-1 py-2 rounded-md text-sm font-medium text-white ${direction === "inflow" ? "bg-green-600 hover:bg-green-700 disabled:bg-green-400" : "bg-red-600 hover:bg-red-700 disabled:bg-red-400"}`}>
                            {isUploading ? "Uploading..." : isSaving ? "Saving..." : "Save Entry"}
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
                {entry.receiptUrl && (
                    <a href={entry.receiptUrl} target="_blank" rel="noopener noreferrer" title="View receipt" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={entry.receiptUrl} alt="receipt" className="w-10 h-10 object-cover rounded border border-gray-200 hover:border-red-400" />
                    </a>
                )}
                <button onClick={() => onDelete(entry)} className="text-[10px] text-gray-400 hover:text-red-600">Delete</button>
            </div>
        </div>
    );
}
