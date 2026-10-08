/**
 * Pure "payment plan" builders — Phase 1 of the atomic-transactions design
 * (see `docs/ATOMIC_TRANSACTIONS_PLAN.md`).
 *
 * These functions compose the existing allocation helpers
 * (`allocatePartialPayment`, `allocateLumpSum`, `allocateMasterPayment`) into a
 * single declarative {@link PaymentPlan} describing EVERY document mutation a
 * payment implies: invoice patches, ledger rows, and (for corporate billing)
 * the master-invoice patch.
 *
 * They are side-effect-free and framework-free so every branch is unit-testable
 * without Firestore. The impure committer in `lib/commitPaymentPlan.ts` turns a
 * plan into a single atomic `writeBatch`.
 *
 * ── Core invariant ──────────────────────────────────────────────────────────
 * Every invoice patch that changes `amountPaid` MUST be accompanied by a ledger
 * row recording that delta. This is what guarantees that full AND partial
 * settlements always appear in the ledger. {@link assertPlanInvariant} checks
 * it and the builders call it before returning.
 */

import { allocatePartialPayment } from "@/lib/allocation";
import { allocateLumpSum, buildTransactionId, type InvoiceLike, type PaymentMode } from "@/lib/payments";
import { allocateMasterPayment, type MasterAllocationResult } from "@/lib/masterAllocation";
import type { Invoice, MasterInvoice } from "@/types";

/**
 * Pool invoice shape for the Daily Ledger waterfall — extends the allocation
 * helper's {@link InvoiceLike} with the identity fields needed to compose
 * ledger rows.
 */
export type InflowInvoice = InvoiceLike & {
    tenantEmail?: string;
    unitNumber?: string;
};

// ---------------------------------------------------------------------------
// Plan shape
// ---------------------------------------------------------------------------

export type LedgerRowType = "payment" | "partial-payment" | "credit" | "master-payment";

/** A ledger document to be created in the same batch as the invoice patch. */
export interface LedgerRowDraft {
    tenantEmail: string;
    unitId?: string;
    unitNumber?: string;
    /** Empty string for a pure credit/advance not tied to an invoice. */
    invoiceId: string;
    billingPeriod: string;
    invoiceAmount: number;
    /** Amount applied in THIS transaction (delta, not cumulative). */
    amountPaid: number;
    /** 0 when cleared, negative when still due, positive for an advance. */
    balance: number;
    type: LedgerRowType;
    transactionId: string;
    settledBy: string;
    createdAt: string;
    /** Optional — present for manual settle flows. */
    paymentMode?: PaymentMode | null;
    paymentReference?: string | null;
    paymentNote?: string | null;
    category?: string | null;
    /** Present for master-child rows so they roll up correctly. */
    masterInvoiceId?: string;
    /** Which logical collection the row belongs to. */
    collection: "ledger" | "ledgerEntries";
}

/** A patch to apply to an invoice document. */
export interface InvoicePatchDraft {
    invoiceId: string;
    patch: Record<string, unknown>;
}

/** An invoice that must be created (auto-created month) before being settled. */
export interface InvoiceCreateDraft {
    invoiceId: string;
    data: Record<string, unknown>;
}

/** A single optional daily-ledger inflow row (real cash movement). */
export interface DailyLedgerRowDraft {
    data: Record<string, unknown>;
}

/** The complete set of writes implied by one logical payment. */
export interface PaymentPlan {
    /** Invoices to create up-front (e.g. auto-created month in Daily Ledger). */
    invoiceCreates: InvoiceCreateDraft[];
    /** Invoice documents to update. */
    invoicePatches: InvoicePatchDraft[];
    /** Ledger rows — one per invoice touched (full OR partial) + optional credit. */
    ledgerRows: LedgerRowDraft[];
    /** Optional master-invoice patch (corporate billing). */
    masterPatch?: { masterInvoiceId: string; patch: Record<string, unknown> };
    /** Optional single daily-ledger inflow row (corporate cash movement). */
    dailyLedgerRow?: DailyLedgerRowDraft;
}

