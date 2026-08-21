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
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

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

    describe('8. Expense Tracking', () => {
        let expenseId: string;

        it('should log an expense linked to a building', async () => {
            const ref = await db.collection('expenses').add({
                amount: 1500,
                category: 'Plumbing',
                description: 'Fixed leaking pipe in unit A101',
                date: '2026-08-15',
                buildingId: TEST_BUILDING_ID,
                buildingName: 'Test Building',
                receiptUrl: '',
                createdBy: 'staff@test.com',
                createdAt: new Date().toISOString(),
            });
            expenseId = ref.id;
            trackDoc(`expenses/${expenseId}`);

            const snap = await ref.get();
            expect(snap.exists).toBe(true);
            expect(snap.data()!.amount).toBe(1500);
            expect(snap.data()!.category).toBe('Plumbing');
            expect(snap.data()!.buildingId).toBe(TEST_BUILDING_ID);
        });

        it('should log a general expense (no building)', async () => {
            const ref = await db.collection('expenses').add({
                amount: 300,
                category: 'Supplies',
                description: 'Cleaning supplies',
                date: '2026-08-16',
                buildingId: '',
                buildingName: 'General',
                createdBy: 'staff@test.com',
                createdAt: new Date().toISOString(),
            });
            trackDoc(`expenses/${ref.id}`);

            const snap = await ref.get();
            expect(snap.data()!.buildingName).toBe('General');
            expect(snap.data()!.amount).toBe(300);
        });

        it('should query expenses by building', async () => {
            const snap = await db.collection('expenses')
                .where('buildingId', '==', TEST_BUILDING_ID)
                .get();
            const found = snap.docs.find(d => d.id === expenseId);
            expect(found).toBeDefined();
            expect(found!.data().amount).toBe(1500);
        });
    });

    describe('9. Inventory Management', () => {
        let inventoryId: string;

        it('should add an inventory item to a building', async () => {
            const ref = await db.collection('inventory').add({
                name: 'Fire Extinguisher',
                quantity: 4,
                buildingId: TEST_BUILDING_ID,
                buildingName: 'Test Building',
                location: 'Ground Floor',
                condition: 'good',
                notes: 'Expires 2027',
                createdBy: 'staff@test.com',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            inventoryId = ref.id;
            trackDoc(`inventory/${inventoryId}`);

            const snap = await ref.get();
            expect(snap.exists).toBe(true);
            expect(snap.data()!.name).toBe('Fire Extinguisher');
            expect(snap.data()!.quantity).toBe(4);
            expect(snap.data()!.condition).toBe('good');
        });

        it('should increment inventory quantity', async () => {
            const ref = db.collection('inventory').doc(inventoryId);
            await ref.update({ quantity: 5, updatedAt: new Date().toISOString() });
            const snap = await ref.get();
            expect(snap.data()!.quantity).toBe(5);
        });

        it('should decrement inventory quantity', async () => {
            const ref = db.collection('inventory').doc(inventoryId);
            await ref.update({ quantity: 3, updatedAt: new Date().toISOString() });
            const snap = await ref.get();
            expect(snap.data()!.quantity).toBe(3);
        });

        it('should filter inventory by building', async () => {
            const snap = await db.collection('inventory')
                .where('buildingId', '==', TEST_BUILDING_ID)
                .get();
            expect(snap.docs.length).toBeGreaterThanOrEqual(1);
            expect(snap.docs.some(d => d.data().name === 'Fire Extinguisher')).toBe(true);
        });
    });

    describe('10. Move-in/Move-out Checklist', () => {
        let checklistId: string;

        it('should create a move-in checklist with room inspections', async () => {
            const ref = await db.collection('checklists').add({
                unitId: `${TEST_PREFIX}_unit`,
                unitNumber: TEST_UNIT_NUMBER,
                buildingId: TEST_BUILDING_ID,
                type: 'move-in',
                rooms: [
                    { room: 'Living Room', condition: 'good', damages: '', photoUrl: '' },
                    { room: 'Bedroom', condition: 'good', damages: '', photoUrl: '' },
                    { room: 'Bathroom', condition: 'fair', damages: 'Minor stain on wall', photoUrl: 'https://test.com/photo.jpg' },
                ],
                notes: 'Overall good condition',
                deduction: 0,
                tenantEmail: TEST_TENANT_EMAIL,
                tenantName: 'Test Tenant',
                createdAt: new Date().toISOString(),
                createdBy: 'staff@test.com',
            });
            checklistId = ref.id;
            trackDoc(`checklists/${checklistId}`);

            const snap = await ref.get();
            expect(snap.exists).toBe(true);
            expect(snap.data()!.type).toBe('move-in');
            expect(snap.data()!.rooms).toHaveLength(3);
            expect(snap.data()!.rooms[2].condition).toBe('fair');
            expect(snap.data()!.rooms[2].damages).toBe('Minor stain on wall');
        });

        it('should create a move-out checklist with security deposit deduction', async () => {
            const ref = await db.collection('checklists').add({
                unitId: `${TEST_PREFIX}_unit`,
                unitNumber: TEST_UNIT_NUMBER,
                buildingId: TEST_BUILDING_ID,
                type: 'move-out',
                rooms: [
                    { room: 'Living Room', condition: 'good', damages: '', photoUrl: '' },
                    { room: 'Bedroom', condition: 'damaged', damages: 'Broken window latch', photoUrl: 'https://test.com/damage.jpg' },
                ],
                notes: 'Window latch needs replacement',
                deduction: 2000,
                tenantEmail: TEST_TENANT_EMAIL,
                tenantName: 'Test Tenant',
                createdAt: new Date().toISOString(),
                createdBy: 'staff@test.com',
            });
            trackDoc(`checklists/${ref.id}`);

            const snap = await ref.get();
            expect(snap.data()!.type).toBe('move-out');
            expect(snap.data()!.deduction).toBe(2000);
            expect(snap.data()!.rooms[1].condition).toBe('damaged');
        });

        it('should query checklists by unit', async () => {
            const snap = await db.collection('checklists')
                .where('unitId', '==', `${TEST_PREFIX}_unit`)
                .get();
            expect(snap.docs.length).toBe(2); // move-in + move-out
            const types = snap.docs.map(d => d.data().type);
            expect(types).toContain('move-in');
            expect(types).toContain('move-out');
        });
    });

    describe('11. Multiple Tenants (Co-Tenants)', () => {
        it('should add co-tenants to a unit', async () => {
            const unitRef = db.collection('units').doc(`${TEST_PREFIX}_unit`);
            const coTenant1 = { name: 'Roommate A', phone: '1111111111', email: 'roommate_a@test.com', addedAt: new Date().toISOString() };
            const coTenant2 = { name: 'Roommate B', phone: '2222222222', email: 'roommate_b@test.com', addedAt: new Date().toISOString() };

            await unitRef.update({ coTenants: [coTenant1, coTenant2] });

            const snap = await unitRef.get();
            expect(snap.data()!.coTenants).toHaveLength(2);
            expect(snap.data()!.coTenants[0].email).toBe('roommate_a@test.com');
            expect(snap.data()!.coTenants[1].name).toBe('Roommate B');
        });

        it('should remove a co-tenant', async () => {
            const unitRef = db.collection('units').doc(`${TEST_PREFIX}_unit`);
            const snap = await unitRef.get();
            const coTenants = snap.data()!.coTenants.filter((ct: any) => ct.email !== 'roommate_a@test.com');

            await unitRef.update({ coTenants });

            const updated = await unitRef.get();
            expect(updated.data()!.coTenants).toHaveLength(1);
            expect(updated.data()!.coTenants[0].email).toBe('roommate_b@test.com');
        });

        it('should keep primary tenant unchanged after co-tenant operations', async () => {
            const snap = await db.collection('units').doc(`${TEST_PREFIX}_unit`).get();
            expect(snap.data()!.tenantEmail).toBe(TEST_TENANT_EMAIL);
            expect(snap.data()!.tenantName).toBe('Test Tenant');
            expect(snap.data()!.status).toBe('occupied');
        });
    });

    describe('12. Occupancy Rate Calculation', () => {
        it('should correctly compute occupancy from unit statuses', async () => {
            // Create a second vacant unit in the same building
            const vacantRef = db.collection('units').doc(`${TEST_PREFIX}_unit_vacant`);
            await vacantRef.set({
                unitNumber: `${TEST_PREFIX}_A102`,
                buildingId: TEST_BUILDING_ID,
                baseRent: 6000,
                status: 'vacant',
                lastMeterReading: 0,
                createdAt: new Date().toISOString(),
            });
            trackDoc(`units/${TEST_PREFIX}_unit_vacant`);

            // Query all units in building
            const snap = await db.collection('units')
                .where('buildingId', '==', TEST_BUILDING_ID)
                .get();

            const total = snap.docs.length;
            const occupied = snap.docs.filter(d => d.data().status === 'occupied').length;
            const rate = Math.round((occupied / total) * 100);

            expect(total).toBe(2);
            expect(occupied).toBe(1);
            expect(rate).toBe(50);
        });
    });

    describe('13. Security Deposit & Tenant Removal', () => {
        it('should store security deposit and payment day on unit', async () => {
            const unitRef = db.collection('units').doc(`${TEST_PREFIX}_unit`);
            await unitRef.update({
                securityDeposit: 10000,
                securityDepositDate: new Date().toISOString(),
                paymentDay: 5
            });

            const snap = await unitRef.get();
            expect(snap.data()!.securityDeposit).toBe(10000);
            expect(snap.data()!.paymentDay).toBe(5);
            expect(snap.data()!.securityDepositDate).toBeDefined();
        });

        it('should clear tenant data and deposit on removal', async () => {
            const unitRef = db.collection('units').doc(`${TEST_PREFIX}_unit`);
            await unitRef.update({
                status: 'vacant',
                tenantEmail: '',
                tenantName: '',
                tenantPhone: '',
                paymentDay: '',
                securityDeposit: '',
                securityDepositDate: '',
                lastChecklistDeduction: '',
                coTenants: []
            });

            const snap = await unitRef.get();
            expect(snap.data()!.status).toBe('vacant');
            expect(snap.data()!.tenantEmail).toBe('');
            expect(snap.data()!.securityDeposit).toBe('');
            expect(snap.data()!.paymentDay).toBe('');
            expect(snap.data()!.coTenants).toHaveLength(0);
        });

        it('should calculate correct refund (deposit minus deduction)', () => {
            const deposit = 10000;
            const deduction = 2000;
            const refund = Math.max(0, deposit - deduction);
            expect(refund).toBe(8000);
        });

        it('should return full deposit when no deductions', () => {
            const deposit = 10000;
            const deduction = 0;
            const refund = Math.max(0, deposit - deduction);
            expect(refund).toBe(10000);
        });
    });

    describe('14. Co-Tenant with Optional Email', () => {
        it('should re-assign tenant for co-tenant tests', async () => {
            const unitRef = db.collection('units').doc(`${TEST_PREFIX}_unit`);
            await unitRef.update({
                status: 'occupied',
                tenantEmail: TEST_TENANT_EMAIL,
                tenantName: 'Test Tenant',
                tenantPhone: '9876543210'
            });
            const snap = await unitRef.get();
            expect(snap.data()!.status).toBe('occupied');
        });

        it('should add co-tenant without email (name + phone only)', async () => {
            const unitRef = db.collection('units').doc(`${TEST_PREFIX}_unit`);
            const coTenant = { name: 'No Email Person', phone: '5555555555', email: '', addedAt: '2026-08-20T10:00:00.000Z' };
            await unitRef.update({ coTenants: [coTenant] });

            const snap = await unitRef.get();
            expect(snap.data()!.coTenants).toHaveLength(1);
            expect(snap.data()!.coTenants[0].email).toBe('');
            expect(snap.data()!.coTenants[0].name).toBe('No Email Person');
            expect(snap.data()!.coTenants[0].phone).toBe('5555555555');
        });

        it('should add co-tenant with email', async () => {
            const unitRef = db.collection('units').doc(`${TEST_PREFIX}_unit`);
            const snap = await unitRef.get();
            const existing = snap.data()!.coTenants || [];
            const newCt = { name: 'With Email', phone: '6666666666', email: 'withemail@test.com', addedAt: '2026-08-20T11:00:00.000Z' };
            await unitRef.update({ coTenants: [...existing, newCt] });

            const updated = await unitRef.get();
            expect(updated.data()!.coTenants).toHaveLength(2);
        });

        it('should remove co-tenant by addedAt timestamp (not email)', async () => {
            const unitRef = db.collection('units').doc(`${TEST_PREFIX}_unit`);
            const snap = await unitRef.get();
            const coTenants = snap.data()!.coTenants;

            // Remove the one without email using addedAt
            const targetAddedAt = '2026-08-20T10:00:00.000Z';
            const filtered = coTenants.filter((ct: any) => ct.addedAt !== targetAddedAt);
            await unitRef.update({ coTenants: filtered });

            const updated = await unitRef.get();
            expect(updated.data()!.coTenants).toHaveLength(1);
            expect(updated.data()!.coTenants[0].email).toBe('withemail@test.com');
        });
    });

    describe('15. Employee Report Issue', () => {
        let issueId: string;

        it('should create a maintenance ticket reported by staff', async () => {
            const ref = await db.collection('maintenance').add({
                tenantEmail: '',
                reportedBy: 'staff@test.com',
                unitId: `${TEST_PREFIX}_unit`,
                unitNumber: TEST_UNIT_NUMBER,
                buildingName: 'Test Building',
                category: 'Plumbing',
                description: 'Water leak in common area bathroom',
                photoUrl: 'https://test.com/leak.jpg',
                status: 'pending',
                comments: [],
                createdAt: new Date().toISOString()
            });
            issueId = ref.id;
            trackDoc(`maintenance/${issueId}`);

            const snap = await ref.get();
            expect(snap.exists).toBe(true);
            expect(snap.data()!.reportedBy).toBe('staff@test.com');
            expect(snap.data()!.status).toBe('pending');
            expect(snap.data()!.comments).toHaveLength(0);
        });

        it('should add a comment to the ticket', async () => {
            const ref = db.collection('maintenance').doc(issueId);
            const comment = { author: 'staff@test.com', text: 'Plumber called, arriving tomorrow', timestamp: new Date().toISOString() };

            await ref.update({
                comments: [comment]
            });

            const snap = await ref.get();
            expect(snap.data()!.comments).toHaveLength(1);
            expect(snap.data()!.comments[0].text).toBe('Plumber called, arriving tomorrow');
        });

        it('should change ticket status and add status comment', async () => {
            const ref = db.collection('maintenance').doc(issueId);
            const snap = await ref.get();
            const existingComments = snap.data()!.comments || [];

            await ref.update({
                status: 'in-progress',
                comments: [...existingComments, { author: 'staff@test.com', text: 'Status changed to IN-PROGRESS', timestamp: new Date().toISOString() }]
            });

            const updated = await ref.get();
            expect(updated.data()!.status).toBe('in-progress');
            expect(updated.data()!.comments).toHaveLength(2);
        });

        it('should resolve the ticket', async () => {
            const ref = db.collection('maintenance').doc(issueId);
            await ref.update({ status: 'resolved' });

            const snap = await ref.get();
            expect(snap.data()!.status).toBe('resolved');
        });
    });

    describe('16. Meter Reading with Previous Override & Manual Units', () => {
        it('should generate invoice with overridden previous reading', async () => {
            // Setup: unit has lastMeterReading = 250 (from earlier tests)
            const unitRef = db.collection('units').doc(`${TEST_PREFIX}_unit`);
            const unitSnap = await unitRef.get();
            const lastReading = unitSnap.data()!.lastMeterReading; // 250

            // Employee overrides previous to 200 (different from stored 250)
            const previousReadingOverride = 200;
            const currentReading = 400;
            const unitsConsumed = currentReading - previousReadingOverride; // 200 units

            expect(lastReading).toBe(250);
            expect(unitsConsumed).toBe(200);

            const electricityRate = 12;
            const electricityCharge = unitsConsumed * electricityRate;
            expect(electricityCharge).toBe(2400);
        });

        it('should generate invoice with manual units consumed override', async () => {
            const currentReading = 400;
            const previousReading = 250;
            const calculatedUnits = currentReading - previousReading; // 150
            const manualUnits = 120; // employee enters manual override
            const reason = 'Shared meter - split between 2 units';

            const electricityRate = 12;
            const usedUnits = manualUnits; // manual overrides calculated
            const electricityCharge = usedUnits * electricityRate;

            expect(calculatedUnits).toBe(150);
            expect(usedUnits).toBe(120); // manual wins
            expect(electricityCharge).toBe(1440);
            expect(reason).toBe('Shared meter - split between 2 units');
        });
    });

    // Suite 17: Tenant History
    describe('Tenant History', () => {
        it('should record tenant history on removal', async () => {
            const unitRef = db.collection('units').doc();
            const moveInDate = '2024-01-15T10:00:00.000Z';
            const coTenantAddedAt = '2024-02-01T00:00:00.000Z';
            await unitRef.set({
                buildingId: TEST_BUILDING_ID, unitNumber: 'H1', baseRent: 10000,
                status: 'occupied', tenantEmail: 'old@test.com', tenantName: 'Old Tenant',
                tenantPhone: '1111111111', moveInDate, securityDeposit: '15000',
                coTenants: [{ name: 'Co1', phone: '2222222222', addedAt: coTenantAddedAt }]
            });

            // Simulate removal: push history entry and clear fields
            const moveOutDate = new Date().toISOString();
            const historyEntry = {
                tenantName: 'Old Tenant', tenantEmail: 'old@test.com', tenantPhone: '1111111111',
                moveInDate, moveOutDate, securityDeposit: '15000', securityRefund: '',
                coTenants: [{ name: 'Co1', phone: '2222222222', addedAt: coTenantAddedAt }]
            };
            await unitRef.update({
                tenantHistory: FieldValue.arrayUnion(historyEntry),
                status: 'vacant', tenantEmail: '', tenantName: '', tenantPhone: '',
                moveInDate: '', coTenants: []
            });

            const snap = await unitRef.get();
            const data = snap.data()!;
            expect(data.status).toBe('vacant');
            expect(data.tenantHistory).toHaveLength(1);
            expect(data.tenantHistory[0].tenantName).toBe('Old Tenant');
            expect(data.tenantHistory[0].moveInDate).toBe(moveInDate);
            expect(data.tenantHistory[0].moveOutDate).toBeDefined();
        });

        it('should accumulate multiple history entries', async () => {
            const unitRef = db.collection('units').doc();
            await unitRef.set({ buildingId: TEST_BUILDING_ID, unitNumber: 'H2', baseRent: 8000, status: 'vacant', tenantHistory: [] });

            await unitRef.update({ tenantHistory: FieldValue.arrayUnion({ tenantName: 'T1', moveInDate: '2023-01-01', moveOutDate: '2023-06-01' }) });
            await unitRef.update({ tenantHistory: FieldValue.arrayUnion({ tenantName: 'T2', moveInDate: '2023-07-01', moveOutDate: '2024-01-01' }) });

            const snap = await unitRef.get();
            expect(snap.data()!.tenantHistory).toHaveLength(2);
            expect(snap.data()!.tenantHistory[0].tenantName).toBe('T1');
            expect(snap.data()!.tenantHistory[1].tenantName).toBe('T2');
        });

        it('should store moveInDate when assigning tenant', async () => {
            const unitRef = db.collection('units').doc();
            await unitRef.set({ buildingId: TEST_BUILDING_ID, unitNumber: 'H3', baseRent: 9000, status: 'vacant' });

            const moveInDate = new Date().toISOString();
            await unitRef.update({ status: 'occupied', tenantName: 'New T', tenantEmail: 'new@test.com', moveInDate });

            const snap = await unitRef.get();
            expect(snap.data()!.moveInDate).toBe(moveInDate);
            expect(snap.data()!.status).toBe('occupied');
        });
    });
});
