# 📘 Business Rules — Employee Handbook

> Read this once. Come back to any section by its 📌 emoji when you need a
> refresher. Every rule here maps to how the app **already** works — the app
> enforces most of them for you. Your job is to *understand* the rule so that
> when something looks odd on screen, you know why.

**Audience:** Property staff (rent collector, meter reader, maintenance
coordinator). If you are a manager/admin, also read `MANAGER_ACTIONS.md`.

---

## 📇 Quick Index

| Emoji | Topic |
|---|---|
| 💰 | Rent & Electricity billing periods |
| 📅 | Payment day & billing month |
| ⚡ | Meter readings |
| 🧾 | Invoice generation |
| 💵 | Collections (Cash / UPI / Bank / Cheque) |
| 🔁 | Partial payments & carry-forward |
| 🏦 | Daily Ledger (inflow / outflow) |
| 🧹 | Expenses & fund allocation |
| 🏘️ | Units, tenants, transfers |
| 🗑️ | Soft-delete & audit trail |
| 🔒 | What only the manager can do |

---

## 💰 1. What the invoice covers

An invoice generated for **month X** carries **two different charges** that
belong to two different periods:

| Charge | Period it covers |
|---|---|
| 🏠 **Rent** | The **upcoming month** — from tenant's payment day to the same day next month |
| ⚡ **Electricity** | The **month that just ended** — units read now were consumed last month |

**Example (invoice dated 8 September 2026, tenant's payment day = 8):**
- 🏠 Rent → 8 Sep 2026 – 8 Oct 2026
- ⚡ Electricity → August 2026

The app writes both periods on every new invoice as `rentPeriod` and
`electricityPeriod`, and shows them everywhere — Meter tab preview,
Collections list, Tenant portal.

---

## 📅 2. Payment Day & Billing Month

- **Payment Day** is stored per-tenant on the unit (`paymentDay`, 1–31).
  Edit it from **Tenant Profile → 📅 Payment & Security**.
- If not set, the app treats it as the **1st of the month**.
- The **Billing Month** picker in the Meter tab decides which invoice month
  the record belongs to. It also determines which two dates the rent covers.
- Do **not** back-date a billing month unless you're correcting a mistake —
  it will look like you're double-billing that month.

---

## ⚡ 3. Meter Readings

### 3a. Normal flow
1. Open **Meter** tab → pick unit.
2. App auto-fills **Previous Reading** from `unit.lastMeterReading`.
3. Enter **Current Reading**.
4. **Units consumed** = current − previous.
5. **Electricity charge** = units × rate (per-tenant rate wins, otherwise
   the default rate shown in the header).

### 3b. Meter changed
Turn on the *"⚠️ Meter was changed / replaced"* toggle. Then:
- Enter **Units Consumed** directly (from old + new meter combined).
- Enter the **New Meter Reading** — this becomes the "last reading" for
  next month.

### 3c. Manual units override
If the calculated consumption is wrong (shared meter, faulty display, etc.),
type the correct number into **Manual Units Consumed** and write a
**reason** — the reason is stored on the invoice for audit.

### 3d. Per-tenant electricity rate
Set from **Tenant Profile → ⚡ Electricity Rate**. Leave empty to use the
default. Historical invoices keep the rate they were generated with.

---

## 🧾 4. Generating an Invoice

- **One invoice per unit per billing month.** If one already exists, the
  app warns you before overriding.
- Invoice ID format: `inv_<unitId>_<MM>_<YYYY>` (e.g. `inv_abc_09_2026`).
- Rent invoiced = the unit's **Base Rent** (unless you edit the invoice
  after creation from the Collections tab).
- After generating, `unit.lastMeterReading` is updated to the current
  reading so next month's difference works automatically.

### 4a. Carry-forward
If the tenant has a running balance from previous months, it's automatically
added (or subtracted) as a `carryForward` line on the invoice.

---

## 💵 5. Collecting Payments (Mark as Paid)

From **Collections** tab, tap **✓ Settle** on a pending invoice:

| Mode | What to record |
|---|---|
| **Cash** | Just confirm. Transaction ID is stored as `CASH_COLLECTED`. |
| **UPI** | Enter the UPI transaction ID / reference number. |
| **Bank Transfer** | Enter the bank reference / UTR. |
| **Cheque** | Enter cheque number. |

- The app saves the mode + reference into `transactionId` in this format:
  `MODE:REFERENCE` (e.g. `UPI:9812345678xyz`), or just `CASH_COLLECTED` for
  cash. This is how the Collections detail view decodes it back.
- `paidAt` is stamped with the current time so today's collections show
  correctly on the Home dashboard.

### 5a. Payment note
Optional free-text note stored on the invoice — use it for things like
"partial ₹500 more due next visit" or "paid via co-tenant Ravi".

---

## 🔁 6. Partial Payments & Balance Roll-over

- Enter an amount lower than the invoice total — the invoice stays
  **unpaid** but shows `Partial` chip; `amountPaid` accumulates the received
  amount.
- The unpaid balance carries forward into next month's invoice as
  `carryForward`.
