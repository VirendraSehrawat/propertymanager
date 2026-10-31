/**
 * Pure helpers for the Meter tab's "meter round": the employee walks the
 * building unit by unit, enters each reading, and moves straight on to the
 * next unit that still needs one for the chosen billing month.
 *
 * Framework-free and side-effect-free so ordering and "what's next" logic can
 * be unit-tested without Firestore or React.
 */

import { stripBillingPeriodSuffix } from "@/lib/allocation";

export interface RoundUnit {
    id: string;
    unitNumber: string;
    buildingId?: string;
    /** Reading saved on the round without an invoice yet. */
    meterDraft?: { billingMonth: string };
}

export interface RoundInvoice {
    id: string;
    unitId?: string;
    billingPeriod?: string;
}

export interface RoundStop<U extends RoundUnit> {
    unit: U;
    buildingName: string;
    /** An invoice already exists for this unit and billing month. */
    done: boolean;
    /** Reading saved as a draft for this month; the invoice is still to be generated. */
    drafted: boolean;
}

export interface MeterRound<U extends RoundUnit> {
    /** Every occupied unit in walking order (building, then unit number). */
    stops: RoundStop<U>[];
    doneCount: number;
    /** Units with a draft reading and no invoice yet. */
    draftCount: number;
    total: number;
}

/** "2026-10" → "October 2026" (matches `Invoice.billingPeriod`). */
export function billingMonthLabel(billingMonth: string): string {
    const [y, m] = billingMonth.split("-").map(Number);
    return new Date(y, m - 1).toLocaleString("default", { month: "long", year: "numeric" });
}

/** Deterministic invoice id the Meter tab writes for a unit + billing month. */
export function meterInvoiceId(unitId: string, billingMonth: string): string {
    const [y, m] = billingMonth.split("-");
    return `inv_${unitId}_${m}_${y}`;
}

/**
 * Build the round for a billing month. A unit counts as done when its
 * Meter-tab invoice exists, or any invoice for that unit carries the same
 * billing period (e.g. one generated in bulk by the admin). `extraDoneIds`
 * covers units saved moments ago whose invoice hasn't reached the listener yet.
 */
export function buildMeterRound<U extends RoundUnit>(
    units: U[],
    invoices: RoundInvoice[],
    billingMonth: string,
    buildingNames: Record<string, string> = {},
    extraDoneIds: ReadonlySet<string> = new Set(),
): MeterRound<U> {
    const label = billingMonthLabel(billingMonth);
    const invoiceIds = new Set(invoices.map((i) => i.id));
    const billedUnits = new Set(
        invoices
            .filter((i) => i.unitId && stripBillingPeriodSuffix(i.billingPeriod) === label)
            .map((i) => i.unitId as string),
    );

    const stops = units
        .map((unit) => {
            const done =
                extraDoneIds.has(unit.id) ||
                billedUnits.has(unit.id) ||
                invoiceIds.has(meterInvoiceId(unit.id, billingMonth));
            return {
                unit,
                buildingName: (unit.buildingId && buildingNames[unit.buildingId]) || "Other",
                done,
                drafted: !done && unit.meterDraft?.billingMonth === billingMonth,
            };
        })
        .sort(
            (a, b) =>
                a.buildingName.localeCompare(b.buildingName, undefined, { numeric: true, sensitivity: "base" }) ||
                a.unit.unitNumber.localeCompare(b.unit.unitNumber, undefined, { numeric: true, sensitivity: "base" }),
        );

    const doneCount = stops.filter((s) => s.done).length;
    const draftCount = stops.filter((s) => s.drafted).length;
    return { stops, doneCount, draftCount, total: stops.length };
}

/**
 * The next pending unit after `currentId` in walking order, wrapping around to
 * the start. Units with an invoice or a draft reading are not pending. Returns
 * the first pending unit when `currentId` is empty or not in the round, and
 * `""` when every unit is done.
 */
export function nextPendingUnitId<U extends RoundUnit>(round: MeterRound<U>, currentId = ""): string {
    const { stops } = round;
    const start = stops.findIndex((s) => s.unit.id === currentId);
    for (let step = 1; step <= stops.length; step++) {
        const stop = stops[(start + step + stops.length) % stops.length];
        if (!stop.done && !stop.drafted && stop.unit.id !== currentId) return stop.unit.id;
    }
    return "";
}
