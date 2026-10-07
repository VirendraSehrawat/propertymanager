# Engineering Backlog — Property Manager

*Generated: 7 October 2026 (from a full codebase scan)*

This backlog translates the current state of the codebase into prioritized,
actionable engineering work. It complements `docs/IMPROVEMENT_PLAN.md`
(product-level opportunities) and `docs/REFACTOR_PLAN.md` (maintainability
tracking) by framing items as deliverable stories with acceptance criteria.

**Stack snapshot:** Next.js 16 (App Router) · React 19 · TypeScript 5 ·
Firebase (Auth + Firestore + Admin) · Cloudinary · Vitest 4 · Tailwind 4 ·
deployed on Vercel.

## Legend

- **Priority:** P0 (critical/now) · P1 (high) · P2 (medium) · P3 (nice-to-have)
- **Size:** S (<½ day) · M (1–2 days) · L (3–5 days) · XL (>1 week)
- **Type:** 🐛 Bug · 🔒 Security · 🧪 Testing · 🧹 Tech Debt · ✨ Feature · ⚙️ DevOps · 📈 Observability · 📚 Docs

---

## Epic A — Code Quality & Maintainability

| ID | Title | Type | Priority | Size | Status |
|----|-------|------|----------|------|--------|
| A1 | Extract `UnitsTab` from `app/employee/page.tsx` | 🧹 | P2 | M | ✅ Done (already extracted & wired) |
| A2 | Reduce `app/employee/page.tsx` (1,133 lines) to a shell/tab-router (~250 lines) | 🧹 | P2 | L | ⏳ Open |
| A3 | Remove remaining `any` / `no-explicit-any` in `CollectionsTab.tsx` & `DailyLedgerTab.tsx` using typed fields | 🧹 | P1 | S | ✅ Done |
| A4 | Enable `noUncheckedIndexedAccess` in `tsconfig.json`; fix fallout (`strict` already on) | 🧹 | P1 | M | ⏳ Open (~67 errors scoped) |
| A5 | Centralize Firestore collection names (`lib/collections.ts` + `COL`) | 🧹 | P2 | M | 🟡 Module added + wired into touched files; migrate remaining call sites |
| A6 | Extract shared money/rounding helpers (`lib/money.ts` + tests) | 🧹🐛 | P1 | M | ✅ Module + 8 tests added; roll out to displays incrementally |

**A3 acceptance:** no `eslint-disable @typescript-eslint/no-explicit-any`
remains in `components/`; `npm run lint` and `npm run typecheck` pass clean.
**Status:** met — both files are `any`-free; typecheck and lint clean.

### Epic A — this pass (changelog)

- **A3:** removed all `any` from `CollectionsTab.tsx` (typed `editInvoice` as
  `Invoice | null`, dropped `(inv as any)` field casts, typed the settled-rows
  `Map`) and `DailyLedgerTab.tsx` (added `expenseId` to the local entry type,
  typed the write payload as `Record<string, unknown>`). Deleted the
  file-level `eslint-disable` directives.
- **A5:** added `lib/collections.ts` exporting a typed `COL` map; migrated every
  collection literal in the two touched files to `COL.*`. Remaining pages/
  components still use string literals — migrate opportunistically.
- **A6:** added `lib/money.ts` (`toNumber`, `toAmount`, `roundRupees`,
  `roundPaise`, `formatRupees`) with `__tests__/money.test.ts` (8 tests, green).
  Call sites still use inline `Number(...)`/`toLocaleString` — swap in the
  helpers as files are touched.
- **A1:** confirmed `components/employee/UnitsTab.tsx` is already extracted and
  wired via `components/employee/index.ts`.
- **A4:** measured — `noUncheckedIndexedAccess` surfaces ~67 errors (many in
  tests, fixable with non-null assertions). Left disabled to keep the build
  green; tackle as a dedicated pass.

---

## Epic B — Testing & Quality Gates

Current suite: `allocation`, `lumpsum`, `payments`, `masterAllocation`,
`transfer`, `telegram`, `cloudinary`, `ledgerSync`, `expenses`, `integration`.
Strong on pure allocation math; thin on API routes, rules, and UI flows.

