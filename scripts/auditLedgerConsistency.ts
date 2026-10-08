/**
 * Read-only audit — Phase 7 of the atomic-transactions design
 * (see `docs/ATOMIC_TRANSACTIONS_PLAN.md`).
 *
 * Verifies the core invariant that every payment flow now upholds:
 *
 *     for each invoice:  Σ(ledger.amountPaid where ledger.invoiceId == invoice.id)
 *                        === invoice.amountPaid
 *
 * Historical data written before the flows became atomic (Phases 3–6) may have
 * drifted — e.g. an invoice marked paid whose ledger row never landed, or a
 * ledger row that was deleted without re-syncing the invoice. This script
 * reports that drift so it can be reviewed and corrected manually.
 *
 * It is strictly READ-ONLY: it never writes to Firestore.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/auditLedgerConsistency.ts [--tolerance 1] [--json]
 *
 * Flags:
 *   --tolerance <₹>  Rounding tolerance before a row counts as drift (default 1).
 *   --json           Emit the drift rows as JSON (for piping into other tools).
 */

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { computeLedgerDrift, type AuditLedgerRow, type AuditInvoice } from "../lib/ledgerAudit";

const flags = process.argv.slice(2);
const JSON_OUT = flags.includes("--json");
const tolIdx = flags.indexOf("--tolerance");
const TOLERANCE = tolIdx >= 0 ? Number(flags[tolIdx + 1]) || 0 : 1;

/** Both collections hold per-invoice payment rows (single + master flows). */
const LEDGER_COLLECTIONS = ["ledger", "ledgerEntries"] as const;

async function main() {
    if (!getApps().length) initializeApp({ credential: applicationDefault() });
    const db = getFirestore();

    // 1. Gather all ledger rows across BOTH collections.
    const ledgerRows: AuditLedgerRow[] = [];
    for (const col of LEDGER_COLLECTIONS) {
        const snap = await db.collection(col).get();
        for (const d of snap.docs) {
            ledgerRows.push({
                invoiceId: d.get("invoiceId"),
                amountPaid: Number(d.get("amountPaid")) || 0,
                deleted: d.get("deleted") === true,
            });
        }
    }

    // 2. Gather all invoices.
    const invSnap = await db.collection("invoices").get();
    const invoices: AuditInvoice[] = invSnap.docs.map((d) => ({
        id: d.id,
        unitNumber: d.get("unitNumber"),
        billingPeriod: d.get("billingPeriod"),
        status: d.get("status"),
        amountPaid: Number(d.get("amountPaid")) || 0,
        deleted: d.get("deleted") === true,
    }));

    // 3. Compute drift via the shared pure helper.
    const report = computeLedgerDrift(invoices, ledgerRows, TOLERANCE);
    const { drift } = report;

    // 4. Report.
    if (JSON_OUT) {
        console.log(JSON.stringify(drift, null, 2));
        return;
    }

    console.log("Ledger consistency audit (read-only)");
    console.log("─".repeat(72));
    console.log(`Invoices scanned:     ${report.invoicesScanned}`);
    console.log(`Ledger rows scanned:  ${report.ledgerRowsScanned} (across ${LEDGER_COLLECTIONS.join(" + ")})`);
    console.log(`Tolerance:            ±₹${TOLERANCE}`);
    console.log("─".repeat(72));

    if (report.balanced) {
        console.log("✅ No drift — every invoice's amountPaid matches its ledger sum.");
        return;
    }

    console.log(`⚠️  ${drift.length} invoice(s) with drift:\n`);
    for (const r of drift) {
        const sign = r.diff > 0 ? "+" : "";
        console.log(
            `  ${r.unitNumber.padEnd(8)} ${r.billingPeriod.padEnd(20)} ` +
            `[${r.status.padEnd(7)}] ` +
            `invoice=₹${r.invoiceAmountPaid.toLocaleString().padStart(9)}  ` +
            `ledger=₹${r.ledgerSum.toLocaleString().padStart(9)}  ` +
            `diff=${sign}₹${r.diff.toLocaleString()}  ` +
            `(${r.ledgerRowCount} row${r.ledgerRowCount === 1 ? "" : "s"})  ${r.invoiceId}`,
        );
    }

    console.log("\n" + "─".repeat(72));
    console.log(`Summary: ${report.invoiceOverLedger} invoice-over-ledger, ${report.ledgerOverInvoice} ledger-over-invoice.`);
    console.log("Review each manually — Admin → Master Payment Ledger can correct ledger rows,");
    console.log("or regenerate/edit the invoice to re-derive its amountPaid.");

    // Non-zero exit so CI / cron can flag drift.
    process.exitCode = 1;
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
