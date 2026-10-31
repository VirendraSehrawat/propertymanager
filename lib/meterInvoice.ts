/**
 * Pure helpers behind the Meter tab and the move-in flow:
 *
 *   - `checkMeterReading`     — sanity checks (reading below previous, spikes).
 *   - `meterOverrideDecision` — what happens when the month's invoice already
 *                               exists, so a paid invoice is never reopened.
 *   - `buildMeterInvoice`     — the invoice fields for one unit + billing month.
 *   - `buildMoveInInvoice`    — the first, pro-rated invoice on move-in.
 *
 * Framework-free: field removals are returned as `clearKeys` so the caller
 * can turn them into Firestore `deleteField()` sentinels.
 */

import { computeElectricityPeriod, computeRentPeriod, toBillingYm } from "@/lib/billingPeriods";
import {
    carryForwardBreakdown,
    carryForwardFromInvoices,
    composeInvoiceTotal,
    stripBillingPeriodSuffix,
} from "@/lib/allocation";
import { billingMonthLabel, meterInvoiceId } from "@/lib/meterRound";

/** Consumption above this multiple of the recent average is flagged. */
export const SPIKE_FACTOR = 2;

export interface MeterUnit {
    id: string;
    unitNumber: string;
    tenantEmail?: string;
    baseRent?: number;
    paymentDay?: number;
    electricityRate?: number;
    lastMeterReading?: number;
}

export interface MeterHistoryInvoice {
    id: string;
    unitId?: string;
    tenantEmail?: string;
    billingPeriod?: string;
    status?: string;
    totalAmount?: number;
    amountPaid?: number;
    baseRent?: number;
    electricityCharge?: number;
    electricityConsumed?: number;
    meterChanged?: boolean;
    isCustom?: boolean;
}

/** What the employee entered for one unit. */
export interface MeterInput {
    previousReading: number;
    currentReading?: number;
    meterChanged?: boolean;
    /** Units typed by hand. Required when the meter changed; an override otherwise. */
    manualUnits?: number;
    manualUnitsReason?: string;
    /** Starting reading of a replacement meter. */
    newMeterReading?: number;
    meterPhotoUrl?: string;
}

// -----------------------------------------------------------------
// Reading sanity checks
// -----------------------------------------------------------------

/** Units billed for the input, before any rate is applied. */
export function unitsFromInput(input: MeterInput): number {
    const manual = Number(input.manualUnits) || 0;
    if (input.meterChanged || manual > 0) return Math.max(0, manual);
    return Math.max(0, (Number(input.currentReading) || 0) - (Number(input.previousReading) || 0));
}

/** Reading stored as the unit's `lastMeterReading` once the invoice is saved. */
export function nextLastReading(input: MeterInput): number {
    if (input.meterChanged) return Number(input.newMeterReading) || 0;
    return Number(input.currentReading) || 0;
}

/**
 * Units billed for this unit in its last `count` regular invoices before the
 * billing month, newest first. Meter-change, transfer and move-in invoices
 * are left out because they don't reflect a normal month.
 */
export function recentConsumption(
    invoices: MeterHistoryInvoice[],
    unitId: string,
    billingMonth: string,
    count = 3,
): number[] {
    return invoices
        .filter((i) =>
            i.unitId === unitId &&
            !i.meterChanged &&
            !i.isCustom &&
            typeof i.electricityConsumed === "number" &&
            stripBillingPeriodSuffix(i.billingPeriod) === (i.billingPeriod || "").trim(),
        )
        .map((i) => ({ ym: toBillingYm(i.billingPeriod), units: Number(i.electricityConsumed) }))
        .filter((r) => r.ym && r.ym < billingMonth)
        .sort((a, b) => b.ym.localeCompare(a.ym))
        .slice(0, count)
        .map((r) => r.units);
}

export interface ReadingCheck {
    unitsConsumed: number;
    /** Current reading is lower than the previous one and nothing explains it. Blocks saving. */
    belowPrevious: boolean;
    /** Average units of the recent months, or null with no history. */
    average: number | null;
    /** Consumption is more than `SPIKE_FACTOR` × the recent average. Needs a second look. */
    isSpike: boolean;
}

export function checkMeterReading(input: MeterInput, history: number[] = []): ReadingCheck {
    const manual = Number(input.manualUnits) || 0;
    const hasReading = input.currentReading !== undefined && !Number.isNaN(Number(input.currentReading));
    const belowPrevious = !input.meterChanged && manual <= 0 && hasReading &&
        Number(input.currentReading) < (Number(input.previousReading) || 0);
    const unitsConsumed = unitsFromInput(input);
    const average = history.length ? Math.round(history.reduce((s, u) => s + u, 0) / history.length) : null;
    const isSpike = !belowPrevious && average !== null && average > 0 && unitsConsumed > SPIKE_FACTOR * average;
    return { unitsConsumed, belowPrevious, average, isSpike };
}

// -----------------------------------------------------------------
// Existing invoice for the month
// -----------------------------------------------------------------

export interface ExistingInvoice {
    status?: string;
    totalAmount?: number;
    amountPaid?: number;
    paidAt?: string;
    transactionId?: string;
    masterInvoiceId?: string;
}

