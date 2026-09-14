# Corporate (Multi-Unit) Tenant Billing

> **Goal:** support a single tenant — typically a company — that leases
> **N apartments** (e.g. 9 rooms in one building for staff housing) and
> wants **one consolidated invoice per month** covering rent + electricity
> for all N units, while the operational side of the app (meter readings,
> per-unit occupancy, per-unit checkout deductions) keeps working
> apartment-by-apartment.
>
> **Non-goal:** rewriting the per-unit invoice model. Individual unit
> invoices continue to exist as the source of truth for meter readings
> and per-room settlement; the corporate invoice **aggregates and
> resolves** them.

**Status:** Design proposal · unimplemented
**Author:** Refactor working group
**Last updated:** 14 Sep 2026

---

## 1. Problem statement

Today `Invoice` is 1-to-1 with a `Unit`. Every unit gets its own monthly
invoice with its own `baseRent`, `electricityConsumed`, `totalAmount`,
`amountPaid`, `status`. That works for retail tenants (one family per
flat).

A corporate tenant does not want 9 invoices with 9 UPI transfers. They
want:

- **One PDF / one line item per month** listing all 9 rooms with their
  rent + electricity.
- **One payment** (bank transfer, RTGS, cheque) that clears the whole
  month.
- **One GST-compliant invoice number** to feed their AP system.

Operationally we still need:

- Per-room meter readings (electricity is metered per apartment).
- Per-room occupancy / checklist / security deposit tracking (the
  company sub-assigns rooms to employees; employees change; we still
  do move-in / move-out inspections per room).
- Per-room maintenance tickets.

So the corporate invoice is an **aggregation layer** on top of the
existing per-unit invoices — not a replacement.

---

## 2. Design overview

Introduce two new concepts:

1. **`Tenant` document** (new top-level collection `tenants`) — a
   first-class party we can bill. For retail flats this is optional
   (unit-embedded tenant data stays); for corporate tenants it is
   **required** because a single tenant spans multiple units.
2. **`MasterInvoice` document** (new collection `masterInvoices`) — the
   consolidated monthly bill. It **owns** a list of per-unit `Invoice`
   IDs (`childInvoiceIds[]`). Payment against a master invoice
   **cascades** to mark every child paid in one atomic batch.

Per-unit `Invoice` gains one optional field: `masterInvoiceId`. When
set, the collections UI hides the child from the per-unit collections
list (or shows it read-only, tagged "Rolled up into MI-2026-09-Acme") to
prevent double collection.

```text
                    tenants/{tenantId}          ← company profile, GST, billing contact
                          │
              ┌───────────┴───────────┐
              │                       │
    units/{unitA} … units/{unitI}     │        ← 9 units, all tenantId = same
    (per-unit occupancy, meters,      │
     checklists, security deposits)   │
              │                       │
    invoices/{invA} … {invI}          │        ← per-unit rent + electricity
    (masterInvoiceId = MI-…)          │
              │                       │
              └──►  masterInvoices/{MI-2026-09-Acme}
                    childInvoiceIds:  [invA, …, invI]
                    totalAmount:      Σ child.totalAmount
                    status:           unpaid | partial | paid
                    amountPaid, paidAt, transactionId, etc.
```

---

## 3. Data model

### 3.1 New — `types/index.ts`

