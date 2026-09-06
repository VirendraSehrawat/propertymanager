# Telegram Integration — Design & Rollout Plan

This document describes how the Property Manager app will use **Telegram**
to notify tenants, managers and admins about invoicing and payment events.

Status: **Design proposal** — not yet implemented.

Telegram is proposed as a **lighter-weight, free alternative** to the
[WhatsApp integration](./WHATSAPP_INTEGRATION.md). Both can co-exist — tenants
pick their preferred channel in their profile.

---

## 1. Goals

Same event matrix as WhatsApp (§1 of `WHATSAPP_INTEGRATION.md`):

| # | Event | Recipient | Purpose |
|---|-------|-----------|---------|
| G1 | Manager generates a monthly invoice | **Tenant** | Bill delivered instantly with UPI deep-link |
| G2 | Custom / single invoice generated | **Tenant** | Same as G1 |
| G3 | Tenant pays online (UPI txn) | **Admin + Manager** | Confirm receipt |
| G4 | Walk-in payment recorded (📓 Daily → ➕ Inflow, auto-settle) | **Admin** | Owner informed of cash collected |
| G5 | Manual settle (Collections → ✓ Settle) | **Admin** | Owner informed, with mode + ref |
| G6 | Partial payment applied | **Admin + Tenant** | Communicate remaining balance |
| G7 | Invoice overdue (T+5 days) | **Tenant** | Automatic reminder |

---

## 2. Why Telegram

| Trait | WhatsApp Cloud API | Telegram Bot API |
|-------|--------------------|------------------|
| **Cost** | Free 1000 conversations/mo, paid after | **Fully free**, unlimited |
| **Onboarding** | Meta Business Manager, phone verification, template approval | Create a bot with `@BotFather` in 60 seconds |
| **Message templates** | Must be pre-approved (Utility / Marketing) | **No pre-approval** — send any message |
| **User opt-in** | Explicit written consent required | User starts the bot by clicking a link → implicit opt-in |
| **Rich content** | Templates + limited buttons | Full Markdown, inline buttons, files, images, deep-links |
| **Group / channel broadcast** | Not supported via API | Native support — one admin channel gets all events |
| **India adoption** | Very high | Medium |

Telegram is **ideal for internal / admin notifications** and a great optional
channel for tech-savvy tenants. It has near-zero setup friction and no
per-message cost, so we can prototype the full flow in a single afternoon.

---

## 3. Prerequisites

1. A Telegram account for the admin/owner.
2. Create a bot:
   - Open Telegram → chat with **`@BotFather`** → `/newbot`
   - Choose a name (`Property Manager Bot`) and a unique username
     (`property_mgr_bot`)
   - Save the **HTTP API token** — this is `TELEGRAM_BOT_TOKEN`.
3. Create a **private admin channel** (e.g. *"Property Ops"*):
   - Add the bot as an **administrator** (needs "Post Messages" permission).
   - Get the channel id via `getUpdates` or by forwarding a message to
     `@userinfobot`. Save as `TELEGRAM_ADMIN_CHAT_ID`
     (looks like `-1001234567890`).
4. (Optional) Set the webhook once at deploy time:

   ```bash
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
        -d "url=https://rental-appartment-theta.vercel.app/api/telegram/webhook" \
        -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```

### Environment variables (Vercel → Project → Settings → Environment Variables)

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF…
TELEGRAM_ADMIN_CHAT_ID=-1001234567890         # admin channel or private chat
TELEGRAM_WEBHOOK_SECRET=some-long-random-string
TELEGRAM_BOT_USERNAME=property_mgr_bot        # used to build the "Start" deep-link
```

---

## 4. Data Model Changes

### 4.1 `users` collection (new fields)

```ts
{
    // existing fields …
    telegramChatId?: number;      // filled in when tenant clicks the deep-link
    telegramUsername?: string;    // filled in from webhook update.message.from
    telegramOptIn?: boolean;      // true once /start is received
    telegramOptInAt?: string;     // ISO timestamp
    telegramLinkCode?: string;    // one-time code used to associate chat ↔ user
}
```

### 4.2 `settings/telegram` document (new)

```ts
{
    enabled: boolean;
    adminChatId: string;          // duplicated from env, editable by admin UI
    silentAdmin: boolean;         // if true, admin messages use disable_notification
    escalation: {
        overdueDaysToTenant: number;   // default 5
        overdueDaysToAdmin: number;    // default 10
    }
}
```

### 4.3 `tgMessages` collection (audit log)

```ts
{
    to: string;                   // chatId
    kind: "invoiceCreated" | "paymentReceived" | "paymentPartial" | "overdue" | "linkPrompt";
    text: string;                 // rendered Markdown
    relatedInvoiceId?: string;
    relatedLedgerId?: string;
    direction: "outbound" | "inbound";
    status: "queued" | "sent" | "failed";
    providerMessageId?: number;
    error?: string;
    createdAt: string;
    updatedAt: string;
}
```

---

## 5. Server-Side Architecture

All Telegram calls happen **server-side** — the bot token never touches the
browser.

### 5.1 New files

| File | Purpose |
|------|---------|
| `lib/telegram/client.ts` | Thin wrapper around `POST https://api.telegram.org/bot<token>/sendMessage` |
| `lib/telegram/messages.ts` | Named senders — `sendInvoiceCreated()`, `sendPaymentReceived()`, `sendPaymentPartial()`, `sendOverdueReminder()`, `sendLinkPrompt()` |
| `lib/telegram/recipients.ts` | Helpers — `resolveTenantChatId(unitId)`, `getAdminChatId()` |
| `app/api/telegram/webhook/route.ts` | Bot webhook — handles `/start <code>`, `/stop`, delivery updates |
| `app/api/notifications/invoice-created/route.ts` | Already introduced by WhatsApp doc — now dispatches to both channels |
| `app/api/notifications/payment-recorded/route.ts` | Same |

