/**
 * Follow-up log and promise-to-pay (§3.5 of
 * `docs/EMPLOYEE_WORKFLOW_IMPROVEMENTS.md`).
 *
 * Each time staff chase a tenant they log an outcome on the unit
 * (`units/{id}.followUps[]`, append-only). The tenant's current promise and
 * its state are *derived*: a promise is kept as soon as any payment for that
 * unit and tenant is recorded after it, so Collections (or any other payment
 * path) closes it without touching the log.
 *
 * Pure and framework-free; dates are local calendar days.
 */

import { daysBetween, dateKey } from "@/lib/paymentDue";
import type { FollowUp, FollowUpOutcome } from "@/types";

export type { FollowUp, FollowUpOutcome };

export const FOLLOW_UP_OUTCOMES: { value: FollowUpOutcome; label: string }[] = [
    { value: "noAnswer", label: "📵 No answer" },
    { value: "promised", label: "🤝 Promised to pay" },
    { value: "partial", label: "➗ Will pay partly" },
    { value: "disputed", label: "⚠️ Disputed" },
];

export interface FollowUpUnit {
    id: string;
    tenantEmail?: string;
    followUps?: FollowUp[];
}

export interface FollowUpPayment {
    unitId?: string;
    tenantEmail?: string;
    amountPaid?: number;
    createdAt?: string;
    deleted?: boolean;
}

export type PromiseState = "upcoming" | "dueToday" | "broken" | "kept";

export interface FollowUpStatus {
    last?: FollowUp;
    /** Days since the last follow-up (0 = today). */
    lastDaysAgo?: number;
    promise?: { date: string; amount?: number; at: string; state: PromiseState };
    /** e.g. "Called 2 days ago · promised Mon 3 Nov". Empty when never contacted. */
    label: string;
}

const isPromise = (f: FollowUp) => (f.outcome === "promised" || f.outcome === "partial") && !!f.promisedDate;
const sameEmail = (a?: string, b?: string) => !a || !b || a.toLowerCase() === b.toLowerCase();

/** The current tenant's follow-ups, oldest first. */
export function tenantFollowUps(unit: FollowUpUnit): FollowUp[] {
    return (unit.followUps || [])
        .filter(f => sameEmail(f.tenantEmail, unit.tenantEmail))
        .slice()
        .sort((a, b) => a.at.localeCompare(b.at));
}

const shortDate = (ymd: string) =>
    new Date(`${ymd}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const ago = (days: number) => (days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);

export function followUpStatus(unit: FollowUpUnit, payments: FollowUpPayment[], now: Date): FollowUpStatus {
    const log = tenantFollowUps(unit);
    if (log.length === 0) return { label: "" };
    const last = log[log.length - 1];
    const lastDaysAgo = daysBetween(new Date(last.at), now);

    // The latest promise counts unless the tenant disputed the dues after making it.
    let promise: FollowUpStatus["promise"];
    const latestPromiseIdx = log.map(isPromise).lastIndexOf(true);
    if (latestPromiseIdx >= 0 && !log.slice(latestPromiseIdx + 1).some(f => f.outcome === "disputed")) {
        const p = log[latestPromiseIdx];
        const kept = payments.some(pay =>
            !pay.deleted && pay.unitId === unit.id && sameEmail(pay.tenantEmail, unit.tenantEmail)
            && Number(pay.amountPaid || 0) > 0 && (pay.createdAt || "") >= p.at);
        const today = dateKey(now);
        const state: PromiseState = kept ? "kept" : p.promisedDate! > today ? "upcoming" : p.promisedDate === today ? "dueToday" : "broken";
        promise = { date: p.promisedDate!, amount: p.promisedAmount, at: p.at, state };
    }

    const parts = [`${last.outcome === "noAnswer" ? "No answer" : "Contacted"} ${ago(lastDaysAgo)}`];
    if (promise && promise.state !== "kept") {
        const amt = promise.amount ? ` ₹${promise.amount.toLocaleString("en-IN")}` : "";
        parts.push(promise.state === "broken" ? `⚠️ broke promise of ${shortDate(promise.date)}` : `promised${amt} ${promise.state === "dueToday" ? "today" : shortDate(promise.date)}`);
    } else if (last.outcome === "disputed") {
        parts.push("disputed");
    }
    return { last, lastDaysAgo, promise, label: parts.join(" · ") };
}

export interface FollowUpInput {
    outcome: FollowUpOutcome;
    promisedDate?: string;
    promisedAmount?: number;
    note?: string;
}

/** Problems that stop the follow-up from being saved; empty when it can be saved. */
export function followUpErrors(input: FollowUpInput, now: Date): string[] {
    const errors: string[] = [];
    if (input.outcome === "promised" || input.outcome === "partial") {
        if (!input.promisedDate) errors.push("Pick the date they promised to pay.");
        else if (input.promisedDate < dateKey(now)) errors.push("The promised date can't be in the past.");
    }
    if (input.outcome === "partial" && !(Number(input.promisedAmount) > 0)) errors.push("Enter the amount they will pay.");
    if (input.outcome === "disputed" && !input.note?.trim()) errors.push("Add a note on what is disputed.");
    return errors;
}

/** The entry appended to `units/{id}.followUps`. Firestore rejects `undefined`, so absent fields are left out. */
export function buildFollowUp(input: FollowUpInput & { tenantEmail?: string; by: string; now: string; id: string }): FollowUp {
    const f: FollowUp = { id: input.id, at: input.now, by: input.by, outcome: input.outcome };
    if (input.tenantEmail) f.tenantEmail = input.tenantEmail;
    if ((input.outcome === "promised" || input.outcome === "partial") && input.promisedDate) f.promisedDate = input.promisedDate;
    if (input.outcome === "partial" && input.promisedAmount) f.promisedAmount = Number(input.promisedAmount);
    if (input.note?.trim()) f.note = input.note.trim();
    return f;
}
