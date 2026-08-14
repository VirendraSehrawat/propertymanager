/**
 * Integration tests for the Property Manager application.
 *
 * These tests use firebase-admin to directly interact with Firestore,
 * simulating the full workflow:
 *   1. Onboard a tenant (create unit, assign tenant)
 *   2. Generate an invoice for the tenant
 *   3. Tenant submits payment
 *   4. Admin approves payment → ledger entry created
 *   5. Verify the ledger reflects correct balances
 *
 * IMPORTANT: These tests run against the REAL Firestore database.
 * They create documents with a test prefix and clean up after themselves.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ---------- Setup ----------

const TEST_PREFIX = `__test_${Date.now()}`;
const TEST_TENANT_EMAIL = `${TEST_PREFIX}_tenant@test.com`;
const TEST_UNIT_NUMBER = `${TEST_PREFIX}_A101`;
const TEST_BUILDING_ID = `${TEST_PREFIX}_bldg`;

let db: ReturnType<typeof getFirestore>;

// Track created doc paths for cleanup
const createdDocs: string[] = [];

function trackDoc(path: string) {
    createdDocs.push(path);
}

beforeAll(async () => {
    // Connect to Firestore emulator
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    if (!getApps().length) {
        initializeApp({
            projectId: 'property-manager-fb9eb',
        });
    }
    db = getFirestore(getApp());
});

afterAll(async () => {
    // Clean up all test documents
    const batch = db.batch();
    for (const path of createdDocs) {
        batch.delete(db.doc(path));
    }
    if (createdDocs.length > 0) {
        await batch.commit();
        console.log(`🧹 Cleaned up ${createdDocs.length} test documents`);
    }
});

// ---------- Helper Functions ----------

async function createTestBuilding() {
    const ref = db.collection('buildings').doc(TEST_BUILDING_ID);
    await ref.set({
        name: 'Test Building',
        address: '123 Test Street',
        totalUnits: 10,
        createdAt: new Date().toISOString(),
    });
    trackDoc(`buildings/${TEST_BUILDING_ID}`);
    return ref;
}

async function createTestUnit(buildingId: string) {
    const unitId = `${TEST_PREFIX}_unit`;
    const ref = db.collection('units').doc(unitId);
    await ref.set({
        unitNumber: TEST_UNIT_NUMBER,
        buildingId,
        baseRent: 5000,
        status: 'vacant',
        lastMeterReading: 100,
        createdAt: new Date().toISOString(),
    });
    trackDoc(`units/${unitId}`);
    return { ref, unitId };
}

async function assignTenantToUnit(unitId: string) {
    const ref = db.collection('units').doc(unitId);
    await ref.update({
        status: 'occupied',
        tenantEmail: TEST_TENANT_EMAIL,
        tenantName: 'Test Tenant',
        tenantPhone: '9876543210',
    });
}

async function generateInvoice(unitId: string, monthKey: string, monthName: string) {
    const invoiceId = `inv_${unitId}_${monthKey}`;
    const previousReading = 100;
    const currentReading = 250;
    const unitsConsumed = currentReading - previousReading;
    const electricityRate = 8;
    const electricityCharge = unitsConsumed * electricityRate;
    const baseRent = 5000;
    const totalAmount = baseRent + electricityCharge;

    const ref = db.collection('invoices').doc(invoiceId);
    await ref.set({
        unitId,
        unitNumber: TEST_UNIT_NUMBER,
        tenantEmail: TEST_TENANT_EMAIL,
        baseRent,
        previousReading,
        currentReading,
        electricityConsumed: unitsConsumed,
        electricityRate,
        electricityCharge,
        totalAmount,
        billingPeriod: monthName,
        status: 'unpaid',
        transactionId: '',
        createdAt: new Date().toISOString(),
    });
    trackDoc(`invoices/${invoiceId}`);

    // Update meter reading on unit
    await db.collection('units').doc(unitId).update({ lastMeterReading: currentReading });

    return { invoiceId, totalAmount, baseRent, electricityCharge, unitsConsumed };
}

async function tenantSubmitPayment(invoiceId: string, amountPaid: number) {
    await db.collection('invoices').doc(invoiceId).update({
        status: 'pending',
        transactionId: 'TEST_UTR_123456789012',
        amountPaid,
        paymentScreenshotUrl: 'https://test.com/screenshot.png',
        submittedAt: new Date().toISOString(),
    });
}

async function adminApprovePayment(invoiceId: string) {
    const invSnap = await db.collection('invoices').doc(invoiceId).get();
    const inv = invSnap.data()!;
    const invoiceAmount = Number(inv.totalAmount || 0);
    const amountPaid = Number(inv.amountPaid || invoiceAmount);

    await db.collection('invoices').doc(invoiceId).update({
        status: 'paid',
        paidAt: new Date().toISOString(),
    });

    // Create ledger entry (same logic as admin handleApproveInvoice)
    const ledgerRef = await db.collection('ledger').add({
        tenantEmail: inv.tenantEmail,
        unitId: inv.unitId,
        unitNumber: inv.unitNumber,
        invoiceId,
        billingPeriod: inv.billingPeriod || 'Ad-Hoc',
        invoiceAmount,
        amountPaid,
        balance: amountPaid - invoiceAmount,
        transactionId: inv.transactionId || '',
        type: 'payment',
        settledBy: 'admin',
        createdAt: new Date().toISOString(),
    });
    trackDoc(`ledger/${ledgerRef.id}`);

    return { ledgerId: ledgerRef.id, invoiceAmount, amountPaid };
}

// ---------- Tests ----------

describe('Property Manager Integration Tests', () => {
    let unitId: string;
    let invoiceId: string;
    let invoiceTotal: number;

    describe('1. Tenant Onboarding', () => {
        it('should create a building', async () => {
            const ref = await createTestBuilding();
            const snap = await ref.get();
            expect(snap.exists).toBe(true);
            expect(snap.data()!.name).toBe('Test Building');
        });

        it('should create a vacant unit in the building', async () => {
            const result = await createTestUnit(TEST_BUILDING_ID);
            unitId = result.unitId;
            const snap = await result.ref.get();
            expect(snap.exists).toBe(true);
            expect(snap.data()!.status).toBe('vacant');
            expect(snap.data()!.baseRent).toBe(5000);
            expect(snap.data()!.lastMeterReading).toBe(100);
        });

        it('should assign a tenant to the unit', async () => {
            await assignTenantToUnit(unitId);
            const snap = await db.collection('units').doc(unitId).get();
            expect(snap.data()!.status).toBe('occupied');
            expect(snap.data()!.tenantEmail).toBe(TEST_TENANT_EMAIL);
            expect(snap.data()!.tenantName).toBe('Test Tenant');
        });
    });

    describe('2. Invoice Generation', () => {
        it('should generate a monthly invoice with correct calculations', async () => {
            const result = await generateInvoice(unitId, '08_2026', 'August 2026');
            invoiceId = result.invoiceId;
            invoiceTotal = result.totalAmount;

            const snap = await db.collection('invoices').doc(invoiceId).get();
            const data = snap.data()!;

            expect(snap.exists).toBe(true);
            expect(data.status).toBe('unpaid');
            expect(data.tenantEmail).toBe(TEST_TENANT_EMAIL);
            expect(data.baseRent).toBe(5000);
            expect(data.previousReading).toBe(100);
            expect(data.currentReading).toBe(250);
            expect(data.electricityConsumed).toBe(150);
            expect(data.electricityRate).toBe(8);
            expect(data.electricityCharge).toBe(1200); // 150 × 8
            expect(data.totalAmount).toBe(6200); // 5000 + 1200
            expect(data.billingPeriod).toBe('August 2026');
        });

        it('should update the unit last meter reading', async () => {
            const snap = await db.collection('units').doc(unitId).get();
            expect(snap.data()!.lastMeterReading).toBe(250);
        });
    });

    describe('3. Payment Submission (Tenant)', () => {
        it('should allow tenant to submit payment with full amount', async () => {
            await tenantSubmitPayment(invoiceId, invoiceTotal);
            const snap = await db.collection('invoices').doc(invoiceId).get();
            const data = snap.data()!;

            expect(data.status).toBe('pending');
            expect(data.amountPaid).toBe(6200);
            expect(data.transactionId).toBe('TEST_UTR_123456789012');
            expect(data.paymentScreenshotUrl).toBe('https://test.com/screenshot.png');
        });
    });

    describe('4. Payment Approval (Admin)', () => {
        it('should approve payment and create ledger entry', async () => {
            const result = await adminApprovePayment(invoiceId);

            // Verify invoice is marked paid
            const invSnap = await db.collection('invoices').doc(invoiceId).get();
            expect(invSnap.data()!.status).toBe('paid');
            expect(invSnap.data()!.paidAt).toBeDefined();

            // Verify ledger entry
            const ledgerSnap = await db.collection('ledger').doc(result.ledgerId).get();
            const ledger = ledgerSnap.data()!;
            expect(ledger.tenantEmail).toBe(TEST_TENANT_EMAIL);
            expect(ledger.invoiceAmount).toBe(6200);
            expect(ledger.amountPaid).toBe(6200);
            expect(ledger.balance).toBe(0); // exact payment
            expect(ledger.settledBy).toBe('admin');
        });
    });

    describe('5. Ledger Balance Verification', () => {
        it('should show zero balance after full payment', async () => {
            const ledgerSnap = await db.collection('ledger')
                .where('tenantEmail', '==', TEST_TENANT_EMAIL)
                .get();

            const totalBalance = ledgerSnap.docs.reduce(
                (sum, d) => sum + Number(d.data().balance || 0), 0
            );
            expect(totalBalance).toBe(0);
        });
    });

    describe('6. Partial Payment Flow', () => {
        let partialInvoiceId: string;

        it('should generate a second invoice', async () => {
            const result = await generateInvoice(unitId, '09_2026', 'September 2026');
            partialInvoiceId = result.invoiceId;
            expect(result.totalAmount).toBe(6200);
        });

        it('should handle partial payment (tenant pays ₹5000 of ₹6200)', async () => {
            await tenantSubmitPayment(partialInvoiceId, 5000);
            const snap = await db.collection('invoices').doc(partialInvoiceId).get();
            expect(snap.data()!.amountPaid).toBe(5000);
            expect(snap.data()!.status).toBe('pending');
        });

        it('should create ledger with negative balance on approval', async () => {
            const result = await adminApprovePayment(partialInvoiceId);

            const ledgerSnap = await db.collection('ledger').doc(result.ledgerId).get();
            const ledger = ledgerSnap.data()!;
            expect(ledger.invoiceAmount).toBe(6200);
            expect(ledger.amountPaid).toBe(5000);
            expect(ledger.balance).toBe(-1200); // underpaid by 1200
        });

        it('should show negative running balance (tenant owes ₹1200)', async () => {
            const ledgerSnap = await db.collection('ledger')
                .where('tenantEmail', '==', TEST_TENANT_EMAIL)
                .get();

            const totalBalance = ledgerSnap.docs.reduce(
                (sum, d) => sum + Number(d.data().balance || 0), 0
            );
            expect(totalBalance).toBe(-1200);
        });
    });

    describe('7. Overpayment Flow', () => {
        let overInvoiceId: string;

        it('should generate a third invoice', async () => {
            const result = await generateInvoice(unitId, '10_2026', 'October 2026');
            overInvoiceId = result.invoiceId;
        });

        it('should handle overpayment (tenant pays ₹7000 of ₹6200)', async () => {
            await tenantSubmitPayment(overInvoiceId, 7000);
            const result = await adminApprovePayment(overInvoiceId);

            const ledgerSnap = await db.collection('ledger').doc(result.ledgerId).get();
            const ledger = ledgerSnap.data()!;
            expect(ledger.balance).toBe(800); // overpaid by 800
        });

        it('should show net balance of -₹400 (owed 1200, credit 800)', async () => {
            const ledgerSnap = await db.collection('ledger')
                .where('tenantEmail', '==', TEST_TENANT_EMAIL)
                .get();

            const totalBalance = ledgerSnap.docs.reduce(
                (sum, d) => sum + Number(d.data().balance || 0), 0
            );
            // 0 (full) + (-1200) (partial) + 800 (over) = -400
            expect(totalBalance).toBe(-400);
        });
    });
});