| ID | Title | Type | Priority | Size | Status |
|----|-------|------|----------|------|--------|
| B1 | Add Firestore **security-rules tests** (`@firebase/rules-unit-testing`) covering tenant self-settle guard, soft-delete tamper, role escalation | 🧪🔒 | P0 | L | 🟡 Partial — `__tests__/rules.test.ts` covers financial soft-delete/provenance (C5); tenant self-settle + role escalation still to add |
| B2 | Integration test: lump-sum inflow through Daily Ledger iterating multiple invoices (noted pending in REFACTOR_PLAN §1) | 🧪 | P1 | M | ⏳ Open |
| B3 | Unit tests for API routes (`/api/notifications/*`, `/api/telegram/*`, `/api/uploads/cloudinary`) incl. auth & error paths | 🧪 | P1 | M | ⏳ Open |
| B4 | Add coverage reporting (`vitest --coverage`) with a threshold gate in CI | 🧪⚙️ | P2 | S | ⏳ Open |
| B5 | Component tests for `CollectionsTab` settle flow & carry-forward preview (React Testing Library) | 🧪 | P2 | M | ✅ Done |
| B6 | Expand CI workflow to also run `lint` and (optionally) full emulator `test` on PRs | ⚙️ | P1 | S | ⏳ Open |

**B1 acceptance:** rule tests assert a tenant cannot set `status:"paid"`,
cannot exceed `totalAmount`, cannot edit financial fields, and cannot change
their own `role`.

### B5 — this pass (changelog)

- Added React Testing Library toolchain: `@testing-library/react`,
  `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`
  (devDependencies).
- `vitest.config.mts` now loads `__tests__/setup.ts`, a jsdom-guarded setup
  that registers jest-dom matchers + RTL auto-cleanup only when a DOM exists —
  so the node-based emulator suites are unaffected.
- `__tests__/CollectionsTab.test.tsx` (4 tests, jsdom via docblock):
  - full settlement → invoice flipped to `paid`, ledger row written, Telegram
    notification fired with the right amount;
  - partial payment → invoice stays `pending`, `partial-payment` ledger row,
    `fully:false` notification;
  - carry-forward preview surfaces a previous-month unpaid invoice for the
    correct unit/period;
  - empty-state when there are no previous-month dues.
- Firestore + notify side-effects are mocked, so tests assert on produced
  payloads, not real writes.
- Added the component test to the fast `npm run test:unit` script.

---

## Epic C — Security & Access Control

| ID | Title | Type | Priority | Size | Status |
|----|-------|------|----------|------|--------|
| C1 | Remove hardcoded `admin@test.com` / `employee@test.com` backdoors from `firestore.rules` and rules helpers before production | 🔒 | P0 | S | ⏳ Open |
| C2 | Move role authority to **Firebase custom claims** only; stop trusting `users/{uid}.role` reads in rules | 🔒 | P1 | M | ⏳ Open |
| C3 | Verify & lock down API routes with `lib/serverAuth.ts` — ensure every route checks ID token + role server-side | 🔒 | P0 | M | ⏳ Open |
| C4 | Validate & sanitize all request bodies (zod) in API routes incl. Telegram webhook signature verification | 🔒 | P1 | M | ⏳ Open |
| C5 | Harden rules so soft-delete/financial audit fields (`deletedBy`, `settledBy`, `amountPaid`) cannot be client-tampered | 🔒 | P1 | M | ✅ Done |
| C6 | Add granular roles (e.g. read-only `accountant`) per IMPROVEMENT_PLAN #16 | ✨🔒 | P3 | M | ⏳ Open |
| C7 | Secrets audit: confirm Cloudinary/Firebase Admin creds are server-only; add `.env.example` if missing | 🔒📚 | P1 | S | ⏳ Open |

**C1 is a release blocker** — the test-email bypass grants admin to anyone
able to authenticate with those addresses.

### C5 — this pass (changelog)

- Added financial/audit-integrity helpers to `firestore.rules`: `keeps(key)`,
  `provenanceIntact()`, `wasSoftDeleted()`, `willBeSoftDeleted()`,
  `softDeleteAudited()`, `financialUpdateOk()`.
- Hardened `expenses`, `dailyLedger`, `ledger` and `ledgerEntries`:
  - provenance (`createdAt`/`createdBy`) is immutable on update;
  - every transition into `deleted:true` must carry `deletedBy` + `deletedAt`;
  - already-deleted rows are frozen for staff (admin may restore);
  - physical deletes are **admin-only** so the default path is a reversible
    soft-delete;
  - `ledger`/`ledgerEntries` pin `settledBy`, `tenantEmail`, `invoiceId` and
    `invoiceAmount` so corrections can only touch `amountPaid`/`balance`/the
    correction audit fields.
- Fixed a latent gap: `ledgerEntries` (written by the corporate master-invoice
  flow) had **no rule** and was denied by default — now covered.
- Added `__tests__/rules.test.ts` (11 `@firebase/rules-unit-testing` cases,
  all green against the emulator).

---

## Epic D — Notifications & Automation

Routes exist (`/api/notifications/invoice-created`, `payment-recorded`) and a
Telegram client is implemented. Scheduling/reminders are not.

