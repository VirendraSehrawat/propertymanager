# Automating Delhi Police Tenant Verification

Status: **Design proposal — not yet implemented**
Owner: TBD
Last updated: 14 September 2026

---

## 1. What we're automating

Delhi Police runs an online tenant / servant / driver verification service
via the Delhi Police Citizen Services portal
(`https://citizen.delhipolice.gov.in/` — the exact tenant-verification URL
changes over time; historically both the "MHA e-Sewa" tenant module and
the Delhi Police portal have been used, currently reachable through the
Delhi Police home page under **Citizen Services → Tenant Verification**).

Today, our landlord opens the portal manually, logs in with his DL Police
account (mobile + OTP), types tenant details into ~15 form fields, uploads
the tenant's ID proof + photograph, submits, waits for the request number,
and then downloads the acknowledgement PDF. He then hands the reference
number to the tenant.

**Goal:** collect every input once inside our app, and have a background
job drive the portal end-to-end so the landlord only sees a completed
"✅ Verification submitted — Ref #XXXXX" card with the acknowledgement
PDF attached.

---

## 2. Non-negotiables (before we write a single line of code)

Automating a government portal is legally, technically, and ethically
sensitive. **All four of these must be true or we do not ship.**

1. **Terms of service.** The Delhi Police portal ToS must not explicitly
   forbid programmatic access on behalf of the account holder. If it does,
   the only correct path is a co-pilot flow (see §7, Alternative A).
2. **Landlord consent.** The landlord logs in, sees the exact payload the
   automation will send, and clicks **"Submit on my behalf"**. No silent
   submissions.
3. **Tenant consent + KYC.** The tenant's Aadhaar/driving-licence/passport
   image and personal data leave our system only for the police submission.
   Recorded, hashed, audit-logged (§9). We rely on the existing consent
   captured in the rental application (`applications` collection) and add
   an explicit "I authorise my landlord to file police verification with
   the documents I've uploaded" checkbox before enabling this feature per
   tenant.
4. **Reversibility.** Every automated submission is idempotent-keyed
   (see §5.4). We can re-run the same request without producing duplicates,
   and we can prove — from the audit log — exactly what data was sent, when,
   and by which staff member.

---

## 3. Two-part architecture

The app is a Next.js 16 client + Firestore backend. The Delhi Police portal
requires a real browser session (JS, cookies, CAPTCHA, sometimes reCAPTCHA
v2). We cannot drive it from a Next.js API route — those are stateless and
short-lived. Split the system in two:

### 3a. Front-end (in the existing Next.js app)

- New tab **"🛡 Police Verification"** in `/employee` (or per-tenant tab
  in the tenant-profile modal) — see §4 for the UX.
- Collects: landlord details (auto-filled from `AppUser`), tenant details
  (auto-filled from `Unit` + `applications`), tenant documents (already in
  Cloudinary), verification-request metadata (stay start date, previous
  address, employer, etc.).
- Writes a new document to Firestore collection **`policeVerifications`**
  with `status: "queued"`.
- Never touches the police portal directly.

### 3b. Automation worker (new service, outside Vercel)

- A Node.js process running **Playwright** (headed=false in prod, headed
  in dev for CAPTCHA debug). Hosted on **Google Cloud Run** or a small
  VM — Vercel functions cannot run Playwright's headless Chromium reliably.
- Watches `policeVerifications` for `status == "queued"` via Firestore
  triggers (Firebase Functions v2 → Cloud Run) or a simple 30-second poll.
- Executes one submission, updates the document with `requestNumber`,
  `acknowledgementPdfUrl`, `submittedAt`, and `status: "submitted"`.
- On failure (CAPTCHA blocked, session expired, missing field validation)
  writes `status: "needs_attention"` with the failure reason + a screenshot
  URL — landlord sees this in the UI and can retry or complete manually.

