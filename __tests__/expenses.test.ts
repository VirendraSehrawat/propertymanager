/**
 * Unit + integration tests for the Expense allocation & settlement feature.
 *
 * Part 1 — pure unit tests for the fund calculation helpers (no Firestore needed).
 * Part 2 — Firestore integration tests against the emulator, verifying that
 *          logging expenses, allocating funds and settling expenses correctly
 *          deduct from the allocated amount.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
    calculateFundSummary,
    filterExpenses,
    buildSettlementUpdate,
    sumAmounts,
} from '@/lib/expenses';

// ============================================================
// PART 1 — Pure unit tests (no database)
// ============================================================

describe('sumAmounts', () => {
    it('sums numeric amounts', () => {
        expect(sumAmounts([{ amount: 100 }, { amount: 250 }, { amount: 50 }])).toBe(400);
    });

    it('coerces string amounts', () => {
        expect(sumAmounts([{ amount: '100' }, { amount: '250.5' }])).toBe(350.5);
    });

    it('returns 0 for an empty list', () => {
        expect(sumAmounts([])).toBe(0);
    });

    it('treats invalid amounts as 0', () => {
        expect(sumAmounts([{ amount: 'abc' }, { amount: 100 }])).toBe(100);
    });
});

describe('calculateFundSummary', () => {
    it('returns all zeros with no data', () => {
        const s = calculateFundSummary([], []);
        expect(s).toEqual({
            totalAllocated: 0,
            settledTotal: 0,
            pendingTotal: 0,
            remaining: 0,
            isOverspent: false,
            overspentBy: 0,
        });
    });

    it('does not deduct unsettled expenses from the allocated amount', () => {
        const s = calculateFundSummary(
            [{ amount: 10000 }],
            [{ amount: 3000 }, { amount: 2000, settled: false }]
        );
        expect(s.totalAllocated).toBe(10000);
        expect(s.settledTotal).toBe(0);
        expect(s.pendingTotal).toBe(5000);
        expect(s.remaining).toBe(10000); // untouched
    });

    it('deducts only settled expenses from the allocated amount', () => {
        const s = calculateFundSummary(
            [{ amount: 10000 }],
            [
                { amount: 3000, settled: true },
                { amount: 2000, settled: false },
                { amount: 1500, settled: true },
            ]
        );
        expect(s.totalAllocated).toBe(10000);
        expect(s.settledTotal).toBe(4500);
        expect(s.pendingTotal).toBe(2000);
        expect(s.remaining).toBe(5500);
        expect(s.isOverspent).toBe(false);
        expect(s.overspentBy).toBe(0);
    });

    it('sums multiple allocations', () => {
        const s = calculateFundSummary(
            [{ amount: 5000 }, { amount: 2500 }, { amount: 2500 }],
            [{ amount: 1000, settled: true }]
        );
        expect(s.totalAllocated).toBe(10000);
        expect(s.remaining).toBe(9000);
    });

    it('flags overspending when settled expenses exceed allocations', () => {
        const s = calculateFundSummary(
            [{ amount: 5000 }],
            [{ amount: 4000, settled: true }, { amount: 2500, settled: true }]
        );
        expect(s.settledTotal).toBe(6500);
        expect(s.remaining).toBe(-1500);
        expect(s.isOverspent).toBe(true);
        expect(s.overspentBy).toBe(1500);
    });

    it('is not overspent when remaining is exactly 0', () => {
        const s = calculateFundSummary([{ amount: 5000 }], [{ amount: 5000, settled: true }]);
        expect(s.remaining).toBe(0);
        expect(s.isOverspent).toBe(false);
    });

    it('handles expenses with no settled field as pending', () => {
        const s = calculateFundSummary([{ amount: 1000 }], [{ amount: 400 }]);
        expect(s.pendingTotal).toBe(400);
        expect(s.settledTotal).toBe(0);
    });
});

describe('filterExpenses', () => {
    const expenses = [
        { id: 'a', amount: 100, settled: true },
        { id: 'b', amount: 200, settled: false },
        { id: 'c', amount: 300 },
    ];

    it('returns everything for "all"', () => {
        expect(filterExpenses(expenses, 'all')).toHaveLength(3);
    });

    it('returns only settled expenses', () => {
        const r = filterExpenses(expenses, 'settled');
        expect(r.map(e => e.id)).toEqual(['a']);
    });

    it('treats missing settled flag as unsettled', () => {
        const r = filterExpenses(expenses, 'unsettled');
        expect(r.map(e => e.id)).toEqual(['b', 'c']);
    });
});

describe('buildSettlementUpdate', () => {
    const DELETE = '__DELETE__';

    it('marks an unsettled expense as settled with metadata', () => {
        const u = buildSettlementUpdate(false, 'staff@test.com', DELETE, '2026-08-31T00:00:00.000Z');
        expect(u).toEqual({
            settled: true,
            settledAt: '2026-08-31T00:00:00.000Z',
            settledBy: 'staff@test.com',
        });
    });

    it('treats undefined as unsettled and settles it', () => {
        const u = buildSettlementUpdate(undefined, 'staff@test.com', DELETE);
        expect(u.settled).toBe(true);
    });

    it('clears settlement metadata when un-settling', () => {
        const u = buildSettlementUpdate(true, 'staff@test.com', DELETE);
        expect(u).toEqual({ settled: false, settledAt: DELETE, settledBy: DELETE });
    });
});

// ============================================================
// PART 2 — Firestore integration tests (emulator)
// ============================================================

const TEST_PREFIX = `__test_exp_${Date.now()}`;
const TEST_BUILDING_ID = `${TEST_PREFIX}_bldg`;
const TEST_USER = `${TEST_PREFIX}_staff@test.com`;

let db: ReturnType<typeof getFirestore>;
const createdDocs: string[] = [];
const trackDoc = (path: string) => createdDocs.push(path);

beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    if (!getApps().length) {
        initializeApp({ projectId: 'property-manager-fb9eb' });
    }
    db = getFirestore(getApp());
});

afterAll(async () => {
    if (createdDocs.length === 0) return;
    const batch = db.batch();
    for (const path of createdDocs) batch.delete(db.doc(path));
    await batch.commit();
    console.log(`🧹 Cleaned up ${createdDocs.length} expense test documents`);
});

async function addAllocation(amount: number, note = 'Test allocation') {
    const ref = db.collection('allocations').doc(`${TEST_PREFIX}_alloc_${amount}_${Math.random().toString(36).slice(2, 8)}`);
    await ref.set({
        amount,
        note,
        date: new Date().toISOString().split('T')[0],
        buildingId: TEST_BUILDING_ID,
        buildingName: 'Test Building',
        createdBy: TEST_USER,
        createdAt: new Date().toISOString(),
    });
    trackDoc(ref.path);
    return ref;
}

async function addExpense(amount: number, description = 'Test expense', category = 'Maintenance') {
    const ref = db.collection('expenses').doc(`${TEST_PREFIX}_exp_${Math.random().toString(36).slice(2, 8)}`);
    await ref.set({
        amount,
        category,
        description,
        date: new Date().toISOString().split('T')[0],
        buildingId: TEST_BUILDING_ID,
        buildingName: 'Test Building',
        createdBy: TEST_USER,
        createdAt: new Date().toISOString(),
    });
    trackDoc(ref.path);
    return ref;
}

async function fetchTestData() {
    const [allocSnap, expSnap] = await Promise.all([
        db.collection('allocations').where('createdBy', '==', TEST_USER).get(),
        db.collection('expenses').where('createdBy', '==', TEST_USER).get(),
    ]);
    return {
        allocations: allocSnap.docs.map(d => d.data() as { amount: number }),
        expenses: expSnap.docs.map(d => d.data() as { amount: number; settled?: boolean }),
    };
}

describe('Expense & settlement — Firestore integration', () => {
    it('creates an expense that defaults to unsettled', async () => {
        const ref = await addExpense(1200, 'Plumbing repair', 'Plumbing');
        const snap = await ref.get();
        const data = snap.data()!;

        expect(snap.exists).toBe(true);
        expect(data.amount).toBe(1200);
        expect(data.category).toBe('Plumbing');
        expect(data.settled).toBeUndefined(); // unsettled by default
    });

    it('creates an allocation with the correct amount', async () => {
        const ref = await addAllocation(20000, 'Monthly maintenance fund');
        const data = (await ref.get()).data()!;

        expect(data.amount).toBe(20000);
        expect(data.note).toBe('Monthly maintenance fund');
        expect(data.buildingId).toBe(TEST_BUILDING_ID);
    });

    it('does not change the remaining fund until an expense is settled', async () => {
        const before = await fetchTestData();
        const summaryBefore = calculateFundSummary(before.allocations, before.expenses);

        await addExpense(800, 'Unsettled supplies');

        const after = await fetchTestData();
        const summaryAfter = calculateFundSummary(after.allocations, after.expenses);

        expect(summaryAfter.remaining).toBe(summaryBefore.remaining);
        expect(summaryAfter.pendingTotal).toBe(summaryBefore.pendingTotal + 800);
    });

    it('deducts the expense from the allocated amount when settled', async () => {
        const expenseRef = await addExpense(2500, 'Electrical rewiring', 'Electrical');

        const before = calculateFundSummary(
            (await fetchTestData()).allocations,
            (await fetchTestData()).expenses
        );

        // Settle it — mirrors handleToggleExpenseSettled
        await expenseRef.update(
            buildSettlementUpdate(false, TEST_USER, FieldValue.delete()) as Record<string, unknown>
        );

        const settled = (await expenseRef.get()).data()!;
        expect(settled.settled).toBe(true);
        expect(settled.settledBy).toBe(TEST_USER);
        expect(settled.settledAt).toBeTruthy();

        const after = await fetchTestData();
        const summaryAfter = calculateFundSummary(after.allocations, after.expenses);

        expect(summaryAfter.settledTotal).toBe(before.settledTotal + 2500);
        expect(summaryAfter.remaining).toBe(before.remaining - 2500);
        expect(summaryAfter.pendingTotal).toBe(before.pendingTotal - 2500);
    });

    it('restores the allocated amount when an expense is un-settled', async () => {
        const expenseRef = await addExpense(1000, 'Reversible cleaning charge', 'Cleaning');

        const baseline = await fetchTestData();
        const baselineSummary = calculateFundSummary(baseline.allocations, baseline.expenses);

        // Settle
        await expenseRef.update(
            buildSettlementUpdate(false, TEST_USER, FieldValue.delete()) as Record<string, unknown>
        );
        const midData = await fetchTestData();
        expect(calculateFundSummary(midData.allocations, midData.expenses).remaining).toBe(
            baselineSummary.remaining - 1000
        );

        // Un-settle
        await expenseRef.update(
            buildSettlementUpdate(true, TEST_USER, FieldValue.delete()) as Record<string, unknown>
        );
        const reverted = (await expenseRef.get()).data()!;
        expect(reverted.settled).toBe(false);
        expect(reverted.settledAt).toBeUndefined();
        expect(reverted.settledBy).toBeUndefined();

        const finalData = await fetchTestData();
        expect(calculateFundSummary(finalData.allocations, finalData.expenses).remaining).toBe(
            baselineSummary.remaining
        );
    });

    it('reports overspending when settled expenses exceed allocations', async () => {
        // Dedicated isolated set so other tests do not interfere
        const allocRef = db.collection('allocations').doc(`${TEST_PREFIX}_over_alloc`);
        await allocRef.set({ amount: 1000, createdBy: `${TEST_PREFIX}_over`, createdAt: new Date().toISOString() });
        trackDoc(allocRef.path);

        const expRef = db.collection('expenses').doc(`${TEST_PREFIX}_over_exp`);
        await expRef.set({
            amount: 1600,
            category: 'Other',
            description: 'Overspend test',
            settled: true,
            createdBy: `${TEST_PREFIX}_over`,
            createdAt: new Date().toISOString(),
        });
        trackDoc(expRef.path);

        const [aSnap, eSnap] = await Promise.all([
            db.collection('allocations').where('createdBy', '==', `${TEST_PREFIX}_over`).get(),
            db.collection('expenses').where('createdBy', '==', `${TEST_PREFIX}_over`).get(),
        ]);

        const summary = calculateFundSummary(
            aSnap.docs.map(d => d.data() as { amount: number }),
            eSnap.docs.map(d => d.data() as { amount: number; settled?: boolean })
        );

        expect(summary.totalAllocated).toBe(1000);
        expect(summary.settledTotal).toBe(1600);
        expect(summary.remaining).toBe(-600);
        expect(summary.isOverspent).toBe(true);
        expect(summary.overspentBy).toBe(600);
    });
});
