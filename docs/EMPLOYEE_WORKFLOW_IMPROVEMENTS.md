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

**Done (13):** 1.1, 1.2, 1.3, 1.4, 1.6 · 2.1, 2.2, 2.3, 2.4, 2.5 · 3.1, 3.2, 3.3. Each is marked ✅ in its section with what shipped.
Sections 1 (Collecting money) and 2 (Meter readings and invoicing) are complete except **1.5 Receipts**.

**Next up (open quick wins):** 3.5, 3.8, 6.3, 7.3.

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
| 9 | Replace `alert()` / `confirm()` / `prompt()` with **toasts and in-app dialogs** | Blocking pop-ups slow every save, and some are easy to dismiss by accident | M | Open (6.2) |
| 10 | **Cut the tab bar** from 13 tabs to ~5 primary destinations | Hard to find things on a phone; related work is spread across tabs | M | Open (6.1) |

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
> and move-in invoices (2.1–2.5). Since then 3.1, 3.2 and 3.3 are built (marked ✅ below).

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
> **Not yet in the list** (their features don't exist): promises (3.5), routine chores (3.7), notice periods (3.8) and day close (3.3).

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
**Problem.** `unit.paymentDay` is stored and used for rent periods (and now for the move-in pro-rating),
but nothing uses it to prompt follow-ups. Home's Overdue list is sorted oldest first, which isn't the
same as "who should pay today".

**Suggestion.** Use it to drive the Today list (3.2), and add a sort to Collections: **due today →
overdue → upcoming this week**. If Telegram (`lib/notify.ts`) or WhatsApp is set up for the tenant, send
an automatic reminder the day before and on the day, showing the remaining balance, so the employee
only chases tenants who didn't respond.

### 3.5 Follow-up log and promise-to-pay — S
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
| **Quick wins (1 week)** | ✅ 1.1, ✅ 1.2, ✅ 1.4, ✅ 1.6, ✅ 2.2, ✅ 2.4, ✅ 3.1, 3.5, 3.8, 6.3, 7.3 | Correct numbers, fewer data errors, faster daily use |
| **Workflow (2–3 weeks)** | ✅ 1.3, 1.5, ✅ 2.1, ✅ 2.3, 4.1, 6.2 | One payment path, fast meter rounds, receipts |
| **Structure (3–4 weeks)** | ✅ 3.2, ✅ 3.3, 3.6, 3.9, 6.1, 7.1 | Today list grouped by building, tracked day close with owner digest, simpler navigation, faster load |
| **Later** | ✅ 2.5, 3.4, 3.7, 3.10, 4.3, 5.x, 7.2 | Routine calendar, ageing review, automation and offline support |

✅ = done. 2.5 was brought forward and shipped with the other meter/invoicing items.
