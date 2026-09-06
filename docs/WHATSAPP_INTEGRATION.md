# WhatsApp Integration — Design & Rollout Plan

This document describes how the Property Manager app will use **WhatsApp** to
notify tenants, managers and admins about invoicing and payment events.

Status: **Design proposal** — not yet implemented.

---

## 1. Goals

| # | Event | Recipient | Purpose |
|---|-------|-----------|---------|
| G1 | Manager generates a monthly invoice (via **Meter** tab or *+ Generate Invoices*) | **Tenant** | Bill delivered instantly on WhatsApp with amount, due date, UPI link |
| G2 | Manager generates a custom / single invoice | **Tenant** | Same as G1 |
| G3 | Tenant pays online (UPI txn recorded) | **Admin + Manager** | Confirm receipt, keep books reconciled |
| G4 | Manager records walk-in payment (📓 Daily → ➕ Inflow, auto-settle) | **Admin** | Owner is informed cash was collected |
| G5 | Manager clicks *✓ Settle* on **Collections** tab (Mark as Paid) | **Admin** | Owner is informed invoice was cleared, with UPI / bank / cheque ref |
| G6 | Partial payment applied | **Admin + Tenant** | Balance still due is communicated |
| G7 | Invoice becomes overdue (T+5 days after billingPeriod end) | **Tenant** | Automatic reminder |

---

## 2. Provider Choice

We will use the **WhatsApp Business Cloud API** (Meta-hosted, no BSP required for MVP).

| Provider | Pros | Cons |
|----------|------|------|
| **Meta Cloud API** *(recommended)* | Free tier (1000 conversations/mo), direct from Meta, official templates, HTTPS webhooks | Requires Facebook Business Manager + verified number |
| Twilio WhatsApp | Fast onboarding, single dashboard for SMS + WA | Per-message cost on top of Meta cost |
| Gupshup / AiSensa | India-focused, INR billing, templates pre-approved | Extra vendor, extra dashboard |

If Meta onboarding stalls, we fall back to **Twilio** — the abstraction in §5
means only one file changes.

---

## 3. Prerequisites

1. Verified business phone number in **Meta Business Manager**.
2. WhatsApp Business Account (WABA) linked to the app's Meta app.
3. **Approved message templates** (see §6). Utility category is enough for our
   flows (billing + payment confirmations).
4. Permanent access token (System User) stored as `WHATSAPP_TOKEN`.
5. Webhook verify token stored as `WHATSAPP_VERIFY_TOKEN`.

### Environment variables (Vercel → Project → Settings → Environment Variables)

```env
WHATSAPP_PHONE_ID=1234567890
WHATSAPP_TOKEN=EAAG…                # never exposed to client
WHATSAPP_VERIFY_TOKEN=some-long-random-string
WHATSAPP_ADMIN_NUMBERS=+9198…,+9199…   # comma-separated E.164 numbers
WHATSAPP_FROM_DISPLAY=Property Manager
```

---

## 4. Data Model Changes

### 4.1 `users` collection (new fields)

```ts
{
    // existing fields …
    whatsappNumber?: string;      // E.164, e.g. "+919812345678"
    whatsappOptIn?: boolean;      // required by Meta policy
    whatsappOptInAt?: string;     // ISO timestamp
}
```

### 4.2 `settings/whatsapp` document (new)

```ts
{
    enabled: boolean;
    adminNumbers: string[];       // duplicated from env, editable by admin UI
    templates: {
        invoiceCreated: string;   // template name registered with Meta
        paymentReceived: string;
        paymentPartial: string;
        overdueReminder: string;
    }
}
```

### 4.3 `waMessages` collection (audit log)

Every outbound send is logged for debugging + non-repudiation.

```ts
{
    to: string;                   // E.164
    templateName: string;
    variables: string[];
    relatedInvoiceId?: string;
    relatedLedgerId?: string;
    direction: "outbound";
    status: "queued" | "sent" | "delivered" | "read" | "failed";
    providerMessageId?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
}
```

---

## 5. Server-Side Architecture

All WhatsApp calls happen **server-side** (never from the browser) so the
token never leaks.

### 5.1 New files

| File | Purpose |
|------|---------|
| `lib/whatsapp/client.ts` | Thin wrapper around `POST /messages` — takes `{ to, template, variables }` and returns provider message id |
| `lib/whatsapp/templates.ts` | Named senders — `sendInvoiceCreated()`, `sendPaymentReceived()`, `sendPaymentPartial()`, `sendOverdueReminder()` |
| `lib/whatsapp/recipients.ts` | Helpers — `resolveTenantNumber(unitId)`, `getAdminNumbers()` |
| `app/api/whatsapp/webhook/route.ts` | Meta webhook — GET (verification), POST (delivery status updates) |
| `app/api/notifications/invoice-created/route.ts` | Called by admin/manager UI after `addDoc("invoices", ...)` |
| `app/api/notifications/payment-recorded/route.ts` | Called after a manual settle or auto-settle |

### 5.2 Call sites in existing code

| Existing action | New call |
|-----------------|----------|
| `handleConfirmInvoices` (admin, Meter tab) | after `batch.commit()` → `POST /api/notifications/invoice-created` for each new invoice |
| `handleCreateCustomInvoice` | same |
| Single-invoice generator | same |
| `CollectionsTab.handleConfirmSettle` | after write → `POST /api/notifications/payment-recorded` (mode: full) |
| `DailyLedgerTab` auto-settle branch | after invoice update → same endpoint (mode: full or partial) |
| Tenant online UPI payment success | same endpoint (mode: online) |

