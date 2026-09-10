# Backup & Restore Strategy

_Last updated: 9 September 2026_

This document describes how we protect Property Manager data (Firestore + Firebase Auth + Cloudinary) and how we restore a fresh, empty deployment from those backups.

---

## 1. What we need to protect

| Layer | Location | Contains |
|---|---|---|
| **Firestore** | `rental-appartment` project | All app data (see table below) |
| **Firebase Auth** | Same project | Employee / admin / tenant login accounts |
| **Cloudinary** | `rentalappartment` cloud | ID proofs, payment screenshots, maintenance photos, tenant documents |
| **Source code** | GitHub `VirendraSehrawat/propertymanager` | The app itself (already versioned) |
| **Env vars** | Vercel + `.env.local` | Firebase / Cloudinary keys |

### 1.1 Firestore collections (as of Sep 2026)

| Collection | Notes | Volume grows with |
|---|---|---|
| `buildings` | Property master data | Rare |
| `units` | One doc per unit (rent, tenant, meter state) | Rare |
| `users` | User roles + phone | New tenants / employees |
| `applications` | Prospective tenant applications | Slow |
| `invoices` | **Monthly rent + electricity bills** | Every month × units |
| `ledger` | Tenant payment history | Every settled invoice |
| `dailyLedger` | Cash inflow / outflow book | Daily |
| `expenses` | Building expenses | Weekly |
| `maintenance` | Tickets | As raised |
| `checklists` | Employee daily checklists | Daily |
| `inventory` | Stock master | Occasionally |
| `allocations` | Inventory consumption | Weekly |
| `contacts` | Vendor phonebook | Rare |
| `announcements` | Broadcast notices | Rare |
| `documents` | Vault (agreement PDFs etc.) | Rare |

> Whenever a new collection is added in code (search: `collection(db, "…")`), **add it to `COLLECTIONS` in the backup script and to this table.**

---

## 2. Backup goals

1. **Full snapshot every month-end** (source of truth for that month) — retained forever.
2. **Weekly incremental** during the month — smaller safety net.
3. **Off-site copies** — never rely on a single storage provider.
4. **Deterministic restore** into an empty Firebase project with the same schema.
5. **Media (Cloudinary) preserved** so URLs saved in Firestore stay resolvable.

---

## 3. Backup cadence

| Type | When | What | Retention |
|---|---|---|---|
| **Monthly Full** | Last day of month, 23:30 IST (or 1st of next month, 00:30 IST) | Every Firestore doc + Auth user list + Cloudinary media inventory | Forever |
| **Weekly Incremental** | Every Sunday 23:30 IST | Docs whose `createdAt` / `date` falls in the last 7 days | 90 days |
| **Ad-hoc** | Before any destructive admin action (bulk delete, schema migration, mass invoice regeneration) | Full snapshot | 1 year |
| **Config** | On every change | `.env.local`, `firebase.json`, Firestore rules | Forever (in Git) |

Timezone: **Asia/Kolkata (IST)** — matches the domain used inside invoices/dailyLedger dates.

---

## 4. Storage layout

Backups are written into a single tree so the restore script can find them mechanically.

```
backups/
├── 2026-09/                       ← month folder (YYYY-MM = "the month whose data this is")
│   ├── FULL_2026-09-30_2330IST/
│   │   ├── firestore/
│   │   │   ├── buildings.json
│   │   │   ├── units.json
│   │   │   ├── invoices.json
│   │   │   ├── ledger.json
│   │   │   ├── dailyLedger.json
│   │   │   ├── expenses.json
│   │   │   ├── ...
│   │   │   └── _manifest.json     ← counts + sha256 per file
│   │   ├── auth/
│   │   │   └── users.json         ← exported via Firebase Admin
│   │   ├── cloudinary/
│   │   │   ├── resources.json     ← list of public_ids + secure_url
│   │   │   └── media/             ← optional raw download (large!)
│   │   └── README.txt             ← "Full snapshot for Sep 2026"
│   ├── INC_2026-09-07/
│   ├── INC_2026-09-14/
│   ├── INC_2026-09-21/
│   └── INC_2026-09-28/
├── 2026-10/
│   └── ...
└── config/
    ├── firestore.rules
    ├── firebase.json
    └── env.local.encrypted.gpg    ← secrets, GPG-encrypted
```