```ts
export interface Tenant {
    id: string;
    /** "retail" for a single household, "corporate" for a company. */
    kind: "retail" | "corporate";
    /** Display name — company legal name for corporate, primary
     *  occupant's name for retail. */
    name: string;
    /** Corporate only. */
    gstin?: string;
    pan?: string;
    /** Primary billing contact — the person who pays. */
    billingContact: {
        name: string;
        email: string;
        phone: string;
    };
    /** Corporate only. Optional AP contact for invoice delivery. */
    accountsContact?: { name: string; email: string; phone?: string };
    billingAddress?: string;
    /** Units currently assigned to this tenant. Mirrors
     *  `units[].tenantId` for fast lookup; kept consistent via
     *  batched writes at assign/unassign time. */
    unitIds: string[];
    /** Billing preference. Corporate tenants default to "consolidated"; retail always "per-unit". */
    billingMode: "per-unit" | "consolidated";
    /** Consolidated-mode only: day of month the master invoice is
     *  generated (defaults to 1). */
    billingDayOfMonth?: number;
    notes?: string;
    createdAt: string;
    createdBy?: string;
    archivedAt?: string;
}

export interface MasterInvoice {
    id: string;
    tenantId: string;
    tenantName: string;
    billingPeriod: string;              // "September 2026"
    /** IDs of per-unit invoices rolled up into this master invoice. */
    childInvoiceIds: string[];
    /** Denormalised snapshot of each child at generation time so the
     *  master PDF is reproducible even if a child is later corrected. */
    lines: MasterInvoiceLine[];
    subtotalRent: number;
    subtotalElectricity: number;
    subtotalCarryForward: number;
    adjustments?: { label: string; amount: number }[];   // signed
    totalAmount: number;
    amountPaid: number;
    status: "unpaid" | "partial" | "paid" | "void";
    paidAt?: string;
    transactionId?: string;
    paymentMode?: string;
    paymentReference?: string | null;
    paymentScreenshotUrl?: string;
    paymentNote?: string;
    /** GST-style invoice number the tenant will book against. Generated
     *  on first status !== 'unpaid' or on demand. */
    invoiceNumber?: string;             // e.g. "MI/2026-27/00042"
    /** URL to the rendered PDF stored in Firebase Storage. */
    pdfUrl?: string;
    createdBy?: string;
    createdAt: string;
    voidedAt?: string;
    voidedBy?: string;
    voidReason?: string;
}

export interface MasterInvoiceLine {
    invoiceId: string;
    unitId: string;
    unitNumber: string;
    baseRent: number;
    previousReading?: number;
    currentReading?: number;
    electricityConsumed?: number;
    electricityRate?: number;
    electricityCharge: number;
    carryForward: number;
    lineTotal: number;
}
```

### 3.2 Modified

- `Unit` gains `tenantId?: string`. When a unit is assigned to a
  corporate tenant, `tenantEmail` / `tenantName` continue to be
  populated (from the tenant doc) so no read paths break.
- `Invoice` gains `masterInvoiceId?: string`. When set:
  - the invoice is **not** individually collectable in the Employee
    Collections tab — settlement flows through the master invoice.
  - the tenant-facing view (`/tenant`) shows it under a "Corporate
    billing — see master invoice" banner rather than a Pay button.

No schema migration is destructive: both new fields are optional. A
one-shot backfill script can create a `Tenant` doc for every existing
occupied unit (kind = `retail`, unitIds = [that unit]) if we want the
model uniform, but that is not required for the corporate feature to
work.

---

## 4. Lifecycle

### 4.1 Onboarding a corporate tenant

Admin → **Tenants → New corporate tenant**:

1. Enter company name, GSTIN, PAN, billing address, billing contact,
   AP contact.
2. Pick `billingMode = "consolidated"`, `billingDayOfMonth`.
3. **Assign units.** Pick a building, multi-select rooms. On submit,
   in one `writeBatch`:
   - Create `tenants/{tenantId}`.
   - For each selected unit: set `unitId.tenantId`,
     `unitId.tenantEmail = billingContact.email`,
     `unitId.tenantName = company.name`, `unitId.status = "occupied"`,
     `unitId.moveInDate = today`.
   - Append to `unitId.tenantHistory` (so retail → corporate handoff
     is auditable, and vice versa on exit).

### 4.2 Monthly bill generation

Employee → **Meter tab** works unchanged: reading is entered per unit,
which creates a per-unit `Invoice` exactly like today. The only
difference: if the unit's tenant is corporate + consolidated, the
generated invoice is stamped with `masterInvoiceId = null` and
`pendingConsolidation = true` (a transient marker used only by the
generator step below).

Once **all 9 units for the tenant** have their per-unit invoices for
the target `billingPeriod` (state check on the tenant profile), the
"Generate Master Invoice" CTA appears. Clicking it, in one batch:

1. Resolves the 9 child `Invoice` docs.
2. Creates `masterInvoices/{MI-YYYY-MM-<tenantSlug>}` with denormalised
   `lines[]` and rolled-up totals.
3. Updates each child: `masterInvoiceId = MI…`.
4. Assigns `invoiceNumber` from the running counter
   (`counters/masterInvoice` transactional increment).
5. Renders and uploads the PDF (server action / Cloud Function).

