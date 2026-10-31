"use client";

import { useState } from "react";
import type { Invoice, LedgerEntry } from "@/types";
import { allocatePartialPayment } from "@/lib/allocation";
import { allocateLumpSum, type PaymentMode } from "@/lib/payments";

export interface SettlePaymentSubmit {
    received: number;
    mode: PaymentMode;
    reference: string;
    note: string;
    kind: "full" | "partial";
}

interface SettlePaymentModalProps {
    invoice: Invoice;
    /** Ledger entries — filtered internally by `invoiceId === invoice.id` to render the prior-payments strip. */
    allLedgerEntries?: LedgerEntry[];
    /**
     * The unit's other pending invoices. Any amount above this invoice's balance
     * is applied to these oldest-first; whatever is left is kept as an advance.
     */
    otherPendingInvoices?: Invoice[];
    isSubmitting: boolean;
    onCancel: () => void;
    onSubmit: (payload: SettlePaymentSubmit) => void | Promise<void>;
}

/**
 * Record Payment modal.
 *
 * Owns all form state (kind / received / mode / reference / note) so the parent
 * only needs to track which invoice is being settled. Auto-selects Partial mode
 * when the invoice already has an `amountPaid > 0` (follow-up payment case).
 *
 * The rent-first allocation preview is computed live via `allocatePartialPayment`.
 * "Other amount" may exceed the balance: the extra is previewed across the
 * unit's other pending invoices (and an advance) via `allocateLumpSum`.
 */