### 4.1 Where the tree lives — the operator's own storage

**No paid cloud infrastructure is provisioned.** Backups are written to storage the operator already owns:

1. **Primary — operator's laptop / desktop** at `~/PropertyManagerBackups/` (or any absolute path chosen once and recorded in `.env.local` as `BACKUP_ROOT=`). This is where the script writes.
2. **Sync target — the operator's Google Drive** (personal or Workspace) folder `PropertyManagerBackups/`. Every backup is copied here immediately so it survives laptop loss / theft. Google Drive is chosen because:
    - the operator already has a Google account (same one that owns Firebase),
    - 15 GB free is plenty for years of JSON — a full monthly snapshot compressed is < 20 MB even at 10× current data volume,
    - it is user-facing (folder is browseable in a web UI — no CLI needed for restore),
    - sync is done with **rclone**, which is free, open-source, and does not require Google Workspace admin.
3. **Optional third copy — external USB drive** (any spare disk). Once a month, plug it in and `rsync` the whole tree. This is the "the house/office burned down and Google locked me out" copy.

Rule of thumb (3-2-1): **3** copies (laptop + Drive + USB), on **2** media types (SSD + Drive), with **1** off-site (Drive is off-site by definition; USB stored at a different address is the ideal third).

The tree in section 4 lives identically at every location:

```
~/PropertyManagerBackups/            ← BACKUP_ROOT on laptop
├── 2026-09/
│   ├── FULL_2026-09-30_2330IST/
│   └── INC_2026-09-07/  …
├── 2026-10/
├── adhoc/
└── config/

Google Drive → PropertyManagerBackups/…  ← identical structure, kept in sync by rclone
USB drive    → /Volumes/BackupUSB/PropertyManagerBackups/…  ← periodic rsync
```

### 4.2 One-time setup (~10 min)

```bash
# 1. Pick a stable location on the operator's machine
mkdir -p ~/PropertyManagerBackups
echo "BACKUP_ROOT=$HOME/PropertyManagerBackups" >> .env.local

# 2. Install rclone (one-time)
brew install rclone            # macOS
# curl https://rclone.org/install.sh | sudo bash   # Linux

# 3. Connect rclone to the operator's Google Drive
rclone config
#   → n (new remote)
#   → name: gdrive
#   → storage: drive
#   → client_id / secret: blank (uses rclone default) OR create own OAuth for higher quotas
#   → scope: 1 (Full access) — needed so we can create the folder
#   → root_folder_id: blank
#   → advanced config: n
#   → auto config: y  → browser opens → sign in → allow
#   → team drive: n
#   → Confirm.

# 4. Create the top-level Drive folder
rclone mkdir gdrive:PropertyManagerBackups

# 5. Quick test
echo "hello" > /tmp/hello.txt
rclone copy /tmp/hello.txt gdrive:PropertyManagerBackups/
rclone ls   gdrive:PropertyManagerBackups/
rclone delete gdrive:PropertyManagerBackups/hello.txt
```

**Nothing to provision on Google Cloud, no billing to enable, no service-account IAM.** The rclone token lives in the operator's local `~/.config/rclone/rclone.conf` and is scoped to that one Drive folder.

---

## 5. Tools

We use the **Firebase Admin SDK from a Node script** (no paid GCP export needed). One script does full + incremental; the mode is a CLI flag.

Required once:
1. In Firebase console → **Project settings → Service accounts → Generate new private key**. Save as `secrets/firebase-service-account.json` (this file is **not** committed — it is listed in `.gitignore`).
2. `npm i -D firebase-admin cloudinary tsx`

