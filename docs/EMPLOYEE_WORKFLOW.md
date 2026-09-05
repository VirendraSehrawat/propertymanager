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
| **🏠 Home** | Daily summary, overdue invoices, tasks, recent activity |
| **📓 Daily** | The core ledger screen — add deposit/expense entries |
| **Collections** | See pending invoices; manually mark as paid |
| **Meter** | Enter monthly meter reading + auto-generate invoice |
| **🏘 Monthly** | Monthly property view — paid / rent due / electricity due |
| **💰 Expenses** | Long-lived expense records (with settle/allocation) |
| **Ledger** | Tenant-wise payment history |

---

## 3. Core Daily Workflow

Below is the standard sequence an employee follows each day.

### Step A — Open the Daily Ledger

1. Employee taps **📓 Daily** tab.
2. Screen shows:
   - Two buttons: **➕ Inflow** and **➖ Outflow**
   - View toggle: **📅 Daily** / **🗓 Monthly**
   - Date/month picker
   - Building filter
   - Totals: Inflow / Outflow / Net

---

### Step B — Deposit Entry (money collected from tenant)

This is used when a **tenant pays** rent, electricity, or maintenance charges.

1. Employee taps **➕ Inflow**.
2. Fills the form:
   - **Date** (defaults to today)
   - **Amount (₹)** — what the tenant paid
   - **Type** — one of:
     - `rent`
     - `electricity`
     - `maintenance`
     - `deposit`
     - `other`
   - **Building** — pick the building
   - **Apartment / Unit** — pick the unit (once building is selected)
   - **Description** — optional note
3. If there is a **pending invoice** for that unit, a **teal preview box** appears showing:
   - Which invoice will be auto-settled
   - Amount due
   - How many other invoices are pending
4. Employee taps **Save Entry**.

**What the app does automatically:**

- Writes a new document in the `dailyLedger` Firestore collection.
- If the entry is `inflow` **and** the category is `rent / electricity / maintenance` **and** a unit is selected **and** that unit has a pending invoice:
  - Applies the payment to the **oldest pending invoice** for that unit.
  - If amount covers the full remaining due → invoice marked **paid** (`status = "paid"`, `paidAt` timestamp added).
  - If amount is less → invoice keeps `status = "unpaid"` but `amountPaid` is incremented (partial payment).
  - Adds a matching row in the `ledger` collection so it shows up under the Tenant's payment history.
- Employee sees a confirmation:
  - ✅ *"Invoice settled"* on full payment
  - 💵 *"Partial payment ₹X applied. Remaining ₹Y"* on partial payment

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

### Monthly meter reading (once a month per unit)

1. Employee opens **Meter** tab.
2. Selects unit + billing month.
3. Enters current meter reading (or manual units consumed if the meter was replaced).
4. App computes: `baseRent + (unitsConsumed × electricityRate) + carryForward` and creates an invoice in the `invoices` collection.
5. That invoice will now show up in **Collections**, **🏘 Monthly**, and can be **auto-settled from the Daily Ledger** once the tenant pays.

### Monthly property overview

1. Employee opens **🏘 Monthly** tab.
2. Picks a month + optional building.
3. Sees each occupied unit grouped as:
   - ✅ **Rent Paid**
   - ⏳ **Rent Pending**
   - ⚡ **Electricity Pending**
   - 📭 **No Invoice Yet** (meter reading missing)
4. Uses this to plan the day's collection route.

### Expense fund & settlement

1. Admin/employee allocates a lump-sum fund on the **💰 Expenses** tab (**+ Allocate**).
2. Individual expenses can be logged and marked **✓ Settle** when paid out.
3. Remaining allocation is displayed and reduces automatically as expenses are settled.

---

## 5. Data Model — What Gets Written Where

| Action | Collection | Notable Fields |
|--------|-----------|----------------|
| Deposit entry | `dailyLedger` | `direction: "inflow"`, `category`, `unitId`, `amount`, `date` |
| Deposit auto-settle | `invoices` (update) | `status`, `amountPaid`, `paidAt` |
| Deposit auto-settle | `ledger` (add) | `invoiceId`, `amountPaid`, `transactionId: "DAILY_LEDGER_AUTOSETTLE"` |
| Expense entry | `dailyLedger` | `direction: "outflow"`, `category`, `workerName`, `hoursWorked`, `vendor`, `quantity` |
| Meter reading | `invoices` | `unitId`, `currentReading`, `electricityCharge`, `totalAmount`, `billingPeriod` |
| Manual collection | `invoices` + `ledger` | `status: "paid"`, `transactionId: "CASH_COLLECTED"` |
| Long-lived expense | `expenses` | `amount`, `category`, `settled`, `settledAt` |
| Allocated fund | `allocations` | `amount`, `date`, `note` |

---

## 6. End-of-Day Summary

At the end of each day the employee typically:

1. Opens **📓 Daily** in **Daily view** for today's date.
2. Confirms:
   - Total **Inflow** matches cash collected.
   - Total **Outflow** matches receipts / paid labour.
   - **Net** equals what should be handed over / retained.
3. Opens **🏘 Monthly** briefly to see if any units still need collection.
4. Logs out.

---

## 7. Visual Flow

```
Login (Google)
      │
      ▼
Employee Dashboard
      │
      ├── 📓 Daily Ledger
      │     ├── ➕ Inflow  → Deposit entry
      │     │        └── auto-settle matching invoice
      │     │             ├── Full payment → invoice PAID
      │     │             └── Partial     → invoice AMOUNT_PAID updated
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

*Last updated: 4 Sep 2026*
