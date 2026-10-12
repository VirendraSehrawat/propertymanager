"use client";

import { useMemo, useState } from "react";
import type { Unit, Invoice, LedgerEntry } from "@/types";
import { searchTenantsAndUnits, buildTenantPaymentSummary, TenantMatch } from "@/lib/paymentLookup";

interface AdminPaymentLookupTabProps {
    allUnits: Unit[];
    allInvoices: Invoice[];
    allLedgerEntries: LedgerEntry[];
}

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function AdminPaymentLookupTab({ allUnits, allInvoices, allLedgerEntries }: AdminPaymentLookupTabProps) {
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<TenantMatch | null>(null);

    const matches = useMemo(() => searchTenantsAndUnits(query, allUnits), [query, allUnits]);

    const summary = useMemo(() => {
        if (!selected) return null;
        return buildTenantPaymentSummary(selected.unitId, selected.tenantEmail, allInvoices, allLedgerEntries);
    }, [selected, allInvoices, allLedgerEntries]);

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-2">🔎 Find Payments — Apartment / Tenant</h2>
                <p className="text-sm text-gray-500 mb-3">
                    Search by unit number, tenant name, email, or phone. Includes past tenants (move-out history) as well as current occupants.
                </p>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
                    placeholder="e.g. 101, Alice, alice@example.com, 98765..."
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                />

                {query.trim() && !selected && (
                    <div className="mt-3 divide-y border rounded-lg overflow-hidden">
                        {matches.length === 0 && (
                            <div className="p-3 text-sm text-gray-500">No matching apartment or tenant found.</div>
                        )}
                        {matches.map((m) => (
                            <button
                                key={`${m.unitId}|${m.tenantEmail}|${m.kind}`}
                                onClick={() => setSelected(m)}
                                className="w-full text-left p-3 hover:bg-gray-50 flex items-center justify-between"
                            >
                                <div>
                                    <div className="font-medium">
                                        Unit {m.unitNumber} — {m.tenantName || m.tenantEmail}
                                        {m.kind === "historical" && (
                                            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                                Past tenant{m.moveOutDate ? ` (moved out ${m.moveOutDate})` : ""}
                                            </span>
                                        )}
                                        {m.kind === "current" && (
                                            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                                                Current
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500">{m.tenantEmail}{m.tenantPhone ? ` · ${m.tenantPhone}` : ""}</div>
                                </div>
                                <span className="text-blue-600 text-sm">View →</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {selected && summary && (
                <div className="bg-white rounded-xl shadow p-4 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                            <h3 className="text-lg font-semibold">
                                Unit {selected.unitNumber} — {selected.tenantName || selected.tenantEmail}
                            </h3>
                            <p className="text-xs text-gray-500">{selected.tenantEmail}{selected.tenantPhone ? ` · ${selected.tenantPhone}` : ""}</p>
                        </div>
                        <button
                            onClick={() => { setSelected(null); }}
                            className="text-sm text-gray-500 hover:text-gray-800"
                        >
                            ← Back to search
                        </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-gray-50 rounded-lg p-3">
                            <div className="text-xs text-gray-500">Total Invoiced</div>
                            <div className="text-lg font-semibold">{money(summary.totals.invoiced)}</div>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3">
                            <div className="text-xs text-gray-500">Total Collected</div>
                            <div className="text-lg font-semibold text-green-700">{money(summary.totals.collected)}</div>
                        </div>
                        <div className={`rounded-lg p-3 ${summary.totals.due > 0 ? "bg-red-50" : "bg-gray-50"}`}>
                            <div className="text-xs text-gray-500">Outstanding Due</div>
                            <div className={`text-lg font-semibold ${summary.totals.due > 0 ? "text-red-700" : ""}`}>{money(summary.totals.due)}</div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                            <div className="text-xs text-gray-500">Invoices / Payments</div>
                            <div className="text-lg font-semibold">{summary.totals.invoiceCount} / {summary.totals.paymentCount}</div>
                        </div>
                    </div>

                    {summary.invoices.length === 0 && (
                        <p className="text-sm text-gray-500">No invoices found for this tenant on this unit yet.</p>
                    )}

                    <div className="space-y-3">
                        {summary.invoices.map((inv) => (
                            <div key={inv.id} className="border rounded-lg p-3">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div className="font-medium">
                                        {inv.id === "__credit__" ? "💰 Unlinked Advance / Credit" : inv.billingPeriod || "—"}
                                    </div>
                                    <div className="text-sm">
                                        <span className="text-gray-500">Billed:</span> {money(Number(inv.totalAmount || 0))}
                                        {" · "}
                                        <span className="text-gray-500">Paid:</span> {money(Number(inv.amountPaid || 0))}
                                        {inv.status && (
                                            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{inv.status}</span>
                                        )}
                                    </div>
                                </div>
                                {inv.payments.length > 0 && (
                                    <table className="w-full text-xs mt-2">
                                        <thead>
                                            <tr className="text-gray-500 text-left">
                                                <th className="py-1">Date</th>
                                                <th className="py-1">Mode</th>
                                                <th className="py-1">Reference / TxID</th>
                                                <th className="py-1 text-right">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {inv.payments.map((p) => (
                                                <tr key={p.id} className="border-t">
                                                    <td className="py-1">{p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN") : "—"}</td>
                                                    <td className="py-1">{p.paymentMode || "—"}</td>
                                                    <td className="py-1">{p.paymentReference || p.transactionId || "—"}</td>
                                                    <td className="py-1 text-right">{money(Number(p.amountPaid || 0))}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
