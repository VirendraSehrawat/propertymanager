/**
 * Firestore security-rules tests for financial/audit-integrity hardening.
 *
 * Covers the soft-delete + provenance guards on `dailyLedger`, `expenses`,
 * `ledger` and `ledgerEntries`:
 *   • provenance fields (createdAt/createdBy) are immutable on update
 *   • a soft-delete MUST carry a who/when audit trail
 *   • already-deleted rows are frozen for staff (admin may override)
 *   • physical deletes are admin-only (default path is soft-delete)
 *   • ledger provenance + settledBy are pinned across corrections
 *
 * Runs against the Firestore emulator (started by `npm test`).
 */

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

let testEnv: RulesTestEnvironment;

const employee = () =>
    testEnv.authenticatedContext("emp1", { role: "employee", email: "e@x.com" }).firestore();
const admin = () =>
    testEnv.authenticatedContext("adm1", { role: "admin", email: "a@x.com" }).firestore();

const now = () => new Date().toISOString();

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: "property-manager-rules-test",
        firestore: {
            host: "127.0.0.1",
            port: 8080,
            rules: readFileSync("firestore.rules", "utf8"),
        },
    });
});

afterAll(async () => {
    await testEnv.cleanup();
});

beforeEach(async () => {
    await testEnv.clearFirestore();
});

/** Seed a doc bypassing rules. */
async function seed(path: [string, string], data: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), path[0], path[1]), data);
    });
}

const baseLedgerRow = {
    tenantEmail: "t@x.com",
    invoiceId: "inv1",
    invoiceAmount: 1000,
    amountPaid: 1000,
    balance: 0,
    settledBy: "e@x.com",
    createdAt: now(),
};

describe("dailyLedger — soft-delete & provenance", () => {
    it("employee can create a well-formed row", async () => {
        await assertSucceeds(
            setDoc(doc(employee(), "dailyLedger", "d1"), {
                date: "2026-10-07", direction: "inflow", category: "rent",
                amount: 500, createdBy: "e@x.com", createdAt: now(),
            }),
        );
    });

    it("employee can soft-delete WITH an audit trail", async () => {
        await seed(["dailyLedger", "d2"], { amount: 500, createdBy: "e@x.com", createdAt: now() });
        await assertSucceeds(
            updateDoc(doc(employee(), "dailyLedger", "d2"), {
                deleted: true, deletedBy: "e@x.com", deletedAt: now(),
            }),
        );
    });

    it("employee CANNOT soft-delete without a who/when audit trail", async () => {
        await seed(["dailyLedger", "d3"], { amount: 500, createdBy: "e@x.com", createdAt: now() });
        await assertFails(
            updateDoc(doc(employee(), "dailyLedger", "d3"), { deleted: true }),
        );
    });

    it("employee CANNOT rewrite provenance (createdAt)", async () => {
        await seed(["dailyLedger", "d4"], { amount: 500, createdBy: "e@x.com", createdAt: now() });
        await assertFails(
            updateDoc(doc(employee(), "dailyLedger", "d4"), { createdAt: "1999-01-01T00:00:00Z" }),
        );
    });

    it("an already-deleted row is frozen for staff but admin can restore", async () => {
        await seed(["dailyLedger", "d5"], {
            amount: 500, createdBy: "e@x.com", createdAt: now(),
            deleted: true, deletedBy: "e@x.com", deletedAt: now(),
        });
        await assertFails(
            updateDoc(doc(employee(), "dailyLedger", "d5"), { deleted: false }),
        );
        await assertSucceeds(
            updateDoc(doc(admin(), "dailyLedger", "d5"), { deleted: false }),
        );
    });

    it("physical delete is admin-only", async () => {
        await seed(["dailyLedger", "d6"], { amount: 500, createdBy: "e@x.com", createdAt: now() });
        await assertFails(deleteDoc(doc(employee(), "dailyLedger", "d6")));
        await assertSucceeds(deleteDoc(doc(admin(), "dailyLedger", "d6")));
    });
});

describe("ledger — provenance & settledBy pinning", () => {
    it("employee correction may change amountPaid/balance", async () => {
        await seed(["ledger", "l1"], baseLedgerRow);
        await assertSucceeds(
            updateDoc(doc(employee(), "ledger", "l1"), {
                amountPaid: 800, balance: -200,
                correctedAt: now(), correctionNote: "fix", correctedBy: "e@x.com",
                originalAmountPaid: 1000,
            }),
        );
    });

    it("employee CANNOT change settledBy or invoiceId", async () => {
        await seed(["ledger", "l2"], baseLedgerRow);
        await assertFails(
            updateDoc(doc(employee(), "ledger", "l2"), { settledBy: "someone-else" }),
        );
        await assertFails(
            updateDoc(doc(employee(), "ledger", "l2"), { invoiceId: "other" }),
        );
    });

    it("physical delete is admin-only", async () => {
        await seed(["ledger", "l3"], baseLedgerRow);
        await assertFails(deleteDoc(doc(employee(), "ledger", "l3")));
        await assertSucceeds(deleteDoc(doc(admin(), "ledger", "l3")));
    });
});

describe("expenses — soft-delete audit", () => {
    it("employee CANNOT soft-delete without audit trail", async () => {
        await seed(["expenses", "e1"], { amount: 500, createdBy: "e@x.com", createdAt: now() });
        await assertFails(updateDoc(doc(employee(), "expenses", "e1"), { deleted: true }));
    });

    it("employee CAN soft-delete with audit trail", async () => {
        await seed(["expenses", "e2"], { amount: 500, createdBy: "e@x.com", createdAt: now() });
        await assertSucceeds(
            updateDoc(doc(employee(), "expenses", "e2"), {
                deleted: true, deletedBy: "e@x.com", deletedAt: now(),
            }),
        );
    });
});
