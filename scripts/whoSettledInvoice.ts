/**
 * Read-only diagnostic: WHO recorded a payment on an invoice, and WHEN.
 *
 * Given an invoice id (or a unit number), prints every ledger / daily-ledger
 * row that touched it, showing the amount applied, the person who recorded it
 * (`settledBy` / `recordedBy` / `createdBy`), the timestamp (`createdAt`), the
 * payment mode/reference and the transaction id.
 *
 * Use this to answer "who collected ₹4,977 and when?" for a given invoice.
 *
 * Usage (DRY-RUN only — never writes):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/whoSettledInvoice.ts inv_89QuGqzPuzmJfAY91tG7_10_2026
 *
 *   # or look up every invoice for a unit, then its ledger rows:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/whoSettledInvoice.ts --unit "SA 305"
 *
 * Nothing is mutated.
 */

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const argv = process.argv.slice(2);
const unitFlagIdx = argv.indexOf("--unit");
const UNIT_NUMBER = unitFlagIdx >= 0 ? argv[unitFlagIdx + 1] : undefined;
const INVOICE_ID = unitFlagIdx >= 0 ? undefined : argv[0];

if (!INVOICE_ID && !UNIT_NUMBER) {
    console.error(
        'Usage:\n' +
            '  whoSettledInvoice.ts <invoiceId>\n' +
            '  whoSettledInvoice.ts --unit "SA 305"',
    );
    process.exit(1);
}

const LEDGER_COLLECTIONS = ["ledger", "ledgerEntries", "dailyLedger"] as const;

const rupee = (n: unknown) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const when = (iso: unknown) => {
    if (!iso) return "(no timestamp)";
    const d = new Date(String(iso));
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleString("en-IN");
};

interface LedgerRow {
    id: string;
    collection: string;
    invoiceId?: string;
    unitNumber?: string;
    tenantEmail?: string;
    billingPeriod?: string;
    amountPaid?: number;
    amount?: number;
    type?: string;
    direction?: string;
    transactionId?: string;
    settledBy?: string;
    recordedBy?: string;
    createdBy?: string;
    createdAt?: string;
    date?: string;
    paymentMode?: string | null;
    paymentReference?: string | null;
    paymentNote?: string | null;
}

async function main() {
    if (!getApps().length) {
        initializeApp({ credential: applicationDefault() });
    }
    const db = getFirestore();

    // Resolve the set of invoice ids we care about.
    const invoiceIds = new Set<string>();
    if (INVOICE_ID) {
        invoiceIds.add(INVOICE_ID);
    } else if (UNIT_NUMBER) {
        const invSnap = await db
            .collection("invoices")
            .where("unitNumber", "==", UNIT_NUMBER)
            .get();
        if (invSnap.empty) {
            console.log(`No invoices found for unit "${UNIT_NUMBER}".`);
            return;
        }
        invSnap.docs.forEach((d) => invoiceIds.add(d.id));
        console.log(
            `Unit "${UNIT_NUMBER}" → ${invoiceIds.size} invoice(s):\n  ${[...invoiceIds].join("\n  ")}\n`,
        );
    }

    const rows: LedgerRow[] = [];
    for (const col of LEDGER_COLLECTIONS) {
        for (const invId of invoiceIds) {
            const snap = await db.collection(col).where("invoiceId", "==", invId).get();
            snap.docs.forEach((d) =>
                rows.push({ id: d.id, collection: col, ...(d.data() as Record<string, unknown>) }),
            );
        }
    }

    if (rows.length === 0) {
        console.log(
            "No ledger / daily-ledger rows reference these invoice(s).\n" +
                "The amountPaid was likely set by an older (pre-atomic) flow or a\n" +
                "data import/backfill that did not record an author.",
        );
        return;
    }

    // Sort oldest-first by whatever timestamp each row carries.
    rows.sort((a, b) => {
        const ta = new Date(String(a.createdAt || a.date || 0)).getTime() || 0;
        const tb = new Date(String(b.createdAt || b.date || 0)).getTime() || 0;
        return ta - tb;
    });

    console.log(`Found ${rows.length} payment record(s):\n`);
    for (const r of rows) {
        const amount = r.amountPaid ?? r.amount;
        const who = r.settledBy || r.recordedBy || r.createdBy || "(unknown)";
        console.log(
            `• ${rupee(amount)}  ${r.type || r.direction || "?"}  [${r.collection}]\n` +
                `    by:     ${who}\n` +
                `    when:   ${when(r.createdAt || r.date)}\n` +
                `    period: ${r.billingPeriod || "—"}   unit: ${r.unitNumber || "—"}   tenant: ${r.tenantEmail || "—"}\n` +
                `    txn:    ${r.transactionId || "—"}` +
                (r.paymentMode ? `   mode: ${r.paymentMode}` : "") +
                (r.paymentReference ? `   ref: ${r.paymentReference}` : "") +
                (r.paymentNote ? `\n    note:   ${r.paymentNote}` : "") +
                `\n    docId:  ${r.collection}/${r.id}\n`,
        );
    }

    console.log("(Read-only — nothing was modified.)");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
