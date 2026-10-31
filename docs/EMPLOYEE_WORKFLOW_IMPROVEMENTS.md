# Employee Workflow — Improvement Suggestions

*Prepared: 31 Oct 2026*

These suggestions are based on a review of the employee dashboard as it exists today
(`app/employee/page.tsx`, `components/employee/*`) and the documented workflow in
[`EMPLOYEE_WORKFLOW.md`](./EMPLOYEE_WORKFLOW.md) and [`MANAGER_ACTIONS.md`](./MANAGER_ACTIONS.md).
They focus on the **person on the ground**: collecting money, taking meter readings,
handling maintenance and closing the day's books. Platform-wide items that are already
tracked elsewhere (notifications, payment gateway, PWA/offline) are only mentioned
where they directly affect the employee's day. See [`IMPROVEMENT_PLAN.md`](./IMPROVEMENT_PLAN.md)
and [`ENGINEERING_BACKLOG.md`](./ENGINEERING_BACKLOG.md) for those.

Each item lists the **problem** (what the employee runs into now), the **suggestion**, and
where in the code it applies. Effort is marked **S** (under a day), **M** (a few days) or **L** (a week or more).

---

## Summary — top 10 by impact

| # | Suggestion | Why it matters | Effort |
|---|-----------|----------------|--------|
| 1 | Record **payment mode** (Cash/UPI/Bank) on Daily Ledger inflows | End-of-day cash reconciliation can't work without it | S |
| 2 | Make **"Collected Today"** use ledger rows instead of fully-paid invoices | The Home KPI misses partial payments and overstates top-ups | S |
| 3 | **One payment path:** steer tenant payments through a single "Record Payment" flow | Two doors (Daily inflow vs. Collections) confuse staff and split the audit trail | M |
| 4 | **Meter round mode:** walk unit-by-unit with "Save & next" | Today it's one dropdown + a blocking alert per unit, for every unit, every month | M |
| 5 | **Meter reading sanity checks** + meter photo | A reading below the previous one silently bills 0 units | S |
| 6 | Protect **paid invoices from being overwritten** by the Meter tab | Override resets `status` to `unpaid` on an already-paid invoice | S |
| 7 | **Shareable receipt** (WhatsApp/print) after every payment | Tenants ask for receipts; the roadmap already promises one | M |
| 8 | Add **actions to the Monthly overview rows** (Call, Record payment, Enter meter) | It's a read-only list today, used to plan the collection route | S |
| 9 | Replace `alert()` / `confirm()` / `prompt()` with **toasts and in-app dialogs** | Blocking pop-ups slow every save, and some are easy to dismiss by accident | M |
| 10 | **Cut the tab bar** from 13 tabs to ~5 primary destinations | Hard to find things on a phone; related work is spread across tabs | M |

---

## 1. Collecting money

### 1.1 Capture payment mode on Daily Ledger inflows — S
**Problem.** The Collections settle modal records `paymentMode` (Cash/UPI/Bank) and a reference,
but the **📓 Daily → ➕ Inflow** form does not (`components/employee/DailyLedgerTab.tsx`,
`handleSubmit`). `MANAGER_ACTIONS.md` §8 tells the manager to "match the Inflow total with the
cash you actually have in hand". If UPI and cash are mixed into one inflow total, that check fails.

**Suggestion.**
- Add a Cash / UPI / Bank toggle (default Cash) and an optional reference field to the inflow form.
- Write the mode onto the `dailyLedger` row *and* the `ledger` rows produced by `buildInflowPlan`.
- In the Daily view, split the Inflow total into **Cash in hand** and **Digital**.

### 1.2 Fix the "Collected Today" KPI — S
**Problem.** In `HomeTab.tsx`, today's collections are computed from invoices whose `status === "paid"`
and `paidAt` is today, summing `totalAmount`. That means:
- partial payments received today are **not counted**;
- a ₹500 balance that closes a ₹10,000 invoice counts as **₹10,000**;
- `toISOString()` gives the UTC date, so payments recorded between 00:00 and 05:30 IST fall on the wrong day.

**Suggestion.** Sum today's `ledger` rows (`payment` + `partial-payment`, excluding `credit`) by local
(IST) date, and reuse the same helper in the Daily tab totals so the two screens always agree.

### 1.3 One clear path for recording a tenant payment — M
**Problem.** A tenant payment can be recorded in two places that behave differently:

| | 📓 Daily → Inflow | Collections → Settle |
|---|---|---|
| Picks the invoice | Automatic (oldest first, waterfall) | Employee picks it |
| Payment mode / reference | ❌ | ✅ |
| Shows prior instalments | ❌ | ✅ |
| Auto-creates a missing invoice | ✅ | ❌ |

The docs need a decision tree (`MANAGER_ACTIONS.md` §7) just to explain which one to use.

**Suggestion.** Keep one **"💳 Record Payment"** flow, reachable from global search, Collections,
Monthly and the Daily tab's ➕ Inflow button. It should show what will be settled before saving
(waterfall preview), capture mode and reference, and list prior instalments. Keep the Daily ➕ Inflow
form for **non-tenant** inflows only (e.g. scrap sale, owner top-up).

### 1.4 Show the remaining balance in the Overdue list — S
**Problem.** The Home "⚠️ Overdue Invoices" card shows `totalAmount`, not what is still owed, so a
partly paid invoice looks larger than it is. The rows also can't be tapped.

**Suggestion.** Show `remaining` (as the "Previous Month Balance" card already does), add a
PARTIAL badge, and make each row open the settle modal for that invoice.

### 1.5 Receipts the employee can hand over — M
**Problem.** There is no receipt after a payment. `MANAGER_ACTIONS.md` §5 lists it as "on the roadmap".

**Suggestion.** After a payment is saved, show a confirmation sheet with:
- **Share on WhatsApp** (`wa.me/<tenantPhone>?text=…` with unit, amount, mode, ref, balance left);
- **Print / Save PDF** (a simple printable route such as `/receipt/[ledgerId]`);
- **Send on Telegram** if the tenant is linked (the notification plumbing already exists in `lib/notify.ts`).

### 1.6 Search by more than email in Collections — S
**Problem.** The Collections pending search matches only `unitNumber` and `tenantEmail`. Employees
know tenants by **name and phone**, which the global search already supports.

**Suggestion.** Match `tenantName` and `tenantPhone` as well (the invoice may need these denormalised,
or they can be looked up via `unitId`).

---

## 2. Meter readings and invoicing

### 2.1 "Meter round" mode — M
**Problem.** Monthly meter entry is one dropdown → one form → a blocking `alert()` → pick the next unit
from the dropdown again. The dropdown lists **all** occupied units, including ones already billed this
month, so the employee has to remember where they are.

**Suggestion.**
- Default the list to **units still pending for the selected month**, ordered by building/floor/unit number.
- After saving, show a non-blocking toast and **move straight to the next pending unit** ("Save & next").
- Show progress: *"12 of 30 done · Block A"*.
- Optionally allow **entering readings now and generating invoices later** (draft readings), so the
  walk-around isn't slowed down by invoice maths.

### 2.2 Reading sanity checks — S
**Problem.** If the current reading is lower than the previous one (typo, meter rollover, replaced
meter not flagged), `Math.max(0, reading - previousReading)` silently bills **0 units**. Unusually high
readings aren't flagged either.

**Suggestion.**
- Block or warn when `current < previous` and suggest ticking **Meter changed**.
- Warn when consumption is above about 2× the unit's average of its last 3 months.
- Show live **units × rate = ₹** before submit so the employee can spot mistakes.

### 2.3 Meter photo as evidence — S
**Problem.** Disputed electricity bills come down to the employee's word.

**Suggestion.** Add an optional camera capture (`<input type="file" accept="image/*" capture="environment">`)
stored on the invoice as `meterPhotoUrl`, using the existing Cloudinary upload hook. Show it in the
tenant's invoice view.

### 2.4 Don't silently reopen paid invoices — S
**Problem.** When an invoice for the unit and month already exists, the Meter tab asks "Do you want to
OVERRIDE this invoice?" and then writes `status: "unpaid"` with `merge: true`. For an invoice that is
already **paid** or partly paid, that reopens it while leaving `amountPaid` as it was, which can
produce a "paid in full but unpaid" invoice.

**Suggestion.** If the existing invoice has any `amountPaid`, either block the override and send the
employee to **Edit invoice** in Collections, or recompute `status` from `amountPaid` against the new
`totalAmount` instead of forcing `unpaid`.