Regeneration: if a child is later corrected (e.g. wrong meter
reading), the master invoice must be **voided and re-issued** — no
in-place mutation of a finalized master invoice. Voiding creates a
credit note trail; the new master invoice references the voided one
via `supersedes: string`.

### 4.3 Payment settlement

The Collections tab gains a **Master Invoices** section for tenants
with `billingMode = "consolidated"`. Clicking a row opens a variant of
the existing `SettlePaymentModal` (extend, don't fork) that:

- Shows the master `totalAmount` and per-line breakdown.
- Accepts full or partial payment (same `allocatePartialPayment` logic
  from `lib/allocation.ts`, applied across the child lines pro-rata,
  or in strict rent-first-then-electricity order per line — see §5.1).
- On confirm, in one `writeBatch`:
  1. Updates the master invoice (`amountPaid`, `status`, `paidAt`,
     `transactionId`, `paymentMode`, `paymentScreenshotUrl`).
  2. Updates each child invoice with its allocated share so per-unit
     `amountPaid` sums equal master `amountPaid`. Child `status`
     becomes `paid` if fully covered, `pending` if partially, stays
     `unpaid` if the allocation gave it nothing.
  3. Writes one `ledgerEntries` row **per child** so per-unit reports
     stay accurate — each row is tagged with `masterInvoiceId` so the
     ledger view can group them.
  4. Writes one `dailyLedger` inflow row for the **total** (not per
     child) — the daily cash view should show one ₹X transfer, not 9
     small ones. The row's `note` includes the child unit list.

If the payment is partial, next time the master invoice is opened,
`SettlePaymentModal` shows prior payments (mirrors the existing
partial-payment history strip pattern).

### 4.4 Unit-level exit inside an active corporate lease

If the company hands back one room (say unit `C-104`) mid-tenancy:

- Employee → unit profile → **Release from corporate lease**.
- In one batch: remove `C-104.tenantId`, clear tenant fields, set
  `status = "vacant"`, remove `C-104` from `tenants/{id}.unitIds`,
  push a `tenantHistory` entry on the unit.
- The **current month's** child invoice for C-104 is already inside a
  master invoice. Do **not** retroactively remove it. Next month's
  master invoice will have 8 lines instead of 9.

### 4.5 Mid-month grouping — clubbing existing per-unit invoices

**Scenario.** During the current month the employee realises the same
party is actually paying for 9 rooms (or the company signs a fresh
consolidated agreement mid-cycle). Per-unit invoices for the month
already exist — some may even be partially paid. The employee needs a
one-click "group these rooms" action without regenerating meter reads
or losing the audit trail.

This is deliberately supported by the model — a `MasterInvoice` is
just a wrapper over `childInvoiceIds[]`. Grouping is an
**upsert-and-link** operation, never a "delete-and-recreate."

#### 4.5.1 UI entry point

Employee → **Collections tab → Group into master invoice**:

1. Filter by building, multi-select the child rows (checkboxes on
   each unpaid / partially-paid per-unit invoice for the current
   `billingPeriod`).
2. Pick or create the `Tenant` doc (either "existing corporate tenant"
   or "convert to corporate: enter company details inline").
3. Preview: shows rolled-up totals, warns about any child that is
   already `paid` (must be excluded) or already linked to another
   master invoice (must be unlinked first).
4. Confirm → runs the grouping batch (§4.5.2).

The same modal is available from a tenant's profile page ("Group this
month's invoices") when the tenant already exists as corporate but the
month's children have not yet been linked (e.g. meter tab created them
before the "Generate Master Invoice" CTA was clicked).

#### 4.5.2 Grouping batch — write plan

Everything runs in one `writeBatch` (or a transaction if we need reads
mid-flight for the counter):

1. **Preflight guards** (client-side, re-checked server-side):
   - All selected children share the same `billingPeriod`.
   - No selected child has `status === "paid"` (fully paid children
     stay independent — they cannot be retroactively rolled up
     without invalidating their `ledgerEntries` row).
   - No selected child has an existing `masterInvoiceId` (must
     ungroup first — §4.5.4).
   - The tenant is `billingMode = "consolidated"` (or is being
     converted right now in step 2 of the UI).