### 5.2 Shared dispatcher

To avoid two duplicate notification pipelines, both integrations share the
same dispatcher endpoints:

```
POST /api/notifications/invoice-created
       │
       ▼
   for each preferred channel of tenant:
       ├── if "whatsapp" → lib/whatsapp/templates.sendInvoiceCreated()
       └── if "telegram" → lib/telegram/messages.sendInvoiceCreated()
```

Tenant preference lives on `users/{uid}.notificationChannels: ("whatsapp" | "telegram" | "email")[]`.

Failures on either channel must **never** roll back the Firestore write.

---

## 6. Message Templates

Telegram accepts **MarkdownV2** freely — no pre-approval required.

### 6.1 `invoiceCreated` (→ tenant)

```markdown
🧾 *Namaste {{tenantName}}*

Your invoice for *{{billingPeriod}}* is ready:

• Rent:          ₹{{baseRent}}
• Electricity:   ₹{{electricityCharge}}
• *Total due:    ₹{{totalAmount}}*

Please pay by *{{dueDate}}*.

[💳 Pay via UPI]({{upiDeepLink}})   ·   [🌐 Open Dashboard]({{dashboardUrl}})

— {{payeeName}}
```

Sent as `sendMessage` with `parse_mode: "MarkdownV2"` and an
`inline_keyboard` carrying two URL buttons.

### 6.2 `paymentReceived` (→ admin + tenant)

```markdown
✅ *Payment received*

Unit *{{unitNumber}}*  ({{tenantName}})
Amount: *₹{{amount}}*   ·   Mode: {{mode}}   ·   Ref: `{{reference}}`
Invoice *{{billingPeriod}}* is now marked *PAID*.
```

### 6.3 `paymentPartial` (→ admin + tenant)

```markdown
💵 *Partial payment*

Unit *{{unitNumber}}*  ({{tenantName}})
Received *₹{{amount}}*.  Remaining *₹{{remaining}}* on invoice {{billingPeriod}}.
```

### 6.4 `overdueReminder` (→ tenant, then admin on day 10)

```markdown
⏰ *Friendly reminder*

Invoice for *{{billingPeriod}}* (₹{{amount}}) is now overdue by *{{days}} day(s)*.
Please clear at your earliest.

[💳 Pay via UPI]({{upiDeepLink}})
```

### 6.5 `linkPrompt` (in-app modal deep-link)

When a tenant first opens the app we show a modal:

> *"Get bills and payment updates on Telegram — instantly and free."*
>
> `[Open Telegram]` → link:
> `https://t.me/{{TELEGRAM_BOT_USERNAME}}?start={{linkCode}}`

The `linkCode` is a random string stored on `users/{uid}.telegramLinkCode`.
When the bot receives `/start <linkCode>`, our webhook matches the code to
the user, saves `telegramChatId`, sets `telegramOptIn = true`, and replies:

> ✅ *Linked!* You will now receive bills and payment updates for unit {{unitNumber}} here.

---

## 7. End-to-End Flows

### 7.1 Tenant onboarding

```
Tenant logs in → App shows "Link Telegram?" modal
      │
      ▼
Tap "Open Telegram"  → https://t.me/property_mgr_bot?start=<code>
      │
      ▼
Bot receives /start <code>
      │
      ▼
Webhook: find user by telegramLinkCode →
         set telegramChatId, telegramOptIn = true, clear linkCode
      │
      ▼
Bot replies "✅ Linked!"
```

### 7.2 Invoice creation (G1, G2)

```
Manager → Admin Dashboard
      │
      ▼
+ Generate Invoices / ⚡ Single Invoice / + Custom Bill
      │
      ▼
addDoc("invoices", …)
      │
      ▼
POST /api/notifications/invoice-created  { invoiceId }
      │
      ├── tenant preferred channel = telegram
      │     └── lib/telegram/messages.sendInvoiceCreated(chatId, invoice)
      │
      └── admin channel (always)
            └── lib/telegram/messages.sendInvoiceCreated(adminChatId, invoice)
                (used as "audit copy" — no UPI button)
```

