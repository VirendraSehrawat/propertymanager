/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { doc, updateDoc, addDoc, getDocs, collection, query, where, deleteField, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Invoice, LedgerEntry, MasterInvoice, Unit } from "@/types";
import { buildTransactionId } from "@/lib/payments";
import {
    allocatePartialPayment,
    composeInvoiceTotal,
    computeCarryForward,
} from "@/lib/allocation";
import { allocateMasterPayment } from "@/lib/masterAllocation";
import { SettlePaymentModal, type SettlePaymentSubmit } from "./modals/SettlePaymentModal";
import { SettleMasterInvoiceModal, type SettleMasterSubmit } from "./modals/SettleMasterInvoiceModal";

interface CollectionsTabProps {
    allInvoices: Invoice[];
    occupiedUnits: Unit[];
    electricityRate: number;
    openTenantProfile: (unit: Unit) => void;
    /** All ledger entries — used to show payment history for a partial invoice inside the settle modal. */
    allLedgerEntries?: LedgerEntry[];
    /** All master invoices — corporate billing wrappers. When present, grouped
     *  children are hidden from the per-unit list and shown as one row per
     *  master. See `docs/CORPORATE_TENANT_BILLING.md`. */
    masterInvoices?: MasterInvoice[];
    /** Email of the collecting employee — recorded on ledger + master settlement writes. */
    userEmail?: string;
}

