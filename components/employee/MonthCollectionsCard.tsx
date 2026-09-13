"use client";

import type { Invoice } from "@/types";
import { collectedSplit } from "@/lib/allocation";

interface MonthCollectionsCardProps {
    /** Currently selected month in `YYYY-MM` format. */
    homeMonth: string;
    /** Setter for the month picker. */
    setHomeMonth: (ym: string) => void;
    /** All invoices; card filters by billingPeriod internally. */
    allInvoices: Invoice[];
}

/**
 * Employee Home tab — "Monthly Collections & Pending" card.
 *
 * Extracted from `app/employee/page.tsx` (previously lines ~1122-1268).
 * All rent-first math now delegates to `collectedSplit` in `lib/allocation`.
 * Zero Firestore reads — parent still owns the `onSnapshot` listener.
 */
export function MonthCollectionsCard({
    homeMonth,
    setHomeMonth,
    allInvoices,
}: MonthCollectionsCardProps) {
    const [yr, mo] = homeMonth.split("-").map(Number);
    const selDate = new Date(yr, mo - 1, 1);
    const selLabel = selDate.toLocaleString("default", {
        month: "long",
        year: "numeric",
    });

    // billingPeriod is stored as e.g. "March 2026" and can have suffixes
    // like " (Transfer)". Strip the suffix before comparing.
    const isSameBillingPeriod = (bp: string | undefined) => {
        if (!bp) return false;
        return bp.replace(/\s*\(.+\)\s*$/, "").trim() === selLabel;
    };
    const monthInvoices = allInvoices.filter((inv) =>
        isSameBillingPeriod(inv.billingPeriod),
    );

    let paidRent = 0;
    let paidElec = 0;
    let dueRent = 0;
    let dueElec = 0;
    let totalBilled = 0;
    let paidInvoices = 0;
    let partialInvoices = 0;
    let unpaidInvoices = 0;

    monthInvoices.forEach((inv) => {
        const rent = Number(inv.baseRent || 0);
        const elec = Number(inv.electricityCharge || 0);
        const total = Number(inv.totalAmount || 0) || rent + elec;
        const {
            collectedRent: pR,
            collectedElectricity: pE,
        } = collectedSplit(inv);
        totalBilled += total;
        paidRent += pR;
        paidElec += pE;
        dueRent += Math.max(0, rent - pR);
        dueElec += Math.max(0, elec - pE);
        const paid = pR + pE;
        if (inv.status === "paid") paidInvoices++;
        else if (paid > 0) partialInvoices++;
        else unpaidInvoices++;
    });

    const collected = paidRent + paidElec;
    const due = dueRent + dueElec;
    const collectPct =
        totalBilled > 0 ? Math.round((collected / totalBilled) * 100) : 0;

    const shiftMonth = (delta: number) => {
        const d = new Date(yr, mo - 1 + delta, 1);
        setHomeMonth(
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        );
    };
    const nowYm = `${new Date().getFullYear()}-${String(
        new Date().getMonth() + 1,
    ).padStart(2, "0")}`;
    const isCurrent = homeMonth === nowYm;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden">
            <div className="bg-indigo-50 px-4 py-3 border-b border-indigo-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        onClick={() => shiftMonth(-1)}
                        className="w-8 h-8 rounded-md bg-white border border-indigo-200 text-indigo-700 font-bold hover:bg-indigo-100"
                    >
                        ‹
                    </button>
                    <div className="min-w-0">
                        <h3 className="text-sm font-bold text-indigo-800 truncate">
                            📅 {selLabel}
                            {isCurrent ? " · Current" : ""}
                        </h3>
                        <p className="text-[10px] text-indigo-600">
                            {monthInvoices.length} invoice
                            {monthInvoices.length !== 1 ? "s" : ""} for this month
                        </p>
                    </div>
                    <button
                        onClick={() => shiftMonth(1)}
                        disabled={isCurrent}
                        className="w-8 h-8 rounded-md bg-white border border-indigo-200 text-indigo-700 font-bold hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        ›
                    </button>
                </div>
                <input
                    type="month"
                    value={homeMonth}
                    max={nowYm}
                    onChange={(e) => setHomeMonth(e.target.value)}
                    className="text-xs px-2 py-1.5 border border-indigo-200 rounded-md bg-white"
                />
            </div>
            <div className="p-4 space-y-3">
                {monthInvoices.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">
                        No invoices generated for {selLabel}.
                    </p>
                ) : (
                    <>
                        {/* Progress bar */}
                        <div>
                            <div className="flex justify-between text-[11px] font-bold text-gray-600 mb-1">
                                <span>
                                    Collected ₹{collected.toLocaleString()} / ₹
                                    {totalBilled.toLocaleString()}
                                </span>
                                <span>{collectPct}%</span>
                            </div>
                            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-green-500 rounded-full transition-all"
                                    style={{ width: `${collectPct}%` }}
                                />
                            </div>
                        </div>

                        {/* Two-column summary */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                <p className="text-[10px] font-bold text-green-700 uppercase">
                                    Collected
                                </p>
                                <p className="text-xl font-bold text-green-800 mt-0.5">
                                    ₹{collected.toLocaleString()}
                                </p>
                                <div className="mt-1.5 space-y-0.5 text-[11px] text-green-700">
                                    <div className="flex justify-between">
                                        <span>🏠 Rent</span>
                                        <span className="font-bold">
                                            ₹{paidRent.toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>⚡ Electricity</span>
                                        <span className="font-bold">
                                            ₹{paidElec.toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                <p className="text-[10px] font-bold text-red-700 uppercase">
                                    Pending
                                </p>
                                <p className="text-xl font-bold text-red-800 mt-0.5">
                                    ₹{due.toLocaleString()}
                                </p>
                                <div className="mt-1.5 space-y-0.5 text-[11px] text-red-700">
                                    <div className="flex justify-between">
                                        <span>🏠 Rent</span>
                                        <span className="font-bold">
                                            ₹{dueRent.toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>⚡ Electricity</span>
                                        <span className="font-bold">
                                            ₹{dueElec.toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Invoice status chips */}
                        <div className="flex gap-2 text-[10px] font-bold">
                            <span className="flex-1 text-center py-1.5 rounded-md bg-green-100 text-green-800">
                                ✓ Paid {paidInvoices}
                            </span>
                            <span className="flex-1 text-center py-1.5 rounded-md bg-amber-100 text-amber-800">
                                ◐ Partial {partialInvoices}
                            </span>
                            <span className="flex-1 text-center py-1.5 rounded-md bg-red-100 text-red-800">
                                ✗ Unpaid {unpaidInvoices}
                            </span>
                        </div>

                        {/* Details toggle */}
                        {unpaidInvoices + partialInvoices > 0 && (
                            <details className="border border-gray-200 rounded-lg">
                                <summary className="px-3 py-2 text-xs font-bold text-gray-700 cursor-pointer hover:bg-gray-50">
                                    📋 Pending Details (
                                    {unpaidInvoices + partialInvoices})
                                </summary>
                                <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
                                    {monthInvoices
                                        .filter((inv) => inv.status !== "paid")
                                        .sort((a, b) =>
                                            String(a.unitNumber || "").localeCompare(
                                                String(b.unitNumber || ""),
                                                undefined,
                                                { numeric: true, sensitivity: "base" },
                                            ),
                                        )
                                        .map((inv) => {
                                            const paid = Number(inv.amountPaid || 0);
                                            const total = Number(inv.totalAmount || 0);
                                            const remaining = Math.max(0, total - paid);
                                            const rent = Number(inv.baseRent || 0);
                                            const elec = Number(inv.electricityCharge || 0);
                                            const rRent = Math.max(0, rent - Math.min(paid, rent));
                                            const rElec = Math.max(0, elec - Math.max(0, paid - rent));
                                            const isPartial = paid > 0 && paid < total;
                                            return (
                                                <div
                                                    key={inv.id}
                                                    className="px-3 py-2 flex justify-between items-start gap-2"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-bold text-gray-900 text-sm">
                                                                {inv.unitNumber}
                                                            </span>
                                                            <span
                                                                className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                                                    isPartial
                                                                        ? "bg-amber-100 text-amber-800"
                                                                        : "bg-red-100 text-red-800"
                                                                }`}
                                                            >
                                                                {isPartial ? "Partial" : "Unpaid"}
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] text-gray-500 truncate">
                                                            {inv.tenantEmail || "—"}
                                                        </p>
                                                        <p className="text-[10px] text-gray-500">
                                                            🏠 ₹{rRent.toLocaleString()} · ⚡ ₹
                                                            {rElec.toLocaleString()}
                                                        </p>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="font-bold text-red-700 text-sm">
                                                            ₹{remaining.toLocaleString()}
                                                        </p>
                                                        {isPartial && (
                                                            <p className="text-[10px] text-gray-500">
                                                                of ₹{total.toLocaleString()}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            </details>
                        )}

                        {/* Paid Details toggle */}
                        {paidInvoices > 0 && (
                            <details className="border border-green-200 rounded-lg">
                                <summary className="px-3 py-2 text-xs font-bold text-green-700 cursor-pointer hover:bg-green-50">
                                    ✅ Paid Details ({paidInvoices})
                                </summary>
                                <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
                                    {monthInvoices
                                        .filter((inv) => inv.status === "paid")
                                        .sort((a, b) =>
                                            (b.paidAt || b.createdAt || "").localeCompare(
                                                a.paidAt || a.createdAt || "",
                                            ),
                                        )
                                        .map((inv) => {
                                            const rent = Number(inv.baseRent || 0);
                                            const elec = Number(inv.electricityCharge || 0);
                                            const total =
                                                Number(inv.totalAmount || 0) || rent + elec;
                                            const paidAmt = Number(inv.amountPaid || 0) || total;
                                            const txn = inv.transactionId || "";
                                            const [mode, ref] =
                                                txn === "CASH_COLLECTED"
                                                    ? ["CASH", ""]
                                                    : txn.includes(":")
                                                        ? [txn.split(":")[0], txn.split(":").slice(1).join(":")]
                                                        : ["", txn];
                                            const paidOn = inv.paidAt
                                                ? new Date(inv.paidAt).toLocaleDateString("en-IN", {
                                                    day: "numeric",
                                                    month: "short",
                                                })
                                                : "";
                                            return (
                                                <div
                                                    key={inv.id}
                                                    className="px-3 py-2 flex justify-between items-start gap-2"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-bold text-gray-900 text-sm">
                                                                {inv.unitNumber}
                                                            </span>
                                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-green-100 text-green-800">
                                                                Paid
                                                            </span>
                                                            {mode && (
                                                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                                                                    {mode}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[10px] text-gray-500 truncate">
                                                            {inv.tenantEmail || "—"}
                                                        </p>
                                                        <p className="text-[10px] text-gray-500">
                                                            🏠 ₹{rent.toLocaleString()} · ⚡ ₹
                                                            {elec.toLocaleString()}
                                                            {paidOn ? ` · ${paidOn}` : ""}
                                                        </p>
                                                        {ref && (
                                                            <p className="text-[10px] text-gray-400 truncate">
                                                                Ref: {ref}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="font-bold text-green-700 text-sm">
                                                            ₹{paidAmt.toLocaleString()}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            </details>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
