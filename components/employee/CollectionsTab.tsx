"use client";

import { useEffect, useRef, useState } from "react";
import { doc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COL } from "@/lib/collections";
import type { Invoice, LedgerEntry, MasterInvoice, Unit } from "@/types";
import {
    composeInvoiceTotal,
    carryForwardFromInvoices,
    carryForwardItems,
    pendingSplit,
} from "@/lib/allocation";
import { buildCollectionPaymentPlan, buildMasterSettlePlan } from "@/lib/paymentPlan";
import { commitPaymentPlan } from "@/lib/commitPaymentPlan";
import { reuseOrStart, type PendingPayment } from "@/lib/idempotency";
import { useSubmitGuard } from "@/lib/useSubmitGuard";
import type { PaymentPlan } from "@/lib/paymentPlan";
import { invoiceContact, matchesInvoiceSearch, unitsById } from "@/lib/invoiceSearch";
import { dueInfo, dueLabel, isSameTenant, sortByDue } from "@/lib/paymentDue";
import { followUpStatus } from "@/lib/followUp";
import { LogFollowUpModal } from "./modals/LogFollowUpModal";
import { notifyPaymentRecorded } from "@/lib/notify";
import { askReason, confirmAction, toast } from "@/components/ui";
import { SettlePaymentModal, type SettlePaymentSubmit } from "./modals/SettlePaymentModal";
import { SettleMasterInvoiceModal, type SettleMasterSubmit } from "./modals/SettleMasterInvoiceModal";
import { savedMessage } from "@/lib/offlineQueue";
import { FirstTimeHint } from "./FirstTimeHint";
import { CustomInvoiceModal } from "./modals/CustomInvoiceModal";

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
    /**
     * When set (e.g. from the Home-page global tenant search), the matching
     * invoice's "Record Payment" modal opens immediately — skips scrolling
     * or filtering the Pending Invoices list entirely. Parent should clear
     * this back to "" once consumed (see `onJumpConsumed`).
     */
    jumpToInvoiceId?: string;
    onJumpConsumed?: () => void;
}

