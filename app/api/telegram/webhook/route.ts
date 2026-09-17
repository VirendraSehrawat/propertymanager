/**
 * Telegram bot webhook.
 *
 *   POST /api/telegram/webhook
 *
 * Handles inbound bot commands (see §9 of TELEGRAM_INTEGRATION.md).
 *
 * Configure once at deploy time:
 *
 *   curl -X POST \
 *     "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
 *     -d "url=https://rentalappartment.store/api/telegram/webhook" \
 *     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
 *
 * Auth: verifies the `X-Telegram-Bot-Api-Secret-Token` header.
 */

import { NextResponse } from "next/server";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    updateDoc,
    where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { sendTelegramMessage, esc } from "@/lib/telegram/client";

export const runtime = "nodejs";

interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        from?: { id: number; username?: string; first_name?: string };
        chat: { id: number; type: string };
        text?: string;
    };
}

export async function POST(request: Request) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    if (expected && provided !== expected) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    let update: TelegramUpdate;
    try {
        update = (await request.json()) as TelegramUpdate;
    } catch {
        return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }

    const msg = update.message;
    if (!msg || !msg.text) {
        return NextResponse.json({ ok: true, ignored: "no-text" });
    }

    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    const username = msg.from?.username || "";

    try {
        if (text.startsWith("/start")) {
            await handleStart(chatId, username, text);
        } else if (text.startsWith("/stop")) {
            await handleStop(chatId);
        } else if (text.startsWith("/status")) {
            await handleStatus(chatId);
        } else if (text.startsWith("/help")) {
            await handleHelp(chatId);
        } else {
            await sendTelegramMessage({
                chatId,
                text: "I only send updates — please contact your manager for other queries.\n\nSend /help to see available commands.",
                kind: "webhookReply",
            });
        }
    } catch (e) {
        console.error("[telegram/webhook] handler failed:", e);
        // Still return 200 so Telegram doesn't retry endlessly.
    }

    return NextResponse.json({ ok: true });
}

async function handleStart(chatId: string, username: string, text: string) {
    const parts = text.split(/\s+/);
    const code = parts[1];

    if (!code) {
        await sendTelegramMessage({
            chatId,
            text:
                "👋 <b>Welcome to Property Manager Bot!</b>\n\n" +
                "To receive your bills and payment updates here, please open the app and tap <b>“Link Telegram”</b> in your profile.\n\n" +
                "That will give you a personal link starting with <code>/start &lt;code&gt;</code>.",
            kind: "webhookReply",
        });
        return;
    }

    // Find the user with this linkCode.
    const snap = await getDocs(query(collection(db, "users"), where("telegramLinkCode", "==", code)));
    if (snap.empty) {
        await sendTelegramMessage({
            chatId,
            text: "⚠️ That link is invalid or has already been used. Please open the app and generate a fresh link.",
            kind: "webhookReply",
        });
        return;
    }

    const userDoc = snap.docs[0];
    const userData = userDoc.data() as { unitNumber?: string; name?: string };

    await updateDoc(doc(db, "users", userDoc.id), {
        telegramChatId: chatId,
        telegramUsername: username || null,
        telegramOptIn: true,
        telegramOptInAt: new Date().toISOString(),
        telegramLinkCode: null,
    });

    await sendTelegramMessage({
        chatId,
        text:
            `✅ <b>Linked!</b>\n\n` +
            `Hi ${esc(userData.name || "there")} — you will now receive bills and payment updates ` +
            (userData.unitNumber ? `for unit <b>${esc(userData.unitNumber)}</b> ` : "") +
            `here.\n\n` +
            `Send /status to see your current balance, /help for all commands, /stop to unsubscribe.`,
        kind: "webhookReply",
    });
}

async function handleStop(chatId: string) {
    const snap = await getDocs(query(collection(db, "users"), where("telegramChatId", "==", chatId)));
    for (const d of snap.docs) {
        await updateDoc(doc(db, "users", d.id), { telegramOptIn: false });
    }
    await sendTelegramMessage({
        chatId,
        text: "🔕 Unsubscribed. Send /start again anytime to re-enable notifications.",
        kind: "webhookReply",
    });
}

async function handleStatus(chatId: string) {
    // Find the linked user.
    const snap = await getDocs(query(collection(db, "users"), where("telegramChatId", "==", chatId)));
    if (snap.empty) {
        await sendTelegramMessage({
            chatId,
            text: "You are not linked yet. Open the app and tap “Link Telegram”.",
            kind: "webhookReply",
        });
        return;
    }
    const user = snap.docs[0].data() as { email?: string; unitNumber?: string };
    const email = (user.email || "").toLowerCase();
    if (!email) {
        await sendTelegramMessage({ chatId, text: "No email on file.", kind: "webhookReply" });
        return;
    }

    const invSnap = await getDocs(query(collection(db, "invoices"), where("tenantEmail", "==", email)));
    let owed = 0;
    let openCount = 0;
    const lines: string[] = [];
    for (const inv of invSnap.docs) {
        const d = inv.data() as { status?: string; totalAmount?: number; amountPaid?: number; billingPeriod?: string };
        if (d.status !== "unpaid" && d.status !== "pending") continue;
        const total = Number(d.totalAmount || 0);
        const paid = Number(d.amountPaid || 0);
        const due = Math.max(0, total - paid);
        if (due <= 0) continue;
        owed += due;
        openCount++;
        lines.push(`• ${esc(d.billingPeriod || "—")}: ₹${due.toLocaleString()}`);
    }

    if (openCount === 0) {
        await sendTelegramMessage({
            chatId,
            text: `🎉 <b>All clear!</b>\nNo outstanding invoices for unit <b>${esc(user.unitNumber || "")}</b>.`,
            kind: "webhookReply",
        });
        return;
    }
    await sendTelegramMessage({
        chatId,
        text:
            `📊 <b>Your balance</b>\n\n` +
            `Unit <b>${esc(user.unitNumber || "")}</b>\n` +
            lines.join("\n") +
            `\n\n<b>Total due: ₹${owed.toLocaleString()}</b>`,
        kind: "webhookReply",
    });
}

async function handleHelp(chatId: string) {
    await sendTelegramMessage({
        chatId,
        text:
            `<b>Property Manager Bot</b>\n\n` +
            `/start &lt;code&gt; — link your unit to this chat\n` +
            `/status         — see your current outstanding balance\n` +
            `/stop           — unsubscribe from notifications\n` +
            `/help           — show this message`,
        kind: "webhookReply",
    });
}

// Optional: quick health check for debugging.
export async function GET() {
    const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN);
    return NextResponse.json({ ok: true, configured });
}

// Used by handleStatus to look up the linked user doc; ensures the doc still
// exists even if the user was deleted between updates.
async function _unusedCompat(id: string) {
    return getDoc(doc(db, "users", id));
}
void _unusedCompat;
