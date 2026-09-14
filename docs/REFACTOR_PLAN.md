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

### Wired into the UI (pass 2)

- [x] `allocatePartialPayment` used by `CollectionsTab.tsx` in both
      `handleConfirmSettle` and the settle-modal preview IIFE.
- [x] `computeCarryForward` + `composeInvoiceTotal` used by `handleSaveInvoice`
      (invoice edit) in `CollectionsTab.tsx`.
- [x] `computeCarryForward` + `composeInvoiceTotal` used by both
      `handleGenerateMeterInvoice` and the meter-tab live preview in
      `app/employee/page.tsx`.
- [x] `collectedSplit` used by the Per-Building Collections table row
      aggregation in `app/admin/page.tsx`.

### Still pending

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

1. Add `lib/firestore.ts` helper: **✅ done** — exports `mapDoc<T>()` and
   `mapSnapshot<T>()` that centralize the single unavoidable `any` cast
   coming out of Firestore's `snap.data()`.
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
| `app/employee/page.tsx` | ~2,717 | 6 tabs, 3 modals, all fetching in one `useEffect` (was 2,895 before `MonthCollectionsCard` extraction) |
| `app/admin/page.tsx`    | ~1,539 | KPIs + per-building tables + expense flow |
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
   escapes — pure prop-in card). **✅ done** —
   `components/employee/MonthCollectionsCard.tsx` (~362 lines).
   `app/employee/page.tsx` shrank by 178 lines. Uses `collectedSplit`
   internally, so the Home tab card and the Admin Per-Building table now
   share identical rent-first math.
2. Extract the three modals next (they own local form state, so they
   isolate cleanly).
   - [x] `SettlePaymentModal` — `components/employee/modals/SettlePaymentModal.tsx`
         (183 lines). Owns all settle-form state locally; parent
         `CollectionsTab.tsx` now only passes the invoice + a save callback.
         `CollectionsTab.tsx` shrank 589 → 451 lines (−138). Also added
         `paymentMode`/`paymentReference` to the `LedgerEntry` type (they
         were being written but not declared).
   - [x] `ResolveTicketModal` + `ReportIssueModal` — never actually needed
         standalone extraction. The already-existing
         `components/employee/TicketsTab.tsx` (282 lines) fully owned both
         modals + comment flow, but was **imported and unused** in
         `app/employee/page.tsx` while ~180 lines of duplicated inline JSX
         + 5 handlers + 8 useState slots lived in the page. Wired the
         component in and deleted the dupes. `app/employee/page.tsx` shrank
         **2717 → 2389 lines (−328)**. Also fixed a bug: ticket list used
         to render on Home / Daily / Monthly tabs because the visibility
         guard was a negation of the tab denylist; now gated on
         `activeTab === "active" || activeTab === "resolved"`.
3. Extract per-tab bodies. Do them one at a time and deploy between each so
   any regression is bisectable.
   - [x] `MeterTab` — `components/employee/MeterTab.tsx` (310 lines). Owns
         all meter-form state (`selectedMeterUnit`, `currentReading`,
         `previousReadingOverride`, `meterChanged`, `manualUnitsConsumed`,
         `manualUnitsReason`, `newMeterReading`, `billingMonth`,
         `isGeneratingInvoice`) plus the whole invoice-generation batch.
         Parent passes `occupiedUnits`, `allLedgerEntries`,
         `electricityRate`. `app/employee/page.tsx` shrank
         **2389 → 2098 lines (−291)**.
   - [x] `InventoryTab` — same "extracted but never wired" pattern as
         `TicketsTab`. Component (`components/employee/InventoryTab.tsx`,
         135 lines) already owned the tab + Add-Item modal + qty +/−
         handlers. Wired in, deleted 9 useState slots + 2 handlers + the
         inline modal. `app/employee/page.tsx` shrank
         **2098 → 1972 lines (−126)** — first time under 2000.
   - [x] `ExpensesTab` — `components/employee/ExpensesTab.tsx` (458
         lines). Owns 13 useState slots + 7 handlers (dual-write to
         `expenses` + `dailyLedger` with cross-linked IDs, cascading
         soft-delete, fund summary card, view/filter toggles, both
         modals). Parent passes 4 props: `allExpenses`, `allAllocations`,
         `buildings`, `userEmail`. `app/employee/page.tsx` shrank
         **1972 → 1555 lines (−417)** — biggest single-commit win yet.
   - [x] `HomeTab` — greeting, 4 KPI tiles, `MonthCollectionsCard`,
         previous-month balance list, quick-action grid, overdue
         invoices, meters-pending, active-tasks preview, and recent
         activity feed. Parent passes 12 props (8 typed collections +
         `homeMonth`/`setHomeMonth` + `onNavigate`/`onOpenTodayCollections`/
         `openTenantProfile`). Zero Firestore writes — pure display.
         `app/employee/page.tsx` shrank **1555 → 1297 lines (−258)**.
   - [ ] `UnitsTab` — buildings tree + tenant search (~140 lines).
   - [ ] `ChecklistTab` (~100 lines).

**Cumulative page shrinkage since refactor started: 2895 → 1297 = −1598 lines (~55%).**

### Rules while extracting
- No new Firestore reads inside child components — parent still owns the
  `onSnapshot` and passes data down. That preserves the single source of
  truth and prevents duplicated listeners.
- Child components accept **typed props**, no `any`.
- Every extracted component gets a matching test file if it contains
  business math (KPI tiles, allocation, etc.).

---

## 4. Housekeeping
- [x] Silence Vitest CJS deprecation — renamed `vitest.config.ts` → `vitest.config.mts`.
- [x] Added `npm run test:unit` (skips emulator) as a fast pre-commit check.
- [x] Added GitHub Action `.github/workflows/test.yml` running `typecheck` +
      `test:unit` on every push + PR to `main`.
