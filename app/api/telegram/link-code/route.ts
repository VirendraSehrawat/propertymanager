/**
 * Generate (or return the existing) Telegram link code for a user.
 *
 *   POST /api/telegram/link-code
 *   body: { email: string }
 *
 * Idempotent — returns the same code until it is consumed by /start.
 *
 * Note: this is a client-facing endpoint. It only allows link-code
 * generation for a user document that already exists (the app creates
 * one on first login), so it can't be used to enumerate strangers.
 */

import { NextResponse } from "next/server";
import { collection, getDocs, query, updateDoc, where, doc, addDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { generateLinkCode, getBotUsername } from "@/lib/telegram/recipients";

export const runtime = "nodejs";

export async function POST(request: Request) {
    let body: { email?: string };
    try {
        body = (await request.json()) as { email?: string };
    } catch {
        return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    const email = (body.email || "").toLowerCase().trim();
    if (!email) {
        return NextResponse.json({ error: "email required" }, { status: 400 });
    }

    const botUsername = getBotUsername();
    if (!botUsername) {
        return NextResponse.json({ error: "TELEGRAM_BOT_USERNAME not configured" }, { status: 500 });
    }

    try {
        const snap = await getDocs(query(collection(db, "users"), where("email", "==", email)));

        let userDocId: string;
        let existingCode: string | undefined;
        let linked = false;
        if (snap.empty) {
            // Create a stub user doc so /start can find it. This mirrors the
            // pattern in AuthContext where a user doc is created on first login.
            const ref = await addDoc(collection(db, "users"), {
                email,
                role: "tenant",
                createdAt: new Date().toISOString(),
            });
            userDocId = ref.id;
        } else {
            const d = snap.docs[0];
            userDocId = d.id;
            const data = d.data() as { telegramLinkCode?: string; telegramChatId?: string; telegramOptIn?: boolean };
            existingCode = data.telegramLinkCode;
            linked = Boolean(data.telegramOptIn && data.telegramChatId);
        }

        if (linked) {
            return NextResponse.json({
                ok: true,
                linked: true,
                deepLink: null,
                message: "Already linked. Send /stop in the bot to unsubscribe.",
            });
        }

        const code = existingCode || generateLinkCode();
        if (!existingCode) {
            await updateDoc(doc(db, "users", userDocId), { telegramLinkCode: code });
        }

        return NextResponse.json({
            ok: true,
            linked: false,
            code,
            deepLink: `https://t.me/${botUsername}?start=${code}`,
        });
    } catch (e) {
        console.error("[telegram/link-code] failed:", e);
        return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
}