Prerequisites in `package.json` (dev-only, no impact on the Vercel bundle):

```jsonc
"scripts": {
    "backup:full":    "tsx scripts/backup.ts full",
    "backup:inc":     "tsx scripts/backup.ts inc",
    "restore":        "tsx scripts/restore.ts",
    "verify-backup":  "tsx scripts/verify-backup.ts"
}
```

Reference implementations live in `scripts/backup.ts`, `scripts/restore.ts`, `scripts/verify-backup.ts` (skeletons committed alongside this doc).

---

## 6. Monthly full backup — step by step

Run on the last day of the month after employees have closed collections.

```bash
# 1. Sync latest code
git pull

# 2. Confirm the service-account JSON exists
ls secrets/firebase-service-account.json

# 3. Run the full snapshot
npm run backup:full -- --month 2026-09

# 4. The script will:
#    a. Read every document from every collection listed in COLLECTIONS
#    b. Write one JSON file per collection to  backups/2026-09/FULL_YYYY-MM-DD_HHMMIST/firestore/
#    c. Export Firebase Auth users via admin.auth().listUsers()
#    d. Ask Cloudinary for every resource under the folder prefixes we use
#       (applications/, maintenance/, vault/, payments/) and save the metadata JSON
#    e. (Optional flag --download-media) stream each file to  cloudinary/media/
#    f. Write _manifest.json with { collection, docCount, sha256 } per file
#    g. Print a summary + total size

# 5. Verify
npm run verify-backup -- $BACKUP_ROOT/2026-09/FULL_2026-09-30_2330IST

# 6. Sync to the operator's Google Drive (off-site copy)
rclone sync $BACKUP_ROOT/2026-09/FULL_2026-09-30_2330IST \
    gdrive:PropertyManagerBackups/2026-09/FULL_2026-09-30_2330IST -P

# 7. Confirm size + doc counts match the source in Firebase console → Firestore usage tab.

# 8. (Optional, monthly) Plug in the external USB and mirror the whole tree
rsync -av --delete $BACKUP_ROOT/ /Volumes/BackupUSB/PropertyManagerBackups/
```

### 6.1 Iterative / incremental (weekly)

```bash
npm run backup:inc -- --since 2026-09-01 --until 2026-09-07
```

The script queries each collection with a `where("createdAt", ">=", since)` (or `date`, `paidAt` for collections without `createdAt`) and writes only the deltas to `backups/2026-09/INC_2026-09-07/`. This is what makes month-end restores fast even without re-uploading the entire dataset every week.

### 6.2 Ad-hoc snapshot before risky actions

```bash
npm run backup:full -- --label PRE_LATE_FEE_APPLY
```

Writes to `backups/adhoc/PRE_LATE_FEE_APPLY_<timestamp>/`.

---

## 7. Retention & cleanup

- Monthly full snapshots: **keep forever** (they are the source of truth for that month, needed for legal + accounting).
- Weekly incrementals: **auto-delete after 90 days** (script: `scripts/cleanup-backups.ts`).
- Ad-hoc snapshots: **auto-delete after 1 year**.
- Never delete a monthly snapshot without first confirming the next month's snapshot exists and passes `verify-backup`.

---

## 8. Restore into an empty deployment

This is the "the app is gone / a new Firebase project" scenario. Time budget: **~30 minutes for the data, plus Cloudinary re-import if media was lost**.

### 8.1 Prep the empty project

1. Create a new Firebase project (or reuse the current empty one) — same region if possible.
2. **Enable** Firestore (Native mode) + Authentication (email/password) + (optionally) Storage.
3. **Copy Firestore rules** from `backups/config/firestore.rules` → console → Rules → Publish.
4. Generate a **new service-account key** for the new project. Save to `secrets/firebase-service-account.RESTORE.json`.
5. Create a new Cloudinary account **only** if the original is lost; otherwise keep the existing one — the URLs stored in Firestore already point to it and will just work.
6. In `.env.local` and Vercel, point every `NEXT_PUBLIC_FIREBASE_*` value at the new project. Redeploy the app (empty UI is expected until step 8.4 finishes).