Why not stuff this into the Next.js app? Playwright needs 200–400 MB of
browser binaries, a persistent Chromium process, human-in-the-loop CAPTCHA
handoff, and 30–60 second run times per submission. That's a job runner,
not an API route.

---

## 4. UX flow (what the landlord sees)

### Step 1 — Open the tenant profile

Under the existing tenant-profile modal in `/employee`, add a new section:

```
🛡 Police Verification (Delhi Police)
─────────────────────────────────────
Status: Not filed
[ Start Verification ]
```

### Step 2 — "Start Verification" — one-screen form

Auto-fill everything we already know so the landlord types nothing that
already lives in the app:

| Field | Source |
|-------|--------|
| Landlord name, phone, address | `AppUser` + `Building` |
| Tenant name, DOB, gender, phone, permanent address | `Unit` + latest `Application` |
| Tenant photo | `applications.photoUrl` or `units.tenantPhotoUrl` |
| Tenant ID proof (Aadhaar/DL/passport) | `applications.idProofUrl` |
| Stay start date | `unit.tenancyStart` |
| Rent amount | `unit.baseRent` |

Landlord fills only what we don't know:
- Previous address (if not on file)
- Emergency contact of tenant
- Employer name + address (if employed)
- Number of family members staying with tenant
- Vehicle registration numbers (optional)

Show a **preview panel** that renders the exact JSON payload the automation
will submit. The landlord clicks **"Submit on my behalf"**. We write to
Firestore with `status: "queued"` and show a persistent progress card.

### Step 3 — In-progress card (polls Firestore)

```
🛡 Police Verification — Unit 3B, Ramesh Kumar
Status: In progress ⏳
Started 2 minutes ago
Automation worker: connected to portal
```

### Step 4 — Success card

```
✅ Verification Submitted — Delhi Police
Ref #: DL-PV-2026-8843921
Submitted: 14 Sep 2026, 3:42 PM
📎 Download Acknowledgement PDF
📎 Screenshot of confirmation
```

The landlord's own `AppUser` record and the tenant's `Application` get
back-linked with `policeVerificationRequestNumber` for future audits.

### Step 5 — If automation fails

```
⚠️ Needs Attention
Reason: CAPTCHA required — automation cannot solve.
Options:
  [ Retry ] — worker will try again
  [ Take over ] — opens portal in a new tab with a
                  pre-filled bookmarklet so you complete
                  the last step manually.
```

---

## 5. Data model

### 5.1 New collection: `policeVerifications`

```ts
interface PoliceVerification {
    id: string;                              // Firestore doc id
    // Idempotency
    idempotencyKey: string;                  // hash of {tenantEmail, unitId, unit.tenancyStart}
    // Scope
    unitId: string;
    unitNumber: string;
    tenantEmail: string;
    landlordEmail: string;                   // whoever pressed "Submit on my behalf"

    // Snapshot of what we submitted (do NOT read live from other collections
    // — freeze the payload at submission time so the audit trail is honest)
    submissionPayload: {
        landlord: { name: string; phone: string; email: string; address: string };
        tenant: {
            name: string; dob: string; gender: string; phone: string;
            permanentAddress: string;
            currentAddress: string;
            idProofType: "aadhaar" | "dl" | "passport" | "voter";
            idProofNumber: string;           // hashed in Firestore, plaintext in submission
            idProofDocUrl: string;           // Cloudinary URL (short-lived signed link)
            photoUrl: string;
            employer?: { name: string; address: string };
            emergencyContact?: { name: string; phone: string; relation: string };
            familyMembers?: number;
            vehicles?: string[];
        };
        tenancy: { startDate: string; rentAmount: number };
    };

    // Automation lifecycle
    status:
        | "queued"          // waiting for worker to pick up
        | "in_progress"     // worker actively running
        | "submitted"       // portal accepted, request number returned
        | "needs_attention" // stuck at CAPTCHA / validation / session
        | "cancelled"       // user aborted before submission
        | "failed";         // unrecoverable
    statusUpdatedAt: string;
    statusReason?: string;
    workerId?: string;      // which worker instance is holding this

    // Portal artefacts (populated on success)
    requestNumber?: string;
    acknowledgementPdfUrl?: string;   // Cloudinary
    portalScreenshots?: string[];     // Cloudinary — every step, for audit

    // Audit
    submittedAt?: string;
    consentTenantAt: string;          // when tenant checked the box
    consentLandlordAt: string;        // when landlord clicked Submit on my behalf

    createdAt: string;
    updatedAt: string;
}
```

