/**
 * Atomic committer for a {@link PaymentPlan} — Phase 2 of the atomic-transactions
 * design (see `docs/ATOMIC_TRANSACTIONS_PLAN.md`).
 *
 * This is the ONLY impure part of the payment pipeline: it turns a pure plan
 * (built by `lib/paymentPlan.ts`) into a single Firestore `writeBatch` so that
 * invoice patches, ledger rows, the optional master patch, and the optional
 * daily-ledger inflow all commit together or not at all.
 *
 * Why a batch (not individual awaits): the previous flows wrote the invoice and
 * its ledger row as separate calls, so a failure between them left the invoice
 * marked paid with no ledger row (payment invisible, books unbalanced). A batch
 * is all-or-nothing, which upholds the "every amountPaid change ⇒ one ledger
 * row" invariant at the persistence layer too.
 */

import { collection, doc, writeBatch, type Firestore } from "firebase/firestore";
import { COL } from "@/lib/collections";
import {
    assertPlanInvariant,
    countPlanWrites,
    PaymentPlanError,
    type PaymentPlan,
} from "@/lib/paymentPlan";

/**
 * Firestore allows 500 writes per batch. Stay comfortably under it so a large
 * corporate master settle can't silently exceed the limit mid-commit.
 */
export const MAX_BATCH_WRITES = 450;

export interface CommitResult {
    /** Newly minted ledger document ids, in plan order. */
    ledgerIds: string[];
    /** Newly minted daily-ledger document id (when the plan included one). */
    dailyLedgerId?: string;
    /** Total number of document writes committed. */
    writes: number;
}

/**
 * Commit a payment plan atomically.
 *
 * Document ids for new ledger / daily-ledger rows are minted client-side (via
 * `doc(collection(...))`) so the inserts can join the same batch as the invoice
 * updates and their ids can be returned to the caller (e.g. for notifications).
 *
 * @throws {PaymentPlanError} if the plan violates the ledger invariant or
 *         exceeds {@link MAX_BATCH_WRITES}.
 */
export async function commitPaymentPlan(
    db: Firestore,
    plan: PaymentPlan,
): Promise<CommitResult> {
    // Re-check the invariant at the boundary — a hand-assembled plan must not
    // be able to write an invoice change without its ledger row.
    assertPlanInvariant(plan);

    const writes = countPlanWrites(plan);
    if (writes > MAX_BATCH_WRITES) {
        throw new PaymentPlanError(
            `Payment plan has ${writes} writes, exceeding the ${MAX_BATCH_WRITES} ` +
                `batch limit. Split the settlement into smaller chunks.`,
        );
    }

    const batch = writeBatch(db);

    // 1. Create any up-front invoices (auto-created month).
    for (const create of plan.invoiceCreates) {
        batch.set(doc(db, COL.invoices, create.invoiceId), create.data);
    }

    // 2. Patch invoices.
    for (const p of plan.invoicePatches) {
        batch.update(doc(db, COL.invoices, p.invoiceId), p.patch);
    }

    // 3. Patch the master invoice (if any).
    if (plan.masterPatch) {
        batch.update(
            doc(db, COL.masterInvoices, plan.masterPatch.masterInvoiceId),
            plan.masterPatch.patch,
        );
    }

    // 4. Insert ledger rows with pre-minted ids.
    const ledgerIds: string[] = [];
    for (const row of plan.ledgerRows) {
        const { collection: col, ...data } = row;
        const ref = doc(collection(db, COL[col]));
        batch.set(ref, data);
        ledgerIds.push(ref.id);
    }

    // 5. Insert the optional daily-ledger inflow row.
    let dailyLedgerId: string | undefined;
    if (plan.dailyLedgerRow) {
        const ref = doc(collection(db, COL.dailyLedger));
        batch.set(ref, plan.dailyLedgerRow.data);
        dailyLedgerId = ref.id;
    }

    await batch.commit();

    return { ledgerIds, dailyLedgerId, writes };
}
