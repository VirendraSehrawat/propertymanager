/**
 * One-off: relabel every invoice whose billingPeriod === FROM_LABEL to TO_LABEL.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/relabelBillingPeriod.ts "August 2026" "September 2026" [--commit]
 *
 * Runs in DRY-RUN mode unless you pass --commit.
 *
 * Also updates `rentPeriod` / `electricityPeriod` derived labels so the
 * business rule in `lib/billingPeriods.ts` stays consistent (rent = current
 * month, electricity = previous month).
 */

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
    computeRentPeriod,
    computeElectricityPeriod,
    billingLabelToYm,
} from "../lib/billingPeriods";

const [, , FROM_LABEL, TO_LABEL, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");

if (!FROM_LABEL || !TO_LABEL) {
    console.error('Usage: relabelBillingPeriod.ts "August 2026" "September 2026" [--commit]');
    process.exit(1);
}

// Normalize suffix like " (Transfer)" the same way the UI does.
const norm = (bp?: string) => (bp || "").replace(/\s*\(.+\)\s*$/, "").trim();

async function main() {
    if (!getApps().length) initializeApp({ credential: applicationDefault() });
    const db = getFirestore();

    const targetYm = billingLabelToYm(TO_LABEL);
    if (!targetYm) {
        console.error(`Could not parse target label "${TO_LABEL}" as YYYY-MM.`);
        process.exit(1);
    }

    const snap = await db.collection("invoices").get();
    const matches = snap.docs.filter((d) => norm(d.get("billingPeriod")) === FROM_LABEL);

    console.log(`Scanned ${snap.size} invoices, ${matches.length} match "${FROM_LABEL}".`);
    if (matches.length === 0) return;

    const batchSize = 400;
    for (let i = 0; i < matches.length; i += batchSize) {
        const batch = db.batch();
        for (const d of matches.slice(i, i + batchSize)) {
            const unitPaymentDay = Number(d.get("paymentDay")) || undefined;
            batch.update(d.ref, {
                billingPeriod: TO_LABEL,
                rentPeriod: computeRentPeriod(targetYm, unitPaymentDay),
                electricityPeriod: computeElectricityPeriod(targetYm),
            });
            console.log(`  ${d.id}  ${d.get("unitNumber") || "?"}  →  ${TO_LABEL}`);
        }
        if (COMMIT) {
            await batch.commit();
            console.log(`Committed batch ${i / batchSize + 1}.`);
        }
    }

    // Also relabel any master invoices for the same period.
    const masters = await db.collection("masterInvoices").get();
    const masterMatches = masters.docs.filter((d) => norm(d.get("billingPeriod")) === FROM_LABEL);
    if (masterMatches.length > 0) {
        const batch = db.batch();
        masterMatches.forEach((d) => batch.update(d.ref, { billingPeriod: TO_LABEL }));
        console.log(`Master invoices to relabel: ${masterMatches.length}`);
        if (COMMIT) await batch.commit();
    }

    if (!COMMIT) {
        console.log("\nDRY-RUN complete. Re-run with --commit to apply.");
    } else {
        console.log("\n✅ Done.");
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
