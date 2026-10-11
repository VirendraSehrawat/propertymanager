/**
 * Re-map a ledger payment row from one invoice to another, atomically.
 *
 * The Admin Ledger UI can only edit a row's AMOUNT — it cannot move a payment
 * to a different invoice. This script does that safely:
 *
 *   1. Re-points the ledger row's `invoiceId` / `billingPeriod` / `invoiceAmount`
 *      to the destination invoice (keeping an audit trail of where it came from).
 *   2. Recomputes BOTH the source and destination invoice `amountPaid` as the
 *      SUM of all ledger rows still pointing at them (across `ledger` +
 *      `ledgerEntries`), and sets `status` accordingly.
 *
 * It is DRY-RUN by default — it prints the exact plan and writes NOTHING unless
 * you pass `--commit`.
 *
 * Usage:
 *   # dry run (shows the plan, no writes)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/remapLedgerPayment.ts \
 *     --ledger EfGIwGlrqWeGQ3xp6A5E \
 *     --to inv_89QuGqzPuzmJfAY91tG7_08_2026 \
 *     --reason "Checkout 05/10 payment belongs to September, not October"
 *
 *   # apply it
 *   ...same command... --commit
 */

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
};
const LEDGER_ID = flag("ledger");
const DEST_INVOICE_ID = flag("to");
const REASON = flag("reason") || "Ledger payment re-mapped to correct invoice";
const COMMIT = argv.includes("--commit");

if (!LEDGER_ID || !DEST_INVOICE_ID) {
    console.error(
        "Usage: remapLedgerPayment.ts --ledger <ledgerDocId> --to <destInvoiceId> " +
            '[--reason "why"] [--commit]',
    );
    process.exit(1);
}

const ledgerId: string = LEDGER_ID;
const destInvoiceId: string = DEST_INVOICE_ID;

const LEDGER_COLLECTIONS = ["ledger", "ledgerEntries"] as const;
const rupee = (n: unknown) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

const deriveStatus = (amountPaid: number, total: number): string => {
    if (amountPaid <= 0.009) return "unpaid";
    if (amountPaid >= total - 0.009) return "paid";
    return "pending";
};

/** Sum amountPaid of every ledger row (both collections) pointing at an invoice. */
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

    // --- Locate the ledger row (search both ledger collections). ---
    let ledgerCol: (typeof LEDGER_COLLECTIONS)[number] | null = null;
    let ledgerData: Record<string, unknown> | null = null;
    for (const col of LEDGER_COLLECTIONS) {
        const d = await db.collection(col).doc(ledgerId).get();
        if (d.exists) {
            ledgerCol = col;
            ledgerData = d.data() as Record<string, unknown>;
            break;
        }
    }
    if (!ledgerCol || !ledgerData) {
        console.error(`Ledger row ${ledgerId} not found in ledger / ledgerEntries.`);
        process.exit(1);
    }

    const sourceInvoiceId = String(ledgerData.invoiceId || "");
    const movedAmount = Number(ledgerData.amountPaid || 0);
    if (!sourceInvoiceId) {
        console.error("This ledger row has no invoiceId (it's a pure credit/advance) — nothing to re-map.");
        process.exit(1);
    }
    if (sourceInvoiceId === destInvoiceId) {
        console.error("Source and destination invoice are the same — nothing to do.");
        process.exit(1);
    }

    // --- Load both invoices. ---
    const [srcSnap, dstSnap] = await Promise.all([
        db.collection("invoices").doc(sourceInvoiceId).get(),
        db.collection("invoices").doc(destInvoiceId).get(),
    ]);
    if (!srcSnap.exists) { console.error(`Source invoice ${sourceInvoiceId} not found.`); process.exit(1); }
    if (!dstSnap.exists) { console.error(`Destination invoice ${destInvoiceId} not found.`); process.exit(1); }
    const src = srcSnap.data() as Record<string, unknown>;
    const dst = dstSnap.data() as Record<string, unknown>;
    const srcTotal = Number(src.totalAmount || 0);
    const dstTotal = Number(dst.totalAmount || 0);

    // --- Recompute paid totals as the ledger sums AFTER the move. ---
    // Source loses this row; destination gains it. We recompute from the live
    // ledger sums and adjust by ±movedAmount so the row is counted on the right
    // side exactly once.
    const srcSumNow = await ledgerSumForInvoice(db, sourceInvoiceId);
    const dstSumNow = await ledgerSumForInvoice(db, destInvoiceId);
    const srcPaidAfter = Math.max(0, srcSumNow - movedAmount);
    const dstPaidAfter = dstSumNow + movedAmount;

    const srcStatus = deriveStatus(srcPaidAfter, srcTotal);
    const dstStatus = deriveStatus(dstPaidAfter, dstTotal);
    const dstOverpay = Math.max(0, dstPaidAfter - dstTotal);

    // --- Print the plan. ---
    console.log(`\n=== Re-map ledger payment ${rupee(movedAmount)} ===`);
    console.log(`Ledger row:  ${ledgerCol}/${ledgerId}  (txn: ${ledgerData.transactionId || "—"})`);
    console.log(`Reason:      ${REASON}\n`);

    console.log(`SOURCE  ${src.unitNumber || "?"} · ${src.billingPeriod || "?"}  (${sourceInvoiceId})`);
    console.log(`  total ${rupee(srcTotal)}   paid ${rupee(src.amountPaid)} → ${rupee(srcPaidAfter)}   status ${src.status} → ${srcStatus}`);

    console.log(`\nDEST    ${dst.unitNumber || "?"} · ${dst.billingPeriod || "?"}  (${destInvoiceId})`);
    console.log(`  total ${rupee(dstTotal)}   paid ${rupee(dst.amountPaid)} → ${rupee(dstPaidAfter)}   status ${dst.status} → ${dstStatus}`);
    if (dstOverpay > 0) {
        console.log(`\n  ⚠️  OVERPAYMENT: destination is overpaid by ${rupee(dstOverpay)}.`);
        console.log(`      Decide how to treat this (e.g. refund at checkout, or split the`);
        console.log(`      payment so only ${rupee(dstTotal - dstSumNow)} lands here). This script`);
        console.log(`      moves the FULL row amount as-is.`);
    }

    if (!COMMIT) {
        console.log(`\n(DRY RUN — nothing was written. Re-run with --commit to apply.)`);
        return;
    }

    // --- Apply atomically. ---
    const now = new Date().toISOString();
    const batch = db.batch();

    batch.update(db.collection(ledgerCol).doc(ledgerId), {
        invoiceId: destInvoiceId,
        billingPeriod: dst.billingPeriod || ledgerData.billingPeriod || "",
        unitNumber: dst.unitNumber ?? ledgerData.unitNumber ?? "",
        unitId: dst.unitId ?? ledgerData.unitId ?? "",
        invoiceAmount: dstTotal,
        balance: dstPaidAfter >= dstTotal ? 0 : -(dstTotal - dstPaidAfter),
        remappedFromInvoiceId: sourceInvoiceId,
        correctedAt: now,
        correctedBy: "script:remapLedgerPayment",
        correctionNote: REASON,
    });

    batch.update(db.collection("invoices").doc(sourceInvoiceId), {
        amountPaid: srcPaidAfter,
        status: srcStatus,
    });

    batch.update(db.collection("invoices").doc(destInvoiceId), {
        amountPaid: dstPaidAfter,
        status: dstStatus,
        ...(dstStatus === "paid" ? { paidAt: dst.paidAt || now } : {}),
    });

    await batch.commit();
    console.log(`\n✅ Committed. Payment re-mapped to ${destInvoiceId}.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