export function CollectionsTab({ allInvoices, occupiedUnits, electricityRate, openTenantProfile, allLedgerEntries = [], masterInvoices = [], userEmail = "employee" }: CollectionsTabProps) {
    // Default: current month label like "September 2026" (matches Invoice.billingPeriod format)
    const currentMonthLabel = new Date().toLocaleString("default", { month: "long", year: "numeric" });
    const [collectionFilter, setCollectionFilter] = useState<string>(currentMonthLabel);
    const [isSettling, setIsSettling] = useState("");

    const [isEditInvoiceOpen, setIsEditInvoiceOpen] = useState(false);
    const [editInvoice, setEditInvoice] = useState<any>(null);

    // Master-invoice settle modal state
    const [settleMaster, setSettleMaster] = useState<MasterInvoice | null>(null);
    const [isSettlingMaster, setIsSettlingMaster] = useState(false);

    // Settle modal (mark as paid with reference). All form state lives inside the modal component.
    const [settleInvoice, setSettleInvoice] = useState<Invoice | null>(null);
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

    const pendingInvoices = allInvoices
        .filter(inv => inv.status === "unpaid" || inv.status === "pending")
        // Grouped children are settled through the master invoice, not here.
        .filter(inv => !inv.masterInvoiceId)
        .slice()
        .sort((a, b) => String(a.unitNumber || "").localeCompare(String(b.unitNumber || ""), undefined, { numeric: true, sensitivity: "base" }));
    // Settled collections (paid invoices) sorted by paidAt desc → newest first.
    const settledInvoices = allInvoices
        .filter(inv => inv.status === "paid")
        .slice()
        .sort((a, b) => {
            const ad = (a.paidAt || a.createdAt || "");
            const bd = (b.paidAt || b.createdAt || "");
            return bd.localeCompare(ad);
        });
    const [settledLimit, setSettledLimit] = useState(20);
    const [settledFilter, setSettledFilter] = useState("");
    const norm = (bp?: string) => (bp || "").replace(/\s*\(.+\)\s*$/, "").trim();
    const filteredSettled = settledInvoices.filter(inv => {
        if (collectionFilter !== "all" && collectionFilter !== "overdue" && norm(inv.billingPeriod) !== collectionFilter) return false;
        if (!settledFilter) return true;
        const q = settledFilter.toLowerCase();
        return (inv.unitNumber || "").toLowerCase().includes(q)
            || (inv.tenantEmail || "").toLowerCase().includes(q)
            || (inv.billingPeriod || "").toLowerCase().includes(q)
            || (inv.transactionId || "").toLowerCase().includes(q);
    });
    const totalSettledAmount = filteredSettled.reduce((s, inv) => s + Number(inv.totalAmount || 0), 0);
    // Build month list from pending + settled + current month so picker always shows this month
    const periods = [...new Set([
        currentMonthLabel,
        ...allInvoices.map(inv => norm(inv.billingPeriod)).filter(Boolean),
    ])].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    const filteredInvoices = collectionFilter === "all"
        ? pendingInvoices
        : collectionFilter === "overdue"
        ? pendingInvoices.filter(inv => isOverdue(inv.billingPeriod))
        : pendingInvoices.filter(inv => norm(inv.billingPeriod) === collectionFilter);
    const totalPendingRent = filteredInvoices.reduce((sum, inv) => sum + Number(inv.baseRent || 0), 0);
    const totalPendingElec = filteredInvoices.reduce((sum, inv) => sum + Number(inv.electricityCharge || 0), 0);

    const overdueCount = pendingInvoices.filter(inv => isOverdue(inv.billingPeriod)).length;
    const overdueAmount = pendingInvoices.filter(inv => isOverdue(inv.billingPeriod)).reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);

    const openSettleModal = (inv: Invoice) => {
        setSettleInvoice(inv);
    };

    const handleConfirmSettle = async (payload: SettlePaymentSubmit) => {
        if (!settleInvoice) return;
        const inv = settleInvoice;
        const { received: receivedInput, mode, reference, note } = payload;
        const alloc = allocatePartialPayment(receivedInput, {
            totalAmount: Number(inv.totalAmount || 0),
            amountPaid: Number(inv.amountPaid || 0),
            baseRent: Number(inv.baseRent || 0),
            electricityCharge: Number(inv.electricityCharge || 0),
        });
        const received = receivedInput; // for user-facing checks
        if (received <= 0) { alert("Enter an amount greater than zero."); return; }
        if (received > alloc.remaining) { alert(`Amount received (₹${received}) exceeds remaining balance (₹${alloc.remaining}).`); return; }
        setIsSettling(inv.id);
        try {
            const txnId = buildTransactionId(mode, reference);
            await updateDoc(doc(db, "invoices", inv.id), {
                amountPaid: alloc.newAmountPaid,
                status: alloc.status,
                ...(alloc.fullyPaid ? { paidAt: new Date().toISOString() } : {}),
                transactionId: txnId,
                ...(note.trim() ? { paymentNote: note.trim() } : {}),
            });
            await addDoc(collection(db, "ledger"), {
                tenantEmail: inv.tenantEmail,
                unitId: inv.unitId,
                unitNumber: inv.unitNumber,
                invoiceId: inv.id,
                billingPeriod: inv.billingPeriod || "Ad-Hoc",
                invoiceAmount: Number(inv.totalAmount || 0),
                amountPaid: received,           // this transaction only
                balance: received - alloc.remaining,  // 0 if fully paid, negative if partial
                transactionId: txnId,
                paymentMode: mode,
                paymentReference: reference.trim() || null,
                paymentNote: note.trim() || null,
                type: alloc.fullyPaid ? "payment" : "partial-payment",
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
            const carryForward = computeCarryForward(runningBalance);
            const { total: totalAmount } = composeInvoiceTotal({ baseRent, electricityCharge, carryForward });

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

    // ------------------------------------------------------------------
    // Corporate master-invoice settlement (see docs/CORPORATE_TENANT_BILLING.md §4.3)
    // ------------------------------------------------------------------
    const openMasterInvoices = masterInvoices
        .filter(m => m.status === "unpaid" || m.status === "partial")
        .slice()
        .sort((a, b) => (a.billingPeriod || "").localeCompare(b.billingPeriod || ""));

    async function handleMasterSettle(m: MasterInvoice, payload: SettleMasterSubmit) {
        setIsSettlingMaster(true);
        try {
            const children = allInvoices.filter(inv => m.childInvoiceIds.includes(inv.id));
            const result = allocateMasterPayment(payload.received, m, children);
            if (result.appliedTotal <= 0) throw new Error("Payment amount must be greater than zero.");

            const txnId = buildTransactionId(payload.mode, payload.reference);
            const nowIso = new Date().toISOString();
            const batch = writeBatch(db);

            // Update master
            batch.update(doc(db, "masterInvoices", m.id), {
                amountPaid: result.newMasterAmountPaid,
                status: result.masterStatus,
                paidAt: result.masterStatus === "paid" ? nowIso : m.paidAt || null,
                transactionId: txnId,
                paymentMode: payload.mode,
                paymentReference: payload.reference || null,
                paymentNote: payload.note || null,
            });

            // Update each child + write ledger row per child
            for (const alloc of result.perChild) {
                if (alloc.appliedNow <= 0) continue;
                batch.update(doc(db, "invoices", alloc.invoiceId), {
                    amountPaid: alloc.newAmountPaid,
                    status: alloc.status,
                    paidAt: alloc.status === "paid" ? nowIso : null,
                    transactionId: txnId,
                    paymentMode: payload.mode,
                    paymentReference: payload.reference || null,
                });
            }
            await batch.commit();

            // Post-commit: one dailyLedger row (total), N ledgerEntries rows (per child)
            for (const alloc of result.perChild) {
                if (alloc.appliedNow <= 0) continue;
                const child = children.find(c => c.id === alloc.invoiceId)!;
                await addDoc(collection(db, "ledgerEntries"), {
                    tenantEmail: child.tenantEmail,
                    unitId: child.unitId,
                    unitNumber: child.unitNumber,
                    invoiceId: child.id,
                    masterInvoiceId: m.id,
                    billingPeriod: child.billingPeriod,
                    invoiceAmount: child.totalAmount,
                    amountPaid: alloc.appliedNow,
                    balance: Math.max(0, Number(child.totalAmount || 0) - alloc.newAmountPaid),
                    transactionId: txnId,
                    type: "master-payment",
                    paymentMode: payload.mode,
                    paymentReference: payload.reference || null,
                    settledBy: userEmail,
                    createdAt: nowIso,
                });
            }
            // Single dailyLedger inflow representing the real cash movement
            await addDoc(collection(db, "dailyLedger"), {
                date: nowIso.slice(0, 10),
                direction: "inflow",
                category: "Rent (Master)",
                amount: result.appliedTotal,
                description: `${m.tenantName} · ${m.billingPeriod} · ${result.perChild.filter(c => c.appliedNow > 0).map(c => c.unitNumber).join(", ")}`,
                tenantName: m.tenantName,
                invoiceId: m.id,
                paymentMode: payload.mode,
                paymentReference: payload.reference || null,
                note: payload.note || null,
                recordedBy: userEmail,
                createdBy: userEmail,
                createdAt: nowIso,
            });

            setSettleMaster(null);
        } catch (e) {
            alert(e instanceof Error ? e.message : String(e));
        } finally {
            setIsSettlingMaster(false);
        }
    }

    return (
        <>
            <div className="space-y-4">
                <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Billing Month</label>
                    <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg font-medium">
                        {periods.map(p => <option key={p} value={p}>{p}{p === currentMonthLabel ? " (current)" : ""}</option>)}
                        <option value="all">All Pending ({pendingInvoices.length})</option>
                        {overdueCount > 0 && <option value="overdue">{"\u26A0\uFE0F"} Overdue ({overdueCount})</option>}
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

                {openMasterInvoices.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden">
                        <div className="bg-indigo-50 px-5 py-3 border-b border-indigo-200 flex justify-between items-center">
                            <div>
                                <h3 className="text-sm font-bold text-indigo-800">🏢 Master invoices (corporate)</h3>
                                <p className="text-[10px] text-indigo-600 mt-0.5">One payment settles all rooms</p>
                            </div>
                            <span className="text-xs font-bold bg-indigo-200 text-indigo-800 px-2 py-1 rounded-full">{openMasterInvoices.length}</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                            {openMasterInvoices.map(m => {
                                const remaining = Math.max(0, Number(m.totalAmount || 0) - Number(m.amountPaid || 0));
                                const isPartial = m.status === "partial";
                                return (
                                    <div key={m.id} className={`px-5 py-3 flex justify-between items-center ${isPartial ? "bg-amber-50/40" : ""}`}>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-bold text-gray-900 text-sm">{m.tenantName}</p>
                                                {isPartial && <span className="text-[9px] font-bold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded">PARTIAL</span>}
                                            </div>
                                            <p className="text-[11px] text-gray-500 mt-0.5">{m.id} · {m.billingPeriod} · {m.childInvoiceIds.length} unit{m.childInvoiceIds.length !== 1 ? "s" : ""}</p>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-gray-900">₹{remaining.toLocaleString()}</p>
                                                <p className="text-[10px] text-gray-400">of ₹{Number(m.totalAmount || 0).toLocaleString()}</p>
                                            </div>
                                            <button onClick={() => setSettleMaster(m)} className="text-xs font-bold bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700">Settle</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
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
                                const total = Number(inv.totalAmount || 0);
                                const paidSoFar = Number(inv.amountPaid || 0);
                                const remaining = Math.max(0, total - paidSoFar);
                                const isPartial = paidSoFar > 0 && paidSoFar < total;
                                return (
                                    <div key={inv.id} className={`px-5 py-4 flex justify-between items-center ${overdue ? "bg-red-50 hover:bg-red-100 border-l-4 border-l-red-400" : isPartial ? "bg-amber-50/40 hover:bg-amber-50 border-l-4 border-l-amber-400" : "hover:bg-gray-50"}`}>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <p className="font-bold text-gray-900">{inv.unitNumber}</p>
                                                {overdue && <span className="text-[9px] font-bold bg-red-200 text-red-800 px-1.5 py-0.5 rounded">OVERDUE</span>}
                                                {isPartial && <span className="text-[9px] font-bold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded">PARTIAL</span>}
                                            </div>
                                            <p className="text-xs text-gray-500">{inv.tenantEmail}</p>
                                            <p className={`text-xs font-medium mt-0.5 ${overdue ? "text-red-600" : "text-indigo-600"}`}>{inv.billingPeriod}</p>
                                            {(inv.rentPeriod || inv.electricityPeriod) && (
                                                <p className="text-[10px] text-gray-500 mt-0.5">
                                                    {inv.rentPeriod && <>🏠 <span className="font-medium">{inv.rentPeriod}</span></>}
                                                    {inv.rentPeriod && inv.electricityPeriod && " · "}
                                                    {inv.electricityPeriod && <>⚡ <span className="font-medium">{inv.electricityPeriod}</span></>}
                                                </p>
                                            )}
                                            <button onClick={() => { const unit = occupiedUnits.find(u => u.id === inv.unitId); if (unit) openTenantProfile(unit); }} className="text-[10px] text-indigo-600 hover:underline mt-1">View Profile {"\u2192"}</button>
                                        </div>
                                        <div className="text-right flex flex-col items-end gap-2">
                                            <div>
                                                <p className={`font-bold ${overdue ? "text-red-700" : isPartial ? "text-amber-700" : "text-gray-900"}`}>{"\u20B9"}{remaining.toLocaleString()}</p>
                                                {isPartial ? (
                                                    <p className="text-[10px] text-amber-700">Paid ₹{paidSoFar.toLocaleString()} of ₹{total.toLocaleString()}</p>
                                                ) : (
                                                    <p className="text-[10px] text-gray-400">Rent: {"\u20B9"}{inv.baseRent || 0} | Elec: {"\u20B9"}{inv.electricityCharge || 0}</p>
                                                )}
                                            </div>
                                            <div className="flex gap-1.5">
                                                <button onClick={() => openEditInvoice(inv)} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition">{"\u270F\uFE0F"} Edit</button>
                                                <button onClick={() => openSettleModal(inv)} disabled={isSettling === inv.id} className={`text-xs px-3 py-1.5 rounded-md font-bold transition text-white disabled:opacity-60 ${isPartial ? "bg-amber-600 hover:bg-amber-700" : "bg-green-600 hover:bg-green-700"}`}>
                                                    {isSettling === inv.id ? "..." : isPartial ? "\u2795 Add Payment" : "\u2713 Settle"}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        }
                    </div>
                </div>

                {/* SETTLED COLLECTIONS — detail view, newest first */}
                <div className="bg-white rounded-xl shadow-sm border border-green-200 overflow-hidden">
                    <div className="bg-green-50 px-5 py-3 border-b border-green-200 flex justify-between items-center gap-2">
                        <div>
                            <h3 className="text-sm font-bold text-green-800">{"\u2713"} Settled Collections</h3>
                            <p className="text-[10px] text-green-700 mt-0.5">{filteredSettled.length} shown · Total {"\u20B9"}{totalSettledAmount.toLocaleString()}</p>
                        </div>
                        <input
                            type="text"
                            value={settledFilter}
                            onChange={(e) => { setSettledFilter(e.target.value); setSettledLimit(20); }}
                            placeholder="Search unit / tenant / ref"
                            className="text-xs px-2 py-1.5 border border-green-300 rounded-md w-40 focus:outline-none focus:border-green-500"
                        />
                    </div>
                    <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                        {filteredSettled.length === 0 ? (
                            <p className="p-6 text-sm text-gray-500 text-center">No settled collections yet.</p>
                        ) : (() => {
                            // Group settled invoices by paid day (YYYY-MM-DD)
                            const shown = filteredSettled.slice(0, settledLimit);
                            const groups = new Map<string, typeof shown>();
                            shown.forEach(inv => {
                                const src = inv.paidAt || inv.createdAt || "";
                                const day = src ? src.slice(0, 10) : "unknown";
                                if (!groups.has(day)) groups.set(day, [] as any);
                                (groups.get(day) as any).push(inv);
                            });
                            const dayKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));
                            return dayKeys.map(day => {
                                const rows = groups.get(day)!;
                                const dayTotal = rows.reduce((s, inv) => s + Number(inv.totalAmount || 0), 0);
                                const dayLabel = day === "unknown"
                                    ? "Unknown date"
                                    : new Date(day + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
                                return (
                                    <div key={day}>
                                        <div className="sticky top-0 z-10 bg-green-100/90 backdrop-blur px-5 py-1.5 flex justify-between items-center border-b border-green-200">
                                            <span className="text-[11px] font-bold text-green-900">📅 {dayLabel}</span>
                                            <span className="text-[11px] font-bold text-green-900">{rows.length} · {"\u20B9"}{dayTotal.toLocaleString()}</span>
                                        </div>
                                        {rows.map(inv => {
                            const paidDate = inv.paidAt || inv.createdAt;
                            const paidStr = paidDate ? new Date(paidDate).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
                            const txn = inv.transactionId || "";
                            // Decode "MODE:REF" (e.g. "UPI:4XXX8291") produced by Mark-as-Paid
                            const [mode, ref] = txn === "CASH_COLLECTED"
                                ? ["CASH", ""]
                                : txn.includes(":")
                                    ? [txn.split(":", 2)[0], txn.split(":", 2)[1]]
                                    : [txn === "DAILY_LEDGER_AUTOSETTLE" ? "LEDGER" : (txn || "—"), ""];
                            return (
                                <div key={inv.id} className="px-5 py-3 hover:bg-green-50/40">
                                    <div className="flex justify-between items-start gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-bold text-gray-900">{inv.unitNumber}</p>
                                                <span className="text-[9px] font-bold bg-green-200 text-green-800 px-1.5 py-0.5 rounded">PAID</span>
                                                <span className="text-[9px] font-bold bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">{mode}</span>
                                            </div>
                                            <p className="text-xs text-gray-500 truncate">{inv.tenantEmail}</p>
                                            <p className="text-xs font-medium text-green-700 mt-0.5">{inv.billingPeriod}</p>
                                            {((inv as any).rentPeriod || (inv as any).electricityPeriod) && (
                                                <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                                                    {(inv as any).rentPeriod && <>🏠 {(inv as any).rentPeriod}</>}
                                                    {(inv as any).rentPeriod && (inv as any).electricityPeriod && " · "}
                                                    {(inv as any).electricityPeriod && <>⚡ {(inv as any).electricityPeriod}</>}
                                                </p>
                                            )}
                                            <div className="text-[10px] text-gray-400 mt-1 flex gap-2 flex-wrap">
                                                <span>📅 {paidStr}</span>
                                                {ref && <span title="Reference">🔖 {ref}</span>}
                                                {(inv as any).paymentNote && <span>📝 {(inv as any).paymentNote}</span>}
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="font-bold text-green-700">{"\u20B9"}{Number(inv.totalAmount || 0).toLocaleString()}</p>
                                            <p className="text-[10px] text-gray-400">Rent: {"\u20B9"}{inv.baseRent || 0} | Elec: {"\u20B9"}{inv.electricityCharge || 0}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                                    </div>
                                );
                            });
                        })()}
                        {filteredSettled.length > settledLimit && (
                            <button
                                onClick={() => setSettledLimit(l => l + 20)}
                                className="w-full py-2 text-xs font-bold text-green-700 hover:bg-green-50 border-t border-gray-100"
                            >
                                Show more ({filteredSettled.length - settledLimit} remaining)
                            </button>
                        )}
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
                <SettlePaymentModal
                    key={settleInvoice.id}
                    invoice={settleInvoice}
                    allLedgerEntries={allLedgerEntries}
                    isSubmitting={isSettling === settleInvoice.id}
                    onCancel={() => setSettleInvoice(null)}
                    onSubmit={handleConfirmSettle}
                />
            )}

            {settleMaster && (
                <SettleMasterInvoiceModal
                    key={settleMaster.id}
                    master={settleMaster}
                    childInvoices={allInvoices.filter(inv => settleMaster.childInvoiceIds.includes(inv.id))}
                    isSubmitting={isSettlingMaster}
                    onCancel={() => setSettleMaster(null)}
                    onSubmit={(payload) => handleMasterSettle(settleMaster, payload)}
                />
            )}
        </>
    );
}
