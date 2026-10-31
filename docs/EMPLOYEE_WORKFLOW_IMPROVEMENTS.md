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

## Progress

*Updated: 31 Oct 2026*

**Done (21):** 1.1, 1.2, 1.3, 1.4, 1.6 · 2.1, 2.2, 2.3, 2.4, 2.5 · 3.1–3.5 · 4.4, 4.5 · 6.1–6.4. Each is marked ✅ in its section with what shipped.
Sections 1 (Collecting money) and 2 (Meter readings and invoicing) are complete except **1.5 Receipts**.

**Next up (open quick wins):** 3.8, 4.2, 4.9, 4.13, 7.3.

---

## Summary — top 10 by impact

| # | Suggestion | Why it matters | Effort | Status |
|---|-----------|----------------|--------|--------|
| 1 | Record **payment mode** (Cash/UPI/Bank) on Daily Ledger inflows | End-of-day cash reconciliation can't work without it | S | ✅ Done (1.1) |
| 2 | Make **"Collected Today"** use ledger rows instead of fully-paid invoices | The Home KPI misses partial payments and overstates top-ups | S | ✅ Done (1.2) |
| 3 | **One payment path:** steer tenant payments through a single "Record Payment" flow | Two doors (Daily inflow vs. Collections) confuse staff and split the audit trail | M | ✅ Done (1.3) |
| 4 | **Meter round mode:** walk unit-by-unit with "Save & next" | Today it's one dropdown + a blocking alert per unit, for every unit, every month | M | ✅ Done (2.1) |
| 5 | **Meter reading sanity checks** + meter photo | A reading below the previous one silently bills 0 units | S | ✅ Done (2.2, 2.3) |
| 6 | Protect **paid invoices from being overwritten** by the Meter tab | Override resets `status` to `unpaid` on an already-paid invoice | S | ✅ Done (2.4) |
| 7 | **Shareable receipt** (WhatsApp/print) after every payment | Tenants ask for receipts; the roadmap already promises one | M | Open (1.5) |
| 8 | Add **actions to the Monthly overview rows** (Call, Record payment, Enter meter) | It's a read-only list today, used to plan the collection route | S | ✅ Done (3.1) |
| 9 | Replace `alert()` / `confirm()` / `prompt()` with **toasts and in-app dialogs** | Blocking pop-ups slow every save, and some are easy to dismiss by accident | M | ✅ Done (6.2) |
| 10 | **Cut the tab bar** from 13 tabs to ~5 primary destinations | Hard to find things on a phone; related work is spread across tabs | M | ✅ Done (6.1) |

---

## 1. Collecting money

### 1.1 Capture payment mode on Daily Ledger inflows — S
> ✅ **Done (31 Oct 2026).** Daily totals now split inflows into Cash in hand and UPI / Bank. With 1.3, all inflows (and their mode) come from Collections.

**Problem.** The Collections settle modal records `paymentMode` (Cash/UPI/Bank) and a reference,
but the **📓 Daily → ➕ Inflow** form does not (`components/employee/DailyLedgerTab.tsx`,
`handleSubmit`). `MANAGER_ACTIONS.md` §8 tells the manager to "match the Inflow total with the
cash you actually have in hand". If UPI and cash are mixed into one inflow total, that check fails.

**Suggestion.**
- Add a Cash / UPI / Bank toggle (default Cash) and an optional reference field to the inflow form.
- Write the mode onto the `dailyLedger` row *and* the `ledger` rows produced by `buildInflowPlan`.
- In the Daily view, split the Inflow total into **Cash in hand** and **Digital**.

### 1.2 Fix the "Collected Today" KPI — S
> ✅ **Done (31 Oct 2026).** Computed from `ledger` + today's `ledgerEntries` rows by local date.

**Problem.** In `HomeTab.tsx`, today's collections are computed from invoices whose `status === "paid"`
and `paidAt` is today, summing `totalAmount`. That means:
- partial payments received today are **not counted**;
- a ₹500 balance that closes a ₹10,000 invoice counts as **₹10,000**;
- `toISOString()` gives the UTC date, so payments recorded between 00:00 and 05:30 IST fall on the wrong day.

**Suggestion.** Sum today's `ledger` rows (`payment` + `partial-payment`, excluding `credit`) by local
(IST) date, and reuse the same helper in the Daily tab totals so the two screens always agree.