### 5.2 New collection: `policeVerificationLogs`

Append-only log, one row per state transition — every read/write/click the
worker performed. Small and fast so we can debug production issues without
touching the main doc.

```ts
interface PoliceVerificationLog {
    id: string;
    verificationId: string;
    step: string;                     // "login" | "fill_landlord" | "upload_id" | "solve_captcha" | ...
    status: "started" | "ok" | "error";
    message?: string;
    screenshotUrl?: string;
    createdAt: string;
}
```

### 5.3 Firestore security rules (add to `firestore.rules`)

- Only the landlord who owns the unit + admins can **read** their own
  verifications.
- Only the automation worker service account can **write** portal
  artefacts (`requestNumber`, `acknowledgementPdfUrl`, `status` transitions
  after `queued`).
- The client can only create with `status == "queued"` and can never
  edit the `submissionPayload` after creation. That freezes the audit trail.

### 5.4 Idempotency

`idempotencyKey = sha256({tenantEmail}:{unitId}:{tenancyStart})`. If a
worker crashes mid-submission and a new job picks it up, we don't want a
second file at the police portal. The worker checks the police portal for
an existing request by the same tenant + landlord pair before submitting
(most gov portals show existing filings under the landlord account).

---

## 6. The automation worker (technical detail)

### 6.1 Runtime

- **Node 20** + **Playwright** (`@playwright/test` in dev,
  `playwright-chromium` in prod).
- Deployed as a **Cloud Run** service (min 0 / max 3 instances) triggered
  by Firestore document creation via **Eventarc**. Cold start is fine —
  users already see "queued" for a few seconds.
- One submission per invocation. Timeout 90 seconds. Retries handled by
  Firestore doc state, not by Cloud Run.

### 6.2 Flow

```
1. Firestore trigger fires with verificationId
2. Read doc, guard: status must be "queued"
3. Update status → "in_progress", set workerId, statusUpdatedAt
4. Launch chromium (single tab, incognito context)
5. Navigate to portal, log in with landlord credentials
      credentials come from Google Secret Manager, NOT Firestore
6. If CAPTCHA: attempt to solve via 2Captcha / anti-captcha API
      if that fails → status = "needs_attention", statusReason,
      upload screenshot to Cloudinary, return
7. Navigate to Tenant Verification form
8. Fill fields from submissionPayload (typed one at a time, waitForNetworkIdle)
9. Upload tenant photo + ID proof (fetch Cloudinary URL, stream to
      Playwright's setInputFiles)
10. Solve final CAPTCHA (same escalation as step 6)
11. Click Submit
12. Wait for confirmation page. Scrape requestNumber.
13. Click "Download PDF", intercept the download, upload to Cloudinary
      under private folder /verifications/{id}/ack.pdf
14. Update Firestore doc: status = "submitted", requestNumber,
      acknowledgementPdfUrl, submittedAt
15. Append final log row.
```

### 6.3 Landlord credentials for the portal

**Never** stored in Firestore. Two options in order of preference:

- **A. Landlord logs into portal once via our worker's UI.** The worker
  stores the resulting *portal session cookies* (encrypted at rest in
  Google Secret Manager, keyed by landlord email, TTL 24 hours). When the
  cookies expire, the app tells the landlord to log in again. This mirrors
  how tax-filing SaaS tools do it and is the least-bad model.
