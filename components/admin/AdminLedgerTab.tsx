"use client";

import { useState } from "react";
import { doc, writeBatch } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { COL } from "@/lib/collections";
import type { Invoice, LedgerEntry, MasterInvoice } from "@/types";
import {
    syncInvoiceFromLedger,
    syncMasterFromChildren,
} from "@/lib/ledgerSync";
import type { LedgerAuditReport } from "@/lib/ledgerAudit";

interface AdminLedgerTabProps {
    ledgerEntries: LedgerEntry[];
    currentUserEmail: string;
    /** All invoices — used to recompute the linked invoice when a ledger row is corrected. */
    allInvoices?: Invoice[];
    /** All master invoices — used to recompute a corporate master when a child invoice changes. */
    masterInvoices?: MasterInvoice[];
}

export function AdminLedgerTab({ ledgerEntries, currentUserEmail, allInvoices = [], masterInvoices = [] }: AdminLedgerTabProps) {
    const [filter, setFilter] = useState("");
    const [editLedger, setEditLedger] = useState<LedgerEntry | null>(null);
    const [editAmount, setEditAmount] = useState("");
    const [editNote, setEditNote] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    // Ledger consistency audit (read-only). See docs/ATOMIC_TRANSACTIONS_PLAN.md §7.
    const [auditReport, setAuditReport] = useState<LedgerAuditReport | null>(null);
    const [auditError, setAuditError] = useState("");
    const [isAuditing, setIsAuditing] = useState(false);

    const handleRunAudit = async () => {
        setIsAuditing(true);
        setAuditError("");
        try {
            const user = auth.currentUser;
            const token = user ? await user.getIdToken() : null;
            if (!token) { setAuditError("You must be signed in to run the audit."); return; }
            const res = await fetch("/api/admin/audit-ledger", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) {
                setAuditError(data?.error || `Audit failed (${res.status}).`);
                return;
            }
            setAuditReport(data as LedgerAuditReport);
        } catch (e) {
            setAuditError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsAuditing(false);
        }
    };

    const handleEditSave = async () => {
        if (!editLedger) return;
        const newAmountPaid = Number(editAmount);
        if (isNaN(newAmountPaid) || newAmountPaid < 0) {
            alert("Enter a valid amount.");
            return;
        }
        if (!editNote.trim()) {
            alert("Please provide a reason for this correction.");
            return;
        }
        const newBalance = newAmountPaid - Number(editLedger.invoiceAmount);
        setIsSaving(true);
        try {
            const batch = writeBatch(db);

            // 1. Correct the ledger row itself (with audit trail).
            batch.update(doc(db, COL.ledger, editLedger.id), {
                amountPaid: newAmountPaid,
                balance: newBalance,
                correctedAt: new Date().toISOString(),
                correctionNote: editNote.trim(),
                correctedBy: currentUserEmail || "admin",
                originalAmountPaid: editLedger.originalAmountPaid ?? editLedger.amountPaid,
            });

            // 2. Propagate the correction to the linked apartment invoice so its
            //    amountPaid / status reflect the corrected ledger total. The
            //    invoice's paid total is the SUM of all its ledger rows, with
            //    this row overridden to the corrected value.
            const invoice = editLedger.invoiceId
                ? allInvoices.find(i => i.id === editLedger.invoiceId)
                : undefined;
            let correctedInvoice: { amountPaid: number } | undefined;
            if (invoice) {
                const invPatch = syncInvoiceFromLedger(
                    Number(invoice.totalAmount || 0),
                    ledgerEntries,
                    invoice.id,
                    { id: editLedger.id, amountPaid: newAmountPaid },
                );
                correctedInvoice = { amountPaid: invPatch.amountPaid };
                batch.update(doc(db, COL.invoices, invoice.id), {
                    amountPaid: invPatch.amountPaid,
                    status: invPatch.status,
                    ...(invPatch.fullyPaid
                        ? { paidAt: invoice.paidAt || new Date().toISOString() }
                        : {}),
                });

                // 3. If this invoice rolls up into a corporate master invoice,
                //    recompute the master's amountPaid / status from its
                //    children (using the corrected child amount).
                const master = invoice.masterInvoiceId
                    ? masterInvoices.find(m => m.id === invoice.masterInvoiceId)
                    : undefined;
                if (master) {
                    const children = allInvoices
                        .filter(i => master.childInvoiceIds.includes(i.id))
                        .map(i => i.id === invoice.id
                            ? { ...i, amountPaid: correctedInvoice!.amountPaid }
                            : i);
                    const masterPatch = syncMasterFromChildren(Number(master.totalAmount || 0), children);
                    batch.update(doc(db, COL.masterInvoices, master.id), {
                        amountPaid: masterPatch.amountPaid,
                        status: masterPatch.status,
                        ...(masterPatch.fullyPaid
                            ? { paidAt: master.paidAt || new Date().toISOString() }
                            : {}),
                    });
                }
            }

            await batch.commit();
            setEditLedger(null);
        } catch (error) {
            console.error("Failed to update ledger entry:", error);
            alert("Failed to update ledger entry.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (entry: LedgerEntry) => {
        if (!window.confirm(`Delete ledger entry for ${entry.billingPeriod} (₹${entry.amountPaid} paid)? This cannot be undone.`)) return;
        try {
            // Deleting a ledger row removes its contribution to the linked
            // invoice's paid total, so re-sync the invoice (and its master, if
            // any) in the SAME batch — otherwise the invoice would keep a stale
            // amountPaid, violating the "ledger == invoice.amountPaid" invariant.
            const batch = writeBatch(db);
            batch.delete(doc(db, COL.ledger, entry.id));

            const invoice = entry.invoiceId
                ? allInvoices.find(i => i.id === entry.invoiceId)
                : undefined;
            if (invoice) {
                // Override the deleted row's amount to 0 so it drops out of the sum.
                const invPatch = syncInvoiceFromLedger(
                    Number(invoice.totalAmount || 0),
                    ledgerEntries,
                    invoice.id,
                    { id: entry.id, amountPaid: 0 },
                );
                batch.update(doc(db, COL.invoices, invoice.id), {
                    amountPaid: invPatch.amountPaid,
                    status: invPatch.status,
                    ...(invPatch.fullyPaid
                        ? { paidAt: invoice.paidAt || new Date().toISOString() }
                        : {}),
                });

                const master = invoice.masterInvoiceId
                    ? masterInvoices.find(m => m.id === invoice.masterInvoiceId)
                    : undefined;
                if (master) {
                    const children = allInvoices
                        .filter(i => master.childInvoiceIds.includes(i.id))
                        .map(i => i.id === invoice.id
                            ? { ...i, amountPaid: invPatch.amountPaid }
                            : i);
                    const masterPatch = syncMasterFromChildren(Number(master.totalAmount || 0), children);
                    batch.update(doc(db, COL.masterInvoices, master.id), {
                        amountPaid: masterPatch.amountPaid,
                        status: masterPatch.status,
                        ...(masterPatch.fullyPaid
                            ? { paidAt: master.paidAt || new Date().toISOString() }
                            : {}),
                    });
                }
            }

            await batch.commit();
        } catch (error) {
            console.error("Failed to delete ledger entry:", error);
            alert("Failed to delete ledger entry.");
        }
    };

    const searchLower = filter.toLowerCase().trim();
    const filteredEntries = ledgerEntries.filter(e =>
        !searchLower ||
        (e.tenantEmail && e.tenantEmail.toLowerCase().includes(searchLower)) ||
        (e.unitNumber && e.unitNumber.toLowerCase().includes(searchLower)) ||
        (e.transactionId && e.transactionId.toLowerCase().includes(searchLower))
    );

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-wrap justify-between items-center gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">📑 Master Payment Ledger</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{ledgerEntries.length} settled payment audit logs with correction history</p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                        onClick={handleRunAudit}
                        disabled={isAuditing}
                        className="px-3 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition disabled:opacity-50 whitespace-nowrap"
                        title="Check that every invoice's amountPaid matches the sum of its ledger rows"
                    >
                        {isAuditing ? "Auditing…" : "🔍 Run Consistency Audit"}
                    </button>
                    <div className="flex-1 sm:w-64">
                        <input
                            type="text"
                            placeholder="🔍 Search unit, tenant, or TxID..."
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs outline-none focus:border-blue-500"
                        />
                    </div>
                </div>
            </div>

            {/* Audit report panel */}
            {auditError && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700 flex justify-between items-start gap-3">
                    <span>⚠️ {auditError}</span>
                    <button onClick={() => setAuditError("")} className="text-rose-400 hover:text-rose-600 font-bold shrink-0">✕</button>
                </div>
            )}
            {auditReport && (
                <div className={`rounded-xl border p-4 ${auditReport.balanced ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                    <div className="flex justify-between items-start gap-3 mb-2">
                        <h3 className="text-base font-bold text-gray-900">
                            {auditReport.balanced ? "✅ Ledger is consistent" : `⚠️ ${auditReport.drift.length} invoice(s) with drift`}
                        </h3>
                        <button onClick={() => setAuditReport(null)} className="text-gray-400 hover:text-gray-600 font-bold shrink-0">✕</button>
                    </div>
                    <p className="text-xs text-gray-600">
                        Scanned {auditReport.invoicesScanned.toLocaleString()} invoices and {auditReport.ledgerRowsScanned.toLocaleString()} ledger rows
                        {" "}(tolerance ±₹{auditReport.tolerance}).
                        {!auditReport.balanced && (
                            <> {auditReport.invoiceOverLedger} invoice-over-ledger, {auditReport.ledgerOverInvoice} ledger-over-invoice.</>
                        )}
                    </p>
                    {!auditReport.balanced && (
                        <div className="mt-3 overflow-x-auto">
                            <table className="w-full text-left text-xs text-gray-600">
                                <thead className="text-gray-500 uppercase font-bold border-b border-amber-200">
                                    <tr>
                                        <th className="px-2 py-1.5">Unit</th>
                                        <th className="px-2 py-1.5">Billing Period</th>
                                        <th className="px-2 py-1.5">Status</th>
                                        <th className="px-2 py-1.5 text-right">Invoice Paid</th>
                                        <th className="px-2 py-1.5 text-right">Ledger Sum</th>
                                        <th className="px-2 py-1.5 text-right">Diff</th>
                                        <th className="px-2 py-1.5 text-right">Rows</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-amber-100">
                                    {auditReport.drift.map(r => (
                                        <tr key={r.invoiceId} className="hover:bg-amber-100/40">
                                            <td className="px-2 py-1.5 font-bold text-gray-900">{r.unitNumber}</td>
                                            <td className="px-2 py-1.5">{r.billingPeriod}</td>
                                            <td className="px-2 py-1.5">{r.status}</td>
                                            <td className="px-2 py-1.5 text-right">₹{r.invoiceAmountPaid.toLocaleString()}</td>
                                            <td className="px-2 py-1.5 text-right">₹{r.ledgerSum.toLocaleString()}</td>
                                            <td className={`px-2 py-1.5 text-right font-bold ${r.diff < 0 ? "text-rose-600" : "text-amber-700"}`}>
                                                {r.diff > 0 ? "+" : ""}₹{r.diff.toLocaleString()}
                                            </td>
                                            <td className="px-2 py-1.5 text-right">{r.ledgerRowCount}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="text-[11px] text-gray-500 mt-2">
                                Review each manually — correct a ledger row above, or regenerate/edit the invoice to re-derive its amountPaid.
                            </p>
                        </div>
                    )}
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-gray-600">
                        <thead className="bg-gray-50 text-gray-500 uppercase font-bold border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3">Date</th>
                                <th className="px-4 py-3">Unit</th>
                                <th className="px-4 py-3">Tenant Email</th>
                                <th className="px-4 py-3">Billing Period</th>
                                <th className="px-4 py-3 text-right">Invoiced</th>
                                <th className="px-4 py-3 text-right">Paid</th>
                                <th className="px-4 py-3 text-right">Balance</th>
                                <th className="px-4 py-3">TxID / Mode</th>
                                <th className="px-4 py-3 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredEntries.map(e => (
                                <tr key={e.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-gray-500">{new Date(e.createdAt).toLocaleDateString()}</td>
                                    <td className="px-4 py-3 font-bold text-gray-900">{e.unitNumber}</td>
                                    <td className="px-4 py-3">{e.tenantEmail}</td>
                                    <td className="px-4 py-3">{e.billingPeriod}</td>
                                    <td className="px-4 py-3 text-right">₹{Number(e.invoiceAmount || 0).toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right font-bold text-emerald-600">₹{Number(e.amountPaid || 0).toLocaleString()}</td>
                                    <td className={`px-4 py-3 text-right font-bold ${
                                        Number(e.balance || 0) < 0 ? "text-rose-600" : "text-emerald-600"
                                    }`}>
                                        {Number(e.balance || 0) >= 0 ? "+" : ""}₹{Number(e.balance || 0).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-[11px] text-gray-400 truncate max-w-[120px]">{e.transactionId || e.paymentMode || "—"}</td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => { setEditLedger(e); setEditAmount(String(e.amountPaid)); setEditNote(""); }}
                                                className="text-blue-600 hover:text-blue-800 font-bold"
                                            >
                                                ✏️ Edit
                                            </button>
                                            <button
                                                onClick={() => handleDelete(e)}
                                                className="text-red-400 hover:text-red-600 font-bold"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Edit Ledger Entry Modal */}
            {editLedger && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-base font-bold text-gray-900">Correct Ledger Record</h3>
                            <button onClick={() => setEditLedger(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <div className="space-y-3">
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                                <p className="font-bold">Unit {editLedger.unitNumber} · {editLedger.billingPeriod}</p>
                                <p className="mt-0.5">Invoiced Amount: ₹{Number(editLedger.invoiceAmount).toLocaleString()}</p>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Corrected Amount Paid (₹)</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={editAmount}
                                    onChange={(e) => setEditAmount(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Reason for Rectification (Audit Trail)</label>
                                <textarea
                                    required
                                    rows={3}
                                    placeholder="Explain reason for correction (e.g. cash deposit adjusted, bank reversal)..."
                                    value={editNote}
                                    onChange={(e) => setEditNote(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500 resize-none"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-3">
                                <button type="button" onClick={() => setEditLedger(null)} className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                                <button type="button" onClick={handleEditSave} disabled={isSaving} className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
                                    {isSaving ? "Saving..." : "Apply Correction"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