export function SettlePaymentModal({
    invoice,
    allLedgerEntries = [],
    otherPendingInvoices = [],
    isSubmitting,
    onCancel,
    onSubmit,
}: SettlePaymentModalProps) {
    const total = Number(invoice.totalAmount || 0);
    const prevPaid = Number(invoice.amountPaid || 0);
    const remaining = Math.max(0, total - prevPaid);

    const [kind, setKind] = useState<"full" | "partial">(prevPaid > 0 ? "partial" : "full");
    const [received, setReceived] = useState<string>(String(remaining));
    const [mode, setMode] = useState<PaymentMode>("cash");
    const [reference, setReference] = useState("");
    const [note, setNote] = useState("");

    const receivedNum = kind === "full" ? remaining : Math.round(Number(received) || 0);
    const receivedValid = receivedNum > 0;
    const towardThisInvoice = Math.min(receivedNum, remaining);
    const extra = Math.max(0, receivedNum - remaining);
    const otherDue = otherPendingInvoices.reduce((s, i) => s + Math.max(0, Number(i.totalAmount || 0) - Number(i.amountPaid || 0)), 0);
    // Same waterfall the plan builder uses, so the preview matches what is saved.
    const extraPreview = extra > 0 ? allocateLumpSum(extra, otherPendingInvoices, invoice.unitId, "rent") : null;

    // Rent-first allocation preview (shared helper).
    const preview = allocatePartialPayment(towardThisInvoice, {
        totalAmount: total,
        amountPaid: prevPaid,
        baseRent: Number(invoice.baseRent || 0),
        electricityCharge: Number(invoice.electricityCharge || 0),
    });
    const { rentDueBefore: rentDue, elecDueBefore: elecDue, towardRent, towardElectricity: towardElec } = preview;

    const priorPayments = allLedgerEntries
        .filter((l) => l.invoiceId === invoice.id)
        .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!receivedValid) return;
        onSubmit({ received: receivedNum, mode, reference, note, kind });
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
            <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
                <div>
                    <h3 className="text-lg font-bold text-gray-800">{"\u2713"} Record Payment</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{invoice.unitNumber} {"\u2014"} {invoice.billingPeriod}</p>
                    <div className="mt-2 flex justify-between text-xs bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
                        <span className="text-gray-500">Invoice ₹{total.toLocaleString()}</span>
                        {prevPaid > 0 && <span className="text-amber-700 font-medium">Paid ₹{prevPaid.toLocaleString()}</span>}
                        <span className="text-red-700 font-bold">Due ₹{remaining.toLocaleString()}</span>
                    </div>
                    {priorPayments.length > 0 && (
                        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-md p-2 space-y-1">
                            <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">Prior payments on this invoice</p>
                            {priorPayments.map((p) => (
                                <div key={p.id} className="flex justify-between items-center text-[11px]">
                                    <span className="text-gray-700">
                                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "\u2014"}
                                        {" \u00b7 "}
                                        <span className="uppercase font-mono">{p.paymentMode || "cash"}</span>
                                        {p.paymentReference ? ` \u00b7 ${p.paymentReference}` : ""}
                                    </span>
                                    <span className="font-bold text-amber-800">₹{Number(p.amountPaid || 0).toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Payment</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => { setKind("full"); setReceived(String(remaining)); }} className={`px-3 py-2.5 rounded-md text-xs font-bold border transition ${kind === "full" ? "bg-green-600 text-white border-green-700" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}>Full ₹{remaining.toLocaleString()}</button>
                            <button type="button" onClick={() => setKind("partial")} className={`px-3 py-2.5 rounded-md text-xs font-bold border transition ${kind === "partial" ? "bg-amber-500 text-white border-amber-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}>Other amount…</button>
                        </div>
                    </div>
                    {kind === "partial" && (
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Amount Received (₹)</label>
                            <input
                                type="number"
                                value={received}
                                onChange={(e) => setReceived(e.target.value)}
                                min={1}
                                step={1}
                                placeholder="Amount the tenant handed over"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                autoFocus
                            />
                            <div className="mt-2 flex gap-1.5 flex-wrap">
                                {rentDue > 0 && <button type="button" onClick={() => setReceived(String(rentDue))} className="text-[11px] px-2 py-1 rounded bg-blue-50 border border-blue-200 text-blue-700 font-bold hover:bg-blue-100">Rent only ₹{rentDue.toLocaleString()}</button>}
                                {elecDue > 0 && <button type="button" onClick={() => setReceived(String(elecDue))} className="text-[11px] px-2 py-1 rounded bg-yellow-50 border border-yellow-200 text-yellow-700 font-bold hover:bg-yellow-100">Elec only ₹{elecDue.toLocaleString()}</button>}
                                {otherDue > 0 && <button type="button" onClick={() => setReceived(String(remaining + otherDue))} className="text-[11px] px-2 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold hover:bg-indigo-100">All {otherPendingInvoices.length + 1} pending ₹{(remaining + otherDue).toLocaleString()}</button>}
                            </div>
                        </div>
                    )}
                    <div className="text-[11px] bg-gray-50 border border-gray-200 rounded-md px-3 py-2 space-y-0.5">
                        <div className="flex justify-between"><span className="text-gray-500">Allocated to 🏠 Rent</span><span className="font-bold text-gray-800">₹{towardRent.toLocaleString()}{rentDue > 0 && ` / ₹${rentDue.toLocaleString()}`}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Allocated to ⚡ Electricity</span><span className="font-bold text-gray-800">₹{towardElec.toLocaleString()}{elecDue > 0 && ` / ₹${elecDue.toLocaleString()}`}</span></div>
                        <div className="flex justify-between border-t border-gray-200 pt-1 mt-1"><span className="text-gray-600 font-medium">After this payment</span><span className={`font-bold ${receivedNum >= remaining ? "text-green-700" : "text-amber-700"}`}>{receivedNum >= remaining ? "Fully Paid ✓" : `₹${(remaining - receivedNum).toLocaleString()} still due`}</span></div>
                    </div>
                    {extraPreview && (
                        <div className="text-[11px] bg-indigo-50 border border-indigo-200 rounded-md px-3 py-2 space-y-0.5">
                            <p className="font-bold text-indigo-800">Extra ₹{extra.toLocaleString()} will be applied oldest-first:</p>
                            {extraPreview.lines.map((line) => {
                                const inv = otherPendingInvoices.find((i) => i.id === line.invoiceId);
                                return (
                                    <div key={line.invoiceId} className="flex justify-between text-indigo-900">
                                        <span>{inv?.billingPeriod || line.invoiceId}</span>
                                        <span className="font-medium">
                                            +₹{line.applied.toLocaleString()}{" "}
                                            {line.fullySettled ? <span className="text-green-700">✓ paid</span> : <span className="text-amber-700">· ₹{line.remaining.toLocaleString()} left</span>}
                                        </span>
                                    </div>
                                );
                            })}
                            {extraPreview.leftover > 0 && (
                                <p className="text-purple-700 font-medium">🪙 ₹{extraPreview.leftover.toLocaleString()} kept as advance (credit) for this tenant</p>
                            )}
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Payment Mode</label>
                        <div className="grid grid-cols-5 gap-1">
                            {(["cash", "upi", "bank", "cheque", "other"] as const satisfies readonly PaymentMode[]).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setMode(m)}
                                    className={`px-2 py-2 rounded-md text-xs font-bold border transition ${mode === m ? "bg-green-600 text-white border-green-700" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
                                >
                                    {m.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>
                    {mode !== "cash" && (
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                {mode === "upi" ? "UPI Txn ID" : mode === "bank" ? "Bank Ref No." : mode === "cheque" ? "Cheque No." : "Reference"}
                            </label>
                            <input
                                type="text"
                                value={reference}
                                onChange={(e) => setReference(e.target.value)}
                                placeholder={mode === "upi" ? "e.g. 4XXXXXX8291" : mode === "cheque" ? "e.g. 000123" : "Reference / transaction id"}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Note (optional)</label>
                        <input
                            type="text"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="e.g. paid to owner directly"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        />
                    </div>
                    <div className="flex gap-2 pt-2">
                        <button type="button" onClick={onCancel} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                        <button type="submit" disabled={isSubmitting || !receivedValid} className="flex-1 py-2 bg-green-600 text-white rounded-md text-sm font-bold hover:bg-green-700 disabled:bg-green-400">
                            {isSubmitting ? "Saving..." : `\u2713 Save ₹${receivedNum.toLocaleString()}`}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