| ID | Title | Type | Priority | Size |
|----|-------|------|----------|------|
| D1 | Scheduled **overdue-invoice reminders** (T+N days) via Vercel Cron → Telegram | ✨ | P1 | M |
| D2 | **Recurring invoice generation** cron so billing doesn't depend on employee opening Meter tab | ✨ | P1 | L |
| D3 | Add **email channel** (invoice/receipt) as a fallback alongside Telegram | ✨ | P2 | M |
| D4 | WhatsApp integration (designed in `docs/WHATSAPP_INTEGRATION.md`, not built) | ✨ | P2 | L |
| D5 | Delivery/retry + dead-letter handling for notification sends; log failures | 📈 | P2 | M |
| D6 | **Lease-renewal reminders** surfacing `leaseEnd` proactively | ✨ | P2 | M |

---

## Epic E — Invoicing & Payments

| ID | Title | Type | Priority | Size |
|----|-------|------|----------|------|
| E1 | **Printable/downloadable receipts** (PDF) — called out as roadmap in `MANAGER_ACTIONS.md` | ✨ | P1 | M |
| E2 | Auto-split a lump sum across *all* pending invoices (not just oldest) in the Daily Ledger flow | ✨🐛 | P1 | M |
| E3 | Configurable **late-fee automation** rule engine | ✨ | P2 | M |
| E4 | Online payment gateway (Razorpay) to replace manual UPI txn-id + screenshot verification | ✨ | P2 | XL |
| E5 | Master-invoice PDF generation (`MasterInvoice.pdfUrl` is declared but unused) | ✨ | P2 | M |
| E6 | Idempotency guards on invoice generation to prevent duplicate invoices per unit/month | 🐛 | P1 | M |

---

## Epic F — Reporting, Observability & Data

| ID | Title | Type | Priority | Size |
|----|-------|------|----------|------|
| F1 | Dashboard **charts** (income vs expense, occupancy, collection efficiency) | ✨ | P2 | L |
| F2 | Scheduled financial exports (monthly P&L CSV/Excel emailed) | ✨ | P2 | M |
| F3 | **Audit-log viewer** in Admin UI surfacing existing soft-delete metadata | ✨ | P2 | M |
| F4 | Add structured **error logging/monitoring** (Sentry) across client + API routes | 📈 | P1 | M |
| F5 | **Automated backup verification** job per `docs/BACKUP_AND_RESTORE.md` | ⚙️ | P2 | M |
| F6 | Bulk tenant/unit **CSV import** for portfolio onboarding | ✨ | P3 | M |

---

## Epic G — UX & Accessibility

| ID | Title | Type | Priority | Size |
|----|-------|------|----------|------|
| G1 | **PWA / offline support** for employees collecting cash with poor connectivity | ✨ | P2 | L |
| G2 | Global **search** across tenants/units/invoices | ✨ | P3 | M |
| G3 | **Multi-language** (Hindi/regional) toggle on tenant screens | ✨ | P3 | L |
| G4 | Accessibility pass (focus states, aria labels, `Modal` focus-trap) + mobile responsiveness review | 🧹 | P2 | M |
| G5 | Loading/empty/error state consistency across tabs (reuse `LoadingSpinner`) | 🧹 | P3 | S |

---

## Epic H — DevOps & Platform

| ID | Title | Type | Priority | Size |
|----|-------|------|----------|------|
| H1 | Verify CI (`.github/workflows/test.yml`) runs typecheck + unit tests on every PR; add status badge | ⚙️ | P2 | S |
| H2 | Add preview-deploy gate + required checks before merge to `main` | ⚙️ | P2 | S |
| H3 | Dependency & vulnerability scanning (Dependabot / `npm audit` in CI) | ⚙️🔒 | P2 | S |
| H4 | Document env vars in `.env.example`; verify README setup steps end-to-end | 📚 | P1 | S |
| H5 | Add Firestore composite **index definitions** to repo (`firestore.indexes.json`) to prevent runtime query failures | ⚙️🐛 | P1 | S |

---

## Suggested near-term sprint (2 weeks)

Focus: close production-blocking security gaps and tighten quality gates.

1. **C1** — remove test-email backdoors (P0)
2. **C3** — server-side auth on all API routes (P0)
3. **B1** — Firestore security-rules tests (P0)
4. **A3** — kill remaining `any` in components (P1)
5. **H4 / H5** — env docs + committed Firestore indexes (P1)
6. **E6** — invoice-generation idempotency (P1)
7. **F4** — error monitoring wired in (P1)

## How to use this backlog

- Treat each **ID** as a ticket handle; copy the row into your issue tracker.
- `IMPROVEMENT_PLAN.md` numbering is preserved thematically but re-prioritized
  here against current code reality (e.g. several REFACTOR_PLAN splits are now
  done; `UnitsTab` remains).
- Re-scan and regenerate after each sprint to keep sizes/priorities honest.