export type OverrideDecision =
    /** No invoice yet for the unit and month. */
    | { kind: "new" }
    /** Replace it. `status` keeps any money already received. */
    | { kind: "override"; status: "unpaid" | "pending" | "paid"; amountPaid: number }
    /** Must be corrected elsewhere, never overwritten from the Meter tab. */
    | { kind: "blocked"; reason: string };

/**
 * Decide how an existing invoice may be replaced. Payments already recorded
 * are kept and the status is recomputed from them against the new total,
 * instead of forcing it back to "unpaid".
 */
export function meterOverrideDecision(existing: ExistingInvoice | null | undefined, newTotal: number): OverrideDecision {
    if (!existing) return { kind: "new" };
    if (existing.masterInvoiceId) {
        return { kind: "blocked", reason: "It is grouped under a corporate invoice. Ungroup it in Collections first." };
    }
    if (existing.status === "written-off") {
        return { kind: "blocked", reason: "It was written off. Ask an admin to restore it first." };
    }
    const amountPaid = Number(existing.amountPaid) || 0;
    if (amountPaid <= 0) return { kind: "override", status: "unpaid", amountPaid: 0 };
    if (amountPaid > newTotal) {
        return {
            kind: "blocked",
            reason: `₹${amountPaid.toLocaleString()} is already paid, more than the new total of ₹${newTotal.toLocaleString()}. Use ✏️ Edit in Collections to correct it.`,
        };
    }
    return { kind: "override", status: amountPaid >= newTotal ? "paid" : "pending", amountPaid };
}

// -----------------------------------------------------------------
// Invoice fields
// -----------------------------------------------------------------

export interface MeterInvoiceResult {
    invoiceId: string;
    billingPeriod: string;
    unitsConsumed: number;
    electricityRate: number;
    electricityCharge: number;
    carryForward: number;
    /** Unpaid earlier invoices making up `carryForward`. */
    carryForwardSources: { invoiceId: string; billingPeriod: string; amount: number }[];
    totalAmount: number;
    /** Value for `units/{id}.lastMeterReading`. */
    lastMeterReading: number;
    decision: OverrideDecision;
    /** Fields to write with `{ merge: true }`. Empty when `decision` is blocked. */
    fields: Record<string, unknown>;
    /** Fields to remove (Firestore `deleteField()`). */
    clearKeys: string[];
}

export function buildMeterInvoice(args: {
    unit: MeterUnit;
    billingMonth: string;
    input: MeterInput;
    defaultRate: number;
    invoices: MeterHistoryInvoice[];
    existing?: ExistingInvoice | null;
    now?: string;
}): MeterInvoiceResult {
    const { unit, billingMonth, input, defaultRate, invoices, existing } = args;
    const now = args.now || new Date().toISOString();
    const invoiceId = meterInvoiceId(unit.id, billingMonth);
    const billingPeriod = billingMonthLabel(billingMonth);

    const unitsConsumed = unitsFromInput(input);
    const electricityRate = Number(unit.electricityRate) > 0 ? Number(unit.electricityRate) : defaultRate;
    const electricityCharge = unitsConsumed * electricityRate;

    const tenantInvoices = invoices.filter((i) => (i.tenantEmail || "") === (unit.tenantEmail || ""));
    const cfOpts = { excludeInvoiceId: invoiceId, excludeBillingPeriod: billingPeriod };
    const carryForward = carryForwardFromInvoices(tenantInvoices, cfOpts);
    const carryForwardSources = carryForwardBreakdown(tenantInvoices, cfOpts)
        .map((s) => ({ invoiceId: s.invoiceId, billingPeriod: s.billingPeriod, amount: s.amount }));
    const carryForwardDetails = carryForwardSources.map((s) => ({ billingPeriod: s.billingPeriod, amount: s.amount }));
    const baseRent = Number(unit.baseRent || 0);
    const { total: totalAmount } = composeInvoiceTotal({ baseRent, electricityCharge, carryForward });

    const decision = meterOverrideDecision(existing, totalAmount);
    const lastMeterReading = nextLastReading(input);
    const result = {
        invoiceId, billingPeriod, unitsConsumed, electricityRate, electricityCharge,
        carryForward, carryForwardSources, totalAmount, lastMeterReading, decision,
    };
    if (decision.kind === "blocked") return { ...result, fields: {}, clearKeys: [] };

    const manual = Number(input.manualUnits) || 0;
    const manualReason = !input.meterChanged && manual > 0
        ? (input.manualUnitsReason || "").trim() || "Manual units entered"
        : "";

    const fields: Record<string, unknown> = {
        unitId: unit.id,
        unitNumber: unit.unitNumber,
        tenantEmail: unit.tenantEmail || "",
        baseRent,
        previousReading: Number(input.previousReading) || 0,
        currentReading: lastMeterReading,
        electricityConsumed: unitsConsumed,
        electricityRate,
        electricityCharge,
        totalAmount,
        billingPeriod,
        billingYm: billingMonth,
        rentPeriod: computeRentPeriod(billingMonth, Number(unit.paymentDay) || undefined),
        electricityPeriod: computeElectricityPeriod(billingMonth),
        createdAt: now,
    };
    const clearKeys: string[] = [];
    const setOrClear = (key: string, value: unknown, keep: boolean) => {
        if (keep) fields[key] = value; else clearKeys.push(key);
    };
    setOrClear("meterChanged", true, Boolean(input.meterChanged));
    setOrClear("manualUnitsReason", manualReason, Boolean(manualReason));
    setOrClear("carryForward", carryForward, carryForward !== 0);
    setOrClear("carryForwardDetails", carryForwardDetails, carryForwardDetails.length > 0);
    setOrClear("meterPhotoUrl", input.meterPhotoUrl, Boolean(input.meterPhotoUrl));

    if (decision.kind === "new" || decision.amountPaid === 0) {
        fields.status = "unpaid";
        fields.transactionId = "";
        if (decision.kind === "override") clearKeys.push("paidAt");
    } else {
        // Money already received stays on the invoice, with its transaction id.
        fields.status = decision.status;
        if (decision.status === "paid") {
            if (!existing?.paidAt) fields.paidAt = now;
        } else {
            clearKeys.push("paidAt");
        }
    }
    return { ...result, fields, clearKeys };
}

