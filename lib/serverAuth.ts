import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let adminApp: App | undefined;

export function getAdminApp(): App {
    if (!getApps().length) {
        const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            try {
                const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
                adminApp = initializeApp({ credential: cert(serviceAccount), projectId });
                return adminApp;
            } catch (e) {
                console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:", e);
            }
        }
        adminApp = initializeApp({ projectId });
    }
    return getApps()[0];
}

export interface VerifiedUser {
    uid: string;
    email?: string;
    role?: string;
}

/**
 * Verifies the Firebase Auth ID token from the Authorization header.
 * Rejects unauthenticated or forged requests.
 */
export async function verifyAuthToken(request: Request): Promise<VerifiedUser | null> {
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }
    const token = authHeader.substring("Bearer ".length).trim();
    if (!token) return null;

    try {
        const app = getAdminApp();
        const decoded = await getAuth(app).verifyIdToken(token);
        return {
            uid: decoded.uid,
            email: decoded.email,
            role: (decoded.role as string) || undefined,
        };
    } catch {
        // Fallback validation via Google Identity Toolkit REST API
        try {
            const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
            if (!apiKey) return null;
            const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idToken: token }),
            });
            if (!res.ok) return null;
            const data = await res.json();
            const user = data.users?.[0];
            if (!user) return null;
            return {
                uid: user.localId,
                email: user.email,
            };
        } catch {
            return null;
        }
    }
}
