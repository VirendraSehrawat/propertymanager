/**
 * When is rent due? Shared by the Home "Today" list, the Collections sort and
 * the daily payment-reminder job (§3.2 / §3.4 of
 * `docs/EMPLOYEE_WORKFLOW_IMPROVEMENTS.md`).
 *
 * An invoice is due on the unit's `paymentDay` in its billing month (clamped
 * to short months). Without a payment day it is due on the 1st of the next
 * month, which matches the long-standing "past month = overdue" rule. The
 * payment day belongs to the unit's *current* tenant, so an old tenant's
 * invoice on a re-let unit falls back to the 1st-of-next-month rule.
 *
 * Pure and framework-free; dates are local calendar days.
 */

import { stripBillingPeriodSuffix } from "@/lib/allocation";

export interface DueInvoice {
    id: string;
    unitId?: string;
    unitNumber?: string;
    tenantEmail?: string;
    billingPeriod?: string;
    billingYm?: string;
    status?: string;
    totalAmount?: number;
    amountPaid?: number;
    masterInvoiceId?: string;
}

export interface DueUnit {
    id: string;
    unitNumber?: string;
    tenantEmail?: string;
    tenantName?: string;
    paymentDay?: number;
}

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
export const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const dateKey = (d: Date) => `${ymOf(d)}-${pad(d.getDate())}`;
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);

/** "YYYY-MM" of an invoice's billing month, from `billingYm` or the "October 2026" label. */
export function invoiceYm(inv: Pick<DueInvoice, "billingYm" | "billingPeriod">): string {
    if (inv.billingYm && /^\d{4}-\d{2}$/.test(inv.billingYm)) return inv.billingYm;
    const d = new Date(stripBillingPeriodSuffix(inv.billingPeriod));
    return Number.isNaN(d.getTime()) ? "" : ymOf(d);
}

/** Due date for a billing month: the payment day (clamped), or the 1st of the next month. */
export function rentDueDate(billingYm: string, paymentDay?: number): Date {
    const [y, m] = billingYm.split("-").map(Number);
    if (!paymentDay) return new Date(y, m, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    return new Date(y, m - 1, Math.min(Math.max(1, paymentDay), daysInMonth));
}

/** True when the unit is still let to the invoice's tenant. */
export function isSameTenant(inv: Pick<DueInvoice, "tenantEmail">, unit?: Pick<DueUnit, "tenantEmail">): boolean {
    if (!unit) return false;
    return !unit.tenantEmail || !inv.tenantEmail || unit.tenantEmail.toLowerCase() === inv.tenantEmail.toLowerCase();
}

/** Balance still owed on an open (unpaid / part-paid) invoice; 0 otherwise. */
export function openRemaining(inv: DueInvoice): number {
    if (inv.status !== "unpaid" && inv.status !== "pending") return 0;
    return Math.max(0, Number(inv.totalAmount || 0) - Number(inv.amountPaid || 0));
}

export type DueBucket = "today" | "overdue" | "week" | "later";
/** Collections order: due today → overdue → upcoming this week → later. */
export const DUE_BUCKET_ORDER: Record<DueBucket, number> = { today: 0, overdue: 1, week: 2, later: 3 };

export interface DueInfo {
    due: Date;
    /** Days from today to the due date: 0 = today, negative = days late. */
    daysUntil: number;
    bucket: DueBucket;
}

export function dueInfo(inv: DueInvoice, unit: DueUnit | undefined, now: Date): DueInfo | null {
    const ym = invoiceYm(inv);
    if (!ym) return null;
    const due = rentDueDate(ym, isSameTenant(inv, unit) ? unit?.paymentDay : undefined);
    const daysUntil = daysBetween(now, due);
    const bucket: DueBucket = daysUntil === 0 ? "today" : daysUntil < 0 ? "overdue" : daysUntil <= 7 ? "week" : "later";
    return { due, daysUntil, bucket };
}

/** Short label for a due badge: "Due today", "5d late", "Due Mon 3 Nov". */
export function dueLabel(info: DueInfo): string {
    if (info.daysUntil === 0) return "Due today";
    if (info.daysUntil < 0) return `${-info.daysUntil}d late`;
    if (info.daysUntil === 1) return "Due tomorrow";
    return `Due ${info.due.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}`;
}

/**
 * Sort open invoices for collection: due today, then overdue (most late
 * first), then due this week (soonest first), then later; ties by unit number.
 * Invoices whose month can't be read go last.
 */
export function sortByDue<I extends DueInvoice>(invoices: I[], units: Map<string, DueUnit>, now: Date): I[] {
    const key = (inv: I) => {
        const info = dueInfo(inv, inv.unitId ? units.get(inv.unitId) : undefined, now);
        return info ? [DUE_BUCKET_ORDER[info.bucket], info.daysUntil] : [9, 0];
    };
    return invoices
        .map(inv => ({ inv, k: key(inv) }))
        .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1]
            || String(a.inv.unitNumber || "").localeCompare(String(b.inv.unitNumber || ""), undefined, { numeric: true, sensitivity: "base" }))
        .map(x => x.inv);
}

