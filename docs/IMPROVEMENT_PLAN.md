# Property Manager — Current Features & Improvement Plan

*Generated: 12 September 2026*

## 1. Current Features (as-is)

The app is a Next.js + Firebase (Firestore/Auth) + Cloudinary rental
management system with three roles: **Admin**, **Employee**, **Tenant**.

| Area | Feature |
|---|---|
| **Auth & Roles** | Google Sign-In, role-based routing (`admin`/`employee`/`tenant`), role stored in `users` collection |
| **Buildings & Units** | Create buildings, manage units (vacant/occupied), unit detail page |
| **Tenant Lifecycle** | Assign tenant to unit, remove tenant (deposit refund + checklist deduction), transfer tenant between units, co-tenant contacts, tenant applications (apply → approve/reject) |
| **Meter Readings & Billing** | Monthly meter entry, auto units-consumed calc, manual override with reason, meter-replacement flow, per-tenant electricity rate, auto invoice generation (`rentPeriod` + `electricityPeriod`), carry-forward of unpaid balance |
| **Invoicing** | One invoice/unit/month, custom/single invoice generation, bulk invoice generation (admin), invoice edit (staff) |
| **Collections / Payments** | Mark-as-paid (Cash/UPI/Bank/Cheque), partial payments, payment note, tenant-submitted payment verification (screenshot + txn id) with admin approval |
| **Daily Ledger** | Inflow/outflow entries, auto-settle invoices from inflow, auto-create invoice if missing, outflow mirrored to Expenses, daily & monthly views, receipt photo upload |
| **Expenses & Allocations** | Allocated fund per property, expense settlement, overspent warning, labour (worker/hours) & material (qty/vendor) sub-fields |
| **Monthly Overview** | Per-unit status: Rent Paid / Pending, Electricity Pending, No Invoice Yet |
| **Maintenance** | Tenant-submitted tickets with photo, comments, resolution photo, status tracking |
| **Announcements** | Admin broadcast to tenants (notice board) |
| **Documents** | Vault for agreements/ID proofs (Cloudinary) |
| **Contacts** | Vendor phonebook |
| **Soft Delete & Audit** | Expenses/ledger soft-deleted with mandatory reason; deletedBy/deletedAt tracked |
| **Tenant Portal** | View unit/lease info, pay invoices (UPI deep-link + txn submission), payment history (ledger), maintenance requests, apply for vacant units, notice board |
| **File Uploads** | Cloudinary-backed uploads with progress bar (`useUpload` hook, `/api/uploads`) |
| **Testing** | Vitest + Firestore emulator (`__tests__`) |
| **Docs** | Business rules, employee workflow, manager actions, backup/restore strategy; WhatsApp & Telegram notification integrations **designed but not yet implemented** |

## 2. Improvement Opportunities

### 🔔 Notifications
1. Implement the already-designed **WhatsApp/Telegram notifications** (invoice generated, payment received, overdue reminder, partial payment) — currently only a proposal doc exists.
2. Add **email notifications** (invoice PDF, receipt) as a channel-agnostic fallback.
3. Automated **overdue invoice reminders** (T+5 days) instead of manual follow-up via Monthly Overview.

### 🧾 Invoicing & Payments
4. **Digital/printable receipts** — a dedicated "print/download receipt" button is explicitly called out as "on the roadmap" in `MANAGER_ACTIONS.md`.
5. Support **splitting a lump-sum payment** across multiple pending invoices automatically (currently only the oldest invoice auto-settles; rest must be settled manually).
6. **Late fee automation** — configurable rule to auto-apply late fees instead of manual bulk action only.
7. **Recurring/scheduled invoice generation** (cron-based) instead of relying on employees to open the Meter tab each month.
8. Online payment gateway integration (Razorpay/Stripe) instead of manual UPI txn-id entry + screenshot verification.

### 📊 Reporting & Exports
9. **Financial CSV/Excel export** is admin-only and manual — add scheduled exports (e.g., monthly P&L emailed automatically) and richer reports (occupancy rate, collection efficiency, expense breakdown by category).
10. Dashboard **analytics/charts** (income vs expense trend, occupancy over time) — currently only tabular/summary views.

### 🏘️ Units & Tenant Management
11. **Bulk tenant/unit import** (CSV) for onboarding an existing portfolio instead of one-by-one entry.
12. **Lease renewal reminders** — no visible workflow for lease-expiry alerts (`leaseEnd` exists but isn't proactively surfaced).
13. Formal **document e-signature** for lease agreements instead of just uploading scanned PDFs.

### 🛠️ Maintenance
14. **SLA tracking / auto-escalation** for maintenance tickets left unresolved past a threshold.
15. Assign tickets to specific vendors/staff with due dates, rather than open-ended status tracking.

### 🔒 Security & Access Control
16. Add **granular permissions** within roles (e.g., a "read-only accountant" role) instead of only admin/employee/tenant.
17. **Firestore rules audit** — ensure soft-delete and financial fields can't be tampered with client-side (verify with `firebase-security-rules-auditor` skill).
18. **Audit log viewer** in Admin UI (currently soft-delete metadata is stored but not surfaced as a searchable audit trail).

### ⚙️ Engineering / Quality
19. **Test coverage expansion** — confirm coverage of Daily Ledger auto-settle, carry-forward, and multi-invoice edge cases (Section 6 of `MANAGER_ACTIONS.md` notes manual workaround for lump-sum multi-invoice payments — a good candidate for regression tests).
20. **TypeScript strictness** — several files use `any` extensively (e.g., `app/tenant/page.tsx`, `app/admin/page.tsx` have `eslint-disable @typescript-eslint/no-explicit-any`); introduce proper interfaces.
21. Split large monolithic page files (`app/employee/page.tsx` ~2,874 lines, `app/admin/page.tsx` ~1,483 lines) into smaller components for maintainability.
22. **Offline support / PWA** for employees collecting cash in areas with poor connectivity.
23. **Automated backup verification** — `BACKUP_AND_RESTORE.md` describes the strategy; add a scheduled job that verifies backups actually restore successfully.

### 📱 UX
24. **Multi-language support** (Hindi/regional language toggle) for tenant-facing screens, given the local market context.
25. **Dark mode** and improved mobile responsiveness review for on-the-go employee use.
26. **In-app search** across tenants/units/invoices from a single global search bar.
