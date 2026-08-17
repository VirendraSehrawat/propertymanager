# Property Manager — Deployment Guide

This guide covers deploying the Property Manager application to a **new Firebase App Hosting** server and connecting a **custom domain**.

---

## Prerequisites

| Tool | Install Command |
|------|----------------|
| Node.js ≥ 20 | https://nodejs.org |
| Firebase CLI | `npm install -g firebase-tools` |
| Google Cloud account | https://console.firebase.google.com |
| Custom domain (optional) | Any registrar (GoDaddy, Namecheap, Cloudflare, Google Domains, etc.) |

---

## Part 1: Create a New Firebase Project

### 1.1 Create the project

```bash
# Login to Firebase
firebase login

# Create a new project (replace with your project name)
firebase projects:create my-property-manager --display-name "Property Manager"
```

Or create it via the [Firebase Console](https://console.firebase.google.com) → **Add project**.

### 1.2 Enable required services

In the Firebase Console for your new project, enable:

1. **Authentication** → Sign-in method → Email/Password → Enable
2. **Cloud Firestore** → Create database → Start in production mode
3. **Cloud Storage** → Get started
4. **App Hosting** (will be set up in Part 3)

### 1.3 Get your Firebase config

Go to **Project Settings** → **General** → **Your apps** → **Add app** (Web `</>`) → Register app.

Copy the config values:
- `apiKey`
- `authDomain`
- `projectId`
- `storageBucket`
- `messagingSenderId`
- `appId`

---

## Part 2: Configure the Codebase

### 2.1 Clone the repository

```bash
git clone https://github.com/VirendraSehrawat/propertymanager.git
cd propertymanager
npm install
```

### 2.2 Create `.env.local` for local development

```bash
cat > .env.local << 'EOF'
NEXT_PUBLIC_FIREBASE_API_KEY="your-api-key"
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="your-project-id"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="your-project.firebasestorage.app"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="your-sender-id"
NEXT_PUBLIC_FIREBASE_APP_ID="your-app-id"
EOF
```

### 2.3 Update `apphosting.yaml`

Replace the environment variable values with your new project's Firebase config:

```yaml
env:
  - variable: NEXT_PUBLIC_FIREBASE_API_KEY
    value: your-api-key
    availability:
      - BUILD
      - RUNTIME
  - variable: NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    value: your-project.firebaseapp.com
    availability:
      - BUILD
      - RUNTIME
  - variable: NEXT_PUBLIC_FIREBASE_PROJECT_ID
    value: your-project-id
    availability:
      - BUILD
      - RUNTIME
  - variable: NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    value: your-project.firebasestorage.app
    availability:
      - BUILD
      - RUNTIME
  - variable: NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
    value: "your-sender-id"
    availability:
      - BUILD
      - RUNTIME
  - variable: NEXT_PUBLIC_FIREBASE_APP_ID
    value: your-app-id
    availability:
      - BUILD
      - RUNTIME
```

### 2.4 Update `firebase.json`

Update the `backendId` if you want a different name:

```json
{
  "apphosting": {
    "backendId": "your-backend-id"
  }
}
```

### 2.5 Deploy Firestore rules

```bash
firebase use your-project-id
firebase deploy --only firestore:rules
```

---

## Part 3: Deploy to Firebase App Hosting

### 3.1 Link Firebase to your project

```bash
firebase use your-project-id
```

### 3.2 Create the App Hosting backend

```bash
firebase apphosting:backends:create --project your-project-id
```

You will be prompted to:
1. **Connect GitHub** — authorize Firebase to access your repository
2. **Select repository** — choose `VirendraSehrawat/propertymanager` (or your fork)
3. **Select branch** — choose `main`
4. **Backend ID** — enter a name (e.g., `property-manager`)
5. **Region** — choose the closest region to your users:
   - `us-central1` (Iowa, USA)
   - `asia-south1` (Mumbai, India)
   - `europe-west1` (Belgium, EU)

### 3.3 Verify deployment

After the backend is created, Firebase will automatically build and deploy on every push to `main`.

Check the status:
```bash
firebase apphosting:backends:list --project your-project-id
```

Your app will be live at:
```
https://your-backend-id--your-project-id.firebaseapp.com
```

---

## Part 4: Connect a Custom Domain

### 4.1 Register a domain

Purchase a domain from any registrar:
- [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/)
- [Google Domains](https://domains.google/)
- [Namecheap](https://www.namecheap.com/)
- [GoDaddy](https://www.godaddy.com/)

### 4.2 Add the custom domain to Firebase App Hosting

```bash
firebase apphosting:backends:update your-backend-id \
  --project your-project-id \
  --custom-domain yourdomain.com
```

Or via the **Firebase Console**:
1. Go to **App Hosting** → select your backend
2. Click **Custom domains** → **Add custom domain**
3. Enter your domain (e.g., `app.yourdomain.com` or `yourdomain.com`)
4. Firebase will provide DNS records to configure

### 4.3 Configure DNS records at your registrar

Firebase will give you records to add. Typically:

| Type | Host/Name | Value/Target | TTL |
|------|-----------|-------------|-----|
| A | `@` | (IP provided by Firebase) | 3600 |
| AAAA | `@` | (IPv6 provided by Firebase) | 3600 |
| TXT | `@` | (verification string) | 3600 |
| CNAME | `www` | `yourdomain.com` | 3600 |

For a **subdomain** (e.g., `app.yourdomain.com`):

| Type | Host/Name | Value/Target | TTL |
|------|-----------|-------------|-----|
| CNAME | `app` | (target provided by Firebase) | 3600 |

### 4.4 Verify domain and wait for SSL

After adding DNS records:
- Verification takes **5–30 minutes**
- SSL certificate provisioning takes **up to 24 hours** (usually faster)
- Firebase provides free managed SSL certificates

Check status:
```bash
firebase apphosting:backends:get your-backend-id --project your-project-id
```

### 4.5 Update Firebase Auth domain

After the custom domain is live, update the authorized domain in Firebase:

1. Go to **Firebase Console** → **Authentication** → **Settings** → **Authorized domains**
2. Add `yourdomain.com` (and `www.yourdomain.com` if needed)

Also update the `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` env var in `apphosting.yaml` if you want auth redirects to use your custom domain.

---

## Part 5: Set Up Admin User

After deployment, create the first admin account:

1. Go to **Firebase Console** → **Authentication** → **Users** → **Add user**
2. Enter the admin email and password
3. Go to **Firestore** → create a document in the `users` collection:
   ```
   Document ID: (the UID from step 2)
   Fields:
     email: "admin@yourdomain.com"
     role: "admin"
   ```
4. Repeat for employee accounts with `role: "employee"`

---

## Part 6: Verify Everything

### Checklist

- [ ] Firebase project created with Auth, Firestore, and Storage enabled
- [ ] `apphosting.yaml` updated with correct env vars
- [ ] Firestore rules deployed
- [ ] App Hosting backend created and linked to GitHub
- [ ] First deployment successful (check Firebase Console → App Hosting)
- [ ] Custom domain DNS records added
- [ ] SSL certificate provisioned
- [ ] Admin user created in Auth + Firestore
- [ ] Login works at `https://yourdomain.com`
- [ ] Can create buildings, units, and manage tenants

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `auth/invalid-api-key` during build | Ensure env vars are in `apphosting.yaml` with `BUILD` availability |
| Domain not resolving | Wait up to 48h for DNS propagation; verify records with `dig yourdomain.com` |
| SSL not working | Firebase auto-provisions SSL; wait up to 24h after DNS verification |
| Firestore permission denied | Run `firebase deploy --only firestore:rules --project your-project-id` |
| Build fails | Check logs: `firebase apphosting:backends:get your-backend-id --project your-project-id` |
| GitHub not connected | Re-run `firebase apphosting:backends:create` and re-authorize GitHub |

---

## Architecture Overview

```
GitHub (main branch)
    ↓ push
Firebase App Hosting (Cloud Build)
    ↓ build & deploy
Cloud Run (Next.js SSR)
    ↓
Custom Domain (yourdomain.com)
    ↓
Users (Admin / Employee / Tenant)
    ↓
Firebase Services:
  ├── Authentication (email/password)
  ├── Cloud Firestore (database)
  └── Cloud Storage (file uploads)
```

---

## Cost Estimates (Firebase Free Tier — Spark Plan)

| Service | Free Tier Limit |
|---------|----------------|
| Authentication | 50k MAU |
| Firestore | 1 GiB storage, 50k reads/day |
| Storage | 5 GB |
| App Hosting | Build minutes vary; see [pricing](https://firebase.google.com/pricing) |

For production use beyond free limits, upgrade to the **Blaze (pay-as-you-go)** plan.
