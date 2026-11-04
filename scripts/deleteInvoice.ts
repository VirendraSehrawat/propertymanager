/**
 * Safely delete a single invoice (e.g. a wrongly-generated month for a now-empty unit).
 *
 * Guard rails:
 *   • Refuses to delete if the invoice has `amountPaid > 0` (money is attached).
 *   • Refuses to delete if any ledger / ledgerEntries row points at it, so a
 *     real payment is never orphaned.
 *   Override both with `--force` (NOT recommended).
 *
 * DRY-RUN by default — prints the plan and writes NOTHING unless `--commit`.
 *
 * Usage:
 *   # by explicit invoice id
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/deleteInvoice.ts --invoice inv_FF6CtZrH6RwUUwPYLQdr_transfer_2026-11-01
 *
 *   # or by unit + billing period
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/deleteInvoice.ts --unit "SA 304" --period "November 2026"
 *
 *   # apply:
 *   ...same... --commit
 */

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { stripBillingPeriodSuffix } from "../lib/allocation";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
};
const INVOICE_ID = flag("invoice");
const UNIT = flag("unit");
const PERIOD = flag("period");
const COMMIT = argv.includes("--commit");
const FORCE = argv.includes("--force");

if (!INVOICE_ID && !(UNIT && PERIOD)) {
    console.error(
        "Usage:\n" +
            "  deleteInvoice.ts --invoice <invoiceId> [--commit] [--force]\n" +
            '  deleteInvoice.ts --unit "SA 304" --period "November 2026" [--commit] [--force]',
    );
    process.exit(1);
}

const LEDGER_COLLECTIONS = ["ledger", "ledgerEntries"] as const;
const rupee = (n: unknown) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

async function main() {
    if (!getApps().length) initializeApp({ credential: applicationDefault() });
    const db = getFirestore();

    // --- Resolve the target invoice. ---
    let invoiceId = INVOICE_ID;
    let data: Record<string, unknown> | undefined;

    if (invoiceId) {
        const snap = await db.collection("invoices").doc(invoiceId).get();
        if (!snap.exists) { console.error(`Invoice ${invoiceId} not found.`); process.exit(1); }
        data = snap.data() as Record<string, unknown>;
    } else {
        const snap = await db.collection("invoices").where("unitNumber", "==", UNIT).get();
        const matches = snap.docs.filter(
            (d) => stripBillingPeriodSuffix(d.get("billingPeriod")) === stripBillingPeriodSuffix(PERIOD),
        );
        if (matches.length === 0) { console.error(`No invoice for unit "${UNIT}" · "${PERIOD}".`); process.exit(1); }
        if (matches.length > 1) {
            console.error(`Multiple invoices match "${UNIT}" · "${PERIOD}":`);
            matches.forEach((m) => console.error(`  ${m.id}  (paid ${rupee(m.get("amountPaid"))})`));
            console.error("Re-run with --invoice <id> to disambiguate.");
            process.exit(1);
        }
        invoiceId = matches[0].id;
        data = matches[0].data() as Record<string, unknown>;
    }

    const paid = Number(data!.amountPaid || 0);

    // --- Check for attached ledger rows. ---
    const attachedRows: string[] = [];
    for (const col of LEDGER_COLLECTIONS) {
        const snap = await db.collection(col).where("invoiceId", "==", invoiceId).get();
        snap.docs.forEach((d) => attachedRows.push(`${col}/${d.id} (${rupee(d.get("amountPaid"))})`));
    }

    // --- Print the plan. ---
    console.log(`\n=== Delete invoice · ${data!.unitNumber || "?"} · ${data!.billingPeriod || "?"} ===`);
    console.log(`Invoice: ${invoiceId}`);
    console.log(`  total ${rupee(data!.totalAmount)}   paid ${rupee(paid)}   status ${data!.status}`);
    console.log(`  attached ledger rows: ${attachedRows.length ? attachedRows.join(", ") : "none"}\n`);

    // --- Safety checks. ---
    const blockers: string[] = [];
    if (paid > 0) blockers.push(`invoice has amountPaid = ${rupee(paid)}`);
    if (attachedRows.length > 0) blockers.push(`${attachedRows.length} ledger row(s) point at it`);

    if (blockers.length > 0 && !FORCE) {
        console.error("⛔ Refusing to delete:");
        blockers.forEach((b) => console.error(`   • ${b}`));
        console.error("\nThis invoice has money/records attached. If you are certain, re-run with --force.");
        process.exit(1);
    }
    if (blockers.length > 0 && FORCE) {
        console.log("⚠️  --force: deleting despite:");
        blockers.forEach((b) => console.log(`   • ${b}`));
    }

    if (!COMMIT) {
        console.log(`(DRY RUN — nothing was written. Re-run with --commit to apply.)`);
        return;
    }

    await db.collection("invoices").doc(invoiceId).delete();
    console.log(`\n✅ Committed. Invoice ${invoiceId} deleted.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