### 1.3 One clear path for recording a tenant payment — M
> ✅ **Done (31 Oct 2026), Collections only.** Daily ➕ Inflow was removed. Collections' Record Payment now accepts more than the invoice balance: it waterfalls across the unit's other pending invoices and keeps any remainder as an advance. Auto-creating a missing invoice was deliberately dropped — generate it from Meter first.

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
> ✅ **Done (31 Oct 2026).** Rows show the balance still owed, a PARTIAL badge and *Paid ₹X of ₹Y*; fully covered invoices drop off; the header shows the total overdue. Tapping a row opens Record Payment for that invoice (corporate children go to Collections).

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
> ✅ **Done (31 Oct 2026).** Both Collections searches (Pending Invoices and Settled Collections) now match the tenant's **name** and **phone** as well as unit and email. Name and phone are looked up from the unit via `invoice.unitId` (no denormalising), and only while the unit still belongs to the invoice's tenant, so a new occupant's details never match an old tenant's invoices. Phone matching ignores spaces, dashes and a leading +91 / 0. Pending rows now show the tenant's name next to the email. Logic in `lib/invoiceSearch.ts`.

**Problem.** The Collections pending search matches only `unitNumber` and `tenantEmail`. Employees
know tenants by **name and phone**, which the global search already supports.

**Suggestion.** Match `tenantName` and `tenantPhone` as well (the invoice may need these denormalised,
or they can be looked up via `unitId`).

---

## 2. Meter readings and invoicing

### 2.1 "Meter round" mode — M
> ✅ **Done (31 Oct 2026)**, including draft readings: **📝 Save reading only** stores the reading on the unit (`units/{id}.meterDraft`) and **Generate N invoices** turns all drafts into invoices later (existing invoices are skipped, never overridden). The Meter tab opens on the first pending unit, ordered by building then unit number, shows *"N of M done · Building"*, and **Save & next** / **Skip** move through the pending units with a toast instead of an alert.

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
> ✅ **Done (31 Oct 2026).** A reading below the previous one blocks saving (with a pointer to *Meter changed* / manual units); consumption above 2× the average of the last 3 regular months needs an *"I've re-checked the meter"* tick; a live *"= N units × ₹rate = ₹…"* line shows under the reading. Logic in `lib/meterInvoice.ts`.

**Problem.** If the current reading is lower than the previous one (typo, meter rollover, replaced
meter not flagged), `Math.max(0, reading - previousReading)` silently bills **0 units**. Unusually high
readings aren't flagged either.

**Suggestion.**
- Block or warn when `current < previous` and suggest ticking **Meter changed**.
- Warn when consumption is above about 2× the unit's average of its last 3 months.
- Show live **units × rate = ₹** before submit so the employee can spot mistakes.

### 2.3 Meter photo as evidence — S
> ✅ **Done (31 Oct 2026).** Optional camera capture on the Meter tab, uploaded through the existing Cloudinary route and saved as `invoice.meterPhotoUrl` (also on drafts). Shown on the tenant's invoice and on Collections rows.

**Problem.** Disputed electricity bills come down to the employee's word.

**Suggestion.** Add an optional camera capture (`<input type="file" accept="image/*" capture="environment">`)
stored on the invoice as `meterPhotoUrl`, using the existing Cloudinary upload hook. Show it in the
tenant's invoice view.

### 2.4 Don't silently reopen paid invoices — S
> ✅ **Done (31 Oct 2026).** Overrides keep `amountPaid`, `transactionId` and `paidAt`, and recompute the status (PAID or PARTIAL/`pending`) against the new total. Overriding is refused when more was paid than the new total, or the invoice is corporate-grouped or written off; the employee is sent to ✏️ Edit in Collections.

**Problem.** When an invoice for the unit and month already exists, the Meter tab asks "Do you want to
OVERRIDE this invoice?" and then writes `status: "unpaid"` with `merge: true`. For an invoice that is
already **paid** or partly paid, that reopens it while leaving `amountPaid` as it was, which can
produce a "paid in full but unpaid" invoice.

**Suggestion.** If the existing invoice has any `amountPaid`, either block the override and send the
employee to **Edit invoice** in Collections, or recompute `status` from `amountPaid` against the new
`totalAmount` instead of forcing `unpaid`.

### 2.5 Prompt for invoice generation on move-in / transfer — S
> ✅ **Done (31 Oct 2026).** Assign Tenant (new or existing tenant) now takes a move-in date and opening meter reading, and **Generate first invoice now** (on by default) creates a rent-only invoice pro-rated from the move-in date to the first payment day of the next month, stamped *"<Month> (Move-in)"* so that month's Meter round treats the unit as done. The Transfer modal is unchanged (it already offers a pro-rated invoice for the old room).

**Problem.** After assigning or transferring a tenant, the employee gets an alert saying *"Reminder:
generate this month's rent invoice (Admin → Invoices → Generate Invoice)"*. That screen is in the
**admin** area, so the employee can't act on the reminder.

**Suggestion.** Offer a **"Generate first invoice now"** button in the move-in flow (pro-rated rent from
the move-in date, opening meter reading captured at the same time).

---

## 3. Daily routine and planning

