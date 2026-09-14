/**
 * Pure helpers for corporate (multi-unit) master-invoice billing.
 *
 * See `docs/CORPORATE_TENANT_BILLING.md` for the design. All functions here
 * are side-effect free: they compute payloads, do not touch Firestore. The
 * caller assembles a `writeBatch` from the returned plans.
 *
 * Two invariants this module enforces:
 *   1. `master.totalAmount === Σ line.lineTotal`
 *   2. After allocation: `master.amountPaid === Σ child.amountPaid`
 */

import type { Invoice, MasterInvoice, MasterInvoiceLine, Tenant } from "@/types";
import { allocatePartialPayment } from "@/lib/allocation";

// ---------------------------------------------------------------------------
// 1. Rollup — turn N child invoices into master totals + `lines[]` snapshot
// ---------------------------------------------------------------------------

export interface RollupResult {
    lines: MasterInvoiceLine[];
    subtotalRent: number;
    subtotalElectricity: number;
    subtotalCarryForward: number;
    totalAmount: number;
    /** Sum of `amountPaid` already recorded on the children (used to seed
     *  master.amountPaid at grouping time — see §4.5.3 of the design doc). */
    seededAmountPaid: number;
}

export function rollupChildren(children: Invoice[]): RollupResult {
    let subtotalRent = 0;
    let subtotalElectricity = 0;
    let subtotalCarryForward = 0;
    let totalAmount = 0;
    let seededAmountPaid = 0;

    const lines: MasterInvoiceLine[] = children.map((c) => {
        const baseRent = Number(c.baseRent || 0);
        const electricityCharge = Number(c.electricityCharge || 0);
        const carryForward = Number(c.carryForward || 0);
        const lineTotal = Number(c.totalAmount || 0);
        subtotalRent += baseRent;
        subtotalElectricity += electricityCharge;
        subtotalCarryForward += carryForward;
        totalAmount += lineTotal;
        seededAmountPaid += Number(c.amountPaid || 0);
        return {
            invoiceId: c.id,
            unitId: c.unitId,
            unitNumber: c.unitNumber,
            baseRent,
            previousReading: c.previousReading,
            currentReading: c.currentReading,
            electricityConsumed: c.electricityConsumed,
            electricityRate: c.electricityRate,
            electricityCharge,
            carryForward,
            meterChanged: c.meterChanged,
            manualUnitsReason: c.manualUnitsReason,
            lineTotal,
        };
    });

    return { lines, subtotalRent, subtotalElectricity, subtotalCarryForward, totalAmount, seededAmountPaid };
}

// ---------------------------------------------------------------------------
// 2. Grouping — validate + build the master-invoice payload
// ---------------------------------------------------------------------------

export class GroupingError extends Error {
    constructor(public code: GroupingErrorCode, message: string) {
        super(message);
        this.name = "GroupingError";
    }
}

export type GroupingErrorCode =
    | "EMPTY_SELECTION"
    | "MIXED_BILLING_PERIODS"
    | "CHILD_ALREADY_PAID"
    | "CHILD_ALREADY_GROUPED"
    | "TENANT_NOT_CONSOLIDATED";

export interface GroupingInput {
    children: Invoice[];
    tenant: Tenant;
    createdBy?: string;
    /** Optional override of the generated `id`. Default: `MI-YYYY-MM-<slug>`. */
    id?: string;
    /** ISO timestamp for `createdAt`. Defaults to `new Date().toISOString()`. */
    now?: string;
}

/**
 * Pure grouping — validates the selection and returns the master-invoice
 * payload plus the per-child link patch. Does NOT write. The caller assembles
 * these into a `writeBatch`.
 *
 * Throws `GroupingError` on any preflight failure so the UI can surface the
 * exact reason.
 */