- **B. Landlord types portal password each time.** The worker fetches it
  from a one-time-use encrypted blob in Firestore (encrypted with a KMS
  key), uses it, wipes it. Slower UX but eliminates long-lived session
  storage. Recommended for MVP.

Passwords are never logged, never written to `policeVerificationLogs`,
never present in error messages.

### 6.4 CAPTCHA strategy

The portal has both an image CAPTCHA and, for repeated logins from the
same IP, sometimes reCAPTCHA v2.

- Try **2Captcha** or **CapMonster** API — commercial CAPTCHA solving
  services, ~₹0.20 per solve, 15–30 second latency. Legal grey area but
  standard practice for RPA against non-machine-friendly government sites.
- On repeated failures, fail gracefully with `needs_attention` and a
  screenshot. Landlord finishes manually via a **magic link** that
  resumes at the CAPTCHA step in a real browser tab.

### 6.5 Rate limiting & etiquette

- Max **1 submission per landlord per 10 minutes.**
- Max **20 submissions per hour globally** (worker-side semaphore in
  Firestore).
- Randomised typing delays (50–200ms per keystroke) so we look human and
  don't trip the portal's bot heuristics.
- Rotating egress IPs via Cloud NAT with 3 static IPs; any single IP that
  gets blocked is drained for 24 hours.

---

## 7. Alternatives we deliberately reject

**A. Co-pilot / bookmarklet approach.** Instead of driving the portal
ourselves, generate a browser extension or bookmarklet that auto-fills
the form when the landlord opens the portal in his own browser. The
landlord clicks submit and solves the CAPTCHA. **Falls back to this in
MVP if legal review says we can't automate submission.** Gives us 80% of
the time savings with 20% of the risk. Same `submissionPayload` schema,
same Firestore doc — just `status: "manual_assisted"` on completion.

**B. Delhi Police public API.** Doesn't exist as of the design date. If
it appears, we replace the worker with plain HTTPS calls in a Firebase
Function within a week and delete the Playwright infra.

**C. Third-party paid API.** A handful of Indian RPA vendors sell tenant
verification as a service (e.g. via CSC centres). Cheapest is ~₹150 per
verification. Costs 3× our own cost but eliminates the legal + infra
work. **Recommended as a fallback plan** if internal automation is
blocked.

---

## 8. Failure modes & recovery

| Failure | Detection | Recovery |
|---|---|---|
| Portal down | `page.goto` timeout | Retry in 30 min; status stays `queued` |
| Landlord credentials wrong | Login page still visible after submit | `needs_attention`, message = "Login failed, re-enter password" |
| CAPTCHA unsolved after 3 tries | 2Captcha returns error 3× | `needs_attention` with magic link |
| Tenant ID doc rejected by portal | Portal shows validation error | `needs_attention` with portal's own error message |
| Portal form changed | Field selector missing | Worker throws; `failed`; on-call alert |
| Duplicate submission | Portal shows "already filed" | Worker parses the existing ref#, sets `status: "submitted"` from existing filing |
| Session expired mid-submission | Login redirect after fill | `needs_attention`; landlord retries |
| Automation quota hit at CAPTCHA vendor | HTTP 402 | `queued` → retry in 5 min |

Every `needs_attention` shows the landlord: the failed step, the
screenshot at that step, the portal's error text if any, and a big
"Take over in your browser" button that opens the portal with the
data pre-filled via bookmarklet.

---

## 9. Audit + compliance

For every submission we keep, immutably, for 7 years:

- Full `submissionPayload` frozen at submission time
- Every screenshot the worker took (including CAPTCHA screen — with the
  CAPTCHA solved-value redacted)
- The rendered acknowledgement PDF
- IP + user-agent used by the worker
- The landlord's clicking of "Submit on my behalf" (timestamp,
  `AppUser.email`, IP)
