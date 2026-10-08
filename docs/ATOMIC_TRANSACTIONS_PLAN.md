# Atomic Transactions & Complete Ledger Visibility — Implementation Plan

**Status:** Proposed
**Author:** Engineering
**Date:** 2026-10-08
**Related:** `lib/payments.ts`, `lib/ledgerSync.ts`, `lib/masterAllocation.ts`, `components/employee/CollectionsTab.tsx`, `components/employee/DailyLedgerTab.tsx`, `components/admin/AdminLedgerTab.tsx`

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

### Phase 0 — Guardrails (tests first)
- [ ] Add `__tests__/paymentPlan.test.ts` describing the expected batch
      contents for: full settle, partial settle, lump-sum across N invoices,
      leftover credit, and master settle.
- [ ] These tests target the **new pure plan builder** (Phase 1) and fail until
      it exists.

### Phase 1 — New pure "payment plan" builder (`lib/paymentPlan.ts`)
Create a side-effect-free module that composes the existing helpers
(`computeAutoSettle`, `allocateLumpSum`, `allocateMasterPayment`) into a single
**`PaymentPlan`** describing every document mutation:

```ts
export interface LedgerRowDraft {
  tenantEmail: string; unitId?: string; unitNumber?: string;
  invoiceId: string; billingPeriod: string;
  invoiceAmount: number; amountPaid: number; balance: number;
  type: "payment" | "partial-payment" | "credit" | "master-payment";
  transactionId: string; settledBy: string; createdAt: string;
  // …payment mode / reference / note
}

export interface InvoicePatchDraft {
  invoiceId: string;
  patch: Record<string, unknown>; // amountPaid, status, paidAt?, transactionId
}

export interface PaymentPlan {
  invoicePatches: InvoicePatchDraft[];
  ledgerRows: LedgerRowDraft[];   // one per invoice touched (full OR partial) + optional credit
  masterPatch?: { masterInvoiceId: string; patch: Record<string, unknown> };
}

export function buildSettlePlan(...): PaymentPlan   // Collections single-invoice
export function buildInflowPlan(...): PaymentPlan   // Daily Ledger lump-sum waterfall
export function buildMasterSettlePlan(...): PaymentPlan // master + children
```

**Invariant enforced in code:** every entry in `invoicePatches` that changes
`amountPaid` has a corresponding `ledgerRows` entry. Add a unit test asserting
`ledgerRows.length >= invoicePatches.length`.

### Phase 2 — Atomic commit helper (`lib/commitPaymentPlan.ts`)
A thin (impure) function that takes a `PaymentPlan` + `db` and writes it in a
single `writeBatch`:

```ts
export async function commitPaymentPlan(db, plan: PaymentPlan): Promise<{ ledgerIds: string[] }> {
  const batch = writeBatch(db);
  for (const p of plan.invoicePatches) batch.update(doc(db, COL.invoices, p.invoiceId), p.patch);
  if (plan.masterPatch) batch.update(doc(db, COL.masterInvoices, plan.masterPatch.masterInvoiceId), plan.masterPatch.patch);
  const ledgerIds: string[] = [];
  for (const row of plan.ledgerRows) {
    const ref = doc(collection(db, COL.ledger)); // pre-minted id
    batch.set(ref, row);
    ledgerIds.push(ref.id);
  }
  await batch.commit();     // ← all-or-nothing
  return { ledgerIds };
}
```

> **Batch limit:** Firestore batches allow 500 writes. A lump-sum realistically
> touches <20 invoices, so we're safe. Add an assertion that throws if a plan
> exceeds ~450 writes (future-proofing for corporate masters).

### Phase 3 — Refactor `CollectionsTab` settle
- [ ] Replace the `updateDoc` + `addDoc` pair (~L240) with
      `buildSettlePlan(...)` → `commitPaymentPlan(...)`.
- [ ] Partial payments already flow through `computeAllocation`; ensure the plan
      always emits the ledger row with `type: "partial-payment"` when
      `!fullyPaid`.
- [ ] Move the Telegram notification **after** a successful commit (keep
      fire-and-forget; it is not part of the atomic unit).

### Phase 4 — Refactor Daily Ledger inflow
This is the riskiest flow (most writes). Split into two atomic units:
- [ ] **Unit A (cash + expense mirror):** the `dailyLedger` row and, for
      outflows, the `expenses` mirror + back-link — commit in one batch using a
      pre-minted expense ref (removes the current 3-step non-atomic mirror).
- [ ] **Unit B (auto-settle):** build a `buildInflowPlan(...)` from
      `allocateLumpSum` **including** the optional auto-created invoice (mint its
      ref up front and `batch.set` it) + all per-invoice patches + per-invoice
      ledger rows + leftover credit row, then `commitPaymentPlan`.
- [ ] Guarantee partial lines produce `type: "partial-payment"` ledger rows and
      full lines `type: "payment"`.

### Phase 5 — Refactor Master settle
- [ ] Fold the current post-commit `addDoc(ledgerEntries)` loop **into** the
      existing `writeBatch` so children, master, and all `ledgerEntries` rows +
      the single `dailyLedger` inflow row commit atomically.
- [ ] Use `buildMasterSettlePlan` to assemble it.

### Phase 6 — Admin ledger correction (`AdminLedgerTab`)
- [ ] The `amountPaid` correction already uses `writeBatch` + `syncInvoiceFromLedger`
      / `syncMasterFromChildren`. Verify the corrected ledger row, invoice, and
      master all sit in **one** batch; if any `addDoc` escaped, pull it in.

### Phase 7 — Backfill / consistency check (optional but recommended)
- [ ] One-off read-only script `scripts/auditLedgerConsistency.ts`: for each
      invoice, `sum(ledger.amountPaid) === invoice.amountPaid`? Report drift
      caused by historical partial writes (pre-atomic era).

---

## 4. Files to Add / Change

| File | Change |
|------|--------|
| `lib/paymentPlan.ts` | **NEW** — pure plan builders (`buildSettlePlan`, `buildInflowPlan`, `buildMasterSettlePlan`). |
| `lib/commitPaymentPlan.ts` | **NEW** — atomic `writeBatch` committer. |
| `__tests__/paymentPlan.test.ts` | **NEW** — invariant + per-flow coverage. |
| `components/employee/CollectionsTab.tsx` | Settle flow → plan + commit. |
| `components/employee/DailyLedgerTab.tsx` | Inflow flow → plan + commit (2 atomic units). |
| `components/admin/AdminLedgerTab.tsx` | Verify single-batch correction. |
| `scripts/auditLedgerConsistency.ts` | **NEW (optional)** — drift report. |
| `docs/BUSINESS_RULES.md` | Document the "every amountPaid change ⇒ one ledger row, atomically" invariant. |

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