export function groupChildInvoices(input: GroupingInput): {
    master: MasterInvoice;
    childPatches: { invoiceId: string; masterInvoiceId: string }[];
} {
    const { children, tenant, createdBy, id, now = new Date().toISOString() } = input;

    if (children.length === 0) {
        throw new GroupingError("EMPTY_SELECTION", "Select at least one invoice to group.");
    }
    if (tenant.billingMode !== "consolidated") {
        throw new GroupingError(
            "TENANT_NOT_CONSOLIDATED",
            `Tenant ${tenant.name} is not in consolidated billing mode.`,
        );
    }

    const billingPeriod = children[0].billingPeriod;
    for (const c of children) {
        if (c.billingPeriod !== billingPeriod) {
            throw new GroupingError(
                "MIXED_BILLING_PERIODS",
                `All grouped invoices must share the same billing period (found ${c.billingPeriod} vs ${billingPeriod}).`,
            );
        }
        if (c.status === "paid") {
            throw new GroupingError(
                "CHILD_ALREADY_PAID",
                `Invoice for unit ${c.unitNumber} is already paid; deselect it and continue.`,
            );
        }
        if (c.masterInvoiceId) {
            throw new GroupingError(
                "CHILD_ALREADY_GROUPED",
                `Invoice for unit ${c.unitNumber} is already grouped under ${c.masterInvoiceId}; ungroup first.`,
            );
        }
    }

    const rollup = rollupChildren(children);
    const masterId = id || defaultMasterId(billingPeriod, tenant);
    const status: MasterInvoice["status"] =
        rollup.seededAmountPaid <= 0
            ? "unpaid"
            : rollup.seededAmountPaid >= rollup.totalAmount
                ? "paid"
                : "partial";

    const master: MasterInvoice = {
        id: masterId,
        tenantId: tenant.id,
        tenantName: tenant.name,
        billingPeriod,
        childInvoiceIds: children.map((c) => c.id),
        lines: rollup.lines,
        subtotalRent: rollup.subtotalRent,
        subtotalElectricity: rollup.subtotalElectricity,
        subtotalCarryForward: rollup.subtotalCarryForward,
        totalAmount: rollup.totalAmount,
        amountPaid: rollup.seededAmountPaid,
        status,
        createdBy,
        createdAt: now,
    };

    return {
        master,
        childPatches: children.map((c) => ({ invoiceId: c.id, masterInvoiceId: masterId })),
    };
}

function slugify(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
}

/** Deterministic default id: `MI-YYYY-MM-<tenantSlug>`. */
export function defaultMasterId(billingPeriod: string, tenant: Tenant): string {
    const d = new Date(billingPeriod);
    const yyyy = isNaN(d.getTime()) ? billingPeriod : String(d.getFullYear());
    const mm = isNaN(d.getTime()) ? "00" : String(d.getMonth() + 1).padStart(2, "0");
    return `MI-${yyyy}-${mm}-${slugify(tenant.name) || tenant.id}`;
}

// ---------------------------------------------------------------------------
// 3. Payment allocation — split a settlement across the child lines
// ---------------------------------------------------------------------------

export type AllocationStrategy = "rent-first-then-electricity" | "pro-rata";

export interface ChildAllocation {
    invoiceId: string;
    unitId: string;
    unitNumber: string;
    /** Amount of THIS transaction applied to the child (delta, not cumulative). */
    appliedNow: number;
    /** Portion of `appliedNow` credited to rent. */
    towardRent: number;
    /** Portion of `appliedNow` credited to electricity. */
    towardElectricity: number;
    /** New cumulative amountPaid on the child after this transaction. */
    newAmountPaid: number;
    /** New status for the child. */
    status: "paid" | "pending" | "unpaid";
}

export interface MasterAllocationResult {
    /** Sum of `appliedNow` across children — always === `received` (or clamped). */
    appliedTotal: number;
    perChild: ChildAllocation[];
    /** Master status after applying. */
    masterStatus: MasterInvoice["status"];
    /** Master.amountPaid after applying (cumulative). */
    newMasterAmountPaid: number;
}

/**
 * Allocate a payment `received` across the master's child invoices. Does not
 * mutate; returns a plan the caller writes.
 *
 * `strategy` defaults to `"rent-first-then-electricity"`, matching how
 * `allocatePartialPayment` treats single invoices — each child is filled
 * rent-first before moving to the next child in unit-number order.
 *
 * Invariant: `Σ perChild.appliedNow === appliedTotal` and
 * `newMasterAmountPaid === master.amountPaid + appliedTotal`.
 */
export function allocateMasterPayment(
    received: number,
    master: Pick<MasterInvoice, "totalAmount" | "amountPaid">,
    children: Invoice[],
    strategy: AllocationStrategy = "rent-first-then-electricity",
): MasterAllocationResult {
    const priorMasterPaid = Math.max(0, Number(master.amountPaid || 0));
    const masterTotal = Math.max(0, Number(master.totalAmount || 0));
    const masterRemaining = Math.max(0, masterTotal - priorMasterPaid);
    const applied = Math.max(0, Math.min(Number(received) || 0, masterRemaining));

    if (children.length === 0 || applied === 0) {
        return {
            appliedTotal: 0,
            perChild: children.map((c) => zeroAllocation(c)),
            masterStatus: deriveMasterStatus(priorMasterPaid, masterTotal),
            newMasterAmountPaid: priorMasterPaid,
        };
    }

    const perChild: ChildAllocation[] =
        strategy === "pro-rata"
            ? allocateProRata(applied, children)
            : allocateSequential(applied, children);

    const newMasterAmountPaid = priorMasterPaid + applied;
    return {
        appliedTotal: applied,
        perChild,
        masterStatus: deriveMasterStatus(newMasterAmountPaid, masterTotal),
        newMasterAmountPaid,
    };
}

