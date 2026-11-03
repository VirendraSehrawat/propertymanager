/**
 * Remove (zero out) an invoice's carry-forward and recompute its total.
 *
 * Use this when an invoice has a spurious `carryForward` (e.g. a transfer /
 * pro-rata flow seeded it with a future or double-counted balance). It sets
 * `carryForward = 0` and recomputes:
 *
 *     totalAmount = max(0, baseRent + electricityCharge)
 *
 * `amountPaid` is preserved; `status` is re-derived from the new total. The
 * previous values are stored (`previousCarryForward`, `previousTotalAmount`)
 * for an audit trail.
 *
 * DRY-RUN by default — prints the plan and writes NOTHING unless `--commit`.
 *
 * Usage:
 *   # by explicit invoice id
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/removeInvoiceCarryForward.ts --invoice inv_FF6CtZrH6RwUUwPYLQdr_10_2026
 *
 *   # or by unit + billing period
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/removeInvoiceCarryForward.ts --unit "SA 304" --period "October 2026"
 *
 *   # apply:
 *   ...same... --commit
 */

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { composeInvoiceTotal, stripBillingPeriodSuffix } from "../lib/allocation";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
};
const INVOICE_ID = flag("invoice");
const UNIT = flag("unit");
const PERIOD = flag("period");
const COMMIT = argv.includes("--commit");

if (!INVOICE_ID && !(UNIT && PERIOD)) {
    console.error(
        "Usage:\n" +
            "  removeInvoiceCarryForward.ts --invoice <invoiceId> [--commit]\n" +
            '  removeInvoiceCarryForward.ts --unit "SA 304" --period "October 2026" [--commit]',
    );
    process.exit(1);
}

const rupee = (n: unknown) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const deriveStatus = (paid: number, total: number): string => {
    if (paid <= 0.009) return "unpaid";
    if (paid >= total - 0.009) return "paid";
    return "pending";
};

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
            matches.forEach((m) => console.error(`  ${m.id}`));
            console.error("Re-run with --invoice <id> to disambiguate.");
            process.exit(1);
        }
        invoiceId = matches[0].id;
        data = matches[0].data() as Record<string, unknown>;
    }

    const rent = Number(data!.baseRent || 0);
    const elec = Number(data!.electricityCharge || 0);
    const oldCf = Number(data!.carryForward || 0);
    const oldTotal = Number(data!.totalAmount || 0);
    const paid = Number(data!.amountPaid || 0);

    if (oldCf === 0) {
        console.log(`Invoice ${invoiceId} already has carryForward = 0. Nothing to do.`);
        return;
    }

    const composed = composeInvoiceTotal({ baseRent: rent, electricityCharge: elec, carryForward: 0 });
    const newTotal = composed.total;
    const newStatus = deriveStatus(paid, newTotal);

    // --- Print the plan. ---
    console.log(`\n=== Remove carry-forward · ${data!.unitNumber || "?"} · ${data!.billingPeriod || "?"} ===`);
    console.log(`Invoice: ${invoiceId}\n`);
    console.log(`  rent                ${rupee(rent)}`);
    console.log(`  electricity         ${rupee(elec)}`);
    console.log(`  carryForward        ${rupee(oldCf)} → ${rupee(0)}`);
    console.log(`  totalAmount         ${rupee(oldTotal)} → ${rupee(newTotal)}`);
    console.log(`  amountPaid          ${rupee(paid)} (unchanged)`);
    console.log(`  status              ${data!.status} → ${newStatus}`);

    if (!COMMIT) {
        console.log(`\n(DRY RUN — nothing was written. Re-run with --commit to apply.)`);
        return;
    }

    const now = new Date().toISOString();
    await db.collection("invoices").doc(invoiceId).update({
        carryForward: 0,
        carryForwardDetails: [],
        totalAmount: newTotal,
        status: newStatus,
        previousCarryForward: oldCf,
        previousTotalAmount: oldTotal,
        carryForwardRemovedAt: now,
        carryForwardRemovedBy: "script:removeInvoiceCarryForward",
    });
    console.log(`\n✅ Committed. ${data!.billingPeriod} total is now ${rupee(newTotal)}.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
