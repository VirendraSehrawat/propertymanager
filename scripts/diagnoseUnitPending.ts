/**
 * Read-only diagnostic: explain a unit's displayed "pending" figure.
 *
 * Prints every invoice for a given unit number (newest first), its own
 * charges (rent + electricity), the stored `carryForward`, the stored
 * `totalAmount`, how much has been paid, and the outstanding balance that the
 * UI shows (`totalAmount − amountPaid`). It then recomputes what the
 * carry-forward *should* be with the fixed, non-compounding rule so you can
 * see the gap.
 *
 * Usage (DRY-RUN only — never writes):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/diagnoseUnitPending.ts "SA 206"
 *
 * Nothing is mutated. See `scripts/recomputeInvoiceTotals.ts` to fix.
 */

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { carryForwardFromInvoices, composeInvoiceTotal } from "../lib/allocation";

const [, , UNIT_NUMBER] = process.argv;

if (!UNIT_NUMBER) {
    console.error('Usage: diagnoseUnitPending.ts "SA 206"');
    process.exit(1);
}

const rupee = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const norm = (bp?: string) => (bp || "").replace(/\s*\(.+\)\s*$/, "").trim();
const monthValue = (bp?: string) => {
    const t = new Date(norm(bp)).getTime();
    return isNaN(t) ? 0 : t;
};

interface InvRow {
    id: string;
    unitNumber?: string;
    tenantEmail?: string;
    billingPeriod?: string;
    status?: string;
    baseRent?: number;
    electricityCharge?: number;
    carryForward?: number;
    totalAmount?: number;
    amountPaid?: number;
}

async function main() {
    if (!getApps().length) initializeApp({ credential: applicationDefault() });
    const db = getFirestore();

    const snap = await db.collection("invoices").get();
    const all: InvRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InvRow, "id">) }));

    const unitInvoices = all
        .filter((i) => (i.unitNumber || "").trim() === UNIT_NUMBER.trim())
        .sort((a, b) => monthValue(b.billingPeriod) - monthValue(a.billingPeriod));

    if (unitInvoices.length === 0) {
        console.log(`No invoices found with unitNumber === "${UNIT_NUMBER}".`);
        return;
    }

    const tenantEmail = unitInvoices[0].tenantEmail || "";
    console.log(`\n=== ${UNIT_NUMBER}  ·  tenant: ${tenantEmail || "(none)"} ===`);
    console.log(`Found ${unitInvoices.length} invoice(s) for this unit.\n`);

    // Per-invoice table.
    const header = ["Billing Period", "Status", "Rent", "Elec", "Own(R+E)", "StoredCF", "StoredTotal", "Paid", "Outstanding"];
    console.log(header.join(" | "));
    console.log("-".repeat(header.join(" | ").length + 20));

    let displayedOutstanding = 0;
    for (const inv of unitInvoices) {
        const rent = Number(inv.baseRent || 0);
        const elec = Number(inv.electricityCharge || 0);
        const own = rent + elec;
        const cf = Number(inv.carryForward || 0);
        const total = Number(inv.totalAmount || 0);
        const paid = Number(inv.amountPaid || 0);
        const outstanding = Math.max(0, total - paid);
        const open = inv.status === "unpaid" || inv.status === "pending";
        if (open) displayedOutstanding += outstanding;
        console.log(
            [
                norm(inv.billingPeriod).padEnd(14),
                (inv.status || "?").padEnd(6),
                rupee(rent),
                rupee(elec),
                rupee(own),
                rupee(cf),
                rupee(total),
                rupee(paid),
                rupee(outstanding) + (open ? "" : "  (closed)"),
            ].join(" | "),
        );
    }

    // The latest open invoice is what a per-unit "pending" badge usually shows.
    const latestOpen = unitInvoices.find((i) => i.status === "unpaid" || i.status === "pending");

    console.log("\n--- How the displayed number is built ---");
    if (latestOpen) {
        const rent = Number(latestOpen.baseRent || 0);
        const elec = Number(latestOpen.electricityCharge || 0);
        const cf = Number(latestOpen.carryForward || 0);
        const total = Number(latestOpen.totalAmount || 0);
        const paid = Number(latestOpen.amountPaid || 0);
        console.log(`Latest open invoice: ${norm(latestOpen.billingPeriod)} (${latestOpen.id})`);
        console.log(`  stored totalAmount        = ${rupee(total)}`);
        console.log(`  = rent ${rupee(rent)} + elec ${rupee(elec)} + storedCarryForward ${rupee(cf)}`);
        console.log(`  − amountPaid ${rupee(paid)}`);
        console.log(`  → OUTSTANDING SHOWN       = ${rupee(total - paid)}`);
    }
    console.log(`\nSum of ALL open invoices' outstanding = ${rupee(displayedOutstanding)}`);

    // Recompute carry-forward with the FIXED (non-compounding) rule.
    const cfInputs = unitInvoices.map((i) => ({
        id: i.id,
        status: i.status,
        billingPeriod: i.billingPeriod,
        baseRent: i.baseRent,
        electricityCharge: i.electricityCharge,
        totalAmount: i.totalAmount,
        amountPaid: i.amountPaid,
    }));

    console.log("\n--- What it SHOULD be (fixed, non-compounding rule) ---");
    if (latestOpen) {
        const correctCf = carryForwardFromInvoices(cfInputs, {
            excludeInvoiceId: latestOpen.id,
            excludeBillingPeriod: norm(latestOpen.billingPeriod),
        });
        const correct = composeInvoiceTotal({
            baseRent: Number(latestOpen.baseRent || 0),
            electricityCharge: Number(latestOpen.electricityCharge || 0),
            carryForward: correctCf,
        });
        const paid = Number(latestOpen.amountPaid || 0);
        console.log(`  correct carryForward      = ${rupee(correctCf)}  (sum of OTHER open months' own charges, once each)`);
        console.log(`  correct totalAmount       = ${rupee(correct.total)}`);
        console.log(`  correct outstanding       = ${rupee(Math.max(0, correct.total - paid))}`);
        console.log(`  stored  outstanding       = ${rupee(Math.max(0, Number(latestOpen.totalAmount || 0) - paid))}`);
    }

    // Also report any OLD open invoices that may be stale (candidates to
    // settle or write off so they stop feeding carry-forward).
    const openOld = unitInvoices.filter((i) => i.status === "unpaid" || i.status === "pending");
    console.log(`\nOpen invoices feeding carry-forward: ${openOld.length}`);
    openOld.forEach((i) =>
        console.log(`  • ${norm(i.billingPeriod)}  own=${rupee(Number(i.baseRent || 0) + Number(i.electricityCharge || 0))}  paid=${rupee(Number(i.amountPaid || 0))}  id=${i.id}`),
    );
    console.log("\n(Read-only — nothing was modified.)\n");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