### 2.5 Prompt for invoice generation on move-in / transfer — S
**Problem.** After assigning or transferring a tenant, the employee gets an alert saying *"Reminder:
generate this month's rent invoice (Admin → Invoices → Generate Invoice)"*. That screen is in the
**admin** area, so the employee can't act on the reminder.

**Suggestion.** Offer a **"Generate first invoice now"** button in the move-in flow (pro-rated rent from
the move-in date, opening meter reading captured at the same time).

---

## 3. Daily routine and planning

### 3.1 Make the Monthly overview actionable — S
**Problem.** `MonthlyOverviewTab` groups units into Rent Paid / Rent Pending / Electricity Pending /
No Invoice Yet, and the docs say it's used to *"plan the day's collection route"*, but the rows have no
actions.

**Suggestion.** Add per-row buttons: **📞 Call** (`tel:`), **💬 WhatsApp reminder** (pre-filled
message with the due amount), **💳 Record payment**, and **⚡ Enter meter** for "No Invoice Yet".

### 3.2 Today's to-do list on Home — M
**Problem.** Home shows lots of cards (KPIs, month card, previous balance, quick actions, overdue,
meters pending, tasks, activity) and leaves it to the employee to work out what to do first.

**Suggestion.** Add a single **"Today"** list at the top, generated from data:
- tenants whose `paymentDay` is today or passed and who still owe;
- meters pending once the reading window opens (e.g. after the 1st);
- tickets older than N days or marked urgent;
- unsettled expenses waiting for a receipt.

Each item gets one action button. Collapse the other cards below it.

### 3.3 End-of-day close — M
**Problem.** The end-of-day check (`EMPLOYEE_WORKFLOW.md` §6) is a manual mental checklist with no record.

**Suggestion.** Add a **"Close day"** action in the Daily tab:
1. Shows expected cash = opening cash + cash inflows − cash outflows.
2. Employee enters **actual cash counted** and any amount handed to the owner.
3. Saves a `dayClose` record with the difference and a note; flags it to the admin if the difference
   isn't zero.
4. The next day's opening cash comes from this close.

This turns reconciliation into a tracked step and gives the admin a daily cash trail.

### 3.4 Payment-day reminders — S/M
**Problem.** `unit.paymentDay` is stored, but nothing uses it to prompt follow-ups.

**Suggestion.** Use it to drive the "Today" list (3.2) and a sort order in Collections
("due today → overdue → upcoming"). If Telegram/WhatsApp notifications are enabled, send tenants
an automatic reminder so the employee doesn't have to.

---

## 4. Expenses

### 4.1 One place to add an expense — S
**Problem.** Expenses can be added from **📓 Daily → ➖ Outflow** (mirrored into `expenses`) or from
**💰 Expenses → + Add Expense** (which shows *"also visible in Daily Ledger"*). The two forms have
different fields: labour/material sub-fields are only on the Daily form, and categories differ
(`labour/material/utilities/repair` vs. `Maintenance/…`).

**Suggestion.** Use one shared expense form component in both places, with one category list, so
reports group correctly.

### 4.2 Receipt photo straight from the camera — S
**Suggestion.** Use `capture="environment"` on the receipt input so the phone opens the camera
directly, and compress images before upload to speed it up on mobile data.

### 4.3 Link expenses to tickets — S
**Suggestion.** When resolving a maintenance ticket, allow **"Add cost"**, which creates the expense
with `ticketId`, `unitId` and building pre-filled. This gives a per-unit repair cost history.

---

## 5. Maintenance tasks

### 5.1 Priority and age on tasks — S
**Suggestion.** Show ticket age ("3 days old"), let staff set a priority, and sort by priority then age.
Highlight tickets older than an SLA threshold on Home.

### 5.2 Fewer steps to resolve — S
**Suggestion.** Allow "Resolve" directly from the Home task preview, with the photo and note in a bottom
sheet. Merge the **Tasks** and **Done** tabs into one **Tasks** tab with an Open/Done toggle.

---

## 6. Navigation and interaction

### 6.1 Reduce the tab bar — M
**Problem.** There are **13 tabs** (Home, Collections, Tasks, Meter, Done, Ledger, Daily, Monthly,
Units, Occupancy, Checklist, Expenses, Inventory) in a horizontal strip on a `max-w-2xl` layout. On a
phone most of them are off-screen.

**Suggestion.** Use a **bottom navigation bar** with 5 primary destinations, with the rest in a "More" sheet:

| Bottom nav | Contains |
|---|---|
| 🏠 Home | Today list, KPIs, search |
| 💳 Collect | Collections + Monthly overview (as a view toggle) |
| 📓 Books | Daily ledger + Expenses + Ledger history |
| 🔧 Tasks | Open / Done tickets |
| ☰ More | Meter, Units, Occupancy, Checklist, Inventory, Help |

Remember the last-used tab per user (in `localStorage`) and support deep links (`/employee?tab=meter`)
so admins can send direct links.

### 6.2 Replace blocking pop-ups — M
**Problem.** Feedback relies on `window.alert`, `window.confirm` and `window.prompt` (for example the
delete-reason prompt in Daily/Expenses, and success alerts after every save). These block the UI, look
different on each browser, and are easy to dismiss with a stray tap.

**Suggestion.**
- Add a small toast component (in `components/ui`) for success and error messages.
- Use the existing `Modal` for confirmations, with the **destructive button on the right and coloured red**.
- Replace `prompt()` for delete reasons with a modal that offers common reasons (Duplicate entry,
  Wrong amount, Wrong unit) plus free text.
- Add **Undo** (about 10 seconds) after soft-deletes and settlements where that is safe.

### 6.3 Mobile input ergonomics — S
**Suggestion.**
- Use `inputMode="numeric"` on amount and meter fields so the number pad opens.
- Use larger tap targets (at least 44px) on the action buttons in cards. Several are `text-[10px]` now.
- Keep the **Save** button fixed to the bottom of long modals so it isn't hidden behind the keyboard.
- Remember the last-used **building** in the Daily, Meter and Expenses forms.

### 6.4 Clean up inline editors in the tenant profile — S
**Problem.** In the tenant profile, payment day and security deposit are saved by reading values with
`document.getElementById(...)` and an unlabelled ✓ button, followed by an `alert`.

**Suggestion.** Use a standard edit form with one **Save** button and a toast, consistent with the rest
of the app.

---

## 7. Reliability on the ground

### 7.1 Load only what the screen needs — M
**Problem.** The dashboard opens **12 live `onSnapshot` listeners on whole collections** (`invoices`,
`ledger`, `dailyLedger`, `expenses`, `maintenance`, …) on page load. As history grows, the app gets
slower to open on mobile data and uses more Firestore reads.

**Suggestion.** Scope listeners: for example pending invoices plus the last 2–3 months, today's and
this month's `dailyLedger`, and open tickets. Load history on demand (Ledger tab, settled list,
older months).

### 7.2 Offline-tolerant entry — L
**Problem.** Employees collect cash in basements and stairwells with poor signal.

**Suggestion.** Turn on Firestore's persistent local cache so writes queue offline, show a
"⏳ N entries waiting to sync" badge, and make the PWA installable. This is already listed as G1 in
the engineering backlog. Before enabling it for payments, check that the client-side batch logic
(`commitPaymentPlan`) still behaves correctly when writes are replayed.

### 7.3 Prevent double-submits — S
**Suggestion.** Disable the submit button while saving everywhere (Daily already does this; check
the Meter, Checklist and Expenses forms), and add an idempotency key on payment writes so a
double tap or retry can't record the same cash twice.

---

## 8. Documentation and help

- Update `EMPLOYEE_WORKFLOW.md`: it describes the invoice `status` as `"partial"`, but individual
  invoices stay `unpaid` with `amountPaid > 0` (only master invoices use `partial`). It also doesn't
  mention lump-sum waterfall, auto-created invoices or tenant credit, which the Daily inflow now does.
- Link the in-app **Help** page (`app/employee/help`) from each tab's header ("?" icon to the relevant
  section) instead of only from the main menu.
- Add short "first time" hints on Meter and Collections.

---

## Suggested rollout

| Phase | Items | Outcome |
|---|---|---|
| **Quick wins (1 week)** | 1.1, 1.2, 1.4, 1.6, 2.2, 2.4, 3.1, 6.3, 7.3 | Correct numbers, fewer data errors, faster daily use |
| **Workflow (2–3 weeks)** | 1.3, 1.5, 2.1, 2.3, 4.1, 6.2 | One payment path, fast meter rounds, receipts |
| **Structure (3–4 weeks)** | 3.2, 3.3, 6.1, 7.1 | Today list, tracked day close, simpler navigation, faster load |
| **Later** | 2.5, 3.4, 4.3, 5.x, 7.2 | Automation and offline support |
