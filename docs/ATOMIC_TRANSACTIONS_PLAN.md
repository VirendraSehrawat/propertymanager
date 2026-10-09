# Atomic Transactions & Complete Ledger Visibility — Implementation Plan

**Status:** ✅ Complete — all phases (0–7) implemented
**Author:** Engineering
**Date:** 2026-10-08 · **Updated:** 2026-10-09
**Related:** `lib/payments.ts`, `lib/ledgerSync.ts`, `lib/masterAllocation.ts`, `components/employee/CollectionsTab.tsx`, `components/employee/DailyLedgerTab.tsx`, `components/admin/AdminLedgerTab.tsx`
**Implemented:** `lib/paymentPlan.ts`, `lib/commitPaymentPlan.ts`, `__tests__/paymentPlan.test.ts`, `components/employee/CollectionsTab.tsx` (settle + master settle), `components/employee/DailyLedgerTab.tsx` (inflow + expense mirror), `components/admin/AdminLedgerTab.tsx` (correct + delete), `scripts/auditLedgerConsistency.ts`

---

## 0. Progress Log

| Phase | Status | Notes |
|-------|--------|-------|
| 0 — Guardrails (tests) | ✅ Done | `__tests__/paymentPlan.test.ts` — 15 tests, all passing. |
| 1 — Pure plan builder | ✅ Done | `lib/paymentPlan.ts` — `buildSettlePlan`, `buildInflowPlan`, `buildMasterSettlePlan` + invariant guard. |
| 2 — Atomic committer | ✅ Done | `lib/commitPaymentPlan.ts` — single `writeBatch`, pre-minted ids, batch-size guard. |
| 3 — Collections settle | ✅ Done | `CollectionsTab.handleConfirmSettle` → `buildSettlePlan` + `commitPaymentPlan`. Component tests updated to assert the atomic batch path. |
| 4 — Daily Ledger inflow | ✅ Done | `DailyLedgerTab.handleSubmit`: Unit A (dailyLedger + expense mirror + back-link) now one `writeBatch` with pre-minted ids; Unit B (auto-settle) → `buildInflowPlan` + `commitPaymentPlan`, incl. auto-created invoice in the same batch. |
| 5 — Master settle | ✅ Done | `CollectionsTab.handleMasterSettle` → `buildMasterSettlePlan` + `commitPaymentPlan`. Master patch, per-child patches, per-child `ledgerEntries` rows, and the single `dailyLedger` inflow now all commit in ONE batch (previously the ledger rows were written post-commit). |
| 6 — Admin correction | ✅ Done | `AdminLedgerTab` — `handleEditSave` already single-batch (switched literals → `COL`). `handleDelete` rewritten: deleting a ledger row now re-syncs the linked invoice + master in the SAME batch (was a bare `deleteDoc` that left stale `amountPaid`). |
| 7 — Audit script | ✅ Done | `scripts/auditLedgerConsistency.ts` — read-only; reports any invoice where `Σ(ledger.amountPaid) ≠ invoice.amountPaid` beyond a tolerance. Dry-run only, non-zero exit on drift (CI/cron friendly). |
| 7b — Admin in-app audit | ✅ Done | Shared pure `lib/ledgerAudit.ts` (`computeLedgerDrift`); admin-only `GET /api/admin/audit-ledger` (token + role verified, reads both ledger collections via Admin SDK); "🔍 Run Consistency Audit" button + drift report panel in `AdminLedgerTab`. 7 new tests in `__tests__/ledgerAudit.test.ts`. |

**Validation (2026-10-09):** `tsc --noEmit` → 0 errors. `vitest run paymentPlan + ledgerSync + CollectionsTab + masterAllocation + payments + lumpsum` → all green. (The 3 failing integration suites — `rules`, `expenses`, `integration` — require the Firestore emulator on `127.0.0.1:8080` and are unrelated to this work.)

---

## 1. Problem Statement

### 1.1 Transactions are not atomic
Every payment flow writes to Firestore as a **sequence of independent `await`ed
calls** (`updateDoc`, then `addDoc`, then another `addDoc`…). If the process is
interrupted between calls (network drop, tab close, Firestore error, permission
rejection), the database is left in a **partially-written, inconsistent state**:

| Flow | Current writes (in order) | Failure gap |
|------|---------------------------|-------------|
| **Collections → Mark as Paid** (`CollectionsTab.tsx` ~L240) | 1. `updateDoc(invoice)` → 2. `addDoc(ledger)` | Invoice flips to `paid`/`pending` but **no ledger row** is created → payment invisible in ledger, numbers don't reconcile. |
| **Daily Ledger → Inflow auto-settle** (`DailyLedgerTab.tsx` ~L141) | 1. `addDoc(dailyLedger)` → 2. `addDoc(expenses)` mirror → 3. `updateDoc(link)` → 4. optional `addDoc(invoice)` → 5. loop `updateDoc(invoice)` + `addDoc(ledger)` → 6. `addDoc(credit)` | Any break leaves orphaned ledger rows, unsettled invoices, or double-applied cash. |
| **Master invoice settle** (`CollectionsTab.tsx` ~L370) | `writeBatch` for invoice+master updates (atomic ✅) **then** post-commit loop of `addDoc(ledgerEntries)` + `addDoc(dailyLedger)` (❌ not atomic) | Master/children marked paid, but ledger rows can be missing. |

### 1.2 Partial & settled payments don't reliably show in the ledger
- `CollectionsTab` already tags rows `type: "partial-payment"` vs `"payment"` —
  but because the ledger `addDoc` is a **separate** non-atomic call, a partial
  can silently fail to appear.
- `DailyLedgerTab` auto-settle writes ledger rows per invoice, but if the loop
  throws midway some invoices get a row and others don't.
- There is no **invariant** guaranteeing: *for every change to
  `invoice.amountPaid`, exactly one ledger row exists recording that delta.*

**Goal:** Make each payment an all-or-nothing unit, and guarantee that every
settlement — full **or** partial — produces its ledger row in the same atomic
write.

---

## 2. Design Principles

1. **One logical payment = one atomic write.** Use Firestore `writeBatch` (for
   blind writes) or `runTransaction` (when we must read-modify-write with
   contention) so invoice + ledger + master all commit together or not at all.
2. **Pre-generate document IDs** instead of `addDoc`. Use
   `doc(collection(db, COL.ledger))` to mint a ref client-side, then
   `batch.set(ref, …)`. This lets ledger inserts join the same batch as the
   invoice update.
3. **Ledger row is mandatory, not a follow-up.** Never update `amountPaid`
   without writing the matching ledger row in the **same** batch.
4. **Keep pure logic pure.** `lib/payments.ts` / `lib/ledgerSync.ts` /
   `lib/masterAllocation.ts` stay side-effect-free. Introduce a new
   side-effect-free **plan builder** that returns the full list of writes; the
   component just commits them.
5. **Idempotency where possible.** Deterministic doc IDs for ledger rows
   (e.g. `pay_<invoiceId>_<timestamp>`) so an accidental retry can't duplicate.

---

## 3. Implementation Steps

### Phase 0 — Guardrails (tests first) ✅ Done
- [x] Added `__tests__/paymentPlan.test.ts` covering: full settle, partial
      settle, lump-sum across N invoices, leftover credit, master settle, the
      `assertPlanInvariant` guard, and `countPlanWrites`. **15 tests passing.**
- [x] Tests target the pure plan builders (Phase 1) and the invariant guard.

### Phase 1 — New pure "payment plan" builder (`lib/paymentPlan.ts`) ✅ Done
Side-effect-free module that composes the existing helpers
(`allocatePartialPayment`, `allocateLumpSum`, `allocateMasterPayment`) into a
single **`PaymentPlan`** describing every document mutation. **As built**, the
plan shape is richer than the original sketch to cover auto-created invoices,
the master daily-ledger row, and the two ledger collections:

```ts
export interface LedgerRowDraft {
  tenantEmail: string; unitId?: string; unitNumber?: string;
  invoiceId: string; billingPeriod: string;
  invoiceAmount: number; amountPaid: number; balance: number;
  type: "payment" | "partial-payment" | "credit" | "master-payment";
  transactionId: string; settledBy: string; createdAt: string;
  paymentMode?: PaymentMode | null; paymentReference?: string | null;
  paymentNote?: string | null; category?: string | null;
  masterInvoiceId?: string;
  collection: "ledger" | "ledgerEntries"; // which collection the row lands in
}

export interface PaymentPlan {
  invoiceCreates: InvoiceCreateDraft[];   // e.g. auto-created month (Daily Ledger)
  invoicePatches: InvoicePatchDraft[];
  ledgerRows: LedgerRowDraft[];           // one per invoice touched + optional credit
  masterPatch?: { masterInvoiceId: string; patch: Record<string, unknown> };
  dailyLedgerRow?: DailyLedgerRowDraft;   // single consolidated master cash inflow
}

export function buildSettlePlan(input: SettlePlanInput): PaymentPlan        // Collections
export function buildInflowPlan(input: InflowPlanInput): PaymentPlan        // Daily Ledger
export function buildMasterSettlePlan(input: MasterSettlePlanInput): PaymentPlan // Master
```

**Invariant enforced in code:** `assertPlanInvariant(plan)` throws
`PaymentPlanError` if any invoice patch that mutates `amountPaid` lacks a
matching ledger row. Each builder calls it before returning, and the committer
re-checks it at the persistence boundary. `countPlanWrites(plan)` reports the
total write count for the batch-size guard.

### Phase 2 — Atomic commit helper (`lib/commitPaymentPlan.ts`) ✅ Done
Impure committer that writes a whole plan in a single `writeBatch`. **As built:**

```ts
export const MAX_BATCH_WRITES = 450; // Firestore hard limit is 500

export async function commitPaymentPlan(db, plan): Promise<CommitResult> {
  assertPlanInvariant(plan);                       // re-check at the boundary
  if (countPlanWrites(plan) > MAX_BATCH_WRITES) throw new PaymentPlanError(...);
  const batch = writeBatch(db);
  for (const c of plan.invoiceCreates) batch.set(doc(db, COL.invoices, c.invoiceId), c.data);
  for (const p of plan.invoicePatches) batch.update(doc(db, COL.invoices, p.invoiceId), p.patch);
  if (plan.masterPatch) batch.update(doc(db, COL.masterInvoices, plan.masterPatch.masterInvoiceId), plan.masterPatch.patch);
  for (const row of plan.ledgerRows) {             // pre-minted ids, routed by row.collection
    const { collection: col, ...data } = row;
    const ref = doc(collection(db, COL[col]));
    batch.set(ref, data);
  }
  if (plan.dailyLedgerRow) batch.set(doc(collection(db, COL.dailyLedger)), plan.dailyLedgerRow.data);
  await batch.commit();                            // ← all-or-nothing
  return { ledgerIds, dailyLedgerId, writes };     // minted ids for notifications
}
```

> **Batch limit:** guarded by `MAX_BATCH_WRITES = 450` (throws before commit if
> exceeded). A lump-sum realistically touches <20 invoices, so we're safe.


### Phase 3 — Refactor `CollectionsTab` settle ✅ Done
- [x] Replaced the `updateDoc` + `addDoc` pair in `handleConfirmSettle` with
      `buildSettlePlan(...)` → `commitPaymentPlan(db, plan)`. The invoice patch
      and ledger row now commit in **one atomic batch**.
- [x] Partial payments emit a `partial-payment` ledger row (balance
      `-newRemaining`); full payments emit a `payment` row (balance `0`) with
      `paidAt`. Guaranteed by `assertPlanInvariant` inside the builder.
- [x] Telegram notification moved **after** the commit (fire-and-forget, outside
      the atomic unit) and now uses the returned `ledgerIds[0]`.
- [x] `__tests__/CollectionsTab.test.tsx` updated: the Firestore mock captures
      `batch.update` / `batch.set` / `batch.commit`, and the two settle tests
      assert on the committed batch writes instead of the old direct calls.
- Note: the pre-settle validation still calls `allocatePartialPayment` directly
  for the "amount exceeds remaining" guard; the write-set itself is built by
  `buildSettlePlan`.


