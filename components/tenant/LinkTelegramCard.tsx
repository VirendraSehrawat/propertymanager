"use client";

import { useState } from "react";

interface Props {
    email: string;
    unitNumber?: string;
}

/**
 * Compact CTA rendered on the tenant dashboard offering to link Telegram
 * for free bill + payment notifications. Calls the server-side link-code
 * endpoint and opens the returned `t.me/<bot>?start=<code>` deep-link.
 */
export function LinkTelegramCard({ email, unitNumber }: Props) {
    const [loading, setLoading] = useState(false);
    const [linked, setLinked] = useState<boolean | null>(null);
    const [message, setMessage] = useState<string>("");

    const handleLink = async () => {
        setLoading(true);
        setMessage("");
        try {
            const res = await fetch("/api/telegram/link-code", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const data = (await res.json()) as {
                ok: boolean;
                linked?: boolean;
                deepLink?: string | null;
                message?: string;
                error?: string;
            };
            if (!data.ok) {
                setMessage(data.error || "Something went wrong.");
                return;
            }
            if (data.linked) {
                setLinked(true);
                setMessage(data.message || "Already linked.");
                return;
            }
            if (data.deepLink) {
                setLinked(false);
                window.open(data.deepLink, "_blank", "noopener,noreferrer");
                setMessage("Opening Telegram… tap Start in the bot to confirm.");
            }
        } catch (e) {
            setMessage(e instanceof Error ? e.message : "Network error.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-linear-to-br from-sky-50 to-indigo-50 border border-sky-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
                <div className="text-3xl">💬</div>
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-gray-900">Get updates on Telegram</h3>
                    <p className="text-xs text-gray-600 mt-1">
                        Receive bills, payment confirmations and reminders {unitNumber ? <>for unit <b>{unitNumber}</b></> : null} — instantly and free.
                    </p>
                    <button
                        type="button"
                        disabled={loading}
                        onClick={handleLink}
                        className="mt-3 inline-flex items-center gap-2 text-xs font-bold bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-md transition"
                    >
                        {loading ? "…" : linked ? "✅ Linked" : "🔗 Link Telegram"}
                    </button>
                    {message && <p className="text-[11px] text-gray-500 mt-2">{message}</p>}
                </div>
            </div>
        </div>
    );
}
