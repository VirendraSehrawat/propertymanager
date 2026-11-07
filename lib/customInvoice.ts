/**
 * Pure helpers for the employee's custom invoice: rent for an arbitrary
 * date range (a few days of a month, or several months) plus optional
 * task / service charges. Framework-free, like `lib/meterInvoice.ts`.
 */

import { billingMonthLabel } from "@/lib/meterRound";
import type { MeterUnit } from "@/lib/meterInvoice";

export interface CustomInvoiceTask {
    description: string;
    amount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FMT_DAY = { day: "numeric", month: "short", year: "numeric" } as const;

function parseDate(s: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
}

/** Days in the inclusive range `from`..`to` ("YYYY-MM-DD"); 0 when invalid. */
export function inclusiveDays(from: string, to: string): number {
    const a = parseDate(from);
    const b = parseDate(to);
    if (!a || !b || b < a) return 0;
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS) + 1;
}

/** Rent for the inclusive range, each day charged at its own month's daily rate. */
export function proratedRent(baseRent: number, from: string, to: string): number {
    const a = parseDate(from);
    if (!a || inclusiveDays(from, to) === 0) return 0;
    const days = inclusiveDays(from, to);
    let total = 0;
    for (let i = 0; i < days; i++) {
        const d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + i);
        const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        total += baseRent / dim;
    }
    return Math.round(total);
}

export function customInvoiceErrors(args: { from: string; to: string; includeRent: boolean; tasks: CustomInvoiceTask[] }): string[] {
    const errs: string[] = [];
    if (args.includeRent && inclusiveDays(args.from, args.to) === 0) errs.push("Pick a valid date range (end on or after start).");
    const tasks = args.tasks.filter(t => t.description.trim() || t.amount);
    if (tasks.some(t => !t.description.trim() || !(t.amount > 0))) errs.push("Each task needs a description and an amount above 0.");
    if (!args.includeRent && tasks.length === 0) errs.push("Add rent days or at least one task.");
    return errs;
}

export function buildCustomInvoice(args: {
    unit: MeterUnit;
    tenantEmail: string;
    from: string;
    to: string;
    includeRent: boolean;
    tasks: CustomInvoiceTask[];
    note?: string;
    now?: string;
}): { invoiceId: string; fields: Record<string, unknown>; rent: number; total: number } {
    const { unit, from } = args;
    const now = args.now || new Date().toISOString();
    const tasks = args.tasks
        .map(t => ({ description: t.description.trim(), amount: Number(t.amount) || 0 }))
        .filter(t => t.description && t.amount > 0);
    const days = args.includeRent ? inclusiveDays(from, args.to) : 0;
    const rent = args.includeRent ? proratedRent(Number(unit.baseRent || 0), from, args.to) : 0;
    const taskTotal = tasks.reduce((s, t) => s + t.amount, 0);
    const total = rent + taskTotal;
    const ym = from.slice(0, 7);
    const parts: string[] = [];
    if (args.includeRent) parts.push(`${days} day${days === 1 ? "" : "s"} rent (${from} to ${args.to})`);
    if (tasks.length) parts.push(`Tasks: ${tasks.map(t => `${t.description} ₹${t.amount}`).join(", ")}`);
    if (args.note?.trim()) parts.push(args.note.trim());
    const fmt = (s: string) => parseDate(s)!.toLocaleDateString("en-IN", FMT_DAY);
    return {
        invoiceId: `inv_${unit.id}_custom_${now.replace(/\D/g, "").slice(0, 14)}`,
        rent,
        total,
        fields: {
            unitId: unit.id,
            unitNumber: unit.unitNumber,
            tenantEmail: args.tenantEmail,
            baseRent: rent,
            previousReading: 0,
            currentReading: 0,
            electricityConsumed: 0,
            electricityCharge: 0,
            totalAmount: total,
            billingPeriod: `${billingMonthLabel(ym)} (Custom)`,
            billingYm: ym,
            ...(args.includeRent ? { rentPeriod: `${fmt(from)} – ${fmt(args.to)}` } : {}),
            ...(tasks.length ? { customItems: tasks } : {}),
            status: "unpaid",
            transactionId: "",
            isCustom: true,
            manualUnitsReason: parts.join(" · "),
            createdAt: now,
        },
    };
}
