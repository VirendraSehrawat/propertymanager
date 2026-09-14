"use client";

import { useState } from "react";
import type { Invoice, MasterInvoice } from "@/types";
import { allocateMasterPayment, type AllocationStrategy } from "@/lib/masterAllocation";
import type { PaymentMode } from "@/lib/payments";

export interface SettleMasterSubmit {
    received: number;
    mode: PaymentMode;
    reference: string;
    note: string;
    kind: "full" | "partial";
}

interface Props {
    master: MasterInvoice;
    childInvoices: Invoice[];
    strategy?: AllocationStrategy;
    isSubmitting: boolean;
    onCancel: () => void;
    onSubmit: (payload: SettleMasterSubmit) => void | Promise<void>;
}

/**
 * Master-invoice settle modal — see `docs/CORPORATE_TENANT_BILLING.md` §4.3.
 *
 * Owns the payment-form state (kind / received / mode / reference / note).
 * Renders a live per-child allocation preview using
 * `allocateMasterPayment`. Auto-selects Partial mode when the master
 * already has prior payments.
 */
export function SettleMasterInvoiceModal({
    master,
    childInvoices,
    strategy = "rent-first-then-electricity",
    isSubmitting,
    onCancel,
    onSubmit,
}: Props) {
    const total = Number(master.totalAmount || 0);
    const prevPaid = Number(master.amountPaid || 0);
    const remaining = Math.max(0, total - prevPaid);

    const [kind, setKind] = useState<"full" | "partial">(prevPaid > 0 ? "partial" : "full");
    const [received, setReceived] = useState<string>(String(remaining));
    const [mode, setMode] = useState<PaymentMode>("bank");
    const [reference, setReference] = useState("");
    const [note, setNote] = useState("");

    const rec = Number(received || 0);
    const preview = allocateMasterPayment(rec, master, childInvoices, strategy);

    const canSubmit = rec > 0 && rec <= remaining && !isSubmitting;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center p-4 z-50 overflow-y-auto" onClick={onCancel}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold">Settle {master.id}</h2>
                        <p className="text-xs text-gray-500 mt-0.5">{master.tenantName} · {master.billingPeriod} · {master.childInvoiceIds.length} unit{master.childInvoiceIds.length !== 1 ? "s" : ""}</p>
                    </div>
                    <button onClick={onCancel} className="text-2xl text-gray-400 hover:text-gray-700">×</button>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
                    <div className="bg-gray-50 border rounded-lg p-2">
                        <p className="text-[10px] text-gray-500 uppercase">Total</p>
                        <p className="font-bold text-gray-800">₹{total.toLocaleString()}</p>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                        <p className="text-[10px] text-green-700 uppercase">Paid</p>
                        <p className="font-bold text-green-800">₹{prevPaid.toLocaleString()}</p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                        <p className="text-[10px] text-amber-700 uppercase">Due</p>
                        <p className="font-bold text-amber-800">₹{remaining.toLocaleString()}</p>
                    </div>
                </div>

                <div className="flex gap-2 mb-3">
                    <button onClick={() => { setKind("full"); setReceived(String(remaining)); }} className={`flex-1 text-xs font-bold py-2 rounded-lg ${kind === "full" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700"}`}>Full ₹{remaining.toLocaleString()}</button>
                    <button onClick={() => setKind("partial")} className={`flex-1 text-xs font-bold py-2 rounded-lg ${kind === "partial" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700"}`}>Partial</button>
                </div>

                <label className="text-[10px] font-bold text-gray-500 uppercase">Amount received</label>
                <input
                    type="number"
                    value={received}
                    onChange={(e) => setReceived(e.target.value)}
                    disabled={kind === "full"}
                    className="w-full border rounded px-3 py-2 text-sm mb-3"
                />

                <div className="grid grid-cols-2 gap-2 mb-3">
                    <select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)} className="border rounded px-3 py-2 text-sm">
                        <option value="bank">Bank transfer</option>
                        <option value="upi">UPI</option>
                        <option value="cheque">Cheque</option>
                        <option value="cash">Cash</option>
                        <option value="other">Other</option>
                    </select>
                    <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference / UTR" className="border rounded px-3 py-2 text-sm" />
                </div>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-full border rounded px-3 py-2 text-sm mb-3" />

                <div className="border rounded-lg overflow-hidden mb-3">
                    <div className="bg-gray-50 px-3 py-2 border-b text-[10px] font-bold uppercase text-gray-500">Allocation preview ({strategy})</div>
                    <div className="divide-y divide-gray-100 max-h-40 overflow-y-auto text-xs">
                        {preview.perChild.map((a) => (
                            <div key={a.invoiceId} className="px-3 py-1.5 flex justify-between">
                                <span>{a.unitNumber}</span>
                                <span className="text-gray-600">
                                    {a.appliedNow > 0
                                        ? <>+₹{a.appliedNow.toLocaleString()} <span className="text-[9px] text-gray-400">({a.towardRent}r + {a.towardElectricity}e)</span></>
                                        : <span className="text-gray-300">—</span>}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="bg-gray-50 px-3 py-2 border-t text-xs flex justify-between">
                        <span className="text-gray-500">Master → {preview.masterStatus}</span>
                        <span className="font-bold">₹{preview.appliedTotal.toLocaleString()}</span>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={onCancel} disabled={isSubmitting} className="flex-1 py-2 text-sm font-bold bg-gray-100 rounded-lg">Cancel</button>
                    <button
                        onClick={() => onSubmit({ received: rec, mode, reference, note, kind })}
                        disabled={!canSubmit}
                        className="flex-1 py-2 text-sm font-bold bg-indigo-600 text-white rounded-lg disabled:bg-gray-300"
                    >
                        {isSubmitting ? "Saving…" : "Record payment"}
                    </button>
                </div>
            </div>
        </div>
    );
}
