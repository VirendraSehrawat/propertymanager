/**
 * The Home tab's "Today" list: what the employee should do today, built from
 * data, each item with one action. Unit items are grouped by building (in
 * walking order); round-wide items (meter round, draft readings) sit on top.
 *
 * Framework-free and side-effect-free so the rules can be unit-tested with a
 * fixed `now`. See `docs/EMPLOYEE_WORKFLOW_IMPROVEMENTS.md` §3.2.
 */

import { buildMeterRound, type RoundUnit } from "@/lib/meterRound";
import { daysBetween, invoiceYm, rentDueDate, startOfDay, ymOf } from "@/lib/paymentDue";

/** Tickets open longer than this many days show up in Today. */
export const STALE_TICKET_DAYS = 3;
/** Leases ending within this many days show up in Today. */
export const LEASE_END_DAYS = 7;

export interface TodayUnit extends RoundUnit {
    status?: string;
    tenantEmail?: string;
    tenantName?: string;
    tenantPhone?: string;
    paymentDay?: number;
    leaseEnd?: string;
}

export interface TodayInvoice {
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

export interface TodayTicket {
    id: string;
    unitId?: string;
    unitNumber?: string;
    buildingName?: string;
    description?: string;
    status?: string;
    createdAt?: string;
}

export type TodayItem =
    | {
          kind: "rent";
          key: string;
          unitId?: string;
          unitNumber: string;
          tenantName?: string;
          tenantPhone?: string;
          /** Oldest open invoice — Record Payment waterfalls the rest. */
          invoiceId: string;
          billingPeriod: string;
          /** Corporate-grouped: settled from the master invoice in Collections. */
          corporate: boolean;
          remaining: number;
          paid: number;
          invoiceCount: number;
          /** 0 = due today, > 0 = days past the due date. */
          daysLate: number;
      }
    | { kind: "ticket"; key: string; ticketId: string; unitNumber: string; description: string; status: string; ageDays: number }
    | { kind: "leaseEnd"; key: string; unitId: string; unitNumber: string; tenantName?: string; leaseEnd: string; daysLeft: number };

export type TodayGeneralItem =
    | { kind: "meterRound"; key: string; billingMonth: string; done: number; total: number; pending: number }
    | { kind: "drafts"; key: string; billingMonth: string; count: number };

export interface TodayGroup {
    buildingName: string;
    items: TodayItem[];
}

export interface TodayList {
    general: TodayGeneralItem[];
    groups: TodayGroup[];
    /** Total actionable items (general + unit items). */
    count: number;
}

export { invoiceYm, rentDueDate };

const byUnitNumber = (a: { unitNumber: string }, b: { unitNumber: string }) =>
    a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true, sensitivity: "base" });
const KIND_ORDER: Record<TodayItem["kind"], number> = { rent: 0, leaseEnd: 1, ticket: 2 };

