# Employee Workflow — Property Manager

This document describes the day-to-day workflow of an **employee** user in the Property Manager app.

The employee is the person on the ground: collecting money from tenants, paying labour, buying materials, taking meter readings, and keeping the property's daily books.

---

## 1. Login

- Employee opens the app at `https://rental-appartment-theta.vercel.app`.
- Signs in with Google using their staff email.
- App checks that the user has role `employee` (managed by the admin in the `users` collection).
- On success, employee is redirected to `/employee` (Employee Dashboard).

---

## 2. Employee Dashboard — Overview

The dashboard has a top-level **tabbed navigation**. The employee uses these tabs throughout the day.

Key tabs used in this workflow:

| Tab | Purpose |
|-----|---------|
| **🏠 Home** | **📋 Today** list (what to do now, by building), KPIs, quick actions; month summary, overdue, meters pending, tasks and activity under **📊 More** |
| **📓 Daily** | The core ledger screen — add deposit/expense entries |
| **Collections** | See pending invoices; manually mark as paid |
| **Meter** | Enter monthly meter reading + auto-generate invoice |
| **🏘 Monthly** | Monthly property view — paid / rent due / electricity due |
| **💰 Expenses** | Long-lived expense records (with settle/allocation) |
| **Ledger** | Tenant-wise payment history |

---

## 3. Core Daily Workflow

Below is the standard sequence an employee follows each day.

**Start with Home → 📋 Today.** It lists, grouped by building in walking order:

| Item | Shows when | Action |
|---|---|---|
| 💰 Rent due | the unit's payment day this month has come (no payment day → once the month is over) and a balance is still owed; one row per tenant, totalling all their open invoices | 💳 Record payment · 📞 Call · 💬 WhatsApp |
| ⚡ Meter round | units still have no reading for this month | Continue round (*"12 of 30 done"*) |
| 📝 Draft readings | readings were saved without an invoice | 🧾 Generate N invoices |
| 🔧 Old tickets | a maintenance ticket has been open 3 days or more | Open ticket |
| 📦 Lease ending | a lease ends within 7 days (or has ended and the unit is still occupied) | 📋 Checklist |

Items disappear on their own once the money is recorded, the reading saved or the ticket resolved.

### Step A — Record tenant payments in Collections

All tenant payments (cash, UPI, bank, cheque) are recorded in **Collections** —
see **§4 Collecting rent** below. There is no ➕ Inflow button on the Daily tab:
each payment saved in Collections writes its own inflow row to the Daily Ledger
automatically, with its payment mode.

---

### Step B — Open the Daily Ledger

1. Employee taps **📓 Daily** tab.
2. Screen shows:
   - **💳 Collect →** (jumps to Collections) and **➖ Outflow**
   - View toggle: **📅 Daily** / **🗓 Monthly**
   - Date/month picker
   - Building filter
   - Totals: Inflow / Outflow / Net, plus inflow split into **💵 Cash in hand** and **📱 UPI / Bank**
3. Inflow rows created by Collections show their mode (e.g. `UPI · TXN-77`) and
   **via Collections** instead of a Delete link — fix a wrong payment from
   Collections, not here.

---

### Step C — Expense Entry (money spent on the property)

This is used when the employee pays for **labour**, **material**, or other property costs.

1. Employee taps **➖ Outflow**.
2. Fills the form:
   - **Date**
   - **Amount (₹)**
   - **Type** — one of:
     - `labour`
     - `material`
     - `utilities`
     - `repair`
     - `other`
   - **Building**
   - **Apartment / Unit** (optional — for unit-specific work)
   - **Description**
3. If **Type = labour**, extra fields appear:
   - **Worker Name**
   - **Hours**
4. If **Type = material**, extra fields appear:
   - **Qty**
   - **Vendor**
5. Employee taps **Save Entry**.

**What the app does automatically:**

- Writes an `outflow` entry to the `dailyLedger` collection.
- Entry contributes to the day's **Outflow** total and the running **Net** for the property/building.

---

### Step D — View Daily & Monthly Books

Same screen supports **two views**:

