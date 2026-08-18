# Adding a Custom Domain to Property Manager

This guide walks you through connecting a custom domain (e.g., `rentals.example.com`) to your Firebase App Hosting deployment.

---

## Prerequisites

- Firebase App Hosting backend already deployed (see `DEPLOYMENT.md`)
- A registered domain from any registrar (GoDaddy, Namecheap, Cloudflare, Google Domains, etc.)
- Firebase CLI installed (`npm install -g firebase-tools`)
- Firebase project ID: `property-manager-fb9eb` (or your project)

---

## Step 1: Add the Custom Domain in Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project → **App Hosting** (left sidebar)
3. Click on your backend (e.g., `property-manager`)
4. Go to the **Domains** tab → click **Add custom domain**
5. Enter your domain:
   - Root domain: `example.com`
   - Subdomain: `app.example.com` or `rent.example.com`

---

## Step 2: Configure DNS Records

Firebase will display DNS records you need to add at your domain registrar. Follow the instructions for your registrar below.

### For a Root Domain (`example.com`)

Add these records at your registrar's DNS settings:

| Type | Name/Host | Value | TTL |
| ---- | --------- | ----- | --- |
| A | `@` | *(IP address shown by Firebase)* | 3600 |
| AAAA | `@` | *(IPv6 address shown by Firebase)* | 3600 |
| TXT | `@` | *(Verification string shown by Firebase)* | 3600 |

### For a Subdomain (`app.example.com`)

| Type | Name/Host | Value | TTL |
| ---- | --------- | ----- | --- |
| CNAME | `app` | *(Target shown by Firebase)* | 3600 |

### For `www` Redirect

| Type | Name/Host | Value | TTL |
| ---- | --------- | ----- | --- |
| CNAME | `www` | `example.com` | 3600 |

---

## Step 3: Registrar-Specific Instructions

### GoDaddy

1. Log in → **My Products** → **DNS** next to your domain
2. Click **Add Record**
3. Select record type (A, AAAA, CNAME, or TXT)
4. Enter the Name and Value from Firebase
5. Set TTL to **1 Hour**
6. Save

### Namecheap

1. Log in → **Domain List** → **Manage** next to your domain
2. Go to **Advanced DNS** tab
3. Click **Add New Record**
4. Enter the type, host, and value from Firebase
5. Save changes

### Cloudflare

1. Log in → select your domain
2. Go to **DNS** → **Records**
3. Click **Add Record**
4. Enter type, name, and content from Firebase
5. **Important:** Set proxy status to **DNS only** (gray cloud) for Firebase to issue SSL
6. Save

### Google Domains / Squarespace Domains

1. Log in → select your domain → **DNS** in left sidebar
2. Scroll to **Custom records**
3. Click **Manage custom records**
4. Add each record with the type, host, and data from Firebase
5. Save

---

## Step 4: Verify Domain Ownership

After adding the DNS records:

1. Go back to Firebase Console → **App Hosting** → **Domains**
2. Click **Verify** next to your domain
3. Firebase will check for the TXT record

**Timing:**
- DNS propagation: **5 minutes to 48 hours** (usually under 30 minutes)
- You can check propagation status at [dnschecker.org](https://dnschecker.org)

---

## Step 5: SSL Certificate

Firebase automatically provisions a free SSL certificate after domain verification.

- SSL provisioning: **10 minutes to 24 hours** (usually under 1 hour)
- No manual setup needed — Firebase manages renewal automatically
- Your site will be accessible via `https://yourdomain.com`

---

## Step 6: Update Firebase Authentication

After the domain is live, add it to Firebase Auth's authorized domains:

1. Firebase Console → **Authentication** → **Settings**
2. Go to **Authorized domains**
3. Click **Add domain**
4. Add your custom domain (e.g., `example.com`)
5. Also add `www.example.com` if applicable

> **Without this step**, users will get auth errors when trying to sign in on the custom domain.

---

## Step 7: Verify Everything Works

Test the following on your new domain:

- [ ] `https://yourdomain.com` loads the login page
- [ ] SSL padlock icon shows in the browser
- [ ] Admin can log in and access the admin portal
- [ ] Employee can log in and access the employee portal
- [ ] Tenant can log in, view invoices, and submit payments
- [ ] File uploads (payment screenshots, documents) work correctly

---

## Troubleshooting

| Problem | Solution |
| ------- | -------- |
| Domain not resolving | Wait up to 48 hours for DNS propagation. Verify records at [dnschecker.org](https://dnschecker.org) |
| SSL certificate not issued | Ensure DNS proxy is off (Cloudflare: gray cloud). Wait up to 24 hours |
| Auth errors on new domain | Add the domain to Firebase Auth → Settings → Authorized domains |
| "Site not found" error | Confirm the backend is deployed: `firebase apphosting:backends:list --project property-manager-fb9eb` |
| DNS records not accepted | Some registrars don't allow `@` — use blank or the root domain name instead |
| `www` not working | Add a CNAME record: `www` → `yourdomain.com` |

---

## Removing a Custom Domain

1. Firebase Console → **App Hosting** → your backend → **Domains**
2. Click the **×** or **Remove** next to the domain
3. Optionally remove the DNS records from your registrar

---

## Multiple Domains

You can add multiple custom domains to the same backend. Repeat Steps 1–6 for each domain. All domains will serve the same application.
