import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
/**
 * In the browser, Firestore keeps a persistent local cache (IndexedDB) so the
 * staff app keeps working with poor signal: reads come from the cache and
 * writes are queued and sent when the connection returns (§7.2 of
 * docs/EMPLOYEE_WORKFLOW_IMPROVEMENTS.md, backlog G1). Several open tabs share
 * it. On the server (API routes) and when IndexedDB is unavailable (private
 * mode, tests) the default memory cache is used.
 */
function createDb(): Firestore {
    if (typeof window === "undefined" || typeof indexedDB === "undefined") return getFirestore(app);
    try {
        return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    } catch {
        // Already initialised (e.g. hot reload) — reuse that instance.
        return getFirestore(app);
    }
}

export const db = createDb();
export const storage = getStorage(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
    prompt: "select_account",
});