### 8.2 Choose the snapshot to restore

Pick the **latest FULL** you trust. It can come from any of your three copies — whichever you can reach fastest:

```bash
# Option A — from the operator's laptop (fastest, if the laptop is intact)
ls $BACKUP_ROOT/2026-09/

# Option B — from Google Drive (if the laptop is gone)
rclone ls gdrive:PropertyManagerBackups/2026-09/
mkdir -p $BACKUP_ROOT/2026-09
rclone copy gdrive:PropertyManagerBackups/2026-09/FULL_2026-09-30_2330IST \
    $BACKUP_ROOT/2026-09/FULL_2026-09-30_2330IST -P

# Option C — from the USB drive (offline / Google account locked)
cp -R /Volumes/BackupUSB/PropertyManagerBackups/2026-09/FULL_2026-09-30_2330IST \
    $BACKUP_ROOT/2026-09/
```

If you also want the changes that happened after that full (e.g. a mid-October crash), also pull any newer `INC_*` folders — restore is idempotent because it upserts by `id`, so layering them in chronological order is safe.

### 8.3 Restore Firestore + Auth

```bash
# 0. Sanity: point at the RESTORE service account
export GOOGLE_APPLICATION_CREDENTIALS="$PWD/secrets/firebase-service-account.RESTORE.json"

# 1. Dry run — prints what would be written, no changes
npm run restore -- backups/2026-09/FULL_2026-09-30_2330IST --dry-run

# 2. Real run
npm run restore -- backups/2026-09/FULL_2026-09-30_2330IST

# 3. Layer any newer incrementals on top (optional)
npm run restore -- backups/2026-10/INC_2026-10-05
npm run restore -- backups/2026-10/INC_2026-10-12
```

The restore script:

- Reads `_manifest.json`, refuses to run if any file's `sha256` does not match.
- For each collection, calls `db.collection(name).doc(id).set(data, { merge: false })` in batches of 400.
- For Auth: uses `admin.auth().importUsers([...], { hash: {…} })` to preserve UIDs (critical — the app keys `users` by UID and stores emails in Firestore, so mismatched UIDs break tenant login).
  - The exported `users.json` includes `passwordHash` (base64) + `passwordSalt` — provided the operator ran the export with the appropriate scope; if not, tenants must reset password on first login (this is a supported fallback).

### 8.4 Cloudinary

Two cases:

**A. Cloudinary account is intact** (most common). Do **nothing**. The URLs saved in Firestore (`idProofUrl`, `paymentProofUrl`, `photoUrl`, `fileUrl`) still resolve.

**B. Cloudinary account is lost**. Recreate the folder structure and re-upload every asset, then run the URL-remap step:

```bash
# 1. Point Cloudinary CLI at the NEW account
export CLOUDINARY_URL=cloudinary://KEY:SECRET@newcloud

# 2. Re-upload from local media/ (only present if --download-media was used at backup time)
cld uploader upload_dir backups/2026-09/FULL_2026-09-30_2330IST/cloudinary/media \
    --folder property-manager-restore --preserve-filename

# 3. Run the URL rewriter — updates every doc's *Url fields to the new cloud name
npm run restore -- backups/2026-09/FULL_2026-09-30_2330IST --remap-media \
    --from-cloud oldcloud --to-cloud newcloud
```

If `--download-media` was **not** used at backup time and Cloudinary is lost, the media is unrecoverable — the metadata JSON still tells you which docs referenced which files so you can nuke `*Url` fields cleanly rather than leave broken links.

### 8.5 Post-restore verification