function deriveMasterStatus(paid: number, total: number): MasterInvoice["status"] {
    if (paid <= 0) return "unpaid";
    if (paid >= total) return "paid";
    return "partial";
}

function zeroAllocation(c: Invoice): ChildAllocation {
    const prev = Math.max(0, Number(c.amountPaid || 0));
    const total = Math.max(0, Number(c.totalAmount || 0));
    return {
        invoiceId: c.id,
        unitId: c.unitId,
        unitNumber: c.unitNumber,
        appliedNow: 0,
        towardRent: 0,
        towardElectricity: 0,
        newAmountPaid: prev,
        status: prev <= 0 ? "unpaid" : prev >= total ? "paid" : "pending",
    };
}

function sortByUnitNumber(children: Invoice[]): Invoice[] {
    return [...children].sort((a, b) =>
        String(a.unitNumber || "").localeCompare(String(b.unitNumber || ""), undefined, {
            numeric: true,
            sensitivity: "base",
        }),
    );
}

function allocateSequential(applied: number, children: Invoice[]): ChildAllocation[] {
    const ordered = sortByUnitNumber(children);
    const results = new Map<string, ChildAllocation>();
    let remaining = applied;

    for (const c of ordered) {
        if (remaining <= 0) {
            results.set(c.id, zeroAllocation(c));
            continue;
        }
        const alloc = allocatePartialPayment(remaining, {
            totalAmount: c.totalAmount,
            amountPaid: c.amountPaid,
            baseRent: c.baseRent,
            electricityCharge: c.electricityCharge,
        });
        const used = alloc.towardRent + alloc.towardElectricity;
        remaining -= used;
        results.set(c.id, {
            invoiceId: c.id,
            unitId: c.unitId,
            unitNumber: c.unitNumber,
            appliedNow: used,
            towardRent: alloc.towardRent,
            towardElectricity: alloc.towardElectricity,
            newAmountPaid: alloc.newAmountPaid,
            status: alloc.status === "paid" ? "paid" : alloc.newAmountPaid > 0 ? "pending" : "unpaid",
        });
    }
    // Return in original input order for stable UI rendering
    return children.map((c) => results.get(c.id) || zeroAllocation(c));
}

function allocateProRata(applied: number, children: Invoice[]): ChildAllocation[] {
    // Compute each child's remaining share
    const remainingByChild = children.map((c) => ({
        c,
        remaining: Math.max(0, Number(c.totalAmount || 0) - Number(c.amountPaid || 0)),
    }));
    const totalRemaining = remainingByChild.reduce((s, x) => s + x.remaining, 0);
    if (totalRemaining <= 0) return children.map(zeroAllocation);

    // First pass: proportional allocation, floored to whole rupees
    let distributed = 0;
    const raw = remainingByChild.map(({ c, remaining }) => {
        const share = Math.floor((applied * remaining) / totalRemaining);
        const clipped = Math.min(share, remaining);
        distributed += clipped;
        return { c, remaining, share: clipped };
    });

    // Distribute any residual (from flooring) to the children with the largest
    // remaining balance, one rupee at a time — keeps the invariant exact.
    let residual = applied - distributed;
    const sortedForResidual = [...raw].sort((a, b) => b.remaining - a.remaining);
    let i = 0;
    while (residual > 0 && sortedForResidual.length > 0) {
        const slot = sortedForResidual[i % sortedForResidual.length];
        if (slot.share < slot.remaining) {
            slot.share += 1;
            residual -= 1;
        }
        i += 1;
        // Safety exit if nothing more can absorb (shouldn't happen since applied<=totalRemaining)
        if (i > sortedForResidual.length * 2 && residual > 0) break;
    }

    return raw.map(({ c, share }) => {
        const alloc = allocatePartialPayment(share, {
            totalAmount: c.totalAmount,
            amountPaid: c.amountPaid,
            baseRent: c.baseRent,
            electricityCharge: c.electricityCharge,
        });
        return {
            invoiceId: c.id,
            unitId: c.unitId,
            unitNumber: c.unitNumber,
            appliedNow: alloc.towardRent + alloc.towardElectricity,
            towardRent: alloc.towardRent,
            towardElectricity: alloc.towardElectricity,
            newAmountPaid: alloc.newAmountPaid,
            status: alloc.status === "paid" ? "paid" : alloc.newAmountPaid > 0 ? "pending" : "unpaid",
        };
    });
}