- **📅 Daily view** — pick a date to see every inflow/outflow logged that day.
- **🗓 Monthly view** — pick a month to see entries grouped by day. Each day shows its own `+₹ inflow` and `−₹ outflow` totals.

Employee uses this to reconcile cash at end of day/month.

---

## 4. Related Workflows the Employee May Do

### Collecting rent — full, partial, and multi-day payments

The **Collections** tab is where the employee records money handed over by tenants.
It supports the common real-world case where a tenant pays the same month's rent
in **multiple instalments on different days** (e.g. ₹3,000 on the 5th by UPI, then
₹1,500 on the 12th in cash, then the balance on the 20th).

#### A. Opening the Collections tab

1. Employee taps **Collections**.
2. Each pending invoice shows a card with unit, tenant, month, total due, and one
   of two action buttons on the right:
   - 🟢 **✓ Settle** — invoice has zero payments so far.
   - 🟠 **➕ Add Payment** — invoice already has one or more partial payments
     against it. The amber colour is the visual cue: *"this is a follow-up
     payment, not a fresh one."*
3. A **PARTIAL** badge on the card confirms the invoice has been part-paid.

#### B. Recording a full payment (single-shot case)

1. Tap 🟢 **✓ Settle** on the invoice.
2. The **Record Payment** modal opens with **Full ₹`<remaining>`** pre-selected.
3. Pick payment mode (Cash / UPI / Bank).
4. Enter reference (UPI txn id / bank ref) if applicable, and an optional note.
5. Tap **Confirm**.

Result:
- Invoice `status` → `paid`, `amountPaid` = `totalAmount`, `paidAt` = now.
- One row added to `ledger` with `type: "payment"`, cross-linked via `invoiceId`.

#### C. Recording the *first* partial payment

Use this when the tenant hands over less than the full due.

1. Tap 🟢 **✓ Settle**.
2. In the modal, tap **Other amount…** and enter the smaller amount received.
3. Enter mode + reference + note.
4. Tap **Confirm**.

Result:
- Invoice stays in the pending list with `status: "pending"`, `amountPaid` set to
  the received amount, and a **PARTIAL** badge shown on the card.
- One row added to `ledger` with `type: "partial-payment"`.
- The Settle button on the card flips to 🟠 **➕ Add Payment** for the next visit.

#### D. Recording a *follow-up* partial payment (same invoice, different day)

This is the multi-day scenario. Nothing new to create — you keep hitting the
same invoice.

1. Find the invoice in the Collections list — it shows the amber **➕ Add
   Payment** button and a **PARTIAL** badge.
2. Tap 🟠 **➕ Add Payment**.
3. The modal opens with:
   - **Other amount** **auto-selected** (no need to tap it again).
   - A **Prior payments on this invoice** strip listing every earlier
     instalment with date, mode, reference, and amount — so you can verify
     what has already been collected before typing the new amount:
     ```
     Prior payments on this invoice
     5 Sep · UPI · TXN-2341        ₹3,000
     12 Sep · CASH                 ₹1,500
     ```
   - A summary line showing `Invoice ₹X · Paid ₹Y · Due ₹Z`.
4. Enter the new amount received (e.g. `1700` for the remaining balance),
   mode, reference, note.
5. Tap **Confirm**.

Result:
- `amountPaid` is **added to** (not overwritten by) the previous total — the
  math is handled by `allocatePartialPayment` in `lib/allocation.ts`, which
  reads the invoice's current `amountPaid` and adds the new receipt.
- If the new total covers `totalAmount`, the invoice flips to `status: "paid"`
  and moves out of the pending list.
- Otherwise it stays `pending` and the card is still available for the next
  visit — repeat this step as many times as needed.
- Each instalment creates its own `ledger` row, so the daily ledger and
  Ledger tab correctly reflect the day the cash actually came in — not the
  day the invoice was raised or the day it was finally settled.

#### E. Tips

- **Keep the amount honest.** Enter exactly what the tenant handed over on that
  day. Do not "round up" to close the invoice — the app will happily accept
  a third or fourth partial payment.
