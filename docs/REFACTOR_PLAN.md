# Refactor Plan

Living document. Goal: pay down maintainability debt without freezing feature
work. Each section lists concrete follow-ups in priority order.

---

## 1. Test coverage — status

### Baseline before this pass
- `__tests__/payments.test.ts` — 22 tests (auto-settle + oldest-invoice picker)
- `__tests__/expenses.test.ts` — allocation + fund summary
- `__tests__/integration.test.ts` — full-workflow emulator tests
- `__tests__/cloudinary.test.ts`

### Added in this pass
- `lib/allocation.ts` — extracted pure helpers previously inlined in
  `CollectionsTab.tsx` and `app/employee/page.tsx`:
  - `allocatePartialPayment(received, invoice)` — rent-first split, returns
    `{towardRent, towardElectricity, newAmountPaid, status, fullyPaid, …}`
  - `collectedSplit(invoice)` — splits a stored `amountPaid` into Rent/Elec
    columns and heals legacy `status="paid"` rows with missing `amountPaid`
  - `computeCarryForward(runningBalance)` — flips ledger `balance` sum into
    the invoice `carryForward` field (positive = tenant owes)
  - `composeInvoiceTotal({baseRent, electricityCharge, carryForward})` —
    clamps to zero so a big credit can't make invoice go negative
- `__tests__/allocation.test.ts` — 23 tests covering every allocation edge case
- `__tests__/lumpsum.test.ts` — 6 tests replaying MANAGER_ACTIONS Section 6
  (₹12,500 lump-sum clears Jul+Aug rent + partial Sep; resume from partial;
  cross-unit skip; overflow → credit)

**Pure-function tests: 22 → 51 (all green).**

### Still pending
- [ ] Wire `allocatePartialPayment` into `components/employee/CollectionsTab.tsx`
      (currently duplicates the math in `handleConfirmSettle` and the modal
      preview IIFE).
- [ ] Wire `collectedSplit` into `app/employee/page.tsx` Home tab tiles and
      `app/admin/page.tsx` Per-Building Collections table.
- [ ] Wire `computeCarryForward` + `composeInvoiceTotal` into the meter
      preview (~line 1626) and `handleGenerateMeterInvoice` (~line 350) in
      `app/employee/page.tsx`.
- [ ] Add integration test for the lump-sum flow through the Daily Ledger
      inflow (once we teach that flow to iterate — currently manual per
      MANAGER_ACTIONS Section 6).

---

## 2. TypeScript strictness

### Reality check
`types/index.ts` (226 lines) already defines strong interfaces for every
domain object we touch: `Building`, `Unit`, `Invoice` (with
`rentPeriod`/`electricityPeriod`/`carryForward`/`amountPaid`/`paidAt`/etc.),
`LedgerEntry`, `Expense`, `Allocation`, `MaintenanceTicket`, `Checklist`,
`Contact`, `Announcement`, `AppUser`.

The `any` in `app/tenant/page.tsx` / `app/admin/page.tsx` / `app/employee/page.tsx`
is almost entirely **Firestore snapshot casting**, not missing types.

### Plan
1. Add `lib/firestore.ts` helper:
   ```ts
   export function mapDoc<T>(snap: QueryDocumentSnapshot): T & {id: string} {
     return { id: snap.id, ...(snap.data() as T) };
   }
   ```
2. In each page, replace patterns like
   ```ts
   const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
   ```
   with
   ```ts
   import type { Invoice } from "@/types";
   const rows = snap.docs.map((d) => mapDoc<Invoice>(d));
   ```
3. Remove the file-level `/* eslint-disable @typescript-eslint/no-explicit-any */`
   directives one page at a time — starting with `app/tenant/page.tsx` (smallest).
4. Any remaining `any` should be `unknown` + a narrow parse/guard, not
   suppressed.

Estimated churn: ~30 replacements per page, mechanical.

---

## 3. Splitting monolithic pages

### Current sizes
| File | Lines | Notes |
|------|------:|-------|
| `app/employee/page.tsx` | ~2,874 | 6 tabs, 3 modals, all fetching in one `useEffect` |
| `app/admin/page.tsx`    | ~1,483 | KPIs + per-building tables + expense flow |
| `app/tenant/page.tsx`   | ~450   | ok for now |

### Target module layout
```
app/employee/page.tsx           ← shell + tab router only (~200 lines)
components/employee/
  ├─ HomeTab.tsx                ← month card + KPI tiles
  ├─ MonthCollectionsCard.tsx   ← extracted from page.tsx lines 1122–1268
  ├─ CollectionsTab.tsx         ← already extracted; strip inline math
  ├─ MeterTab.tsx               ← includes carry-forward preview
  ├─ TicketsTab.tsx
  ├─ InventoryTab.tsx
  ├─ ExpensesTab.tsx            ← rewire (removed in unification pass)
  └─ modals/
      ├─ SettlePaymentModal.tsx
      ├─ NewTicketModal.tsx
      └─ MeterReadingModal.tsx
```

```
app/admin/page.tsx              ← shell only (~250 lines)
components/admin/
  ├─ KpiStrip.tsx
  ├─ PerBuildingCollectionsTable.tsx
  ├─ DailyTransactionsByBuilding.tsx
  ├─ VerificationsList.tsx
  ├─ ExpenseForm.tsx            ← already writes to dailyLedger
  └─ MonthPicker.tsx
```

### Ordering
1. **Extract `MonthCollectionsCard`** first (proof of pattern, no state
   escapes — pure prop-in card).
2. Extract the three modals next (they own local form state, so they
   isolate cleanly).
3. Extract per-tab bodies. Do them one at a time and deploy between each so
   any regression is bisectable.

### Rules while extracting
- No new Firestore reads inside child components — parent still owns the
  `onSnapshot` and passes data down. That preserves the single source of
  truth and prevents duplicated listeners.
- Child components accept **typed props**, no `any`.
- Every extracted component gets a matching test file if it contains
  business math (KPI tiles, allocation, etc.).

---

## 4. Housekeeping
- Silence Vitest CJS deprecation: rename `vitest.config.ts` → `vitest.config.mts`
  or set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` in the `test` script.
- Add `npm run test:unit` (skips emulator) as a fast pre-commit check.
- Add GitHub Action running `test:unit` on every push.
