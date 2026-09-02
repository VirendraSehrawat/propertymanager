# Property Manager

Property management web app built with `Next.js` and Firebase services (`Auth`, `Firestore`, `Storage`).

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

This app expects Firebase client env vars (see `.env.example`):

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

## Tests

```bash
npm test
```

`npm test` runs Vitest with Firestore emulator.

## Deploy to Vercel (primary)

This repository is configured for Vercel deployment (`vercel.json`).

### Option A: Git integration (recommended)

1. Import this repository in Vercel.
2. Set all Firebase environment variables in Vercel Project Settings.
3. Use default build settings for Next.js.
4. Deploy.

### Option B: CLI deploy

```bash
npm run deploy:vercel
```

## Firebase usage after migration

Firebase remains the backend provider:

- Firestore rules are still managed via `firebase.json` + `firestore.rules`
- Emulator/testing workflow remains unchanged

Only app hosting moved from Firebase App Hosting to Vercel.
