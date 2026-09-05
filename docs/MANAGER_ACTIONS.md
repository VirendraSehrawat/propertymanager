# Manager Actions — Quick Reference

This document is a **short playbook** for the on-site manager / employee.
It answers the most common question:

> *"A tenant just walked up to me and handed me cash for rent / electricity. Where do I record it?"*

Answer: **📓 Daily tab → ➕ Inflow**.

---

## 1. Tenant Pays Rent or Electricity Bill (Walk-in)

### Where to enter

1. Login at `https://rental-appartment-theta.vercel.app` with your staff Google account.
2. Open the **📓 Daily** tab on the Employee Dashboard.
3. Tap **➕ Inflow**.

### What to fill

| Field | Value |
|-------|-------|
| **Date** | Today (auto-filled) |
| **Amount (₹)** | Cash / UPI amount the tenant handed over |
| **Type** | `rent` **or** `electricity` **or** `maintenance` |
| **Building** | Pick the tenant's building |
| **Apartment / Unit** | Pick the tenant's unit |
| **Description** | Optional — e.g. *"Cash, Aug rent, Mr. Sharma"* |

### What the app does automatically

As soon as you select a **unit** with a **pending invoice**, a **teal preview box** appears in the modal:

> *"This inflow will settle Invoice #INV-… for ₹ … (oldest pending)."*

On **Save Entry**:

- A `dailyLedger` document is written (`direction: "inflow"`).
- The **oldest pending invoice** for that unit is auto-settled:
  - Full amount ≥ due → invoice marked **paid** (`status = "paid"`, `paidAt` = now).
  - Amount < due → invoice stays **unpaid** but `amountPaid` is incremented (partial payment).
- A matching row is added to the `ledger` collection so it appears in the **Tenant's payment history** and **Ledger** tab.
- Confirmation banner appears:
  - ✅ *"Invoice settled — ₹X applied"*
  - 💵 *"Partial payment ₹X applied. Remaining ₹Y"*

### One entry = one payment

If the tenant pays **rent AND electricity separately** in cash, make **two Inflow entries** (one with `Type = rent`, one with `Type = electricity`). Each one settles its own invoice.

If both are on the **same invoice** (combined monthly bill from the Meter tab), a single Inflow entry with `Type = rent` (or the amount matching the total) will settle the whole invoice.

---

## 2. Tenant Pays Part of the Amount (Partial Payment)

1. Same flow as above — **📓 Daily → ➕ Inflow**.
2. Enter the **partial amount** actually received.
3. App shows *"Partial payment ₹X applied. Remaining ₹Y"*.
4. The invoice stays **unpaid** in **Collections** with the reduced balance.
5. When tenant pays the rest later, make another **Inflow** entry with the balance amount — it will settle the same invoice automatically.

---

## 3. Tenant Pays for Multiple Months at Once

If a tenant clears **multiple pending invoices** in one payment:

- Option A (recommended): Make **one Inflow entry per invoice** (each equal to that month's due). This gives the cleanest ledger and settles each invoice cleanly.
- Option B: Enter the full lump sum as one Inflow. Only the **oldest** invoice will be auto-settled; the remainder stays as an unsettled inflow. You will then need to manually mark the newer invoices as paid from the **Collections** tab.

---

## 4. Tenant Says "I Already Paid Online / to Owner"

Do not create a walk-in Inflow. Instead:

1. Open **Collections** tab.
2. Find the invoice.
3. Tap **Mark as Paid** and add the reference (UPI txn id / bank ref) in the note.
4. This writes to `invoices` (status = paid) and `ledger` (`transactionId: "CASH_COLLECTED"` or the ref you entered).

Use this route whenever **no physical cash changed hands with you**.

---

## 5. Tenant Wants a Receipt

After saving the Inflow entry:

1. Open the **Ledger** tab.
2. Find the tenant / unit.
3. The latest paid invoice row shows the amount, date, and invoice number — use that as the receipt reference.
   *(A dedicated print-receipt button is on the roadmap.)*

---

## 6. What NOT to Use for Tenant Payments

| Tab | Don't use for tenant payments because… |
|-----|----------------------------------------|
| **💰 Expenses** | This tab is for **money going out** (labour, materials, utility bills paid to vendors). |
| **Meter** | This tab **generates** the electricity/rent invoice for the month. It does not record payment. |
| **🏘 Monthly** | Read-only overview. Use it to *see* who has paid; use **📓 Daily → Inflow** to actually record a payment. |

---

## 7. Manager's Decision Tree

```
Tenant walks up and hands money?
        │
        ▼
    YES → 📓 Daily → ➕ Inflow → pick unit → Save
        │              │
        │              └── App auto-settles the oldest pending invoice
        │
    NO (paid online / to owner)
        │
        ▼
   Collections → find invoice → Mark as Paid → add ref
```

```
Money going OUT (labour / material / vendor)?
        │
        ▼
    📓 Daily → ➖ Outflow  (for daily cash-in-hand spends)
             OR
    💰 Expenses → + Add Expense  (for long-lived expense records / fund settlement)
```

---

## 8. End-of-Day Checklist for the Manager

1. Open **📓 Daily** in **Daily view** → today.
2. Match the **Inflow total** with the cash you actually have in hand.
3. Match the **Outflow total** with the receipts you paid out.
4. Confirm **Net** is what you'll deposit / carry over.
5. Open **🏘 Monthly** → check anyone still marked **⏳ Rent Pending** or **⚡ Electricity Pending** whom you should follow up with tomorrow.
6. Logout.

---

## Related Documents

- [`docs/EMPLOYEE_WORKFLOW.md`](./EMPLOYEE_WORKFLOW.md) — full employee workflow reference.

---

*Last updated: 5 Sep 2026*