### 7.3 Payment settlement (G3, G4, G5, G6)

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
      ├── if fully   → sendPaymentReceived  (admin channel + tenant chatId)
      └── if partial → sendPaymentPartial   (admin channel + tenant chatId)
```

---

## 8. Overdue Reminder Cron (G7)

Reuses the WhatsApp cron at `/api/notifications/overdue-sweep`:

```json
{
    "crons": [
        { "path": "/api/notifications/overdue-sweep", "schedule": "0 4 * * *" }
    ]
}
```

Escalation (configurable in `settings/telegram`):

- Day > 5 → send `overdueReminder` to tenant
- Day > 10 → also send to admin channel with a CTA button
  *"Apply late fee"* linking to `/admin?action=lateFee&invoice=<id>`
- Day > 15 → auto-generate the late-fee invoice (already implemented in
  `handleApplyLateFees`) and send `invoiceCreated` for the fee

Deduplication: the sweep skips any invoice that already has an outbound
`tgMessages` doc within the last 7 days for the same `kind + invoiceId`.

---

## 9. Webhook Handling

`app/api/telegram/webhook/route.ts` handles these updates:

| Update | Action |
|--------|--------|
| `/start <code>` | Link chat to user; reply "Linked". |
| `/start` (no code) | Reply with instructions to open the app and use the link. |
| `/stop` | Set `telegramOptIn = false`, reply "Unsubscribed. `/start` again anytime." |
| `/help` | Show bot commands. |
| `/status` | Show the linked unit's outstanding balance (queries `invoices`). |
| Any other text | Reply "I only send updates — please contact your manager." |

The endpoint verifies the `X-Telegram-Bot-Api-Secret-Token` header against
`TELEGRAM_WEBHOOK_SECRET` and rejects mismatches with `403`.

---

## 10. Compliance & Trust

Telegram does not enforce Meta-style opt-in policy, but we still follow good
practice:

1. Tenant must **click the deep-link** — that action is the opt-in.
2. `/stop` command is honoured — sets `telegramOptIn = false` immediately.
3. Every message includes a footer:
   > *"You are receiving this because you linked unit {{unitNumber}}. Send `/stop` to unsubscribe."*
4. The bot never initiates a conversation with a user — the first message
   always comes from the tenant (`/start`).

---

## 11. Rollout Plan

| Phase | Scope | Est. effort |
|-------|-------|-------------|
| **P1** | Bot creation + `lib/telegram/client.ts` + `tgMessages` log + `/start` webhook + link modal on tenant login | 1 day |
| **P2** | `invoiceCreated` message + hook into all 3 invoice-creation code paths | 0.5 day |
| **P3** | `paymentReceived` + `paymentPartial` messages + hook into Collections settle + Daily Ledger auto-settle | 0.5 day |
| **P4** | `overdueReminder` cron + escalation to admin channel | 0.5 day |
| **P5** | `/status` command + delivery-health tile on admin dashboard (reads `tgMessages`) | 0.5 day |

Total: ~**3 days**, versus ~5 for WhatsApp (no template approval delay).

---

## 12. Coexistence with WhatsApp

Both channels share the notification dispatcher endpoints. A tenant document
looks like:

```ts
{
    email: "tenant@example.com",
    unitId: "unit-A",
    whatsappNumber: "+9198…",
    whatsappOptIn: true,
    telegramChatId: 12345678,
    telegramOptIn: true,
    notificationChannels: ["telegram", "whatsapp"],   // ordered by preference
}
```

Dispatcher rule: iterate `notificationChannels` in order. If the first
channel returns success, **stop** (avoid double-notifying). If it fails,
fall through to the next channel. Admin always receives via Telegram
(cheapest and free-form).

---

## 13. Open Questions

1. Should admins get **every** payment event, or only *daily digests* to
   avoid a noisy channel?
2. Do we want a `/pay <invoiceId>` command that replies with the UPI
   deep-link on demand?
3. Should the bot expose a `/receipts` command that returns the tenant's
   ledger as a downloadable CSV?
4. Do we mirror `overdueReminder` on both WhatsApp and Telegram when a
   tenant has opted into both, or use the preference order strictly?

---

## 14. Related Documents

- [`docs/WHATSAPP_INTEGRATION.md`](./WHATSAPP_INTEGRATION.md) — WhatsApp Business Cloud API integration
- [`docs/EMPLOYEE_WORKFLOW.md`](./EMPLOYEE_WORKFLOW.md) — employee/manager daily workflow
- [`docs/MANAGER_ACTIONS.md`](./MANAGER_ACTIONS.md) — walk-in payment playbook

---

*Last updated: 5 Sep 2026*
