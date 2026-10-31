/**
 * Tests for the daily payment-reminder job
 * (app/api/notifications/payment-reminders/route.ts): cron-secret auth, dry
 * run, Telegram sends to linked tenants, the admin summary, and never sending
 * the same reminder twice. Firestore (Admin SDK) and Telegram are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendPaymentReminder = vi.fn<(chatId: string, ctx: Record<string, unknown>) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
const sendReminderSummary = vi.fn<(chatId: string, date: string, lines: unknown[]) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
vi.mock("@/lib/telegram/messages", () => ({
    sendPaymentReminder: (chatId: string, ctx: Record<string, unknown>) => sendPaymentReminder(chatId, ctx),
    sendReminderSummary: (chatId: string, date: string, lines: unknown[]) => sendReminderSummary(chatId, date, lines),
}));
vi.mock("@/lib/telegram/recipients", () => ({ getAdminChatId: () => "admin-chat" }));
vi.mock("@/lib/serverAuth", () => ({ getAdminApp: () => ({}) }));

// In-memory Admin SDK stand-in: canned query results + a `paymentReminders` store.
let collections: Record<string, { id: string; data: Record<string, unknown> }[]> = {};
const reminders = new Map<string, Record<string, unknown>>();
vi.mock("firebase-admin/firestore", () => ({
    getFirestore: () => ({
        collection: (name: string) => ({
            where: () => ({
                get: async () => ({ docs: (collections[name] || []).map(d => ({ id: d.id, data: () => d.data })) }),
            }),
            doc: (id: string) => ({
                create: async (data: Record<string, unknown>) => {
                    if (reminders.has(id)) throw new Error("ALREADY_EXISTS");
                    reminders.set(id, data);
                },
                update: async (data: Record<string, unknown>) => { reminders.set(id, { ...reminders.get(id), ...data }); },
            }),
        }),
    }),
}));

import { GET } from "@/app/api/notifications/payment-reminders/route";

const ist = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const [Y, M, D] = ist.split("-").map(Number);
const label = new Date(Y, M - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
// Tomorrow's day of the month in IST (falls back to today on the last day of the month).
const daysInMonth = new Date(Y, M, 0).getDate();

const call = (query = "", auth = "Bearer s3cret") =>
    GET(new Request(`http://x/api/notifications/payment-reminders${query}`, { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    reminders.clear();
    sendPaymentReminder.mockClear();
    sendReminderSummary.mockClear();
    collections = {
        units: [
            { id: "u1", data: { unitNumber: "101", tenantEmail: "a@x.com", tenantName: "Asha", paymentDay: D } },
            { id: "u2", data: { unitNumber: "102", tenantEmail: "b@x.com", tenantName: "Bala", paymentDay: D } },
        ],
        invoices: [
            { id: "i1", data: { unitId: "u1", unitNumber: "101", tenantEmail: "a@x.com", billingPeriod: label, status: "unpaid", totalAmount: 5000 } },
            { id: "i2", data: { unitId: "u2", unitNumber: "102", tenantEmail: "b@x.com", billingPeriod: label, status: "pending", totalAmount: 6000, amountPaid: 1000 } },
        ],
        users: [{ id: "x", data: { email: "A@x.com", telegramChatId: 42, telegramOptIn: true } }],
    };
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("payment-reminders job", () => {
    it("rejects calls without the cron secret", async () => {
        expect((await call("", "")).status).toBe(401);
        expect((await call("", "Bearer wrong")).status).toBe(401);
        vi.stubEnv("CRON_SECRET", "");
        expect((await call()).status).toBe(401);
    });

    it("dry run lists who is due without sending or recording", async () => {
        const body = await (await call("?dryRun=1")).json();
        expect(body.reminders).toEqual([
            expect.objectContaining({ unitNumber: "101", kind: "dueToday", remaining: 5000, telegramLinked: true }),
            expect.objectContaining({ unitNumber: "102", kind: "dueToday", remaining: 5000, telegramLinked: false }),
        ]);
        expect(sendPaymentReminder).not.toHaveBeenCalled();
        expect(reminders.size).toBe(0);
    });

    it("sends to linked tenants, summarises the rest to the admin, and never repeats", async () => {
        const body = await (await call()).json();
        expect(body).toMatchObject({ ok: true, sent: 1, notOnTelegram: 1, alreadyDone: 0 });
        expect(sendPaymentReminder).toHaveBeenCalledWith("42", expect.objectContaining({ kind: "dueToday", unitNumber: "101", remaining: 5000, tenantName: "Asha" }));
        expect(sendReminderSummary).toHaveBeenCalledWith("admin-chat", ist, [
            expect.objectContaining({ unitNumber: "101", sent: true }),
            expect.objectContaining({ unitNumber: "102", sent: false }),
        ]);
        expect([...reminders.values()]).toEqual([
            expect.objectContaining({ unitId: "u1", sentOn: ist, channel: "telegram", ok: true }),
            expect.objectContaining({ unitId: "u2", sentOn: ist, channel: "none", ok: false }),
        ]);

        const again = await (await call()).json();
        expect(again).toMatchObject({ sent: 0, notOnTelegram: 0, alreadyDone: 2 });
        expect(sendPaymentReminder).toHaveBeenCalledTimes(1);
        expect(sendReminderSummary).toHaveBeenCalledTimes(1);
    });

    it("reminds the day before the payment day", async () => {
        if (D === daysInMonth) return; // tomorrow is next month; covered by lib/paymentDue tests
        collections.units = [{ id: "u1", data: { unitNumber: "101", tenantEmail: "a@x.com", paymentDay: D + 1 } }];
        collections.invoices = collections.invoices.slice(0, 1);
        const body = await (await call("?dryRun=1")).json();
        expect(body.reminders).toEqual([expect.objectContaining({ kind: "dueTomorrow" })]);
    });
});