> **Updated 31 Oct 2026** to match what is now built: tenant payments go through Collections only (1.3),
> the Daily tab splits **💵 Cash in hand / 📱 UPI-Bank / ❔ Mode not recorded** (1.1), Home's Overdue list
> shows remaining balances and opens Record Payment (1.4), and the Meter tab has rounds, drafts, checks
> and move-in invoices (2.1–2.5). Since then 3.1–3.5 are built (marked ✅ below).

The items are ordered around the employee's day. Item numbers are unchanged so the rollout table still
matches.

| When | What the employee needs | Items |
|---|---|---|
| **Morning** | One list of what to do today, in walking order | 3.2, 3.6, 3.4, 3.7 |
| **During the day** | Act straight from the list; remember what tenants said | 3.1, 3.5 |
| **Evening** | Count the cash, close the day, tell the owner | 3.3, 3.9 |
| **Weekly / monthly** | See which dues are getting old; prepare for move-outs | 3.10, 3.8 |

### 3.1 Make the Monthly overview actionable — S
> ✅ **Done (31 Oct 2026).** Rows now have **💳 Record payment** (opens Collections' Settle modal; corporate-grouped invoices show *Corporate → Collections*), **📞 Call** and **💬 WhatsApp** (message quotes the remaining balance; helpers in `lib/contact.ts`), and **⚡ Enter meter** / **📝 Draft saved — generate invoice** on No Invoice Yet rows, which open the Meter tab on that unit and month (`MeterTab` `initialUnitId` / `initialBillingMonth`). Move-in invoices now count as the month's invoice.

**Problem.** `MonthlyOverviewTab` groups units into Rent Paid / Rent Pending / Electricity Pending /
No Invoice Yet and is used to plan the collection route, but its rows have no buttons. Home's Overdue
list can now open Record Payment directly (1.4); the Monthly overview can't.

**Suggestion.** Add per-row buttons, reusing what already exists:
- **💳 Record payment**: the same `jumpToInvoiceId` hand-off Home uses, so it opens Collections' Settle
  modal on that invoice (corporate-grouped invoices go to the master invoice instead);
- **📞 Call** (`tel:`) and **💬 WhatsApp reminder** pre-filled with the *remaining* balance, not the
  invoice total;
- **⚡ Enter meter** on "No Invoice Yet": opens the Meter tab on that unit (needs a small
  `initialUnitId` prop on `MeterTab`). If the unit already has a **📝 draft reading**, show
  *"Draft saved — generate invoice"* instead.

### 3.2 Today list on Home — M
> ✅ **Done (31 Oct 2026), with the data that exists today.** Home opens with a **📋 Today** card (`components/employee/TodayCard.tsx`, rules in `lib/todayList.ts`):
> - **Rent due** — once the unit's payment day this month is reached (no payment day → once the billing month is over), one row per unit + tenant totalling all open invoices, with 💳 Record payment (on the oldest; the waterfall settles the rest) · 📞 Call · 💬 WhatsApp. Corporate-grouped dues go to Collections; an old tenant's dues don't pick up the new occupant's name or payment day.
> - **Meter round** (*"N of M done · K to read"*) and **draft readings** (*Generate N invoices*), both opening the Meter tab.
> - **Tickets** open 3+ days (there is no ticket priority field yet, so "urgent" isn't used) and **leases ending** within 7 days (📋 Checklist).
> - Unit items are grouped by building (sorted by name), round-wide items on top.
>
> KPIs and Quick Actions stay visible; the other cards moved into a collapsed **📊 More** section. **Meters Pending** now uses `buildMeterRound`, so drafted and move-in units aren't counted (drafts are shown as *"+ N read, waiting to be invoiced"*).
> **Not yet in the list** (their features don't exist): routine chores (3.7), notice periods (3.8) and a day-close reminder (3.3). Promises were added with 3.5.

**Problem.** Home shows many separate cards (KPIs, month card, previous balance, quick actions, overdue,
meters pending, tasks, activity) and leaves it to the employee to work out what to do first. The
**Meters Pending** card also doesn't know about draft readings, so units read and saved as drafts
still show as pending.

**Suggestion.** One **"Today"** list at the top, built from data, each item with one action:

| Source | Shows when | Action |
|---|---|---|
| Rent due (3.4) | `paymentDay` is today or passed and the invoice still has a remaining balance | 💳 Record payment |
| Promises (3.5) | promised date is today, or passed and still unpaid (broken promise) | 💳 Record payment · 📞 Call |
| Meter round | from the 1st until every unit is read for the month | ⚡ Continue round (*"12 of 30 done"*) |
| Draft readings | drafts exist for the month | 🧾 Generate N invoices |
| Tickets | urgent, or open longer than N days | 🔧 Open ticket |
| Routine (3.7) | a recurring chore is due | ✓ Done |
| Move-outs (3.8) | a lease ends or notice expires within 7 days | 📋 Checklist |
| Day close (3.3) | yesterday wasn't closed, or after 6 pm today | 🔒 Close day |

Lay it out by building (3.6). The other cards collapse below the list. Fix Meters Pending to use
`buildMeterRound` so drafted and move-in units aren't counted as pending.

### 3.3 End-of-day close — M
> ✅ **Done (31 Oct 2026).** **🔒 Close day** in the Daily tab (`components/employee/DayClosePanel.tsx`, rules in `lib/dayClose.ts`), for the whole day across buildings:
> - Expected cash = opening (the previous close's carried-forward cash; typed in on the first close) + cash inflows − outflows (all outflows are treated as cash). UPI / bank / cheque is shown separately.
> - Inflows without a mode get a **❔ Set mode…** picker on the row and block the close. Earlier unclosed days with entries must be closed first.
> - The employee enters cash counted and handed to the owner; a difference needs a note. Saved as `dayCloses/{YYYY-MM-DD}`; *counted − handed* is the next opening.
> - A closed day is read-only in the Daily tab (no outflows dated that day, no deletes, no mode changes); entries added later (e.g. a Collections payment) show a *changed after close* warning. Admins (same tab in `/admin`) **🔓 Reopen** with a reason (the old figures go to `history`) and **✓ Review** differences, counted on the admin tab badge. Firestore rules only let staff change a close after an admin reopens it.
> - Also fixed: Collections inflows and the Daily tab's "today" now use the local date, not UTC, so a payment after midnight IST lands on the right day.
>
> Not done: a Telegram alert to the admin for a difference (it shows on the admin tab instead), and Collections itself doesn't refuse payments on a closed day — they're flagged on the close.

**Problem.** The end-of-day check (`EMPLOYEE_WORKFLOW.md` §6, `MANAGER_ACTIONS.md` §9) is a mental
checklist with no record. The Daily tab now shows *Cash in hand* and *UPI / Bank* separately, but nothing
saves the reconciliation.

**Suggestion.** A **🔒 Close day** action in the Daily tab:
1. **Expected cash** = opening cash + cash inflows − cash outflows. Inflows come from Collections
   payments with mode *cash*; UPI/bank is listed separately to match against the phone or bank statement.
2. Any **❔ Mode not recorded** inflow (older rows) must be given a mode before closing.
3. The employee enters **actual cash counted** and any amount **handed to the owner**.
4. A `dayClose` record saves the difference and a note; a non-zero difference is flagged to the admin.
5. The next day's **opening cash** comes from this close. A closed day becomes read-only in the Daily
   tab; changes need a reopen by the admin.

### 3.4 Payment-day reminders — S/M
> ✅ **Done (31 Oct 2026)**, Telegram only. Due dates now live in `lib/paymentDue.ts` (shared with the Today list).
> - **Collections** sorts pending invoices **due today → overdue → due this week → later** (toggle back to unit order), with a due badge on each card (*DUE TODAY*, *5D LATE*, *DUE TOMORROW*, *DUE SAT 8 NOV*).
> - **Automatic reminders:** a daily job (`/api/notifications/payment-reminders`, 09:00 IST via `vercel.json` cron, protected by `CRON_SECRET`) sends linked tenants a Telegram message the day before and on the payment day with the balance still owed, and sends the admin channel one summary of who was reminded and who isn't on Telegram. Each send is recorded once in `paymentReminders` (never sent twice); Home → Today shows **🔔 Reminded** for those tenants.
> - **Not done:** automatic WhatsApp (no WhatsApp API is set up — the manual 💬 WhatsApp buttons from 3.1/3.2 remain), and a scheduler on Firebase App Hosting (needs a Cloud Scheduler job; see `TELEGRAM_INTEGRATION.md` §8a).

**Problem.** `unit.paymentDay` is stored and used for rent periods (and now for the move-in pro-rating),
but nothing uses it to prompt follow-ups. Home's Overdue list is sorted oldest first, which isn't the
same as "who should pay today".

**Suggestion.** Use it to drive the Today list (3.2), and add a sort to Collections: **due today →
overdue → upcoming this week**. If Telegram (`lib/notify.ts`) or WhatsApp is set up for the tenant, send
an automatic reminder the day before and on the day, showing the remaining balance, so the employee
only chases tenants who didn't respond.

### 3.5 Follow-up log and promise-to-pay — S
> ✅ **Done (31 Oct 2026).** **📝 Log follow-up** on rent rows in Home → Today, Collections (pending) and Monthly (pending), via one dialog (`components/employee/modals/LogFollowUpModal.tsx`, rules in `lib/followUp.ts`). Outcomes: *No answer*, *Promised to pay* (date), *Will pay partly* (date + amount), *Disputed* (note required).
> - Stored append-only on the unit as `followUps[]` (date, outcome, promised date / amount, note, staff, tenant email — a new occupant doesn't inherit them).
> - Rows show *"Contacted 2 days ago · promised Mon 3 Nov"*; Collections adds a PROMISED / PROMISED TODAY / BROKEN PROMISE badge.
> - Today list: promises due today and **broken promises** are listed first in their building with a badge; tenants with a **future promise are left out** (counted as *"N promised to pay later"*).
> - A promise is **closed by any payment** for that unit and tenant recorded after it (derived from the ledger, so no extra write in Collections). A later *Disputed* cancels the promise.

**Problem.** When a tenant says *"I'll pay on Friday"*, there is nowhere to record it. Unit notes are
free text, so the next day the employee has to remember who was chased, when, and what they said.

**Suggestion.** A **📞 Log follow-up** action on overdue rows (Home, Collections, Monthly) with a small
set of outcomes: *No answer*, *Promised on <date>*, *Will pay partly*, *Disputed*. Store it on the unit
(e.g. `followUps[]` with date, outcome, promised date, staff). Then:
- show *"Last contacted 2 days ago · promised 3 Nov"* on the overdue row;
- put promises due today into the Today list, and flag **broken promises** (date passed, still unpaid);
- leave tenants with a future promise out of the "chase today" list so they aren't called twice;
- recording a payment in Collections closes any open promise for that tenant.

### 3.6 Plan the walk by building — S
> ◐ **Partly done by 3.2:** Today items are grouped under a building header with an item count. Still open: per-kind counts in the header (*dues · meters · tickets*) and listing each building's meter-round units alongside its dues.

**Problem.** Overdue tenants, pending meters and open tickets are separate lists, so the employee may
visit the same building several times a day.

**Suggestion.** Lay the Today list (3.2) out by **building, then unit number**, using the same ordering
as the meter round (`lib/meterRound.ts`). Each building header shows its counts (*"Block A — 3 dues ·
2 meters · 1 ticket"*), so one visit covers collection, readings and repairs. During the first week of
the month, the meter round and rent collection for the same building appear together.

### 3.7 Monthly routine calendar — M
**Problem.** The month has a fixed rhythm (meter round in the first days, rent around each tenant's
payment day, month-end books) and recurring chores (water-tank cleaning, fire extinguisher checks,
common-area lights, pest control). None of it is in the app, so it depends on memory.

**Suggestion.** A **Routine** list the admin sets up once: task, frequency (daily / weekly / monthly /
every N months), building, and day. Due items appear in the Today list with a ✓ button that records who
did it and when; overdue ones show in red. Two entries are built in: **Meter round** (from the 1st,
showing the round's progress and any drafts to generate) and **Close day** (3.3).

### 3.8 Upcoming move-outs and lease ends — S
**Problem.** `unit.leaseEnd` is stored but only shown in the admin area. The employee finds out about a
move-out when the tenant leaves, so the move-out checklist, deposit deduction and final invoice are
rushed. Move-ins are covered: Assign Tenant now creates the first invoice and records the opening
reading (2.5).

**Suggestion.** A **"Coming up (30 days)"** card on Home: leases ending, notice given, and planned
transfers, with **📋 Move-out checklist** (Checklist tab pre-filled with the unit) and **🧾 Final
invoice** (pro-rated rent plus the final meter reading, the same maths as the transfer invoice). When the
unit is vacated, offer to mark it ready for the next tenant.

### 3.9 Automatic end-of-day summary to the owner — S
**Problem.** The owner learns about the day by phoning the employee. Telegram already sends invoice and
payment alerts (`lib/notify.ts`, `lib/telegram/`), but there is no daily digest.

**Suggestion.** When the day is closed (3.3), or at a fixed time if it isn't, send one message:
collected today (cash / UPI-bank, from the ledger rows behind *Collected Today*), spent today, cash
counted vs expected, advances recorded, new and resolved tickets, meter round progress, and the top 3
overdue tenants by remaining balance.

### 3.10 Weekly review: how old the dues are — S
**Problem.** Home's Overdue list now shows remaining balances (1.4), but it's still flat. It doesn't show
whether dues are getting older or which tenants are becoming a risk.

**Suggestion.** A weekly view (Monday) with remaining balances in **ageing buckets** (0–30, 31–60, 60+
days), money collected this week vs last week, and tenants whose balance has grown for 2+ months in a
row. Each tenant row shows their follow-up history (3.5) and security deposit, so the employee and owner
can decide on the next step (notice, deposit adjustment, write-off).

---

## 4. Expenses

> **Updated 31 Oct 2026** after a review of `components/employee/ExpensesTab.tsx`,
> `components/employee/DailyLedgerTab.tsx` (➖ Outflow), `components/admin/AdminExpensesTab.tsx`,
> `lib/expenses.ts` and the admin Overview. Items 4.1–4.3 keep their numbers; 4.4–4.15 are new.
> 4.4 and 4.5 are built (marked ✅ below); the table shows the state after them.

There are **three** ways to record money spent today, and they don't agree with each other:

| | 📓 Daily → ➖ Outflow | 💰 Expenses → + Add | Admin → 💸 Expenses |
|---|---|---|---|
| Categories | `labour, material, utilities, repair, other` (lower case) | 19 from `EXPENSE_CATEGORIES` | 19 from `EXPENSE_CATEGORIES` |
| Unit, worker, hours, qty, vendor | ✅ | ❌ | ❌ |
| Receipt opens the camera | ✅ (`capture="environment"`) | ❌ | ❌ |
| Writes | one atomic batch | one atomic batch (4.5) | one atomic batch (4.5) |
| Default date | local (IST) | local (IST) (4.5) | local (IST) (4.5) |
| Closed days (3.3) refused | ✅ | ✅ (4.5) | ✅ (4.5) |
| Delete | soft (reason) + cascade | soft (reason) + cascade, one batch | soft (reason) + cascade (4.4) |

Items, roughly in order of value:

| Group | Items |
|---|---|
| **Fix first** (wrong numbers today) | 4.4, 4.5 |
| **Entering an expense** | 4.1, 4.2, 4.3, 4.9, 4.14 |
| **Where the money came from** | 4.6, 4.7, 4.8 |
| **Planning and reporting** | 4.10, 4.11, 4.12, 4.13, 4.15 |

### 4.1 One place to add an expense — S/M
**Problem.** The three forms above have different fields and categories. The Daily form writes
`category: "labour"` (lower case, not in `EXPENSE_CATEGORIES`) into `expenses`, and the Expenses tab
writes its category lower-cased into `dailyLedger` (`"common area"`, `"staff salary"`). So the
*By Category* breakdowns in Expenses and Monthly split the same spend across two names, and the 📝
fallback emoji appears for Daily outflows.

**Suggestion.**
- One `ExpenseForm` component used by Daily, Expenses and Admin, with one category list
  (`EXPENSE_CATEGORIES` plus *Labour* and *Material*), and the labour / material / vendor / unit fields
  shown by category.
- Store the same category string in both collections (the label, not a lower-cased copy).
- A one-off migration (`scripts/`) maps old values (`labour` → Labour, `repair` → Maintenance, …).

### 4.2 Receipt photo straight from the camera — S
**Problem.** The Expenses and Admin forms use a plain file picker (`accept="image/*,.pdf"`), so on a phone
the employee has to take the photo first and then find it. Photos are uploaded at full size over mobile data.

**Suggestion.** Add `capture="environment"` (the Daily form already has it), compress images in the
browser to about 1600 px / JPEG 0.7 before upload, and show a thumbnail before saving. Optionally make a
receipt **required above an amount** set by the admin (e.g. ₹2,000), with *"No receipt — reason"* as
the escape hatch.

### 4.3 Link expenses to tickets and units — S
**Problem.** The Expenses form has no unit field, and nothing links a repair's cost to its ticket, so
there is no per-unit repair history and no way to see what a ticket cost.

**Suggestion.** When resolving a maintenance ticket, offer **Add cost**, which opens the expense form with
`ticketId`, `unitId`, building and category pre-filled. Show the cost on the ticket and a **🔧 Repairs**
list (total per unit, per year) in the tenant profile. Costs a tenant should pay (damage) get a
**Charge to tenant** toggle that adds the amount to the next invoice.

### 4.4 Deleted expenses still count on the admin side — S (bug)
> ✅ **Done (31 Oct 2026).** The admin page keeps every expense doc for audit but passes only live ones to
> the Overview, the monthly export and the Expenses totals. Admin ✕ is now a soft delete with a reason that
> cascades to the `dailyLedger` mirror in one batch; **Show N deleted** lists deleted expenses (struck
> through, with who, when and why). A banner lists Daily-ledger outflows whose expense was hard-deleted
> earlier (or soft-deleted without the cascade) with **Remove from Daily ledger**, which soft-deletes them
> with a reason. Helpers in `lib/expenseWrite.ts`.

**Problem.** The admin page loads `expenses` without filtering `deleted`, so **soft-deleted expenses are
still included** in *Total spent*, the per-category totals and the Overview's revenue-minus-expenses
figure. The admin's 🗑 is a **hard delete** that leaves the mirrored `dailyLedger` outflow behind, so
the Daily tab and day close still deduct money that no longer exists as an expense.

**Suggestion.** Filter `deleted` in the admin listener (as the employee page does), switch the admin
delete to the same soft delete with reason and cascade, and add a **Show deleted** toggle for audit.
A one-off check lists `dailyLedger` outflows whose `expenseId` no longer exists.

### 4.5 Atomic writes and local dates on the Expenses form — S (bug)
> ✅ **Done (31 Oct 2026).** Employee and admin forms build both documents with `buildExpenseWrite`
> (pre-minted, cross-linked ids) and commit them in one `writeBatch`; soft deletes of an expense and its
> mirror are one batch too. Default and filter dates use the local date. Adding or deleting an expense on
> a closed day is refused with *"… is closed in the Daily ledger"*.

**Problem.** The Expenses tab writes the expense, then the ledger row, then the back-link as three
separate calls; a dropped connection in between leaves an expense with no Daily row (or a Daily row with
no back-link, so deleting the expense doesn't cascade). Default dates use `toISOString()` (UTC), so an
expense logged between midnight and 05:30 IST lands on the previous day — and can land on a day that is
already closed (3.3).

**Suggestion.** Use one `writeBatch` with pre-minted ids (as the Daily form does), `localDateKey()` for
dates, and refuse dates that are already closed, like the Daily form.

### 4.6 Record who paid and from where — S/M
**Problem.** An expense doesn't say whether it was paid from **cash in hand**, by the employee's own
**UPI**, from the **owner's fund**, or directly by the **owner**. The day close (3.3) therefore treats
every outflow as cash, which is wrong for a UPI payment to a vendor, and reimbursing the employee's own
money is not tracked.

**Suggestion.** Add `paidFrom: cash | upi | fund | owner` (default cash) and `paidBy` (staff email).
Only `cash` reduces expected cash in the day close; `upi` is listed next to UPI inflows for statement
matching; `owner` is recorded for books but not in the employee's cash. Show *"₹X owed to <employee>"*
for money paid personally until it is reimbursed.

### 4.7 Make the fund and "settled" clear — M
**Problem.** *Settled* means *"deducted from the allocated fund"*, but the button is next to every
expense and nothing says who approved it. The fund summary ignores the building on allocations, so a
building's fund can look healthy while it is overspent. Deleting an allocation is a hard delete behind
`window.confirm`, and edits keep no previous value.

**Suggestion.** Rename *Settle* to **Approve** (or *Reimburse* for money paid personally — 4.6), show the
fund **per building** as well as in total, soft-delete allocations with a reason, and keep an edit
history (`history[]`, as day closes do). Show the fund balance on Home for the admin.

### 4.8 Approval for large expenses — S/M
**Problem.** Any staff member can log and settle an expense of any size; the admin only finds out by
looking at the list.

**Suggestion.** An admin-set threshold (`settings/expenses.approvalLimit`). Above it the expense is saved
as **Awaiting approval**, the admin gets a Telegram message (reusing `lib/telegram`) with Approve / Reject
buttons or a link, and only approved expenses count against the fund. Firestore rules stop staff from
approving their own large expenses.

### 4.9 Edit an expense instead of delete + re-add — S
**Problem.** There is no edit. A wrong amount or category means deleting (with a reason) and typing it
all again, which also loses the receipt link.

**Suggestion.** ✏️ Edit on unsettled expenses (amount, category, building, description, date, receipt),
updating the `dailyLedger` mirror in the same batch and keeping `editedBy`, `editedAt` and the previous
values. Approved/settled expenses and closed days need an admin to change.

### 4.10 Recurring expenses — M
**Problem.** Salaries, internet, building electricity, water, security and property tax are paid every
month or year and typed in by hand each time — easy to forget or enter twice.

**Suggestion.** **Recurring expense** templates (amount, category, building, payee, day of month or
yearly date). On the due day they appear in Home → Today (with the routine calendar, 3.7) as
*"Internet ₹999 due — ✓ Paid"*; one tap logs the expense from the template. A missed month shows as
overdue.

### 4.11 Vendors and workers — S/M
**Problem.** Vendor and worker names are free text (Daily form only), so the same plumber appears as
*Ramesh*, *ramesh plumber* and *Ramesh Kumar*, and there is no phone number to call him back.

**Suggestion.** A small **vendors** list (name, trade, phone, UPI id) with autocomplete in the expense
form, and a vendor page with total paid, last job and receipts. For daily labour, show total hours and
amount per worker per month for wage settlement.

### 4.12 Budgets and spend per building — M
**Problem.** There is no target to compare against. The Monthly overview shows expenses by category but
not against collections, so it isn't obvious whether a building made money this month.

**Suggestion.** Monthly budget per building (and optionally per category), with *"₹18,400 of ₹25,000
used"* and a warning above 80 % / 100 %. In Monthly, show **Collected − Spent = Net** per building, and
the top spending categories against last month.

### 4.13 Find expenses quickly — S
**Problem.** The All view renders every expense ever logged in one scrolling box, with no search. Finding
*"the tank cleaning in August"* means scrolling.

**Suggestion.** Search by description, vendor, amount or category; filters for building and category;
and paging (*Show more*), as in Settled Collections. Load only the last few months by default (7.1).

### 4.14 Warn about duplicates — S
**Problem.** The same expense is sometimes entered twice — once from Daily and once from Expenses, or by
two staff members.

**Suggestion.** Before saving, look for an expense with the same amount and building within ±1 day (and a
similar description) and ask *"Looks like ₹1,200 Plumbing on 30 Oct by Ravi — save anyway?"*.

### 4.15 Export for the accountant — S
**Problem.** The admin Overview exports financials for a month, but there is no expense export with
receipts that an accountant can use.

**Suggestion.** **⬇️ Export** in Expenses (and Admin) for a date range: CSV with date, building, unit,
category, vendor, amount, paid from, approved by and receipt link, plus a per-category summary sheet.

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
> ✅ **Done (31 Oct 2026).** Fixed bottom bar **🏠 Home · 💳 Collect · 📓 Books · 🔧 Tasks · ☰ More** (`components/employee/EmployeeNav.tsx`, groups in `lib/employeeNav.ts`), with a segmented switch for the screens of the current group (Collections | Monthly, Daily | Expenses | Ledger, Open | Done) and a **More** sheet (Meter, Units, Occupancy, Checklist, Inventory, Help). Red counts: pending invoices, open tickets, units needing a reading. The screen is kept in the URL (`/employee?tab=meter`, so links work) and remembered on the device (`localStorage`; per device rather than per user, since the device is personal). Ledger history sits under Books as suggested.

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
> ✅ **Done (31 Oct 2026)** for the employee dashboard: every `alert` / `confirm` / `prompt` in `app/employee` and `components/employee` (≈70) now uses `components/ui/Dialogs.tsx` — **toasts** (success / error, optional action), **confirm** dialogs (destructive button on the right, red) and a **reason** dialog with one-tap reasons (*Duplicate entry, Wrong amount, Wrong date, Wrong building / unit, Entered by mistake*; write-offs get their own list). The host is mounted on the employee and admin pages; elsewhere the helpers fall back to the browser dialogs. **Undo** is offered after settling / un-settling an expense. Not done: Undo after soft-deletes — Firestore rules freeze deleted rows for staff (only an admin can restore), so the reason dialog is the safety step instead; the admin pages' own pop-ups are unchanged.

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
> ✅ **Done (31 Oct 2026).** All 29 number fields on the employee screens open the number pad (`inputMode="decimal"`); card actions (Today, Monthly, Collections, Daily, Expenses) are at least 44 px tall; dialogs are capped to the screen height with the Cancel/Save row pinned to the bottom (`Modal` plus the hand-built dialogs); the Daily ➖ Outflow and Expenses forms start with the last-used building (`lib/prefs.ts`). The Meter tab has no building picker — the round already walks building by building — so there is nothing to remember there.

**Suggestion.**
- Use `inputMode="numeric"` on amount and meter fields so the number pad opens.
- Use larger tap targets (at least 44px) on the action buttons in cards. Several are `text-[10px]` now.
- Keep the **Save** button fixed to the bottom of long modals so it isn't hidden behind the keyboard.
- Remember the last-used **building** in the Daily, Meter and Expenses forms.

### 6.4 Clean up inline editors in the tenant profile — S
> ✅ **Done (31 Oct 2026).** `components/employee/ProfileBillingForm.tsx`: labelled Payment day, Security deposit and Electricity rate fields with validation and **one Save** (disabled until something changes), saving only what changed (empty clears a field) and confirming with a toast. No more `document.getElementById`.

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
| **Quick wins (1 week)** | ✅ 1.1, ✅ 1.2, ✅ 1.4, ✅ 1.6, ✅ 2.2, ✅ 2.4, ✅ 3.1, ✅ 3.5, 3.8, ✅ 4.4, ✅ 4.5, 4.2, 4.9, 4.13, ✅ 6.3, 7.3 | Correct numbers, fewer data errors, faster daily use |
| **Workflow (2–3 weeks)** | ✅ 1.3, 1.5, ✅ 2.1, ✅ 2.3, 4.1, 4.6, 4.14, ✅ 6.2 | One payment path, fast meter rounds, receipts |
| **Structure (3–4 weeks)** | ✅ 3.2, ✅ 3.3, 3.6, 3.9, ✅ 6.1, 7.1, 4.3, 4.7, 4.12 | Today list grouped by building, tracked day close with owner digest, simpler navigation, faster load |
| **Later** | ✅ 2.5, ✅ 3.4, 3.7, 3.10, 5.x, 7.2, 4.8, 4.10, 4.11, 4.15 | Routine calendar, ageing review, automation and offline support |

✅ = done. 2.5 and 3.4 were brought forward.