2. **Assign units to tenant** (if not already): for each selected
   child's `unitId`, patch `unit.tenantId`, append to
   `tenant.unitIds`, push `tenantHistory` entry with a
   `reason: "mid-month grouping"` marker.
3. **Create `masterInvoices/{MI-YYYY-MM-<tenantSlug>}`** using the
   same rollup logic (`rollupChildren`) as §4.2. Denormalised
   `lines[]` snapshot each child's rent + electricity + carry-forward
   **as they are now** (including any partial payment already made).
4. **Link each child**: set `masterInvoiceId = MI…` on every selected
   `Invoice`. Do **not** touch `amountPaid`, `status`, or ledger
   history on children that were already partially paid — those
   prior payments stay with the child and are reflected in the master
   invoice's initial `amountPaid` (see §4.5.3).
5. **Seed master `amountPaid`** = Σ children.amountPaid at grouping
   time. Master `status` derived: `paid` if fully covered (rare at
   grouping), `partial` if any prior payment, else `unpaid`.
6. **Audit row**: write one `ledgerEntries` row of `type: "grouping"`
   per grouped child (zero-amount, carries `masterInvoiceId`,
   `groupingReason`, `groupedBy`, `groupedAt`) so the audit trail
   shows exactly when and by whom the rooms were clubbed. No
   `dailyLedger` write — no cash moved.

The invariant from §5.1 still holds after grouping:

$$
\text{master.amountPaid} \;=\; \sum_{i \in \text{children}} \text{child}_i.\text{amountPaid}
$$

#### 4.5.3 What happens to prior partial payments

If unit `C-101` had ₹5 000 paid before grouping, and units `C-102`
through `C-109` had zero paid:

- Master invoice at creation: `amountPaid = 5000`, `status = "partial"`.
- The next settlement modal call sees "₹5 000 already collected" in
  the history strip (same pattern as §4.3).
- Prior `ledgerEntries` rows for `C-101`'s ₹5 000 remain **as-is**;
  they gain `masterInvoiceId` via a backfill write in the same batch
  so cross-references stay clean, but their `amount`, `type`,
  `createdAt` are immutable.
- Prior `dailyLedger` inflow for the ₹5 000 is **not** touched — that
  cash moved on the original date and stays where it was recorded.
  This is the deliberate choice made in §10: daily ledger reflects
  reality, not the current billing wrapper.

#### 4.5.4 Ungrouping

The mirror action — **Break master invoice back into per-unit
invoices** — is admin-only and only allowed while
`amountPaid === 0` (no cash has cleared through the master invoice).
If cash has cleared, ungrouping is not permitted; the correct path is
§5.3 (void + re-issue).

Ungroup batch:

1. Delete `masterInvoices/{id}` (or set `voidedAt` + `voidReason:
   "ungrouped"` if we want history — preferred).
2. Clear `masterInvoiceId` on each child.
3. Optional: unassign units from the tenant (only if the user picked
   "return to per-unit tenants" in the confirmation dialog).
4. Write a `ledgerEntries` row of `type: "ungrouping"` per child for
   the audit trail.

#### 4.5.5 Guard rails & failure matrix

| Situation | Behaviour |
|---|---|
| Selected child is already `paid` | Blocked; message: "Fully-paid invoices cannot be grouped. Deselect and continue." |
| Selected child already has `masterInvoiceId` | Blocked; message: "Already grouped under MI-…. Ungroup first." |
| Selected children span multiple `billingPeriod`s | Blocked; user must group per month. |
| Selected units span multiple buildings | Allowed (companies can lease across buildings). |
| Batch write fails half-way | Firestore batch is atomic → all-or-nothing. Retry safe. |
| Tenant record does not exist | Force inline creation in step 2 of the modal; grouping only proceeds once tenant is written. |
| Meter reading corrected after grouping | Same rule as §4.2: void master (only if `amountPaid === 0`) or issue superseding master (§5.3). |

#### 4.5.6 Testing additions

Extend `__tests__/masterInvoice.test.ts`:

- `groupChildInvoices(children, tenant)` — pure fn that computes the
  master doc payload (does not write). Covers: mixed prior-partial
  payments, cross-building selection, a child with a manual meter
  override, N=1 grouping (degenerate but should still work),
  attempted grouping of a `paid` child (throws).