- The Home dashboard's **⚠️ Previous Month Balance** card lists every
  tenant still carrying dues from the previous month.

---

## 🏦 7. Daily Ledger

The Daily Ledger is the source of truth for **cash movement day by day**.
Two directions:

- **Inflow** — money received (rent, deposit, misc).
  - If the inflow is against an unpaid invoice for that unit, the app
    **auto-settles** the invoice (transaction ID `DAILY_LEDGER_AUTOSETTLE`).
  - If no invoice exists for that unit for the current month, the app
    **auto-creates one** and settles it.
- **Outflow** — money spent (maintenance, salary, supplies).
  - Outflow entries are **mirrored to the Expenses collection** — the two
    views stay in sync via `expenseId` / `dailyLedgerId` back-links.
  - Optionally attach a receipt photo (Cloudinary upload).

---

## 🧹 8. Expenses & Allocated Fund

- **Allocated Fund** = money that a manager has set aside for the property
  (repairs, cleaning, etc.). Add allocations from **Expenses tab → +
  Allocate**.
- Every expense you log deducts from the allocated fund when you mark it
  **✓ Settle**.
- If total settled expenses exceed the allocated fund, the app shows an
  **⚠️ Overspent** warning.
- Every expense automatically appears in **Daily Ledger** as an outflow.

---

## 🏘️ 9. Units & Tenants

### 9a. Assigning a tenant
- Only vacant units accept new tenants.
- Fields: name, phone, email, **payment day**, **security deposit**.
- The unit becomes `occupied` and shows in Collections.

### 9b. Removing a tenant
- App warns you about the security deposit refund amount.
- Any move-out **checklist deduction** is subtracted from the deposit.
- The tenant profile is copied into `tenantHistory` for records.

### 9c. Transferring a tenant
- Move a tenant from unit A → unit B, optionally generate a **pro-rated
  final invoice** for the old room.
- Meter reading on the old unit at transfer date is respected.

### 9d. Co-tenants
- Multiple people can live in one unit. Only the primary tenant's email is
  used for the tenant portal login; co-tenants are contacts only.

---

## 🗑️ 10. Deleting Data (Soft Delete)

- **Expenses and Daily Ledger entries can be soft-deleted with a mandatory
  reason.** Nothing is really removed — the record is flagged with
  `deleted: true`, `deleteReason`, `deletedBy`, `deletedAt`.
- Because expense ⇌ ledger entries are back-linked, deleting one soft-deletes
  the mirror too.
- **Invoices cannot be deleted by staff.** Edit them if you need a
  correction; if wrong, ask the manager.
- **Allocations** are hard-deleted (removed from the allocated fund).

---

## 🔒 11. What Only the Manager (Admin) Can Do

Staff cannot:
- Approve payment verifications submitted from the tenant portal
  (`💸 Payment Verifications` panel on admin).
- Approve new tenant applications.
- Broadcast announcements.
- Apply late fees in bulk.
- Bulk-generate invoices for every occupied unit in one click.
- Export financial CSVs.
- Hard-delete invoices.

You *can* still do everything else on the go: record meters, generate
invoices one-by-one, collect payments, log expenses, maintain checklists,
run maintenance tickets, and manage the tenant directory.

---

## 🧭 12. Quick Decision Flowchart

**"Tenant just paid rent — what do I do?"**
1. Open **Collections** tab.
2. Find the pending invoice (search by unit or tenant name).
3. Tap **✓ Settle** → pick mode → enter reference (if not cash) → Save.

**"Tenant paid, but there's no invoice yet — what do I do?"**
1. Open **Daily Ledger** → **+ Inflow**.
2. Pick the unit and amount. The app will auto-create the current month's
   invoice and settle it.

**"It's month-end — how do I bill everyone?"**
1. Open **Meter** tab.
2. For each occupied unit, record the reading. The app auto-generates the
   invoice with rent (upcoming month) + electricity (last month).
3. Alternatively, ask the manager to run **+ Generate Invoices** from the
   admin dashboard for a batch.

**"Tenant wants to pay only part of the rent."**
1. Settle with **Amount Paid = partial amount**. The invoice will show
   `Partial`; the balance rolls forward to next month.

**"I recorded a wrong reading."**
1. In **Collections**, tap **✏️ Edit** on the invoice → correct meter
   fields → Save. The unit's `lastMeterReading` also updates.

**"I made a wrong expense entry."**
1. In **Expenses** or **Daily Ledger**, tap **🗑** → provide a reason. It's
   soft-deleted; audit trail preserved.

---

## 🚨 13. Golden Rules

1. **Never fake the meter reading** — the app stores previous vs current,
   so any discrepancy is auditable.
2. **Always include a reason** when you manually override units consumed or
   delete an entry.
3. **Cash collected today must appear in Daily Ledger today** — even if
   you'll deposit it tomorrow.
4. **Every rupee out has a receipt** (photo or note). Upload it.
5. **The tenant portal is a mirror** — anything you mark paid there, they
   can see. Be accurate; don't guess.

---

*Last updated: 8 September 2026. If a rule here disagrees with the app,
the app is authoritative — please open an issue / notify the manager.*
