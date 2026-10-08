/**
 * Admin-only ledger consistency audit.
 *
 *   GET /api/admin/audit-ledger?tolerance=1
 *   Authorization: Bearer <firebase-id-token>
 *
 * Verifies the caller is an authenticated admin, then reads every invoice and
 * ledger row (across `ledger` + `ledgerEntries`) with the Admin SDK and returns
 * the drift report computed by the shared `computeLedgerDrift` helper.
 *
 * Read-only: never writes to Firestore. See docs/ATOMIC_TRANSACTIONS_PLAN.md §7.
 */

import { NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp, verifyAuthToken } from "@/lib/serverAuth";
import { computeLedgerDrift, type AuditInvoice, type AuditLedgerRow } from "@/lib/ledgerAudit";

export const runtime = "nodejs";

const LEDGER_COLLECTIONS = ["ledger", "ledgerEntries"] as const;

export async function GET(request: Request) {
    // 1. Authenticate.
    const user = await verifyAuthToken(request);
    if (!user) {
        return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    // 2. Authorize — must be an admin. Prefer the custom claim; fall back to the
    //    Firestore `users/<uid>.role` document.
    const app = getAdminApp();
    const db = getFirestore(app);
    let isAdmin = user.role === "admin";
    if (!isAdmin) {
        try {
            const userDoc = await db.collection("users").doc(user.uid).get();
            isAdmin = userDoc.exists && userDoc.get("role") === "admin";
        } catch {
            isAdmin = false;
        }
    }
    if (!isAdmin) {
        return NextResponse.json({ error: "forbidden — admin only" }, { status: 403 });
    }

    // 3. Parse tolerance.
    const url = new URL(request.url);
    const tolRaw = url.searchParams.get("tolerance");
    const tolerance = tolRaw !== null && Number.isFinite(Number(tolRaw)) ? Number(tolRaw) : 1;

    try {
        // 4. Read ledger rows across both collections + all invoices.
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

        const invSnap = await db.collection("invoices").get();
        const invoices: AuditInvoice[] = invSnap.docs.map((d) => ({
            id: d.id,
            unitNumber: d.get("unitNumber"),
            billingPeriod: d.get("billingPeriod"),
            status: d.get("status"),
            amountPaid: Number(d.get("amountPaid")) || 0,
            deleted: d.get("deleted") === true,
        }));

        // 5. Compute + return the report.
        const report = computeLedgerDrift(invoices, ledgerRows, tolerance);
        return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), ...report });
    } catch (e) {
        console.error("[admin/audit-ledger] failed:", e);
        return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
}