- Integration: seed 3 children with `[0, 3000, 0]` paid, group them,
  assert master `amountPaid === 3000`, `status === "partial"`, and
  that the settle modal shows ₹3 000 in the prior-payments strip.
- Integration: group → ungroup while `amountPaid === 0`, assert
  original per-unit collections flow still works and no orphan
  `masterInvoiceId` is left behind on any child.

---

### 4.6 Full tenant termination

Admin → tenant profile → **Terminate lease**:

- Requires all outstanding master invoices to be either paid or
  explicitly written off.
- Batch-vacates all `unitIds` (same handshake as §4.4 × N).
- Sets `tenants/{id}.archivedAt`. Historical master invoices remain
  queryable but the tenant no longer shows in dropdowns.

---

## 5. Allocation & edge-case rules

### 5.1 How a partial payment splits across the child lines

Two strategies; pick one via `Tenant.paymentAllocationStrategy`
(default `"rent-first-then-electricity"`):

1. **`rent-first-then-electricity`** — apply payment to all lines'
   rent buckets first (in unit-number order), then to all lines'
   electricity buckets, then carry-forward. Predictable, matches how
   we already reason about single-unit invoices in
   `allocatePartialPayment`.
2. **`pro-rata`** — split payment across child lines proportional to
   each `lineTotal`. Cleaner accounting for GST audits (each unit's
   line moves together), messier arithmetic.

Whichever we pick, the invariant is:

$$
\text{master.amountPaid} \;=\; \sum_{i \in \text{children}} \text{child}_i.\text{amountPaid}
$$

The allocation is deterministic and **pure** — implement in
`lib/masterAllocation.ts` alongside `lib/allocation.ts` and unit-test
it there (Section §7).

### 5.2 Carry-forward

Each child invoice can still carry a `carryForward` from prior months.
The master invoice's `subtotalCarryForward` line surfaces the sum and
notes which units contributed. Applying `computeCarryForward` per
child post-settlement keeps the existing behaviour intact.

### 5.3 Voiding & credit notes

- A master invoice can be **voided** only if `amountPaid === 0`.
- If a partial payment has been applied and the tenant asks for a
  correction, we issue a **new** master invoice (`supersedes`) whose
  `lines` diff from the voided one, and a credit-note record in
  `ledgerEntries` reversing the child allocations. This preserves the
  audit chain that CAs need.

### 5.4 Retail ↔ corporate conversions

- **Retail → corporate**: rare (a family flat becoming a company
  guesthouse). Create a `Tenant` doc, batch-migrate the unit under it.
- **Corporate → retail**: on tenant termination, unit becomes vacant
  first; the next retail tenant is onboarded via the existing per-unit
  flow. No cross-scheme data mixing.

### 5.5 Meter changes / manual reading overrides

Unchanged. Per-unit `Invoice` still owns `meterChanged`,
`manualUnitsReason` — these details are copied into the corresponding
`MasterInvoiceLine` at generation time so the PDF can annotate them.

### 5.6 Security deposits & checklist deductions

Stay per-unit — a company still pays a deposit per apartment, and
checklist deductions at exit are per apartment. Not rolled up into the
master invoice.

---

## 6. UX

### 6.1 Admin

- New **Tenants** admin tab: list, filter by kind, KPIs (count of
  corporate tenants, units under corporate leases, outstanding across
  all master invoices).
- Tenant detail page: units grid, current month's master invoice
  status, payment history, PDF downloads, GST details.

### 6.2 Employee

- **Home tab KPI tiles**: "Pending Collections" continues to sum
  everything, but when the outstanding row is a master invoice the
  drill-through opens the master settle modal, not the per-unit one.
- **Collections tab**: two-column filter — `Retail` / `Corporate`.
  Corporate rows show tenant name + child-unit chips + rolled-up
  amount. The existing "➕ Add Payment" partial-payment CTA (from
  commit `bb18cdb`) works identically against master invoices.
- **Meter tab**: unchanged, still per-unit. Adds a subtle "will roll
  up into MI-… on generation" hint for corporate units.

### 6.3 Tenant-facing (`/tenant`)

For a corporate billing contact's login:

- Dashboard lists master invoices, not per-unit ones.
- Per-unit invoices are still visible for transparency (rooms, meter
  reads) but marked read-only "See master invoice MI-…".
- Payment upload flows against the master invoice.