// ---------------------------------------------------------------------------
// Invariant guard
// ---------------------------------------------------------------------------

export class PaymentPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PaymentPlanError";
    }
}

/**
 * Enforce the core invariant: for every invoice patch that mutates
 * `amountPaid`, there is at least one ledger row referencing that invoice.
 * Throws {@link PaymentPlanError} when violated.
 */
export function assertPlanInvariant(plan: PaymentPlan): void {
    const ledgerInvoiceIds = new Set(
        plan.ledgerRows.filter((r) => r.invoiceId).map((r) => r.invoiceId),
    );
    for (const p of plan.invoicePatches) {
        if (Object.prototype.hasOwnProperty.call(p.patch, "amountPaid")) {
            if (!ledgerInvoiceIds.has(p.invoiceId)) {
                throw new PaymentPlanError(
                    `Invoice ${p.invoiceId} changes amountPaid but has no ledger row — ` +
                        `every settlement (full or partial) must be recorded in the ledger.`,
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 1. Collections → "Mark as Paid" (single invoice, full or partial)
// ---------------------------------------------------------------------------

export interface SettlePlanInput {
    invoice: Pick<
        Invoice,
        "id" | "tenantEmail" | "unitId" | "unitNumber" | "billingPeriod" |
        "totalAmount" | "amountPaid" | "baseRent" | "electricityCharge"
    >;
    received: number;
    mode: PaymentMode;
    reference?: string | null;
    note?: string | null;
    settledBy?: string;
    now?: string;
}

/**
 * Build the plan for settling a single invoice (Collections tab). Produces one
 * invoice patch + exactly one ledger row (typed `payment` when fully cleared,
 * `partial-payment` otherwise).
 */
export function buildSettlePlan(input: SettlePlanInput): PaymentPlan {
    const { invoice: inv, received, mode } = input;
    const now = input.now || new Date().toISOString();
    const reference = (input.reference || "").trim();
    const note = (input.note || "").trim();
    const settledBy = input.settledBy || "employee";

    const alloc = allocatePartialPayment(received, {
        totalAmount: Number(inv.totalAmount || 0),
        amountPaid: Number(inv.amountPaid || 0),
        baseRent: Number(inv.baseRent || 0),
        electricityCharge: Number(inv.electricityCharge || 0),
    });
    const txnId = buildTransactionId(mode, reference);

    const patch: Record<string, unknown> = {
        amountPaid: alloc.newAmountPaid,
        status: alloc.status,
        transactionId: txnId,
        ...(alloc.fullyPaid ? { paidAt: now } : {}),
        ...(note ? { paymentNote: note } : {}),
    };

    const ledgerRow: LedgerRowDraft = {
        tenantEmail: inv.tenantEmail || "",
        unitId: inv.unitId,
        unitNumber: inv.unitNumber,
        invoiceId: inv.id,
        billingPeriod: inv.billingPeriod || "Ad-Hoc",
        invoiceAmount: Number(inv.totalAmount || 0),
        amountPaid: Math.max(0, Number(received) || 0),
        balance: alloc.fullyPaid ? 0 : -alloc.newRemaining,
        type: alloc.fullyPaid ? "payment" : "partial-payment",
        transactionId: txnId,
        settledBy,
        createdAt: now,
        paymentMode: mode,
        paymentReference: reference || null,
        paymentNote: note || null,
        collection: "ledger",
    };

    const plan: PaymentPlan = {
        invoiceCreates: [],
        invoicePatches: [{ invoiceId: inv.id, patch }],
        ledgerRows: [ledgerRow],
    };
    assertPlanInvariant(plan);
    return plan;
}

// ---------------------------------------------------------------------------
// 2. Daily Ledger → Inflow auto-settle (lump sum, waterfall across invoices)
// ---------------------------------------------------------------------------

export interface InflowPlanInput {
    amount: number;
    /** Candidate pool for this unit (pending invoices). May be empty. */
    pool: InflowInvoice[];
    unitId?: string;
    category: string;
    transactionId?: string;
    settledBy?: string;
    now?: string;
    /** Resolved tenant/unit identity for ledger rows & any auto-created invoice. */
    tenantEmail?: string;
    unitNumber?: string;
    /**
     * When the pool is empty, the caller may pass a draft invoice to create and
     * settle against. Its `id` seeds the waterfall pool.
     */
    autoInvoice?: InvoiceCreateDraft & { totalAmount: number; billingPeriod: string };
}

/**
 * Build the plan for a Daily Ledger inflow. A single lump sum waterfalls across
 * the unit's pending invoices oldest-first; each invoice touched gets its own
 * ledger row (full → `payment`, partial → `partial-payment`). Any unallocated
 * remainder becomes a `credit` ledger row so cash is never lost.
 */
export function buildInflowPlan(input: InflowPlanInput): PaymentPlan {
    const now = input.now || new Date().toISOString();
    const txnId = input.transactionId || "DAILY_LEDGER_AUTOSETTLE";
    const settledBy = input.settledBy || "employee-daily-ledger";
    const category = input.category;

    const invoiceCreates: InvoiceCreateDraft[] = [];
    let pool = input.pool;

    // Seed an auto-created invoice into the pool when nothing is pending.
    if (pool.length === 0 && input.autoInvoice) {
        const { invoiceId, data, totalAmount, billingPeriod } = input.autoInvoice;
        invoiceCreates.push({ invoiceId, data });
        pool = [{
            id: invoiceId,
            unitId: input.unitId,
            unitNumber: input.unitNumber,
            tenantEmail: input.tenantEmail,
            totalAmount,
            amountPaid: 0,
            billingPeriod,
            status: "unpaid",
        }];
    }

    const result = allocateLumpSum(input.amount, pool, input.unitId, category);

    const invoicePatches: InvoicePatchDraft[] = [];
    const ledgerRows: LedgerRowDraft[] = [];

    for (const line of result.lines) {
        const inv = pool.find((i) => i.id === line.invoiceId);
        const patch: Record<string, unknown> = line.fullySettled
            ? { status: "paid", paidAt: now, amountPaid: line.newAmountPaid, transactionId: txnId }
            : { amountPaid: line.newAmountPaid };
        invoicePatches.push({ invoiceId: line.invoiceId, patch });

        ledgerRows.push({
            tenantEmail: inv?.tenantEmail || input.tenantEmail || "",
            unitId: inv?.unitId ?? input.unitId,
            unitNumber: inv?.unitNumber || input.unitNumber || "",
            invoiceId: line.invoiceId,
            billingPeriod: inv?.billingPeriod || "Ad-Hoc",
            invoiceAmount: Number(inv?.totalAmount || 0),
            amountPaid: line.applied,
            balance: line.remaining === 0 ? 0 : -line.remaining,
            type: line.fullySettled ? "payment" : "partial-payment",
            transactionId: txnId,
            settledBy,
            createdAt: now,
            category,
            collection: "ledger",
        });
    }

    // Unallocated remainder → tenant credit / advance.
    if (result.leftover > 0) {
        ledgerRows.push({
            tenantEmail: input.tenantEmail || "",
            unitId: input.unitId,
            unitNumber: input.unitNumber || "",
            invoiceId: "",
            billingPeriod: "Advance / Credit",
            invoiceAmount: 0,
            amountPaid: result.leftover,
            balance: result.leftover,
            type: "credit",
            transactionId: txnId,
            settledBy,
            createdAt: now,
            category,
            collection: "ledger",
        });
    }

    const plan: PaymentPlan = { invoiceCreates, invoicePatches, ledgerRows };
    assertPlanInvariant(plan);
    return plan;
}

// ---------------------------------------------------------------------------
// 3. Corporate master-invoice settle (master + N children, atomic)
// ---------------------------------------------------------------------------

export interface MasterSettlePlanInput {
    master: Pick<MasterInvoice, "id" | "tenantName" | "billingPeriod" | "totalAmount" | "amountPaid"> & {
        paidAt?: string | null;
    };
    children: Invoice[];
    received: number;
    mode: PaymentMode;
    reference?: string | null;
    note?: string | null;
    settledBy?: string;
    now?: string;
    /** Pre-computed allocation (optional) — mainly for tests. */
    allocation?: MasterAllocationResult;
}

/**
 * Build the plan for settling a corporate master invoice: the master patch,
 * one patch + one `master-payment` ledger row per child that received cash,
 * and a single consolidated daily-ledger inflow row for the real cash movement.
 */
export function buildMasterSettlePlan(input: MasterSettlePlanInput): PaymentPlan {
    const { master, children, received, mode } = input;
    const now = input.now || new Date().toISOString();
    const reference = (input.reference || "").trim();
    const note = (input.note || "").trim();
    const settledBy = input.settledBy || "employee";
    const txnId = buildTransactionId(mode, reference);

    const result = input.allocation || allocateMasterPayment(received, master, children);
    if (result.appliedTotal <= 0) {
        throw new PaymentPlanError("Payment amount must be greater than zero.");
    }

    const masterPatch = {
        masterInvoiceId: master.id,
        patch: {
            amountPaid: result.newMasterAmountPaid,
            status: result.masterStatus,
            paidAt: result.masterStatus === "paid" ? now : master.paidAt || null,
            transactionId: txnId,
            paymentMode: mode,
            paymentReference: reference || null,
            paymentNote: note || null,
        } as Record<string, unknown>,
    };

    const invoicePatches: InvoicePatchDraft[] = [];
    const ledgerRows: LedgerRowDraft[] = [];
    const settledUnits: string[] = [];

    for (const alloc of result.perChild) {
        if (alloc.appliedNow <= 0) continue;
        const child = children.find((c) => c.id === alloc.invoiceId);
        invoicePatches.push({
            invoiceId: alloc.invoiceId,
            patch: {
                amountPaid: alloc.newAmountPaid,
                status: alloc.status,
                paidAt: alloc.status === "paid" ? now : null,
                transactionId: txnId,
                paymentMode: mode,
                paymentReference: reference || null,
            },
        });
        ledgerRows.push({
            tenantEmail: child?.tenantEmail || "",
            unitId: child?.unitId,
            unitNumber: child?.unitNumber,
            invoiceId: alloc.invoiceId,
            masterInvoiceId: master.id,
            billingPeriod: child?.billingPeriod || master.billingPeriod,
            invoiceAmount: Number(child?.totalAmount || 0),
            amountPaid: alloc.appliedNow,
            balance: Math.max(0, Number(child?.totalAmount || 0) - alloc.newAmountPaid),
            type: "master-payment",
            transactionId: txnId,
            settledBy,
            createdAt: now,
            paymentMode: mode,
            paymentReference: reference || null,
            collection: "ledgerEntries",
        });
        if (alloc.unitNumber) settledUnits.push(alloc.unitNumber);
    }

    const dailyLedgerRow: DailyLedgerRowDraft = {
        data: {
            date: now.slice(0, 10),
            direction: "inflow",
            category: "Rent (Master)",
            amount: result.appliedTotal,
            description: `${master.tenantName} · ${master.billingPeriod} · ${settledUnits.join(", ")}`,
            tenantName: master.tenantName,
            invoiceId: master.id,
            paymentMode: mode,
            paymentReference: reference || null,
            note: note || null,
            recordedBy: settledBy,
            createdBy: settledBy,
            createdAt: now,
        },
    };

    const plan: PaymentPlan = {
        invoiceCreates: [],
        invoicePatches,
        ledgerRows,
        masterPatch,
        dailyLedgerRow,
    };
    assertPlanInvariant(plan);
    return plan;
}

/** Total number of document writes a plan implies (for the batch-size guard). */
export function countPlanWrites(plan: PaymentPlan): number {
    return (
        plan.invoiceCreates.length +
        plan.invoicePatches.length +
        plan.ledgerRows.length +
        (plan.masterPatch ? 1 : 0) +
        (plan.dailyLedgerRow ? 1 : 0)
    );
}
