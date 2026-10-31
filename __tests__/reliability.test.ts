/**
 * Tests for §7 "Reliability on the ground": the history window (7.1), the
 * offline-aware commit (7.2) and idempotent payment commits (7.3).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const onSnapshot = vi.fn();
const batchSet = vi.fn();
vi.mock("firebase/firestore", () => ({
    onSnapshot: (q: unknown, cb: unknown) => onSnapshot(q, cb),
    collection: (_db: unknown, col: string) => ({ col }),
    doc: (parent: { col?: string } | unknown, col?: string, id?: string) =>
        typeof col === "string" ? { col, id } : { col: (parent as { col: string }).col, id: "random" },
    writeBatch: () => ({ set: (ref: unknown, data: unknown) => batchSet(ref, data), update: vi.fn(), commit: () => Promise.resolve() }),
}));

import { extendHistory, historyLabel, historyStart, mergeById, subscribeMerged } from "@/lib/historyWindow";
import { commitOrQueue, getSyncState, clearSyncFailures, savedMessage } from "@/lib/offlineQueue";
import { newIdempotencyKey, reuseOrStart } from "@/lib/idempotency";
import { commitPaymentPlan } from "@/lib/commitPaymentPlan";
import type { PaymentPlan } from "@/lib/paymentPlan";
import type { Firestore } from "firebase/firestore";

describe("history window (7.1)", () => {
    it("starts 3 months before the current month and widens on demand, never narrowing", () => {
        expect(historyStart(new Date(2026, 9, 31))).toBe("2026-07-01");
        expect(historyStart(new Date(2026, 1, 10), 3)).toBe("2025-11-01");
        expect(extendHistory("2026-07-01", "2026-05")).toBe("2026-04-01"); // one month before, for carry-forward
        expect(extendHistory("2026-07-01", "2026-09-14")).toBe("2026-07-01");
        expect(extendHistory("2026-07-01", "all")).toBe("");
        expect(extendHistory("", "2020-01")).toBe("");
        expect(historyLabel("")).toBe("all history");
        expect(historyLabel("2026-07-01")).toMatch(/^since 1 Jul,? 2026$/);
    });

    it("merges query results by id and waits for every query", () => {
        expect(mergeById([[{ id: "a", v: 1 }], [{ id: "a", v: 2 }, { id: "b", v: 3 }]])).toEqual([{ id: "a", v: 2 }, { id: "b", v: 3 }]);
        const callbacks: ((s: unknown) => void)[] = [];
        onSnapshot.mockImplementation((_q, cb) => { callbacks.push(cb); return () => {}; });
        const onChange = vi.fn();
        subscribeMerged([{} as never, {} as never], onChange);
        const snap = (ids: string[]) => ({ docs: ids.map(id => ({ id, data: () => ({ n: id }) })) });
        callbacks[0](snap(["x"]));
        expect(onChange).not.toHaveBeenCalled();
        callbacks[1](snap(["x", "y"]));
        expect(onChange).toHaveBeenLastCalledWith([{ n: "x", id: "x" }, { n: "y", id: "y" }]);
    });
});

describe("commitOrQueue (7.2)", () => {
    beforeEach(() => { vi.useFakeTimers(); clearSyncFailures(); });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it("reports synced when the server answers in time", async () => {
        await expect(commitOrQueue(Promise.resolve())).resolves.toBe("synced");
        expect(getSyncState().pending).toBe(0);
    });

    it("reports queued after the timeout and counts it until the server confirms", async () => {
        let confirm!: () => void;
        const p = commitOrQueue(new Promise<void>(r => { confirm = r; }), 1000);
        expect(getSyncState().pending).toBe(1);
        vi.advanceTimersByTime(1000);
        await expect(p).resolves.toBe("queued");
        confirm();
        await vi.runAllTimersAsync();
        expect(getSyncState().pending).toBe(0);
    });

    it("reports queued at once when the phone is offline, and counts later failures", async () => {
        vi.stubGlobal("navigator", { onLine: false });
        let fail!: (e: Error) => void;
        const p = commitOrQueue(new Promise<void>((_, rej) => { fail = rej; }));
        await expect(p).resolves.toBe("queued");
        vi.spyOn(console, "error").mockImplementation(() => {});
        fail(new Error("permission-denied"));
        await vi.runAllTimersAsync();
        expect(getSyncState()).toMatchObject({ pending: 0, failed: 1, lastError: "permission-denied" });
    });

    it("throws errors that arrive before the write is queued", async () => {
        await expect(commitOrQueue(Promise.reject(new Error("bad")))).rejects.toThrow("bad");
        expect(getSyncState()).toMatchObject({ pending: 0, failed: 0 });
    });

    it("words the toast for queued saves", () => {
        expect(savedMessage("synced", "Saved.")).toBe("Saved.");
        expect(savedMessage("queued", "Saved.")).toMatch(/Saved on this phone/);
    });
});

describe("idempotent payments (7.3)", () => {
    it("reuses the key and plan for the same payment, starts fresh otherwise", () => {
        const build = vi.fn(() => ({ n: Math.random() }));
        const first = reuseOrStart(null, "inv1|500|cash||", build);
        expect(reuseOrStart(first, "inv1|500|cash||", build)).toBe(first);
        const other = reuseOrStart(first, "inv1|600|cash||", build);
        expect(other.key).not.toBe(first.key);
        expect(build).toHaveBeenCalledTimes(2);
        expect(newIdempotencyKey()).toMatch(/^pay_[a-z0-9]+_[a-z0-9]+$/);
    });

    it("commitPaymentPlan derives row ids from the key", async () => {
        batchSet.mockClear();
        const plan = {
            invoiceCreates: [], invoicePatches: [],
            ledgerRows: [], dailyLedgerRow: { data: { amount: 1 } },
        } as unknown as PaymentPlan;
        const res = await commitPaymentPlan({} as Firestore, plan, { idempotencyKey: "pay_k" });
        expect(res).toMatchObject({ dailyLedgerId: "pay_k_d", outcome: "synced" });
        expect(batchSet).toHaveBeenCalledWith({ col: "dailyLedger", id: "pay_k_d" }, { amount: 1 });
    });
});