- **Reference field.** For UPI/bank, paste the txn id every time. It shows up
  in the *Prior payments* strip on the next visit, which is invaluable for
  reconciling with the bank statement.
- **Several months at once, or extra money.** Enter the whole amount under
  **Other amount…** (or tap **All N pending ₹…**). The selected invoice is
  cleared first, then the tenant's other pending invoices oldest-first; any
  remainder is kept as an **advance (credit)**. The modal previews this before
  you save. Corporate (master-invoice) children are not included.
- **No invoice yet?** Generate it from the **Meter** tab first, then record the
  payment here.

---

### Monthly meter reading (once a month per unit)

The Meter tab works as a **meter round**: walk the building and enter readings one unit after another.

1. Employee opens **Meter** tab and checks the **billing month**.
2. The first unit still needing a reading for that month is already selected. Units are ordered by
   building, then unit number, and a progress bar shows *"N of M done · Block A"*.
   The **Pending / All units** toggle controls the list; ✓ marks units already billed.
3. Enters current meter reading (or manual units consumed if the meter was replaced).
4. Taps **Save & next →**. The app computes `baseRent + (unitsConsumed × electricityRate) + carryForward`,
   creates the invoice in `invoices`, shows a short confirmation, and moves to the next pending unit with
   the reading field ready. **Skip →** moves on without saving (tenant not home); skipped units come
   back round at the end.
   - **📝 Save reading only** stores the reading on the unit as a draft and moves on, so the walk-around
     isn't slowed down. Drafted units show 📝 in the list. When the round is done, tap
     **Generate N invoices** to turn every draft into an invoice in one go (units that already have an
     invoice for the month are skipped, never overridden).
   - **Checks:** a reading **below the previous one** can't be saved: tick **Meter was changed** or enter
     manual units with a reason. Consumption above **2× the unit's average of its last 3 months** must be
     confirmed with *"I've re-checked the meter"*. The live line *"= N units × ₹rate = ₹…"* shows the
     charge as you type.
   - **📷 Meter photo** (optional) opens the phone camera. The photo is stored on the invoice as
     `meterPhotoUrl` and shown to the tenant and in Collections.
   - **Existing invoice for the month:** any amount already paid is kept and the status is recomputed
     (PAID or PARTIAL) against the new total. If more was paid than the new total, or the invoice is
     grouped under a corporate invoice or written off, the Meter tab refuses and sends you to
     **✏️ Edit** in Collections.
5. That invoice will now show up in **Collections**, **🏘 Monthly**, and is settled from **Collections** once the tenant pays.

### New tenant moving in

**Units → Assign Tenant** records the **move-in date** and the **opening meter reading**, and by default
creates the **first invoice** straight away:

- Rent runs from the move-in date to the tenant's first payment day in the next month (the 1st if no
  payment day is set), charged per day at the move-in month's daily rate. Moving in on the payment day
  charges a full month.
- No electricity: the opening reading becomes `lastMeterReading`, and next month's Meter round bills
  consumption from it.
- The invoice is stamped *"<Month> (Move-in)"*, so that month's Meter round already counts the unit as done.

### Monthly property overview

1. Employee opens **🏘 Monthly** tab.
2. Picks a month + optional building.
3. Sees each occupied unit grouped as:
   - ✅ **Rent Paid**
   - ⏳ **Rent Pending**
   - ⚡ **Electricity Pending**
   - 📭 **No Invoice Yet** (meter reading missing). A move-in invoice counts as the month's invoice.
4. Uses this to plan the day's collection route, acting straight from each row:
   - **💳 Record payment** opens Collections' Record Payment on that invoice. Invoices grouped under a
     corporate invoice show **Corporate → Collections** instead.
   - **📞 Call** and **💬 WhatsApp** use the tenant's saved phone. The WhatsApp message is pre-filled with
     the **remaining balance** (and a thank-you for any part already paid). Rows without a phone say
     *No phone saved*.
   - **⚡ Enter meter** (No Invoice Yet) opens the Meter tab on that unit and month. If a draft reading is
     already saved, the button reads **📝 Draft saved — generate invoice** and opens with it filled in.