// -----------------------------------------------------------------
// First invoice on move-in
// -----------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const FMT_DAY = { day: "numeric", month: "short", year: "numeric" } as const;

function daysInMonth(y: number, m: number): number {
    return new Date(y, m + 1, 0).getDate();
}

export interface MoveInRent {
    rent: number;
    days: number;
    /** True when the move-in day is the payment day, so a full month is charged. */
    fullMonth: boolean;
    /** "15 Oct 2026 – 1 Nov 2026" */
    rentPeriod: string;
    /** "YYYY-MM" of the move-in month. */
    billingMonth: string;
}

/**
 * Rent for the first stay: from the move-in day to the tenant's first payment
 * day in the following month, the point where the next month's Meter round
 * takes over. Charged per day at the move-in month's daily rate.
 *
 *   Move in 15 Oct, pays on the 1st  → 15 Oct – 1 Nov (17 days)
 *   Move in 3 Oct, pays on the 5th   → 3 Oct – 5 Nov (33 days)
 *   Move in 8 Oct, pays on the 8th   → full month
 *
 * `moveInDate` is a local "YYYY-MM-DD" date. Without a payment day the 1st is
 * used, matching `computeRentPeriod`.
 */
export function moveInRent(baseRent: number, moveInDate: string, paymentDay?: number): MoveInRent {
    const [y, m, d] = moveInDate.split("-").map(Number);
    const mi = m - 1;
    const payDay = Math.min(Math.max(1, Number(paymentDay) || 1), 31);
    const endDay = Math.min(payDay, daysInMonth(y, mi + 1));
    const start = new Date(y, mi, d);
    const end = new Date(y, mi + 1, endDay);
    const days = Math.round((Date.UTC(y, mi + 1, endDay) - Date.UTC(y, mi, d)) / DAY_MS);
    const fullMonth = Math.min(payDay, daysInMonth(y, mi)) === d;
    const rent = fullMonth ? baseRent : Math.round((baseRent * days) / daysInMonth(y, mi));
    return {
        rent,
        days,
        fullMonth,
        rentPeriod: `${start.toLocaleDateString("en-IN", FMT_DAY)} – ${end.toLocaleDateString("en-IN", FMT_DAY)}`,
        billingMonth: `${y}-${String(m).padStart(2, "0")}`,
    };
}

/**
 * The first invoice for a tenant moving in: rent from the move-in day, no
 * electricity (the opening reading is recorded instead). Its billing period
 * is "<Month> (Move-in)", so the move-in month's Meter round counts the unit
 * as done.
 */
export function buildMoveInInvoice(args: {
    unit: MeterUnit;
    tenantEmail: string;
    moveInDate: string;
    paymentDay?: number;
    openingReading: number;
    now?: string;
}): { invoiceId: string; fields: Record<string, unknown>; rent: MoveInRent } {
    const { unit, tenantEmail, moveInDate, openingReading } = args;
    const rent = moveInRent(Number(unit.baseRent || 0), moveInDate, args.paymentDay);
    return {
        invoiceId: `inv_${unit.id}_movein_${moveInDate}`,
        rent,
        fields: {
            unitId: unit.id,
            unitNumber: unit.unitNumber,
            tenantEmail,
            baseRent: rent.rent,
            previousReading: openingReading,
            currentReading: openingReading,
            electricityConsumed: 0,
            electricityCharge: 0,
            totalAmount: rent.rent,
            billingPeriod: `${billingMonthLabel(rent.billingMonth)} (Move-in)`,
            billingYm: rent.billingMonth,
            rentPeriod: rent.rentPeriod,
            status: "unpaid",
            transactionId: "",
            isCustom: true,
            manualUnitsReason: rent.fullMonth
                ? `First invoice on move-in (${moveInDate})`
                : `First invoice on move-in (${moveInDate}): ${rent.days} days pro-rated`,
            createdAt: args.now || new Date().toISOString(),
        },
    };
}
