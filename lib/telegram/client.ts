/**
 * Thin server-side wrapper around the Telegram Bot API.
 *
 *   POST https://api.telegram.org/bot<TOKEN>/sendMessage
 *
 * Every call writes an audit row to `tgMessages` (Firestore) — successes
 * and failures alike — so we can debug undelivered notifications from the
 * admin UI later.
 *
 * The bot token never leaves the server. Do NOT import this file from any
 * "use client" component.
 */

import { addDoc, collection, serverTimestamp, updateDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
export { esc } from "./esc";

const TG_API = "https://api.telegram.org";

export interface InlineKeyboardButton {
    text: string;
    url?: string;
    callback_data?: string;
}

export interface SendMessageOpts {
    /** Recipient chat id (numeric for users, "-100…" for channels). */
    chatId: string | number;
    /** HTML-formatted message body. */
    text: string;
    /** Optional inline URL / callback buttons (max 8 per row). */
    inlineKeyboard?: InlineKeyboardButton[][];
    /** If true, Telegram won't push a notification. */
    silent?: boolean;
    /** Audit-log tag — e.g. "invoiceCreated", "paymentReceived". */
    kind: string;
    /** Foreign keys for the audit log. */
    relatedInvoiceId?: string;
    relatedLedgerId?: string;
}

export interface SendMessageResult {
    ok: boolean;
    messageId?: number;
    error?: string;
    auditId?: string;
}

/**
 * Send a message and persist an audit row. Never throws — callers should
 * treat the return value's `ok` flag as authoritative and continue on
 * failure (notifications must not roll back business writes).
 */
export async function sendTelegramMessage(opts: SendMessageOpts): Promise<SendMessageResult> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };
    }

    // Queue an audit row first so we can update it once we know the outcome.
    let auditId: string | undefined;
    try {
        const auditRef = await addDoc(collection(db, "tgMessages"), {
            to: String(opts.chatId),
            kind: opts.kind,
            text: opts.text,
            relatedInvoiceId: opts.relatedInvoiceId || null,
            relatedLedgerId: opts.relatedLedgerId || null,
            direction: "outbound",
            status: "queued",
            createdAt: new Date().toISOString(),
            updatedAt: serverTimestamp(),
        });
        auditId = auditRef.id;
    } catch (e) {
        console.error("[telegram] failed to write audit row", e);
    }

    const payload: Record<string, unknown> = {
        chat_id: opts.chatId,
        text: opts.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
    };
    if (opts.silent) payload.disable_notification = true;
    if (opts.inlineKeyboard && opts.inlineKeyboard.length) {
        payload.reply_markup = { inline_keyboard: opts.inlineKeyboard };
    }

    try {
        const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });
        const body = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };

        if (!res.ok || !body.ok) {
            const err = body.description || `HTTP ${res.status}`;
            if (auditId) {
                try {
                    await updateDoc(doc(db, "tgMessages", auditId), {
                        status: "failed",
                        error: err,
                        updatedAt: serverTimestamp(),
                    });
                } catch {
                    /* audit-only failure */
                }
            }
            console.error("[telegram] sendMessage failed:", err);
            return { ok: false, error: err, auditId };
        }

        const messageId = body.result?.message_id;
        if (auditId) {
            try {
                await updateDoc(doc(db, "tgMessages", auditId), {
                    status: "sent",
                    providerMessageId: messageId || null,
                    updatedAt: serverTimestamp(),
                });
            } catch {
                /* audit-only failure */
            }
        }
        return { ok: true, messageId, auditId };
    } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        if (auditId) {
            try {
                await updateDoc(doc(db, "tgMessages", auditId), {
                    status: "failed",
                    error: err,
                    updatedAt: serverTimestamp(),
                });
            } catch {
                /* ignore */
            }
        }
        console.error("[telegram] sendMessage threw:", err);
        return { ok: false, error: err, auditId };
    }
}