- The tenant's consent to police verification (timestamp, source doc)

Retention aligns with **Delhi Rent Control Act** and **DPDP Act 2023**:
tenant PII is encrypted at rest, purged 90 days after tenancy ends
*except* the `requestNumber` + `acknowledgementPdfUrl` which the landlord
needs indefinitely.

Add a new admin-only view `/admin/verifications` (Section 3 of
`docs/REFACTOR_PLAN.md` — future) that lists every filing with
searchable filters and one-click PDF download for landlord reconciliation.

---

## 10. Rollout plan

**Phase 0 — Legal & policy (2 weeks)**
- Written OK from a lawyer on ToS of the Delhi Police portal.
- Draft privacy policy update.
- Draft tenant consent language.
- Get signoff from admin before writing any code.

**Phase 1 — Co-pilot MVP (1 week)**
- Ship the `policeVerifications` collection + form UI + preview panel.
- Generate a bookmarklet that auto-fills the portal when landlord opens
  it in a new tab. Landlord solves CAPTCHA + clicks submit himself.
- Landlord uploads the resulting acknowledgement PDF back to our app
  via a simple file input. `status: "manual_assisted"`.
- **This alone saves the landlord ~7 minutes per verification** and
  gives us the data model, audit log, and dashboard we need for Phase 2.

**Phase 2 — Full automation (3–4 weeks after Phase 1)**
- Cloud Run + Playwright worker.
- 2Captcha integration.
- Cookie-based session storage.
- Ship behind a feature flag `enableAutoVerification: true` in the
  `Building` doc so we enable per-landlord as we gain confidence.

**Phase 3 — Admin tooling (1 week)**
- `/admin/verifications` list with filters.
- Monthly report of automations succeeded / failed / manual.
- Alerts on portal form changes (selector-missing errors).

---

## 11. Cost estimate (monthly, at 200 verifications / month)

| Item | Cost |
|---|---:|
| Cloud Run (min 0, max 3, ~90s per job) | ₹300 |
| 2Captcha (2 CAPTCHAs × ₹0.20 × 200) | ₹80 |
| Cloudinary storage (200 × 3 MB screenshots + PDF) | ₹0 (within free tier) |
| Google Secret Manager (200 secret-versions) | ₹40 |
| Cloud NAT static IPs (3) | ₹250 |
| **Total** | **~₹670/mo** |

For comparison: a third-party CSC verification service at ~₹150/filing ×
200 filings = **₹30,000/mo**. Break-even is ~5 verifications per month.

---

## 12. Open questions

- [ ] Does the Delhi Police portal ToS explicitly forbid RPA on behalf
      of the account holder? **Legal review required.**
- [ ] Do we need to obtain fresh tenant consent for every re-submission
      (e.g. after tenancy renewal) or is the initial consent sufficient?
- [ ] Should the acknowledgement PDF also be shared with the tenant
      automatically via the tenant portal, or does the landlord decide?
- [ ] Do we support other states' police portals (Mumbai, Bengaluru)
      later, or is Delhi-only acceptable for v1?
- [ ] What's our SLA for `needs_attention` — does an on-call engineer
      look at every failure, or is it self-service via retry?
- [ ] Rotating IPs — 3 is enough for 200/month but not for 1000/month.
      When do we upsize?

---

## 13. Related docs

- [`docs/BUSINESS_RULES.md`](./BUSINESS_RULES.md) — general employee handbook
- [`docs/EMPLOYEE_WORKFLOW.md`](./EMPLOYEE_WORKFLOW.md) — where the new
  tab goes in the employee dashboard
- [`docs/BACKUP_AND_RESTORE.md`](./BACKUP_AND_RESTORE.md) — extend the
  backup list with `policeVerifications` + `policeVerificationLogs`
- [`docs/REFACTOR_PLAN.md`](./REFACTOR_PLAN.md) — the admin
  `/admin/verifications` view is a future refactor item