### Phase 4 — Refactor Daily Ledger inflow ✅ Done
Split into two atomic units:
- [x] **Unit A (cash + expense mirror):** the `dailyLedger` row and, for
      outflows, the `expenses` mirror + back-link now commit in **one
      `writeBatch`** using pre-minted `doc(collection(...))` ids (removes the old
      3-step `addDoc`→`addDoc`→`updateDoc` mirror that could orphan rows).
      Inflows/ non-outflows write the single `dailyLedger` row via `setDoc` on
      the pre-minted ref.
- [x] **Unit B (auto-settle):** `buildInflowPlan(...)` builds the whole
      write-set — the optional auto-created invoice (id minted up front),
      per-invoice patches, per-invoice ledger rows, and the leftover credit row —
      then `commitPaymentPlan(db, plan)` writes them atomically.
- [x] Partial lines produce `partial-payment` ledger rows and full lines
      `payment` rows (enforced by `assertPlanInvariant`). The user summary
      (settled / partial / credit) is now derived from `plan.ledgerRows` so UI
      and persistence share one source of truth.
- Note: the inline settle **preview** in the modal still calls `allocateLumpSum`
  directly (read-only, no writes) — unchanged.


### Phase 5 — Refactor Master settle ✅ Done
- [x] Folded the former post-commit `addDoc(ledgerEntries)` loop **and** the
      `addDoc(dailyLedger)` inflow **into** the atomic batch. `handleMasterSettle`
      now calls `buildMasterSettlePlan(...)` → `commitPaymentPlan(db, plan)`, so
      the master patch, every child patch, every `master-payment` ledger row
      (routed to `ledgerEntries`), and the single consolidated daily-ledger
      inflow all commit together or not at all.
- [x] The "payment amount must be greater than zero" guard is preserved —
      `buildMasterSettlePlan` throws `PaymentPlanError` when `appliedTotal <= 0`,
      caught by the existing handler.
- [x] Removed now-unused imports (`addDoc`, `collection`, `writeBatch`,
      `buildTransactionId`, `allocateMasterPayment`) from `CollectionsTab`.


### Phase 6 — Admin ledger correction (`AdminLedgerTab`) ✅ Done
- [x] `handleEditSave` was already single-batch (corrected ledger row + invoice
      + master all via one `writeBatch`). Switched its literal collection names
      (`"ledger"`, `"invoices"`, `"masterInvoices"`) to the `COL` map for
      consistency and typo-safety.
- [x] `handleDelete` was a bare `deleteDoc` that removed a ledger row **without**
      updating the linked invoice — leaving a stale `amountPaid` (a drift bug
      against the core invariant). Rewritten to delete the row **and** re-sync
      the invoice + master in the SAME batch: the deleted row is overridden to
      `amountPaid: 0` via `syncInvoiceFromLedger`, so the invoice/master totals
      recompute correctly.


### Phase 7 — Backfill / consistency check ✅ Done
- [x] Added read-only `scripts/auditLedgerConsistency.ts`: for each invoice it
      checks `Σ(ledger.amountPaid where invoiceId == invoice.id) === invoice.amountPaid`
      across **both** `ledger` and `ledgerEntries`, honouring soft-deletes and
      skipping pure credit/advance rows (no `invoiceId`). Reports drift caused by
      historical partial writes (pre-atomic era).
- Behaviour: strictly read-only (never writes); `--tolerance <₹>` (default 1) and
  `--json` flags; prints worst-first, summarises invoice-over-ledger vs
  ledger-over-invoice, and sets a non-zero exit code when drift exists so it can
  run in CI/cron.
- Usage:
  ```bash
  GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
    npx tsx scripts/auditLedgerConsistency.ts [--tolerance 1] [--json]
  ```

### Phase 7b — Admin in-app audit ✅ Done
So admins can run the same check without shell access:
- [x] **`lib/ledgerAudit.ts`** — extracted the drift maths into a pure,
      reusable `computeLedgerDrift(invoices, ledgerRows, tolerance)` returning a
      `LedgerAuditReport`. Both the CLI script and the API route now call it
      (single source of truth). 7 unit tests in `__tests__/ledgerAudit.test.ts`.