export type ReminderKind = "dueTomorrow" | "dueToday";

export interface PaymentReminder {
    /** Stable id for de-duplication: one reminder per tenant, kind and due date. */
    key: string;
    kind: ReminderKind;
    unitId: string;
    unitNumber: string;
    tenantEmail: string;
    tenantName?: string;
    /** YYYY-MM-DD the rent is due. */
    dueDate: string;
    /** Total still owed across the tenant's open invoices on this unit. */
    remaining: number;
    invoiceIds: string[];
}

/**
 * Reminders to send today: one per unit + tenant whose rent falls due
 * tomorrow or today, quoting everything still owed on that unit. Corporate
 * (master-invoiced) units and tenants without an email are skipped.
 */
export function paymentRemindersDue(args: { units: DueUnit[]; invoices: DueInvoice[]; now: Date }): PaymentReminder[] {
    const unitById = new Map(args.units.map(u => [u.id, u]));
    const byTenant = new Map<string, { unit: DueUnit; email: string; open: DueInvoice[]; kinds: Map<ReminderKind, Date> }>();
    for (const inv of args.invoices) {
        const remaining = openRemaining(inv);
        if (remaining <= 0 || inv.masterInvoiceId || !inv.unitId || !inv.tenantEmail) continue;
        const unit = unitById.get(inv.unitId);
        if (!unit || !isSameTenant(inv, unit)) continue;
        const key = `${inv.unitId}|${inv.tenantEmail.toLowerCase()}`;
        if (!byTenant.has(key)) byTenant.set(key, { unit, email: inv.tenantEmail, open: [], kinds: new Map() });
        const entry = byTenant.get(key)!;
        entry.open.push(inv);
        const info = dueInfo(inv, unit, args.now);
        if (info?.daysUntil === 1) entry.kinds.set("dueTomorrow", info.due);
        if (info?.daysUntil === 0) entry.kinds.set("dueToday", info.due);
    }
    const out: PaymentReminder[] = [];
    for (const { unit, email, open, kinds } of byTenant.values()) {
        // The day-of reminder wins if both apply (two invoices due on different days).
        const kind: ReminderKind | undefined = kinds.has("dueToday") ? "dueToday" : kinds.has("dueTomorrow") ? "dueTomorrow" : undefined;
        if (!kind) continue;
        const dueDate = dateKey(kinds.get(kind)!);
        out.push({
            key: `${unit.id}_${email.toLowerCase().replace(/[^a-z0-9]/g, "-")}_${kind}_${dueDate}`,
            kind,
            unitId: unit.id,
            unitNumber: unit.unitNumber || open[0].unitNumber || "",
            tenantEmail: email,
            tenantName: unit.tenantName,
            dueDate,
            remaining: open.reduce((s, i) => s + openRemaining(i), 0),
            invoiceIds: open.map(i => i.id),
        });
    }
    return out.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
}
