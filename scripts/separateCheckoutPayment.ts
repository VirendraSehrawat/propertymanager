/**
 * Separate a previous tenant's CHECKOUT payment from the new tenant's invoice.
 *
 * Scenario this solves (tenant transition):
 *   • A unit's occupant checks out; their final electricity (meter read at
 *     checkout) is collected in cash.
 *   • That payment got recorded against the CURRENT month's invoice, which now
 *     belongs to the NEW tenant — wrongly inflating the new tenant's amountPaid.
 *
 * What it does (atomically):
 *   1. Creates a dedicated CLOSING invoice for the previous tenant that holds
 *      the checkout charge (electricity), already fully paid.
 *   2. Re-points the existing ledger row to that closing invoice (audit trail
 *      preserved via `remappedFromInvoiceId`).
 *   3. Recomputes the source (new tenant's) invoice amountPaid from the
 *      remaining ledger rows, so the checkout money no longer shows there.
 *
 * DRY-RUN by default — prints the plan and writes NOTHING unless `--commit`.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/separateCheckoutPayment.ts \
 *     --ledger EfGIwGlrqWeGQ3xp6A5E \
 *     --prev-tenant "sachin@9050263105" \
 *     --period "October 2026 (Checkout — Previous Tenant)" \
 *     --reason "Previous tenant final electricity at checkout 05/10; not the new tenant's rent"
 *
 *   # apply:
 *   ...same... --commit
 */

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
};
const LEDGER_ID = flag("ledger");
const PREV_TENANT = flag("prev-tenant");
const PERIOD = flag("period");
const REASON = flag("reason") || "Previous tenant checkout payment separated from new tenant's invoice";
const COMMIT = argv.includes("--commit");

if (!LEDGER_ID) {
    console.error(
        "Usage: separateCheckoutPayment.ts --ledger <ledgerDocId> " +
            '[--prev-tenant "email"] [--period "Label"] [--reason "why"] [--commit]',
    );
    process.exit(1);
}
const ledgerId: string = LEDGER_ID;

const LEDGER_COLLECTIONS = ["ledger", "ledgerEntries"] as const;
const rupee = (n: unknown) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const deriveStatus = (paid: number, total: number): string => {
    if (paid <= 0.009) return "unpaid";
    if (paid >= total - 0.009) return "paid";
    return "pending";
};

async function ledgerSumForInvoice(db: Firestore, invoiceId: string): Promise<number> {
    let sum = 0;
    for (const col of LEDGER_COLLECTIONS) {
        const snap = await db.collection(col).where("invoiceId", "==", invoiceId).get();
        snap.docs.forEach((d) => (sum += Number((d.data() as { amountPaid?: number }).amountPaid || 0)));
    }
    return sum;
}

async function main() {
    if (!getApps().length) initializeApp({ credential: applicationDefault() });
    const db = getFirestore();

    // --- Locate the ledger row. ---
    let ledgerCol: (typeof LEDGER_COLLECTIONS)[number] | null = null;
    let ledgerData: Record<string, unknown> | null = null;
    for (const col of LEDGER_COLLECTIONS) {
        const d = await db.collection(col).doc(ledgerId).get();
        if (d.exists) { ledgerCol = col; ledgerData = d.data() as Record<string, unknown>; break; }
    }
    if (!ledgerCol || !ledgerData) {
        console.error(`Ledger row ${ledgerId} not found in ledger / ledgerEntries.`);
        process.exit(1);
    }

    const sourceInvoiceId = String(ledgerData.invoiceId || "");
    const amount = Number(ledgerData.amountPaid || 0);
    if (!sourceInvoiceId) { console.error("Ledger row has no invoiceId — nothing to separate."); process.exit(1); }
    if (amount <= 0) { console.error("Ledger row amountPaid is zero — nothing to separate."); process.exit(1); }

    // --- Load the source (new tenant's) invoice to copy unit identity. ---
    const srcSnap = await db.collection("invoices").doc(sourceInvoiceId).get();
    if (!srcSnap.exists) { console.error(`Source invoice ${sourceInvoiceId} not found.`); process.exit(1); }
    const src = srcSnap.data() as Record<string, unknown>;
    const srcTotal = Number(src.totalAmount || 0);

    const prevTenant = PREV_TENANT || String(ledgerData.tenantEmail || "");
    const period = PERIOD || `${src.billingPeriod || "Checkout"} (Checkout — Previous Tenant)`;
    const now = new Date().toISOString();

    // --- New closing invoice (previous tenant's checkout electricity, fully paid). ---
    const closingRef = db.collection("invoices").doc();
    const closingInvoice: Record<string, unknown> = {
        buildingId: src.buildingId ?? "",
        unitId: src.unitId ?? "",
        unitNumber: src.unitNumber ?? "",
        tenantEmail: prevTenant,
        billingPeriod: period,
        baseRent: 0,
        electricityCharge: amount,
        carryForward: 0,
        totalAmount: amount,
        amountPaid: amount,
        status: "paid",
        paidAt: String(ledgerData.createdAt || now),
        transactionId: String(ledgerData.transactionId || ""),
        paymentMode: ledgerData.paymentMode ?? "cash",
        paymentNote: ledgerData.paymentNote ?? ledgerData.note ?? "",
        isClosing: true,
        closingForTenant: prevTenant,
        createdAt: now,
    };

    // --- Source invoice recompute (loses this row). ---
    const srcSumNow = await ledgerSumForInvoice(db, sourceInvoiceId);
    const srcPaidAfter = Math.max(0, srcSumNow - amount);
    const srcStatus = deriveStatus(srcPaidAfter, srcTotal);

    // --- Print plan. ---
    console.log(`\n=== Separate checkout payment ${rupee(amount)} ===`);
    console.log(`Ledger row:  ${ledgerCol}/${ledgerId}  (txn: ${ledgerData.transactionId || "—"})`);
    console.log(`Reason:      ${REASON}\n`);

    console.log(`NEW closing invoice  ${closingInvoice.unitNumber} · ${period}`);
    console.log(`  tenant ${prevTenant}`);
    console.log(`  electricity ${rupee(amount)}   paid ${rupee(amount)}   status paid   (id: ${COMMIT ? closingRef.id : "<new>"})\n`);

    console.log(`SOURCE invoice (new tenant)  ${src.unitNumber} · ${src.billingPeriod}  (${sourceInvoiceId})`);
    console.log(`  total ${rupee(srcTotal)}   paid ${rupee(src.amountPaid)} → ${rupee(srcPaidAfter)}   status ${src.status} → ${srcStatus}`);

    if (!COMMIT) {
        console.log(`\n(DRY RUN — nothing was written. Re-run with --commit to apply.)`);
        return;
    }

    // --- Apply atomically. ---
    const batch = db.batch();
    batch.set(closingRef, closingInvoice);
    batch.update(db.collection(ledgerCol).doc(ledgerId), {
        invoiceId: closingRef.id,
        billingPeriod: period,
        tenantEmail: prevTenant,
        invoiceAmount: amount,
        balance: 0,
        remappedFromInvoiceId: sourceInvoiceId,
        correctedAt: now,
        correctedBy: "script:separateCheckoutPayment",
        correctionNote: REASON,
    });
    batch.update(db.collection("invoices").doc(sourceInvoiceId), {
        amountPaid: srcPaidAfter,
        status: srcStatus,
    });
    await batch.commit();
    console.log(`\n✅ Committed. Closing invoice ${closingRef.id} created; October cleared.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
