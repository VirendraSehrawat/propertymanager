# Manager Actions — Quick Reference

This document is a **short playbook** for the on-site manager / employee.
It answers the most common question:

> *"A tenant just paid me rent / electricity. Where do I record it?"*

Answer: **Collections → find the invoice → ✓ Settle** (or **🔍 search the tenant → 💳 Record Payment**).

Collections is the **only** place tenant payments are recorded. The **📓 Daily** tab no longer
has an ➕ Inflow button: every payment saved in Collections writes its own inflow row to the
Daily Ledger automatically, so the day's books stay complete.

---

## 1. Tenant Pays Rent or Electricity Bill

### Where to enter

1. Login at `https://rental-appartment-theta.vercel.app` with your staff Google account.
2. Either:
   - type the tenant's name or phone in the **🔍 search bar** at the top and tap **💳 Record Payment**, or
   - open **Collections**, find the invoice under **Pending Invoices** (its search box takes the unit,
     tenant name, phone or email), and tap **✓ Settle** (**➕ Add Payment** if it is already part-paid).

### What to fill

| Field | Value |
|-------|-------|
| **Payment** | **Full ₹…** (pre-selected) or **Other amount…** |
| **Amount Received** | Only for *Other amount* — exactly what the tenant handed over |
| **Payment Mode** | CASH / UPI / BANK / CHEQUE / OTHER |
| **Reference** | UPI txn id / bank ref / cheque no. (not needed for cash) |
| **Note** | Optional — e.g. *"paid to owner directly"* |

### What the app does automatically

On **Save**, in one atomic write:

- The invoice is updated (`amountPaid`, and `status = "paid"` + `paidAt` when cleared).
- A row is added to the `ledger` collection — it appears in the **Tenant's payment history** and the **Ledger** tab.
- An **inflow** row is added to the **📓 Daily Ledger** with the payment mode, so it counts towards
  **💵 Cash in hand** or **📱 UPI / Bank** for the day.
- The tenant gets a Telegram notification if linked.

---

## 2. Tenant Pays Part of the Amount (Partial Payment)

1. Open the invoice's **✓ Settle** → tap **Other amount…** and enter what was received.
   *Rent only* / *Elec only* shortcuts fill the amount for you.
2. Save. The invoice stays in **Pending Invoices** with a **PARTIAL** badge and the reduced balance.
3. When the tenant pays the rest, tap **➕ Add Payment** on the same invoice. The *Prior payments*
   strip shows every earlier instalment.

---

## 3. Tenant Pays for Multiple Months at Once (or Pays Extra)

1. Open **✓ Settle** on any of the tenant's pending invoices.
2. Tap **Other amount…** and enter the **whole amount** handed over — or tap **All N pending ₹…**.
3. Before saving, the modal previews where the money goes:
   - the selected invoice is cleared first;
   - the extra is applied to the tenant's **other pending invoices, oldest first**;
   - anything left after that is kept as an **🪙 advance (credit)** for the tenant.
4. Save. Each invoice touched gets its own ledger row; the Daily Ledger gets **one** inflow row
   for the full amount.

> Invoices grouped under a **corporate master invoice** are not included in this waterfall —
> settle those from the master invoice card in Collections.

---

## 4. Tenant Says "I Already Paid Online / to Owner"

Same flow as §1. Pick the matching **Payment Mode** (UPI / BANK), paste the reference, and add a
note such as *"paid to owner directly"*.

---

## 5. Tenant Pays Before This Month's Invoice Exists

Collections only settles existing invoices. Generate the invoice first from the **Meter** tab
(meter reading → invoice), then record the payment in Collections.

---

## 6. Tenant Wants a Receipt

After saving the payment:

1. Open the **Ledger** tab.
2. Find the tenant / unit.
3. The latest row shows the amount, date, mode and reference — use that as the receipt reference.
   *(A dedicated print-receipt button is on the roadmap.)*

---

## 7. What NOT to Use for Tenant Payments

| Tab | Don't use for tenant payments because… |
|-----|----------------------------------------|
| **📓 Daily** | Inflows are created automatically from Collections. Use Daily only for **➖ Outflows**. |
| **💰 Expenses** | This tab is for **money going out** (labour, materials, utility bills paid to vendors). |
| **Meter** | This tab **generates** the electricity/rent invoice for the month. It does not record payment. |
| **🏘 Monthly** | Overview of who has paid. Its **💳 Record payment** button opens Collections — the payment is still saved there. |

Inflow rows created by Collections show **"via Collections"** in the Daily tab and can't be deleted
there — deleting only the cash row would leave the invoice marked paid.

---

## 8. Manager's Decision Tree

```
Tenant hands over money (cash, UPI, bank, cheque)?
        │
        ▼
   Collections → ✓ Settle on the invoice   (or 🔍 search → 💳 Record Payment)
        │
        ├── amount = balance      → invoice PAID
        ├── amount < balance      → invoice PARTIAL
        └── amount > balance      → other pending invoices cleared oldest-first,
                                     remainder kept as advance
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

## 9. End-of-Day Checklist for the Manager

1. Open **📓 Daily** in **Daily view** → today.
2. Set the mode on any inflow showing **❔ Set mode…**.
3. Match **📱 UPI / Bank** with the payments received on your phone / bank statement.
4. Match the **Outflow total** with the receipts you paid out.
5. Tap **🔒 Close day**, count the cash, enter it and what you **handed to the owner**. If it doesn't
   match the expected cash, write why. The day is then locked; the admin can reopen it.
6. Open **🏘 Monthly** → check anyone still marked **⏳ Rent Pending** or **⚡ Electricity Pending**, and send a **💬 WhatsApp** reminder (pre-filled with the balance) or plan a call for tomorrow. Whenever
   you reach (or fail to reach) a tenant, tap **📝 Log follow-up** and record what they said — a promised
   date keeps them off tomorrow's Today list until that day.
7. Logout.

---

## Related Documents

- [`docs/EMPLOYEE_WORKFLOW.md`](./EMPLOYEE_WORKFLOW.md) — full employee workflow reference.

---

*Last updated: 31 Oct 2026*