export function CollectionsTab({ allInvoices, occupiedUnits, electricityRate, openTenantProfile, allLedgerEntries = [], masterInvoices = [], userEmail = "employee", jumpToInvoiceId = "", onJumpConsumed }: CollectionsTabProps) {
    // Default: current month label like "September 2026" (matches Invoice.billingPeriod format)
    const currentMonthLabel = new Date().toLocaleString("default", { month: "long", year: "numeric" });
    const [collectionFilter, setCollectionFilter] = useState<string>(currentMonthLabel);
    const [isSettling, setIsSettling] = useState("");
    const [pendingSearch, setPendingSearch] = useState("");
    // Pending list order: by when rent is due (payment day) or by unit number.
    const [pendingSort, setPendingSort] = useState<"due" | "unit">("due");
    // 📝 Log follow-up dialog (§3.5).
    const [followUpFor, setFollowUpFor] = useState<{ unitId: string; remaining: number } | null>(null);

    const [isCustomInvoiceOpen, setIsCustomInvoiceOpen] = useState(false);
    const [isEditInvoiceOpen, setIsEditInvoiceOpen] = useState(false);
    const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);

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

    // Write-off (mark uncollectible — tenant absconded etc.)
    const [writingOff, setWritingOff] = useState("");

    /**
     * One-click self-heal: closes an invoice whose stored amountPaid already
     * covers totalAmount but whose status is still "unpaid" / "pending".
     * Happens when the older DailyLedger auto-settle used strict >= (fixed
     * separately) or when an admin lowered an invoice's total via Edit
     * without also flipping the status.
     */
    async function handleCloseAlreadyPaid(inv: Invoice) {
        setIsSettling(inv.id);
        try {
            await updateDoc(doc(db, COL.invoices, inv.id), {
                status: "paid",
                paidAt: new Date().toISOString(),
            });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
        } finally {
            setIsSettling("");
        }
    }

    async function handleWriteOff(inv: Invoice) {
        const reason = await askReason({
            title: `Write off ${inv.unitNumber} · ${inv.billingPeriod}?`,
            message: "It will be removed from pending collections without recording a payment.",
            reasons: ["Tenant absconded", "Tenant left without paying", "Waived by owner", "Dispute settled"],
            confirmLabel: "Write off",
        });
        if (!reason) return;
        setWritingOff(inv.id);
        try {
            await updateDoc(doc(db, COL.invoices, inv.id), {
                status: "written-off",
                writtenOff: true,
                writtenOffAt: new Date().toISOString(),
                writtenOffBy: userEmail,
                writtenOffReason: reason.trim(),
            });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
        } finally {
            setWritingOff("");
        }
    }

    async function handleReopenWriteOff(inv: Invoice) {
        if (!(await confirmAction({ title: `Reopen ${inv.unitNumber} · ${inv.billingPeriod}?`, message: "It will return to pending collections.", confirmLabel: "Reopen" }))) return;
        setWritingOff(inv.id);
        try {
            const priorPaid = Number(inv.amountPaid || 0);
            const total = Number(inv.totalAmount || 0);
            const nextStatus = priorPaid <= 0 ? "unpaid" : priorPaid >= total ? "paid" : "pending";
            await updateDoc(doc(db, COL.invoices, inv.id), {
                status: nextStatus,
                writtenOff: deleteField(),
                writtenOffAt: deleteField(),
                writtenOffBy: deleteField(),
                writtenOffReason: deleteField(),
            });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
        } finally {
            setWritingOff("");
        }
    }

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
    // Settled collections stream: one row per payment taken (complete or partial),
    // so a day's total is what was actually collected that day. Paid invoices with
    // no ledger payments fall back to a single row for the full amount.
    const lastLedgerAtByInvoice = new Map<string, string>();
    for (const le of allLedgerEntries) {
        if (!le.invoiceId) continue;
        const prev = lastLedgerAtByInvoice.get(le.invoiceId);
        if (!prev || (le.createdAt || "").localeCompare(prev) > 0) {
            lastLedgerAtByInvoice.set(le.invoiceId, le.createdAt || "");
        }
    }
    type SettledRow = Invoice & {
        _rowKey: string;
        _effectiveDate: string;
        _isPartial: boolean;
        /** Amount collected in this payment. */
        _amount: number;
        /** Balance left on the invoice right after this payment. */
        _balanceAfter: number;
        _mode?: string;
        _ref?: string;
    };
    const invoiceById = new Map(allInvoices.map(inv => [inv.id, inv]));
    const settledRows: SettledRow[] = [];
    const invoicesWithPayments = new Set<string>();
    for (const le of allLedgerEntries) {
        if (le.deleted || (le.type !== "payment" && le.type !== "partial-payment")) continue;
        const inv = invoiceById.get(le.invoiceId);
        if (!inv || inv.masterInvoiceId || !(Number(le.amountPaid) > 0)) continue;
        invoicesWithPayments.add(inv.id);
        settledRows.push({
            ...inv,
            _rowKey: le.id,
            _effectiveDate: le.createdAt || "",
            _isPartial: le.type === "partial-payment",
            _amount: Number(le.amountPaid),
            _balanceAfter: Math.max(0, Number(le.balance) || 0),
            _mode: le.paymentMode,
            _ref: le.paymentReference || "",
        });
    }
    for (const inv of allInvoices) {
        if (inv.status !== "paid" || invoicesWithPayments.has(inv.id)) continue;
        settledRows.push({
            ...inv,
            _rowKey: inv.id,
            _effectiveDate: inv.paidAt || lastLedgerAtByInvoice.get(inv.id) || inv.createdAt || "",
            _isPartial: false,
            _amount: Number(inv.totalAmount || 0),
            _balanceAfter: 0,
        });
    }
    const settledInvoices = settledRows.sort((a, b) => b._effectiveDate.localeCompare(a._effectiveDate));
    const [settledLimit, setSettledLimit] = useState(20);
    const [settledFilter, setSettledFilter] = useState("");
    // Name / phone for search and display come from the unit (invoices only carry email).
    const unitMap = unitsById(occupiedUnits);
    const norm = (bp?: string) => (bp || "").replace(/\s*\(.+\)\s*$/, "").trim();
    const filteredSettled = settledInvoices.filter(inv => {
        if (collectionFilter !== "all" && collectionFilter !== "overdue" && norm(inv.billingPeriod) !== collectionFilter) return false;
        return matchesInvoiceSearch(inv, settledFilter, unitMap, [inv.billingPeriod, inv.transactionId]);
    });
    const totalSettledAmount = filteredSettled.reduce((s, inv) => s + inv._amount, 0);
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
    // Pending / Unpaid section renders ALL open invoices (both fully unpaid
    // and partially paid). Partial rows get an amber row + "Add Payment" CTA
    // via `isPartial` inside the row body — see the render below.
    const isPartialInvoice = (inv: Invoice) => {
        const total = Number(inv.totalAmount || 0);
        const paid = Number(inv.amountPaid || 0);
        return paid > 0 && paid < total;
    };
    const partialInvoices = filteredInvoices.filter(isPartialInvoice);
    const today = new Date();
    const searchedInvoices = filteredInvoices.filter(inv => matchesInvoiceSearch(inv, pendingSearch, unitMap));
    // Due today → overdue → due this week → later (pendingInvoices is already in unit order).
    const unpaidInvoices = pendingSort === "due" ? sortByDue(searchedInvoices, unitMap, today) : searchedInvoices;

    // Written-off (uncollectible — tenant absconded etc.). Respects the active month filter.
    const writtenOffInvoices = allInvoices
        .filter(inv => inv.status === "written-off")
        .filter(inv => collectionFilter === "all" || collectionFilter === "overdue" || norm(inv.billingPeriod) === collectionFilter)
        .slice()
        .sort((a, b) => (b.writtenOffAt || b.createdAt || "").localeCompare(a.writtenOffAt || a.createdAt || ""));
    const writtenOffTotal = writtenOffInvoices.reduce((s, inv) => s + Math.max(0, Number(inv.totalAmount || 0) - Number(inv.amountPaid || 0)), 0);
    // Rent-first split of the still-outstanding balance across every open
    // invoice in view. Deducts any partial payments (amountPaid) so the
    // "Pending Rent / Electricity" tiles reflect what's actually due.
    const { totalPendingRent, totalPendingElec } = filteredInvoices.reduce(
        (acc, inv) => {
            const { pendingRent, pendingElectricity } = pendingSplit(inv);
            acc.totalPendingRent += pendingRent;
            acc.totalPendingElec += pendingElectricity;
            return acc;
        },
        { totalPendingRent: 0, totalPendingElec: 0 },
    );

    const overdueCount = pendingInvoices.filter(inv => isOverdue(inv.billingPeriod)).length;
    // Sum outstanding (total − paid) not total, so partial payments are honoured.
    const overdueAmount = pendingInvoices
        .filter(inv => isOverdue(inv.billingPeriod))
        .reduce((sum, inv) => sum + pendingSplit(inv).pendingTotal, 0);

    const openSettleModal = (inv: Invoice) => {
        setSettleInvoice(inv);
    };

    // Jump-to-invoice: Home page's global tenant search can deep-link straight
    // into "Record Payment" for a specific invoice, bypassing the Pending
    // Invoices list/scroll entirely.
    useEffect(() => {
        if (!jumpToInvoiceId) return;
        const inv = allInvoices.find(i => i.id === jumpToInvoiceId);
        if (inv) setSettleInvoice(inv);
        onJumpConsumed?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jumpToInvoiceId]);

    // The unit's other pending invoices — any amount above the selected
    // invoice's balance waterfalls across these (see buildCollectionPaymentPlan).
    const otherPendingFor = (inv: Invoice) => allInvoices.filter(i =>
        i.id !== inv.id &&
        i.unitId === inv.unitId &&
        (i.status === "unpaid" || i.status === "pending") &&
        !i.masterInvoiceId,
    );

    // §7.3: a double tap is ignored, and a retry of the same payment (after an
    // error or timeout) reuses the same plan and idempotency key, so the cash is
    // never recorded twice. Cleared once the payment is saved.
    const submitGuard = useSubmitGuard();
    const pendingPayment = useRef<PendingPayment<PaymentPlan> | null>(null);

    const handleConfirmSettle = (payload: SettlePaymentSubmit) => submitGuard(async () => {
        if (!settleInvoice) return;
        const inv = settleInvoice;
        const { received, mode, reference, note } = payload;
        if (received <= 0) { toast.error("Enter an amount greater than zero."); return; }
        setIsSettling(inv.id);
        try {
            // Build the full write-set (invoice patches + ledger rows + daily
            // ledger inflow) and commit it in a single atomic batch so a
            // settlement can never update an invoice without its ledger row.
            // Amounts above this invoice's balance clear the unit's other
            // pending invoices oldest-first; any remainder becomes an advance.
            // See docs/ATOMIC_TRANSACTIONS_PLAN.md (Phase 3).
            const pending = reuseOrStart(pendingPayment.current, `${inv.id}|${received}|${mode}|${reference.trim()}|${note.trim()}`, () =>
                buildCollectionPaymentPlan({
                    invoice: inv,
                    otherPending: otherPendingFor(inv),
                    received,
                    mode,
                    reference,
                    note,
                    settledBy: userEmail,
                }));
            pendingPayment.current = pending;
            const { plan } = pending;
            const { ledgerIds, outcome } = await commitPaymentPlan(db, plan, { idempotencyKey: pending.key });
            pendingPayment.current = null;
            // Fire-and-forget Telegram notification per invoice paid (outside the atomic unit).
            plan.ledgerRows.forEach((row, i) => {
                if (!row.invoiceId) return; // advance/credit — not tied to an invoice
                notifyPaymentRecorded({
                    invoiceId: row.invoiceId,
                    amount: row.amountPaid,
                    fully: row.type === "payment",
                    mode,
                    reference: reference.trim() || undefined,
                    ledgerId: ledgerIds[i],
                });
            });
            const credit = plan.ledgerRows.find(r => r.type === "credit");
            if (credit) toast.info(savedMessage(outcome, `🪙 ₹${credit.amountPaid.toLocaleString()} recorded as an advance for ${inv.unitNumber}.`));
            else toast.success(savedMessage(outcome, `Payment of ₹${received.toLocaleString()} recorded for ${inv.unitNumber}.`));
            setSettleInvoice(null);
        } catch (error) {
            console.error(error);
            toast.error("Failed to settle invoice. If you try again with the same amount, it won't be recorded twice.");
        } finally {
            setIsSettling("");
        }
    });

    // Helper: get all open (unpaid/pending) invoices for a tenant from previous months only,
    // excluding the invoice being generated/edited and optionally excluding same-month invoices.
    /**
     * Carry-forward items for a tenant, scoped to the month *immediately
     * preceding* the anchor month. Thin wrapper over the shared pure helper
     * `carryForwardItems` (see lib/allocation) so UI and tests share logic.
     */
    function getCarryForwardItems(
        tenantEmail: string,
        excludeInvoiceId?: string,
        anchorMonth?: string,
    ) {
        return carryForwardItems(allInvoices, { tenantEmail, excludeInvoiceId, anchorMonth });
    }

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

            const carryForward = carryForwardFromInvoices(
                allInvoices.filter(i => (i.tenantEmail || "") === (editInvoice.tenantEmail || "")),
                { excludeInvoiceId: editInvoice.id, excludeBillingPeriod: editInvBillingMonth },
            );
            const { total: totalAmount } = composeInvoiceTotal({ baseRent, electricityCharge, carryForward });

            // If existing amountPaid already covers the new (possibly lower)
            // totalAmount, flip the invoice to "paid" — handles the case where
            // an admin lowers rent/elec on an already-partly-paid invoice.
            const existingPaid = Number(editInvoice.amountPaid || 0);
            const shouldClose = existingPaid > 0 && existingPaid >= totalAmount - 0.5;

            await updateDoc(doc(db, COL.invoices, editInvoice.id), {
                baseRent,
                electricityRate: rate,
                electricityConsumed: units,
                previousReading: prevReading,
                currentReading: currReading,
                electricityCharge,
                billingPeriod: editInvBillingMonth,
                ...(carryForward !== 0 ? { carryForward } : { carryForward: deleteField() }),
                totalAmount,
                ...(shouldClose ? { status: "paid", paidAt: new Date().toISOString() } : {}),
            });

            if (editInvoice.unitId && currReading !== Number(editInvoice.currentReading || 0)) {
                await updateDoc(doc(db, COL.units, editInvoice.unitId), { lastMeterReading: currReading });
            }

            toast.success("Invoice updated.\n\nRent: \u20B9" + baseRent + "\nElectricity: " + units + " \u00D7 \u20B9" + rate + " = \u20B9" + electricityCharge + "\nTotal: \u20B9" + totalAmount);
            setIsEditInvoiceOpen(false);
            setEditInvoice(null);
        } catch (error) {
            console.error(error);
            toast.error("Failed to update invoice.");
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

    const pendingMasterPayment = useRef<PendingPayment<PaymentPlan> | null>(null);
    const handleMasterSettle = (m: MasterInvoice, payload: SettleMasterSubmit) => submitGuard(async () => {
        setIsSettlingMaster(true);
        try {
            const children = allInvoices.filter(inv => m.childInvoiceIds.includes(inv.id));
            // Build the entire write-set — master patch, per-child patches,
            // per-child `master-payment` ledger rows, and the single
            // consolidated daily-ledger inflow — and commit it in ONE atomic
            // batch. See docs/ATOMIC_TRANSACTIONS_PLAN.md (Phase 5).
            const pending = reuseOrStart(pendingMasterPayment.current, `${m.id}|${payload.received}|${payload.mode}|${payload.reference.trim()}|${payload.note.trim()}`, () =>
                buildMasterSettlePlan({
                    master: m,
                    children,
                    received: payload.received,
                    mode: payload.mode,
                    reference: payload.reference,
                    note: payload.note,
                    settledBy: userEmail,
                }));
            pendingMasterPayment.current = pending;
            const { outcome } = await commitPaymentPlan(db, pending.plan, { idempotencyKey: pending.key });
            pendingMasterPayment.current = null;
            toast.success(savedMessage(outcome, `Payment of ₹${payload.received.toLocaleString()} recorded for ${m.tenantName || "the corporate invoice"}.`));
            setSettleMaster(null);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
        } finally {
            setIsSettlingMaster(false);
        }
    });

    return (
        <>
            <CustomInvoiceModal isOpen={isCustomInvoiceOpen} onClose={() => setIsCustomInvoiceOpen(false)} units={occupiedUnits} />
            <div className="space-y-4">
                <FirstTimeHint id="collections" title="Recording a payment" helpHref="/employee/help#collect">
                    <p>Every rupee a tenant hands over is recorded here — it also goes into today&apos;s Daily ledger.</p>
                    <p>Tap <b>✓ Settle</b> on the invoice (<b>➕ Add Payment</b> if it is part-paid), pick the mode (cash, UPI, bank…) and add the UPI or bank reference. Got less than the full amount? Tap <b>Other amount…</b>. More than the bill? The extra clears older dues first, then is kept as an advance.</p>
                    <p>The list is sorted by <b>due date</b>; use <b>📝 Log follow-up</b> to note what the tenant said.</p>
                </FirstTimeHint>
                <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Billing Month</label>
                    <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg font-medium">
                        {periods.map(p => <option key={p} value={p}>{p}{p === currentMonthLabel ? " (current)" : ""}</option>)}
                        <option value="all">All Pending ({pendingInvoices.length})</option>
                        {overdueCount > 0 && <option value="overdue">{"\u26A0\uFE0F"} Overdue ({overdueCount})</option>}
                    </select>
                </div>

                <button onClick={() => setIsCustomInvoiceOpen(true)} className="w-full text-sm font-bold bg-indigo-600 text-white px-4 py-2.5 rounded-xl hover:bg-indigo-700">
                    + Custom invoice (days / tasks)
                </button>

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

                {/* Carry Forward Section for Collections */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                    <h3 className="text-sm font-bold text-amber-800 mb-1">Carry Forward (Outstanding from Previous Month)</h3>
                    {(() => {
                        // Group by tenant/unit
                        const carryMap = new Map<string, ReturnType<typeof getCarryForwardItems>>();
                        occupiedUnits.forEach(u => {
                            if (!u.tenantEmail) return;
                            carryMap.set(u.id, getCarryForwardItems(u.tenantEmail, undefined, collectionFilter));
                        });
                        const rows = Array.from(carryMap.entries()).filter(entry => entry[1].length > 0);
                        if (rows.length === 0) return <span className="text-amber-700">No outstanding carry forward for any unit.</span>;
                        return (
                            <div className="space-y-2">
                                {rows.map(([unitId, items]) => {
                                    const unit = occupiedUnits.find(u => u.id === unitId);
                                    return (
                                        <div key={unitId} className="border-b border-amber-100 pb-1 mb-1 last:border-b-0 last:pb-0 last:mb-0">
                                            <span className="font-bold text-amber-900">{unit?.unitNumber || unitId}</span>
                                            <ul className="ml-2 mt-0.5 space-y-0.5">
                                                {items.map(item => (
                                                    <li key={item.id} className="flex justify-between text-xs">
                                                        <span>
                                                            {item.rentDue > 0 && <>🏠 Rent </>}
                                                            {item.elecDue > 0 && <>⚡ Electricity </>}
                                                            <span className="text-gray-500">({item.billingPeriod})</span>
                                                        </span>
                                                        <span className="font-bold">₹{item.totalDue.toLocaleString()}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex justify-between items-center gap-2">
                        <h3 className="text-sm font-bold text-gray-800">Pending Invoices</h3>
                        <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">{unpaidInvoices.length} pending{partialInvoices.length > 0 ? ` · ${partialInvoices.length} partial` : ""}</span>
                    </div>
                    <div className="px-5 py-2 border-b border-gray-100 flex gap-2">
                        <input
                            type="text"
                            value={pendingSearch}
                            onChange={(e) => setPendingSearch(e.target.value)}
                            placeholder="🔍 Search unit, name, phone or email…"
                            className="flex-1 min-w-0 text-xs px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:border-indigo-400"
                        />
                        <select
                            aria-label="Sort pending invoices"
                            value={pendingSort}
                            onChange={(e) => setPendingSort(e.target.value as "due" | "unit")}
                            className="text-xs px-2 py-1.5 border border-gray-300 rounded-md"
                        >
                            <option value="due">📅 By due date</option>
                            <option value="unit">🔢 By unit</option>
                        </select>
                    </div>
                    <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                        {unpaidInvoices.length === 0 ? (
                            <p className="p-6 text-sm text-gray-500 text-center">{pendingSearch.trim() ? `No pending invoices match "${pendingSearch.trim()}".` : "🎉 No pending invoices!"}</p>
                        ) : unpaidInvoices.map(inv => {
                                const rowUnit = unitMap.get(inv.unitId);
                                const due = dueInfo(inv, rowUnit, today);
                                const followUp = rowUnit && isSameTenant(inv, rowUnit) ? followUpStatus(rowUnit, allLedgerEntries, today) : null;
                                const overdue = isOverdue(inv.billingPeriod) || (due !== null && due.daysUntil < 0);
                                const total = Number(inv.totalAmount || 0);
                                const paidSoFar = Number(inv.amountPaid || 0);
                                const remaining = Math.max(0, total - paidSoFar);
                                const isPartial = paidSoFar > 0 && paidSoFar < total;
                                // Self-heal: paid enough but status not flipped (legacy / rounding).
                                const alreadyCovered = paidSoFar >= total - 0.5 && total > 0;
                                return (
                                    <div key={inv.id} className={`px-5 py-4 flex justify-between items-center ${overdue ? "bg-red-50 hover:bg-red-100 border-l-4 border-l-red-400" : isPartial ? "bg-amber-50/40 hover:bg-amber-50 border-l-4 border-l-amber-400" : "hover:bg-gray-50"}`}>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <p className="font-bold text-gray-900">{inv.unitNumber}</p>
                                                {due && (
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${due.daysUntil < 0 ? "bg-red-200 text-red-800" : due.daysUntil === 0 ? "bg-amber-200 text-amber-900" : "bg-gray-100 text-gray-600"}`}>
                                                        {dueLabel(due).toUpperCase()}
                                                    </span>
                                                )}
                                                {isPartial && <span className="text-[9px] font-bold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded">PARTIAL</span>}
                                                {followUp?.promise?.state === "broken" && <span className="text-[9px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded">BROKEN PROMISE</span>}
                                                {followUp?.promise?.state === "dueToday" && <span className="text-[9px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">PROMISED TODAY</span>}
                                                {followUp?.promise?.state === "upcoming" && <span className="text-[9px] font-bold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">PROMISED</span>}
                                            </div>
                                            {(() => {
                                                const { tenantName } = invoiceContact(inv, unitMap);
                                                return tenantName
                                                    ? <p className="text-xs text-gray-700">{tenantName} <span className="text-gray-400">· {inv.tenantEmail}</span></p>
                                                    : <p className="text-xs text-gray-500">{inv.tenantEmail}</p>;
                                            })()}
                                            <p className={`text-xs font-medium mt-0.5 ${overdue ? "text-red-600" : "text-indigo-600"}`}>{inv.billingPeriod}</p>
                                            {followUp?.label && <p className="text-[10px] text-gray-600 mt-0.5">📝 {followUp.label}</p>}
                                            {(inv.rentPeriod || inv.electricityPeriod) && (
                                                <p className="text-[10px] text-gray-500 mt-0.5">
                                                    {inv.rentPeriod && <>🏠 <span className="font-medium">{inv.rentPeriod}</span></>}
                                                    {inv.rentPeriod && inv.electricityPeriod && " · "}
                                                    {inv.electricityPeriod && <>⚡ <span className="font-medium">{inv.electricityPeriod}</span></>}
                                                </p>
                                            )}
                                            {inv.meterPhotoUrl && (
                                                <a href={inv.meterPhotoUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-purple-600 hover:underline mt-0.5 block">📷 Meter photo ({inv.currentReading ?? "—"})</a>
                                            )}
                                            <button onClick={() => { const unit = occupiedUnits.find(u => u.id === inv.unitId); if (unit) openTenantProfile(unit); }} className="text-xs text-indigo-600 hover:underline min-h-11 inline-flex items-center">View Profile {"\u2192"}</button>
                                            {rowUnit && isSameTenant(inv, rowUnit) && (
                                                <button onClick={() => setFollowUpFor({ unitId: rowUnit.id, remaining })} className="text-xs text-gray-600 hover:underline min-h-11 inline-flex items-center ml-4">📝 Log follow-up</button>
                                            )}
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
                                            <div className="flex gap-1.5 flex-wrap justify-end">
                                                <button onClick={() => openEditInvoice(inv)} className="text-xs px-3 min-h-11 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition">{"\u270F\uFE0F"} Edit</button>
                                                {alreadyCovered ? (
                                                    <button onClick={() => handleCloseAlreadyPaid(inv)} disabled={isSettling === inv.id} className="text-xs px-3 min-h-11 bg-emerald-600 hover:bg-emerald-700 rounded-md font-bold transition text-white disabled:opacity-60" title="Amount collected already covers this invoice — mark it paid.">
                                                        {isSettling === inv.id ? "..." : "\u2705 Close (paid)"}
                                                    </button>
                                                ) : (
                                                    <button onClick={() => openSettleModal(inv)} disabled={isSettling === inv.id} className={`text-xs px-3 min-h-11 rounded-md font-bold transition text-white disabled:opacity-60 ${isPartial ? "bg-amber-600 hover:bg-amber-700" : "bg-green-600 hover:bg-green-700"}`}>
                                                        {isSettling === inv.id ? "..." : isPartial ? "\u2795 Add Payment" : "\u2713 Settle"}
                                                    </button>
                                                )}
                                                <button onClick={() => handleWriteOff(inv)} disabled={writingOff === inv.id} className="text-xs px-3 min-h-11 bg-gray-100 text-gray-600 border border-gray-300 rounded-md font-bold hover:bg-gray-200 transition disabled:opacity-60" title="Mark uncollectible (tenant absconded)">
                                                    {writingOff === inv.id ? "..." : "🚫"}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        }
                    </div>
                </div>

                {writtenOffInvoices.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-300 overflow-hidden">
                        <div className="bg-gray-100 px-5 py-3 border-b border-gray-200 flex justify-between items-center gap-3">
                            <div className="min-w-0">
                                <h3 className="text-sm font-bold text-gray-700">🚫 Written Off (uncollectible)</h3>
                                <p className="text-[10px] text-gray-500 mt-0.5">₹{writtenOffTotal.toLocaleString()} removed from pending collections</p>
                            </div>
                            <span className="text-xs font-bold bg-gray-200 text-gray-700 px-2 py-1 rounded-full shrink-0">{writtenOffInvoices.length}</span>
                        </div>
                        <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                            {writtenOffInvoices.map(inv => {
                                const total = Number(inv.totalAmount || 0);
                                const paidSoFar = Number(inv.amountPaid || 0);
                                const remaining = Math.max(0, total - paidSoFar);
                                return (
                                    <div key={inv.id} className="px-5 py-3 flex justify-between items-center bg-gray-50/40">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="font-bold text-gray-700 line-through">{inv.unitNumber}</p>
                                                <span className="text-[9px] font-bold bg-gray-300 text-gray-700 px-1.5 py-0.5 rounded">WRITTEN OFF</span>
                                            </div>
                                            <p className="text-xs text-gray-500">{inv.tenantEmail} · {inv.billingPeriod}</p>
                                            {inv.writtenOffReason && (
                                                <p className="text-[10px] text-gray-600 mt-0.5 italic">&ldquo;{inv.writtenOffReason}&rdquo;</p>
                                            )}
                                            {inv.writtenOffAt && (
                                                <p className="text-[10px] text-gray-400 mt-0.5">by {inv.writtenOffBy || "—"} on {new Date(inv.writtenOffAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                                            )}
                                        </div>
                                        <div className="text-right flex flex-col items-end gap-1.5 shrink-0">
                                            <p className="text-sm font-bold text-gray-500 line-through">₹{remaining.toLocaleString()}</p>
                                            <button onClick={() => handleReopenWriteOff(inv)} disabled={writingOff === inv.id} className="text-[10px] px-2 py-1 bg-white border border-gray-300 rounded text-gray-600 font-bold hover:bg-gray-50 transition disabled:opacity-60">
                                                {writingOff === inv.id ? "..." : "↩ Reopen"}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

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
                            placeholder="Search unit / name / phone / ref"
                            className="text-xs px-2 py-1.5 border border-green-300 rounded-md w-40 focus:outline-none focus:border-green-500"
                        />
                    </div>
                    <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                        {filteredSettled.length === 0 ? (
                            <p className="p-6 text-sm text-gray-500 text-center">No settled collections yet.</p>
                        ) : (() => {
                            // Group settled invoices by activity day (YYYY-MM-DD)
                            const shown = filteredSettled.slice(0, settledLimit);
                            const groups = new Map<string, typeof shown>();
                            shown.forEach(inv => {
                                const src = inv._effectiveDate;
                                const day = src ? src.slice(0, 10) : "unknown";
                                if (!groups.has(day)) groups.set(day, []);
                                groups.get(day)!.push(inv);
                            });
                            const dayKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));
                            return dayKeys.map(day => {
                                const rows = groups.get(day)!;
                                const dayTotal = rows.reduce((s, inv) => s + inv._amount, 0);
                                const dayPartial = rows.filter(r => r._isPartial).reduce((s, r) => s + r._amount, 0);
                                const dayLabel = day === "unknown"
                                    ? "Unknown date"
                                    : new Date(day + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
                                return (
                                    <div key={day}>
                                        <div className="sticky top-0 z-10 bg-green-100/90 backdrop-blur px-5 py-1.5 flex justify-between items-center border-b border-green-200">
                                            <span className="text-[11px] font-bold text-green-900">📅 {dayLabel}</span>
                                            <span className="text-[11px] font-bold text-green-900">{rows.length} · {"\u20B9"}{dayTotal.toLocaleString()}{dayPartial > 0 && <span className="font-medium text-orange-700"> (full ₹{(dayTotal - dayPartial).toLocaleString()} + partial ₹{dayPartial.toLocaleString()})</span>}</span>
                                        </div>
                                        {rows.map(inv => {
                            const isPartial = inv._isPartial;
                            const total = Number(inv.totalAmount || 0);
                            const paidNow = inv._amount;
                            const remaining = inv._balanceAfter;
                            const stillOpen = inv.status === "unpaid" || inv.status === "pending";
                            const activityDate = inv._effectiveDate || inv.paidAt || inv.createdAt;
                            const paidStr = activityDate ? new Date(activityDate).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
                            const txn = inv.transactionId || "";
                            // Decode "MODE:REF" (e.g. "UPI:4XXX8291") produced by Mark-as-Paid
                            const [mode, ref] = inv._mode
                                ? [inv._mode.toUpperCase(), inv._ref || ""]
                                : txn === "CASH_COLLECTED"
                                ? ["CASH", ""]
                                : txn.includes(":")
                                    ? [txn.split(":", 2)[0], txn.split(":", 2)[1]]
                                    : [txn === "DAILY_LEDGER_AUTOSETTLE" ? "LEDGER" : (txn || "—"), ""];
                            return (
                                <div key={inv._rowKey} className={`px-5 py-3 ${isPartial ? "bg-orange-50 hover:bg-orange-100 border-l-4 border-l-orange-400" : "hover:bg-green-50/40"}`}>
                                    <div className="flex justify-between items-start gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-bold text-gray-900">{inv.unitNumber}</p>
                                                {isPartial
                                                    ? <span className="text-[9px] font-bold bg-orange-200 text-orange-800 px-1.5 py-0.5 rounded">PARTIAL</span>
                                                    : <span className="text-[9px] font-bold bg-green-200 text-green-800 px-1.5 py-0.5 rounded">PAID</span>}
                                                {mode !== "—" && <span className="text-[9px] font-bold bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">{mode}</span>}
                                            </div>
                                            <p className="text-xs text-gray-500 truncate">{inv.tenantEmail}</p>
                                            <p className={`text-xs font-medium mt-0.5 ${isPartial ? "text-orange-700" : "text-green-700"}`}>{inv.billingPeriod}</p>
                                            {(inv.rentPeriod || inv.electricityPeriod) && (
                                                <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                                                    {inv.rentPeriod && <>🏠 {inv.rentPeriod}</>}
                                                    {inv.rentPeriod && inv.electricityPeriod && " · "}
                                                    {inv.electricityPeriod && <>⚡ {inv.electricityPeriod}</>}
                                                </p>
                                            )}
                                            <div className="text-[10px] text-gray-500 mt-1 flex gap-2 flex-wrap">
                                                <span>📅 {paidStr}</span>
                                                {ref && <span title="Reference">🔖 {ref}</span>}
                                                {inv.paymentNote && <span>📝 {inv.paymentNote}</span>}
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                                            {isPartial ? (
                                                <>
                                                    <p className="font-bold text-orange-700">₹{paidNow.toLocaleString()}<span className="text-[10px] font-medium text-gray-500"> / ₹{total.toLocaleString()}</span></p>
                                                    <p className="text-[10px] text-orange-700 font-bold">₹{remaining.toLocaleString()} still due</p>
                                                    {stillOpen && (
                                                        <button onClick={() => openSettleModal(inv)} disabled={isSettling === inv.id} className="text-[10px] px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded font-bold transition disabled:opacity-60">
                                                            {isSettling === inv.id ? "..." : "➕ Add Payment"}
                                                        </button>
                                                    )}
                                                </>
                                            ) : (
                                                <>
                                                    <p className="font-bold text-green-700">₹{paidNow.toLocaleString()}{paidNow !== total && <span className="text-[10px] font-medium text-gray-500"> / ₹{total.toLocaleString()}</span>}</p>
                                                    <p className="text-[10px] text-gray-400">Rent: ₹{inv.baseRent || 0} | Elec: ₹{inv.electricityCharge || 0}</p>
                                                </>
                                            )}
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
                    <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800">{"\u270F\uFE0F"} Edit Invoice</h3>
                        <p className="text-xs text-gray-500">{editInvoice.unitNumber} {"\u2014"} {editInvBillingMonth}</p>
                        {/* Carry Forward Breakdown */}
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 space-y-1">
                            <p className="font-bold text-amber-800 mb-1">Carry Forward from Previous Month:</p>
                            {getCarryForwardItems(editInvoice.tenantEmail, editInvoice.id, editInvBillingMonth).length === 0 ? (
                                <span className="text-amber-700">No outstanding carry forward.</span>
                            ) : (
                                getCarryForwardItems(editInvoice.tenantEmail, editInvoice.id, editInvBillingMonth).map(item => (
                                    <div key={item.id} className="flex justify-between items-center">
                                        <span>
                                            {item.rentDue > 0 && <>🏠 <span>Rent</span> </>}
                                            {item.elecDue > 0 && <>⚡ <span>Electricity</span> </>}
                                            <span className="text-gray-500">({item.billingPeriod})</span>
                                        </span>
                                        <span className="font-bold">₹{item.totalDue.toLocaleString()}</span>
                                    </div>
                                ))
                            )}
                        </div>
                        <form onSubmit={handleSaveInvoice} className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Billing Month / Period</label>
                                <input type="text" required value={editInvBillingMonth} onChange={(e) => setEditInvBillingMonth(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. August 2026" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Base Rent ({"\u20B9"})</label>
                                <input type="number" inputMode="decimal" required min="0" value={editInvBaseRent} onChange={(e) => setEditInvBaseRent(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Prev Reading</label>
                                    <input type="number" inputMode="decimal" min="0" value={editInvPrevReading} onChange={(e) => setEditInvPrevReading(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Curr Reading</label>
                                    <input type="number" inputMode="decimal" min="0" value={editInvCurrReading} onChange={(e) => setEditInvCurrReading(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Units Consumed</label>
                                    <input type="number" inputMode="decimal" required min="0" value={editInvUnitsConsumed} onChange={(e) => setEditInvUnitsConsumed(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Rate ({"\u20B9"}/unit)</label>
                                    <input type="number" inputMode="decimal" required min="0" value={editInvElecRate} onChange={(e) => setEditInvElecRate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                </div>
                            </div>
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-1">
                                <p><strong>Electricity:</strong> {Number(editInvUnitsConsumed) || 0} {"\u00D7"} {"\u20B9"}{Number(editInvElecRate) || 0} = {"\u20B9"}{((Number(editInvUnitsConsumed) || 0) * (Number(editInvElecRate) || 0)).toLocaleString()}</p>
                                <p><strong>Estimated Total:</strong> {"\u20B9"}{((Number(editInvBaseRent) || 0) + (Number(editInvUnitsConsumed) || 0) * (Number(editInvElecRate) || 0)).toLocaleString()} <span className="text-gray-400">(+ carry-forward)</span></p>
                            </div>
                            <div className="flex gap-2 pt-2 sticky bottom-0 bg-white pb-1">
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
                    otherPendingInvoices={otherPendingFor(settleInvoice)}
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

            <LogFollowUpModal
                unit={followUpFor ? unitMap.get(followUpFor.unitId) ?? null : null}
                onClose={() => setFollowUpFor(null)}
                currentUserEmail={userEmail}
                remaining={followUpFor?.remaining}
                payments={allLedgerEntries}
            />
        </>
    );
}