Automated (part of restore script's output):

- Per-collection **doc counts** in the new project match `_manifest.json`.
- Random 20 docs re-read + deep-equal against the JSON.
- Auth: `admin.auth().listUsers()` count matches.

Manual smoke test (5 min):

1. Log in as admin → see all buildings, KPIs for restored month, per-building daily transactions.
2. Log in as an employee → Collections tab shows the same paid/pending totals as the pre-restore screenshot.
3. Log in as a tenant → sees their invoice history and can open an ID-proof / document URL.
4. Firestore rules: try reading a doc without auth → denied.

Take a fresh **full snapshot immediately** after a successful restore so the new project has its own baseline.

---

## 9. Failure modes & response

| Symptom | Likely cause | Action |
|---|---|---|
| `_manifest.json` sha mismatch | Backup file corrupt in transit | Use the next-oldest full snapshot; investigate storage layer |
| Auth import: `INVALID_HASH_ALGORITHM` | Export ran without password-hash scope | Fall back to "email reset link" mode; users log in with new password |
| Doc count off by ≤ 1% | New writes during the backup window | Acceptable — re-run incremental for that day |
| Doc count off by > 5% | Backup script partial failure | Do not use — investigate the log; re-run the backup |
| Cloudinary URLs 404 | Account/folder deleted | Section 8.4 case B — remap or nullify |
| App still empty after restore | Firebase config in `.env.local` still points at the old (empty) project | Re-check env vars in Vercel; redeploy |

---

## 10. Runbook one-pager (print this)

**Every month end (5 min):**
1. `git pull`
2. `npm run backup:full -- --month YYYY-MM`
3. `npm run verify-backup -- $BACKUP_ROOT/YYYY-MM/<FULL-folder>`
4. `rclone sync $BACKUP_ROOT/YYYY-MM/<FULL-folder> gdrive:PropertyManagerBackups/YYYY-MM/<FULL-folder> -P`
5. (Once/month) Plug in USB → `rsync -av --delete $BACKUP_ROOT/ /Volumes/BackupUSB/PropertyManagerBackups/`
6. Log the snapshot in `$BACKUP_ROOT/LOG.md` (folder path + doc counts + operator).

**Every Sunday (2 min):**
1. `npm run backup:inc -- --since <last Sun> --until <today>`
2. `rclone sync $BACKUP_ROOT/YYYY-MM/<INC-folder> gdrive:PropertyManagerBackups/YYYY-MM/<INC-folder> -P`

**Restore (30 min):**
1. Bring up empty Firebase project + copy rules.
2. Fetch the snapshot from whichever copy is reachable: `rclone copy gdrive:PropertyManagerBackups/<YYYY-MM>/<FULL-folder> $BACKUP_ROOT/<YYYY-MM>/<FULL-folder> -P` (or `cp -R` from USB, or just use the laptop copy).
3. `GOOGLE_APPLICATION_CREDENTIALS=...RESTORE.json npm run restore -- $BACKUP_ROOT/<YYYY-MM>/<FULL-folder>`
4. Layer incrementals if desired (fetch each, then `npm run restore`).
5. Point Vercel env vars at new project + redeploy.
6. Smoke test with admin / employee / tenant logins.
7. Take a fresh full snapshot of the restored project → sync to Drive + USB.

---

## 11. Open follow-ups

- [ ] Wire the monthly full into a GitHub Actions cron (`.github/workflows/backup.yml`) so it runs even if the operator is on leave. Store secrets in Actions secrets.
- [ ] Add PITR (Point-in-time recovery) on Firestore once the project moves to Blaze plan — this covers the "someone deleted a doc 3 hours ago" case without needing a new snapshot.
- [ ] Encrypt sensitive fields at rest before upload (`age` or `gpg --symmetric`) so a leaked laptop / Drive share link doesn't leak tenant IDs.
- [ ] Add an admin dashboard tile: "Last successful backup: 2 days ago" so we notice a stuck cron.
