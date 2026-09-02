# Property Manager

Property management web app built with `Next.js`, Firebase services (`Auth`, `Firestore`) and Cloudinary for file uploads.

## Tech stack

- `Next.js` (App Router)
- `React`
- `TypeScript`
- `Firebase` (backend services)
- `Vitest`

## Local setup

1. Install dependencies
2. Configure environment variables
3. Run dev server

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Environment variables

This app expects:

### Firebase client vars

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

### Cloudinary server vars

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

## Tests

```bash
npm test
```

`npm test` runs Vitest with Firestore emulator.

## Deploy to Vercel (primary)

This repository is configured for Vercel deployment (`vercel.json`).

### Option A: Git integration (recommended)

1. Import this repository in Vercel.
2. Set Firebase + Cloudinary environment variables in Vercel Project Settings.
3. Use default build settings for Next.js.
4. Deploy.

### Option B: CLI deploy

```bash
npm run deploy:vercel
```

## Firebase usage after migration

Firebase remains the primary backend provider:

- Firestore rules are still managed via `firebase.json` + `firestore.rules`
- Emulator/testing workflow remains unchanged

File uploads are now routed through a server API and stored in Cloudinary.

Only app hosting moved from Firebase App Hosting to Vercel.