### Expense fund & settlement

1. Admin/employee allocates a lump-sum fund on the **💰 Expenses** tab (**+ Allocate**).
2. Individual expenses can be logged and marked **✓ Settle** when paid out.
3. Remaining allocation is displayed and reduces automatically as expenses are settled.

---

## 5. Data Model — What Gets Written Where

| Action | Collection | Notable Fields |
|--------|-----------|----------------|
| Tenant payment (Collections) | `invoices` (update) | `status`, `amountPaid`, `paidAt`, `transactionId` |
| Tenant payment (Collections) | `ledger` (add, one per invoice + `credit` for any advance) | `invoiceId`, `amountPaid`, `type`, `paymentMode`, `paymentReference` |
| Tenant payment (Collections) | `dailyLedger` (add, one per payment) | `direction: "inflow"`, `amount`, `paymentMode`, `invoiceId` |
| Expense entry | `dailyLedger` | `direction: "outflow"`, `category`, `workerName`, `hoursWorked`, `vendor`, `quantity` |
| Meter reading | `invoices` | `unitId`, `currentReading`, `electricityCharge`, `totalAmount`, `billingPeriod` |
| Long-lived expense | `expenses` | `amount`, `category`, `settled`, `settledAt` |
| Allocated fund | `allocations` | `amount`, `date`, `note` |

---

## 6. End-of-Day Summary

At the end of each day the employee typically:

1. Opens **📓 Daily** in **Daily view** for today's date.
2. Gives a payment mode to any inflow showing **❔ Set mode…** (older rows saved without one).
3. Taps **🔒 Close day** (covers every building):
   - **Expected cash** = opening cash + 💵 cash received − outflows. Opening cash is carried from the
     previous close; on the very first close the employee types it in. All outflows count as cash spent.
   - **📱 UPI / Bank** is shown separately to match against the phone or bank statement.
   - Enters the **cash counted** and anything **handed to the owner**. A difference needs a note.
   - The rest (*counted − handed over*) carries forward as tomorrow's opening cash.
   - If an earlier day with entries was never closed, it must be closed first.
4. Opens **🏘 Monthly** briefly to see if any units still need collection.
5. Logs out.

A closed day is **read-only** in the Daily tab (no new outflows dated that day, no deletes, no mode
changes). If a payment is recorded in Collections after the close, the close shows *"Entries changed
after it was closed"*; the admin reopens the day (with a reason) and the employee closes it again. The
earlier figures are kept in the close's `history`. Closes are stored in `dayCloses/{YYYY-MM-DD}`; admins
see unreviewed cash differences on their **📅 Daily Ledger** tab and mark them **✓ Reviewed**.

---

## 7. Visual Flow

```
Login (Google)
      │
      ▼
Employee Dashboard
      │
      ├── Collections → ✓ Settle / ➕ Add Payment   (the only way to record a tenant payment)
      │     ├── amount = balance → invoice PAID
      │     ├── amount < balance → invoice PARTIAL
      │     └── amount > balance → other pending invoices oldest-first, rest kept as advance
      │              └── writes the inflow row to 📓 Daily Ledger
      │
      ├── 📓 Daily Ledger
      │     └── ➖ Outflow → Expense entry
      │              ├── labour  (worker, hours)
      │              └── material (qty, vendor)
      │
      ├── Meter → generate monthly invoice
      │
      ├── 🏘 Monthly Overview
      │     ├── ✅ Rent Paid
      │     ├── ⏳ Rent Pending
      │     ├── ⚡ Electricity Pending
      │     └── 📭 No Invoice Yet
      │
      └── Collections / Ledger / Expenses (support flows)
```

---

## 8. Roles at a Glance

| Role | Can access |
|------|-----------|
| **Employee** | Everything above |
| **Admin** | Employee flows + Building & Unit management, Applications, Financial exports |
| **Tenant** | Own dashboard: pay invoices, submit maintenance requests, view documents |

---

*Last updated: 31 Oct 2026*