- [x] **`GET /api/admin/audit-ledger`** (`app/api/admin/audit-ledger/route.ts`)
      — verifies the Firebase ID token via `verifyAuthToken`, confirms the
      caller is an **admin** (custom claim or `users/<uid>.role`), then reads all
      invoices + both ledger collections with the Admin SDK and returns the
      report. Strictly read-only; 401/403 for non-admins.
- [x] **UI** — a "🔍 Run Consistency Audit" button in `AdminLedgerTab` calls the
      route with the user's ID token and renders a report panel: green "ledger is
      consistent" banner when balanced, or an amber drift table (unit, period,
      invoice paid, ledger sum, diff, row count) sorted worst-first.



---

## 4. Files to Add / Change

| File | Change |
|------|--------|
| `lib/paymentPlan.ts` | ✅ **DONE** — pure plan builders (`buildSettlePlan`, `buildInflowPlan`, `buildMasterSettlePlan`) + `assertPlanInvariant` / `countPlanWrites`. |
| `lib/commitPaymentPlan.ts` | ✅ **DONE** — atomic `writeBatch` committer with `MAX_BATCH_WRITES` guard. |
| `__tests__/paymentPlan.test.ts` | ✅ **DONE** — invariant + per-flow coverage (15 tests). |
| `components/employee/CollectionsTab.tsx` | ✅ **DONE** — settle flow → `buildSettlePlan` + `commitPaymentPlan` (atomic). |
| `components/employee/DailyLedgerTab.tsx` | ✅ **DONE** — inflow flow → plan + commit; expense mirror batched (2 atomic units). |
| `components/admin/AdminLedgerTab.tsx` | ✅ **DONE** — correction single-batch (→ `COL`); delete now re-syncs invoice + master atomically. |
| `scripts/auditLedgerConsistency.ts` | ✅ **DONE** — read-only drift report (`Σ ledger === invoice.amountPaid`). |
| `lib/ledgerAudit.ts` | ✅ **DONE** — pure `computeLedgerDrift` shared by the script + API. |
| `app/api/admin/audit-ledger/route.ts` | ✅ **DONE** — admin-only read-only audit endpoint. |
| `__tests__/ledgerAudit.test.ts` | ✅ **DONE** — 7 tests for the drift maths. |
| `docs/BUSINESS_RULES.md` | ⏳ Document the "every amountPaid change ⇒ one ledger row, atomically" invariant. |

---

## 5. Ledger Visibility Rules (explicit)

For every committed payment, the ledger (`COL.ledger` / `COL.ledgerEntries`)
MUST contain a row with:

| Scenario | `type` | `amountPaid` | `balance` |
|----------|--------|--------------|-----------|
| Full settle | `payment` | amount applied this txn | `0` |
| Partial settle | `partial-payment` | amount applied this txn | `-remaining` (negative = still due) |
| Overpayment / advance | `credit` | leftover | `+leftover` |
| Master child | `master-payment` | applied to that child | `max(0, total − paid)` |

The tenant ledger view (`app/tenant/page.tsx`) and admin ledger already read
these rows; no schema change is required — partial rows simply become
**guaranteed** instead of best-effort.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Batch exceeds 500 writes on a huge corporate master | Assert ≤450 in `commitPaymentPlan`; chunk master settles if ever needed. |
| `runTransaction` contention if two employees settle the same invoice | Start with `writeBatch` (blind writes are fine because the allocation is computed from a fresh snapshot); escalate to `runTransaction` only for the rare concurrent-settle case. |
| Historical inconsistent data | Phase 7 audit script; no destructive migration. |
| Telegram/notify failure rolling back a payment | Keep notifications **outside** the batch (post-commit, fire-and-forget). |

---

## 7. Rollout

1. Land Phases 0–2 (pure code + committer, fully unit-tested) — zero UI risk.
2. Migrate Collections settle (Phase 3), ship, watch ledger reconciliation.
3. Migrate Daily Ledger (Phase 4) and Master (Phase 5).
4. Run audit script (Phase 7) to confirm `sum(ledger) === invoice.amountPaid`
   across the book.

**Definition of done:** No payment flow writes `amountPaid` without writing its
ledger row in the same atomic batch; `vitest` covers every branch; audit script
reports zero drift on new payments.
```