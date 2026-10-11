/**
 * Backfill — Phase 8b of the atomic-transactions design
 * (see `docs/ATOMIC_TRANSACTIONS_PLAN.md`).
 *
 * Mirrors EXISTING settled invoices and partial payments (recorded in the
 * `ledger` / `ledgerEntries` collections before Phase 8 shipped) into the
 * `dailyLedger` collection as `direction: "inflow"` rows, so they show up in
 * both the Daily and Monthly views of the Daily Ledger tab — exactly like
 * Expenses already show up as `outflow` rows.
 *
 * Safe by construction:
 *   - Idempotent: re-running skips any settlement already mirrored (see
 *     `buildExistingInflowKeySet` / dedupe key in `lib/dailyLedgerBackfill.ts`).
 *   - Dry-run by default — prints the plan without writing. Pass `--apply` to
 *     actually commit.
 *   - Never touches `invoices` or `ledger*` collections — strictly additive
 *     inserts into `dailyLedger`.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *     npx tsx scripts/backfillDailyLedgerInflows.ts            # dry run
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *     npx tsx scripts/backfillDailyLedgerInflows.ts --apply     # commit
 *
 * Flags:
 *   --apply   Actually write the backfilled rows (default: dry run / preview only).
 *   --json    Emit the planned rows as JSON (for piping into other tools).
 */

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
    buildExistingInflowKeySet,
    planLedgerBackfill,
    planMasterLedgerBackfill,
    type ExistingDailyLedgerRow,
    type LedgerRowForBackfill,
    type MasterLedgerRowForBackfill,
    type BackfillPlanRow,
} from "../lib/dailyLedgerBackfill";

const flags = process.argv.slice(2);
const APPLY = flags.includes("--apply");
const JSON_OUT = flags.includes("--json");

/** Firestore allows 500 writes per batch; stay comfortably under it. */
const BATCH_SIZE = 450;

async function main() {
    if (!getApps().length) initializeApp({ credential: applicationDefault() });
    const db = getFirestore();
    const now = new Date().toISOString();

    // 1. Existing dailyLedger rows → dedupe key set (skip already-mirrored settlements).
    const dailyLedgerSnap = await db.collection("dailyLedger").get();
    const existingRows: ExistingDailyLedgerRow[] = dailyLedgerSnap.docs.map((d) => ({
        direction: d.get("direction"),
        invoiceId: d.get("invoiceId") || undefined,
        amount: Number(d.get("amount")) || 0,
        createdAt: d.get("createdAt"),
        deleted: d.get("deleted") === true,
    }));
    const existingKeys = buildExistingInflowKeySet(existingRows);

    // 2. Single-invoice settlements (`ledger`).
    const ledgerSnap = await db.collection("ledger").get();
    const ledgerRows: LedgerRowForBackfill[] = ledgerSnap.docs.map((d) => ({
        id: d.id,
        tenantEmail: d.get("tenantEmail"),
        unitId: d.get("unitId"),
        unitNumber: d.get("unitNumber"),
        invoiceId: d.get("invoiceId"),
        billingPeriod: d.get("billingPeriod"),
        amountPaid: Number(d.get("amountPaid")) || 0,
        type: d.get("type"),
        transactionId: d.get("transactionId"),
        paymentMode: d.get("paymentMode") ?? null,
        paymentReference: d.get("paymentReference") ?? null,
        paymentNote: d.get("paymentNote") ?? null,
        settledBy: d.get("settledBy"),
        createdAt: d.get("createdAt"),
        deleted: d.get("deleted") === true,
    }));

    // 3. Corporate master-invoice settlements (`ledgerEntries`).
    const ledgerEntriesSnap = await db.collection("ledgerEntries").get();
    const masterRows: MasterLedgerRowForBackfill[] = ledgerEntriesSnap.docs.map((d) => ({
        id: d.id,
        tenantEmail: d.get("tenantEmail"),
        unitId: d.get("unitId"),
        unitNumber: d.get("unitNumber"),
        invoiceId: d.get("invoiceId"),
        masterInvoiceId: d.get("masterInvoiceId"),
        billingPeriod: d.get("billingPeriod"),
        amountPaid: Number(d.get("amountPaid")) || 0,
        type: d.get("type"),
        transactionId: d.get("transactionId"),
        paymentMode: d.get("paymentMode") ?? null,
        paymentReference: d.get("paymentReference") ?? null,
        settledBy: d.get("settledBy"),
        createdAt: d.get("createdAt"),
        deleted: d.get("deleted") === true,
    }));

    // 4. Compute the plan via the shared pure helpers.
    const singlePlan = planLedgerBackfill(ledgerRows, existingKeys, now);
    // Master rows can legitimately collide on the single-settlement dedupe set
    // (different invoiceId namespace: masterInvoiceId vs invoiceId), so reuse
    // the same existingKeys — they're keyed by invoiceId either way.
    const masterPlan = planMasterLedgerBackfill(masterRows, existingKeys, now);
    const plan: BackfillPlanRow[] = [...singlePlan, ...masterPlan];

    if (JSON_OUT) {
        console.log(JSON.stringify(plan, null, 2));
    } else {
        console.log("Daily Ledger inflow backfill (Phase 8b)");
        console.log("─".repeat(72));
        console.log(`Existing dailyLedger rows scanned: ${existingRows.length}`);
        console.log(`Ledger rows scanned (single):       ${ledgerRows.length}`);
        console.log(`Ledger rows scanned (master):        ${masterRows.length}`);
        console.log(`Rows to backfill:                    ${plan.length}`);
        console.log("─".repeat(72));

        if (plan.length === 0) {
            console.log("✅ Nothing to backfill — every settlement already has a matching Daily Ledger inflow row.");
        } else {
            const total = plan.reduce((s, p) => s + (Number(p.data.amount) || 0), 0);
            for (const p of plan) {
                console.log(
                    `  ${(p.data.date as string).padEnd(12)} ₹${String(p.data.amount).padStart(9)}  ` +
                    `${(p.data.unitNumber as string || "—").padEnd(8)} ${p.data.description}`,
                );
            }
            console.log("─".repeat(72));
            console.log(`Total cash to surface in Daily Ledger: ₹${total.toLocaleString()}`);
        }
    }

    if (!APPLY) {
        console.log(plan.length > 0 ? "\nDry run only — re-run with --apply to write these rows." : "");
        return;
    }

    if (plan.length === 0) return;

    // 5. Commit in batches of ≤450.
    let written = 0;
    for (let i = 0; i < plan.length; i += BATCH_SIZE) {
        const chunk = plan.slice(i, i + BATCH_SIZE);
        const batch = db.batch();
        for (const row of chunk) {
            const ref = db.collection("dailyLedger").doc();
            batch.set(ref, row.data);
        }
        await batch.commit();
        written += chunk.length;
        console.log(`Committed ${written}/${plan.length}...`);
    }
    console.log(`✅ Backfilled ${written} Daily Ledger inflow row(s).`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
