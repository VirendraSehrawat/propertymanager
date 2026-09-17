/**
 * Recipient resolution helpers for the Telegram integration.
 *
 * All lookups are Firestore reads via the client SDK (which works fine on
 * the server side in Next.js API routes). They intentionally return null
 * rather than throwing when a chat is not linked — the caller is expected
 * to fall back to admin-only notification.
 */

import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { randomBytes } from "crypto";

/** The admin channel id from env — always available as a fallback recipient. */
export function getAdminChatId(): string | null {
    return process.env.TELEGRAM_ADMIN_CHAT_ID || null;
}

export function getBotUsername(): string | null {
    return process.env.TELEGRAM_BOT_USERNAME || null;
}

/**
 * Look up the tenant's linked Telegram chat id.
 *
 * We match by the invoice's `tenantEmail` (canonical) against
 * `users.email` (case-insensitive). Returns null when the tenant has not
 * completed `/start <code>` onboarding.
 */
export async function resolveTenantChatIdByEmail(tenantEmail?: string | null): Promise<string | null> {
    if (!tenantEmail) return null;
    const email = tenantEmail.toLowerCase().trim();
    if (!email) return null;
    try {
        const snap = await getDocs(query(collection(db, "users"), where("email", "==", email)));
        for (const d of snap.docs) {
            const data = d.data() as { telegramChatId?: string | number; telegramOptIn?: boolean };
            if (data.telegramOptIn && data.telegramChatId) {
                return String(data.telegramChatId);
            }
        }
    } catch (e) {
        console.error("[telegram] resolveTenantChatIdByEmail failed", e);
    }
    return null;
}

/**
 * Generate a URL-safe 12-char one-time code used inside the
 * `t.me/<bot>?start=<code>` deep-link.
 */
export function generateLinkCode(): string {
    return randomBytes(9).toString("base64url"); // 12 chars, URL-safe
}