export function buildTodayList(args: {
    /** Every unit (occupied and vacant) — needed to place old tenants' dues. */
    units: TodayUnit[];
    invoices: TodayInvoice[];
    activeTickets: TodayTicket[];
    buildingNames?: Record<string, string>;
    now: Date;
}): TodayList {
    const { units, invoices, activeTickets, buildingNames = {}, now } = args;
    const unitById = new Map(units.map(u => [u.id, u]));
    const buildingOf = (unitId?: string) => {
        const b = unitId ? unitById.get(unitId)?.buildingId : undefined;
        return (b && buildingNames[b]) || "Other";
    };
    const groups = new Map<string, TodayItem[]>();
    const add = (building: string, item: TodayItem) => {
        if (!groups.has(building)) groups.set(building, []);
        groups.get(building)!.push(item);
    };

    // ── Rent due: one item per unit + tenant, once the oldest open invoice is due.
    type Due = { inv: TodayInvoice; remaining: number; paid: number; due: Date };
    const dueByTenant = new Map<string, Due[]>();
    for (const inv of invoices) {
        if (inv.status !== "unpaid" && inv.status !== "pending") continue;
        const total = Number(inv.totalAmount || 0);
        const paid = Number(inv.amountPaid || 0);
        const remaining = Math.max(0, total - paid);
        const ym = invoiceYm(inv);
        if (remaining <= 0 || !ym) continue;
        const unit = inv.unitId ? unitById.get(inv.unitId) : undefined;
        // The payment day belongs to the unit's current tenant only.
        const sameTenant = unit && (!unit.tenantEmail || !inv.tenantEmail || unit.tenantEmail.toLowerCase() === inv.tenantEmail.toLowerCase());
        const due = rentDueDate(ym, sameTenant ? unit?.paymentDay : undefined);
        if (startOfDay(due) > startOfDay(now)) continue;
        const key = `${inv.unitId || inv.unitNumber}|${(inv.tenantEmail || "").toLowerCase()}`;
        if (!dueByTenant.has(key)) dueByTenant.set(key, []);
        dueByTenant.get(key)!.push({ inv, remaining, paid, due });
    }
    for (const [key, list] of dueByTenant) {
        list.sort((a, b) => a.due.getTime() - b.due.getTime());
        const oldest = list[0].inv;
        const unit = oldest.unitId ? unitById.get(oldest.unitId) : undefined;
        const sameTenant = unit && (!unit.tenantEmail || unit.tenantEmail.toLowerCase() === (oldest.tenantEmail || "").toLowerCase());
        add(buildingOf(oldest.unitId), {
            kind: "rent",
            key: `rent:${key}`,
            unitId: oldest.unitId,
            unitNumber: oldest.unitNumber || unit?.unitNumber || "—",
            tenantName: sameTenant ? unit?.tenantName : undefined,
            tenantPhone: sameTenant ? unit?.tenantPhone : undefined,
            invoiceId: oldest.id,
            billingPeriod: oldest.billingPeriod || "",
            corporate: !!oldest.masterInvoiceId,
            remaining: list.reduce((s, d) => s + d.remaining, 0),
            paid: list.reduce((s, d) => s + d.paid, 0),
            invoiceCount: list.length,
            daysLate: daysBetween(list[0].due, now),
        });
    }

    // ── Tickets open longer than STALE_TICKET_DAYS.
    for (const t of activeTickets) {
        if (t.status === "resolved" || !t.createdAt) continue;
        const ageDays = daysBetween(new Date(t.createdAt), now);
        if (ageDays < STALE_TICKET_DAYS) continue;
        add(t.unitId ? buildingOf(t.unitId) : t.buildingName || "Other", {
            kind: "ticket",
            key: `ticket:${t.id}`,
            ticketId: t.id,
            unitNumber: t.unitNumber || "—",
            description: t.description || "",
            status: t.status || "pending",
            ageDays,
        });
    }

    // ── Leases ending within LEASE_END_DAYS (or already ended) on occupied units.
    for (const u of units) {
        if (u.status !== "occupied" || !u.leaseEnd) continue;
        const end = new Date(u.leaseEnd);
        if (Number.isNaN(end.getTime())) continue;
        const daysLeft = daysBetween(now, end);
        if (daysLeft > LEASE_END_DAYS) continue;
        add(buildingOf(u.id), { kind: "leaseEnd", key: `lease:${u.id}`, unitId: u.id, unitNumber: u.unitNumber, tenantName: u.tenantName, leaseEnd: u.leaseEnd, daysLeft });
    }

    // ── Meter round for this month, and drafts waiting to become invoices.
    const billingMonth = ymOf(now);
    const occupied = units.filter(u => u.status === "occupied");
    const round = buildMeterRound(occupied, invoices, billingMonth, buildingNames);
    const pending = round.total - round.doneCount - round.draftCount;
    const general: TodayGeneralItem[] = [];
    if (pending > 0) {
        general.push({ kind: "meterRound", key: `meter:${billingMonth}`, billingMonth, done: round.doneCount + round.draftCount, total: round.total, pending });
    }
    if (round.draftCount > 0) {
        general.push({ kind: "drafts", key: `drafts:${billingMonth}`, billingMonth, count: round.draftCount });
    }

    const sortedGroups = [...groups.entries()]
        .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })))
        .map(([buildingName, items]) => ({
            buildingName,
            items: items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byUnitNumber(a, b)),
        }));
    const count = general.length + sortedGroups.reduce((s, g) => s + g.items.length, 0);
    return { general, groups: sortedGroups, count };
}