Notification endpoints are fire-and-forget from the client's perspective —
failure to send WhatsApp must **never** roll back the Firestore write.

---

## 6. Template Definitions

All templates are registered as **Utility** category in Meta Business Manager.
Variables are positional (`{{1}}`, `{{2}}`, …).

### 6.1 `invoice_created`

> 🧾 *Namaste {{1}},*
>
> Your invoice for **{{2}}** is ready:
> - Rent: ₹{{3}}
> - Electricity: ₹{{4}}
> - **Total due: ₹{{5}}**
>
> Please pay by **{{6}}**.
> Tap here to pay via UPI: {{7}}
>
> — {{8}}

Variables: `tenantName, billingPeriod, baseRent, electricityCharge, totalAmount, dueDate, upiDeepLink, payeeName`.

### 6.2 `payment_received`

> ✅ *Payment received*
>
> Unit **{{1}}** ({{2}}) — ₹{{3}} received on {{4}}.
> Mode: {{5}} · Ref: {{6}}
> Invoice **{{7}}** is now marked **PAID**.

Sent to admin numbers + tenant. Variables: `unitNumber, tenantName, amount, dateISO, mode, reference, billingPeriod`.

### 6.3 `payment_partial`

> 💵 *Partial payment*
>
> Unit **{{1}}** ({{2}}) — ₹{{3}} received. Remaining balance ₹{{4}} on invoice {{5}}.

### 6.4 `overdue_reminder`

> ⏰ *Friendly reminder*
>
> Invoice for **{{1}}** (₹{{2}}) is now overdue by {{3}} day(s).
> Please clear at your earliest — {{4}}.

Sent by a daily Vercel cron job (see §8).

---

## 7. End-to-End Flows

### 7.1 Invoice creation (G1, G2)

```
Manager → Admin Dashboard
      │
      ▼
+ Generate Invoices  /  ⚡ Single Invoice  /  + Custom Bill
      │
      ▼
addDoc("invoices", …)
      │
      ▼
POST /api/notifications/invoice-created  { invoiceId }
      │
      ▼
lib/whatsapp/templates.sendInvoiceCreated(invoice, tenantNumber)
      │
      ▼
Meta Cloud API  →  Tenant's WhatsApp
      │
      ▼
addDoc("waMessages", { status: "queued", … })
```

### 7.2 Payment settlement (G3, G4, G5)

```
Manager → Collections → ✓ Settle
   OR    Daily Ledger → ➕ Inflow (auto-settle)
   OR    Tenant → Online UPI pay
      │
      ▼
invoices/{id}.status = "paid" (or amountPaid += x)
ledger.add(…)
      │
      ▼
POST /api/notifications/payment-recorded  { invoiceId, mode, reference, applied, fully }
      │
      ▼
        ┌── sendPaymentReceived( admin+tenant )   if fully
        └── sendPaymentPartial ( admin+tenant )   if partial
```

---

## 8. Overdue Reminder Cron (G7)

Vercel Cron entry in `vercel.json`:

```json
{
    "crons": [
        { "path": "/api/notifications/overdue-sweep", "schedule": "0 4 * * *" }
    ]
}
```

The sweep endpoint:

1. Loads all `invoices` where `status ∈ { "unpaid", "pending" }`.
2. For each, computes `daysOverdue` from `billingPeriod`.
3. If `daysOverdue > 5` and no reminder was sent in the last 7 days
   (checked via `waMessages` audit log), sends `overdue_reminder`.

---

## 9. Opt-In & Compliance

Meta requires **explicit tenant opt-in** before we may send Utility templates.

1. On first login the tenant sees a modal:
   > *"Get bills and payment updates on WhatsApp?"* — [Yes, opt me in] / [No, thanks]
2. On *Yes* → we set `users/{uid}.whatsappOptIn = true` + `whatsappNumber` and
   send a one-time `hello_world` welcome template.
3. Tenant can revoke from **My Profile → Notifications**.
4. Every template ends with a footer *"Reply STOP to unsubscribe"* — the
   webhook must honour STOP and set `whatsappOptIn = false`.

---

## 10. Rollout Plan

| Phase | Scope | Est. effort |
|-------|-------|-------------|
| **P1** | Provider setup + `lib/whatsapp/client.ts` + `waMessages` log + hello_world verification | 1 day |
| **P2** | `invoice_created` template + hook into all 3 invoice-creation code paths | 1 day |
| **P3** | `payment_received` + `payment_partial` templates + hook into Collections settle + Daily Ledger auto-settle | 1 day |
| **P4** | Opt-in modal + revocation UI + webhook STOP handling | 1 day |
| **P5** | Overdue cron + admin dashboard tile *"WhatsApp delivery health"* (reads `waMessages`) | 1 day |

---

## 11. Open Questions

1. Should the tenant receive **one** message per invoice (current plan) or a
   **daily digest** if multiple invoices are generated together?
2. Do admins want a **single group chat** message vs individual DMs to each
   admin number? (Meta does not support group send via API — we would send
   the same message to each admin number in `WHATSAPP_ADMIN_NUMBERS`.)
3. Should overdue reminders escalate — e.g. day 5 to tenant, day 10 to
   admin+tenant, day 15 late-fee auto-applied?
4. Language: keep English-only for MVP, add Hindi templates in P6?

---

## 12. Related Documents

- [`docs/EMPLOYEE_WORKFLOW.md`](./EMPLOYEE_WORKFLOW.md) — employee/manager daily workflow
- [`docs/MANAGER_ACTIONS.md`](./MANAGER_ACTIONS.md) — walk-in payment playbook

---

*Last updated: 5 Sep 2026*