---

## 7. Testing plan

Pure functions to add & cover in `__tests__/masterInvoice.test.ts`
(target: 20+ tests, all under `npm run test:unit`, no emulator):

- `allocateMasterPayment(strategy, master, children, amountPaid)` —
  returns per-child `{ invoiceId, allocatedRent, allocatedElec,
  allocatedCarry }`. Test both strategies, boundary cases (payment >
  total, payment = 0, one child already partially paid from an earlier
  round, one child fully paid, N=1 degenerates to `allocatePartialPayment`).
- `rollupChildren(children)` — sums into `subtotal*`, `totalAmount`,
  produces `lines[]`. Test with meter change flags, manual overrides,
  mixed carry-forward.
- `nextMasterInvoiceNumber(counter, fiscalYear)` — pure counter → GST
  string.
- Invariant test: for every allocation result, `Σ per-child
  allocation === amountPaid` and `child.status` transitions match the
  spec table.

Integration test (Section 1 of `REFACTOR_PLAN.md` already flags a
lump-sum integration test — extend that harness):

- Seed 3 corporate units, generate master invoice, settle partial,
  settle balance next day, verify:
  - 3 child invoices all `paid`.
  - 3 `ledgerEntries` rows, each tagged with `masterInvoiceId`.
  - **1** `dailyLedger` inflow per settlement event (not 3).
  - Master `amountPaid === Σ children.amountPaid`.

---

## 8. Rollout

Ship behind a feature flag (`ENABLE_CORPORATE_TENANTS`) that gates
the new admin Tenants tab and the master-invoice code paths in
Collections. Retail flows are untouched when the flag is off.

**Phase 1 — Data plumbing (1 sprint)**
- Types (`Tenant`, `MasterInvoice`, `MasterInvoiceLine`,
  `Invoice.masterInvoiceId`, `Unit.tenantId`).
- `lib/masterAllocation.ts` + full unit-test suite.
- Firestore security rules: only `admin` may write `tenants/*` and
  `masterInvoices/*`; `employee` may write child-invoice status
  updates that arrive via a master settlement batch.

**Phase 2 — Admin surface (1 sprint)**
- Admin Tenants tab (list + create + assign units).
- Backfill script (optional) — one `Tenant` doc per current occupied
  unit, all `kind = "retail"`.
- Master invoice generator (server action).

**Phase 3 — Employee & tenant surfaces (1 sprint)**
- Collections tab corporate section + settle modal extension.
- Tenant-facing corporate view.
- PDF template (server rendered, Storage upload, signed URL).

**Phase 4 — Nice-to-haves**
- Auto-email master invoice PDF to `accountsContact` on generation.
- WhatsApp reminder (piggyback on existing integration doc) — one
  reminder per master invoice, not per child.
- GST report export for FY.

---

## 9. Open questions

1. **GST treatment.** Is residential leasing to a corporate GST-taxable
   at 18% under reverse charge? Confirm with the CA before wiring the
   GSTIN field into the PDF template — until confirmed, render an
   invoice without a tax line.
2. **Deposit portability.** If the company swaps room C-104 for room
   D-201 mid-lease, do we transfer the deposit line or refund + re-take?
   Product decision, not a technical blocker.
3. **Split payments across banks.** Some corporates pay each PO
   separately. Do we support one master invoice + multiple
   `paymentReference`s? Model already supports partial payments; only
   the UI would need a "log another partial payment" affordance
   (already exists via the `bb18cdb` CTA).
4. **Retroactive rollup.** If a tenant is retail today and converts to
   corporate mid-month, does the current month's per-unit invoice get
   rolled into a partial-month master invoice? Recommend **no** —
   corporate billing starts next full cycle to keep the audit line
   clean.

---

## 10. Non-negotiables

- **Never let master and child `amountPaid` drift.** Every write path
  is a single `writeBatch`; enforce the invariant in a unit test and
  in a nightly reconciliation script.
- **Never mutate a finalized master invoice.** Corrections = void +
  re-issue with `supersedes`.
- **Daily ledger shows the real cash movement**, not the per-unit
  allocation. One transfer = one inflow row.
- **Per-unit operational data (meter, checklist, deposits, tickets)
  stays per-unit.** The master invoice is a billing wrapper, nothing
  more.
