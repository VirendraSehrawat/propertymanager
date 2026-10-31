/**
 * Phone / WhatsApp helpers for contacting tenants from employee screens
 * (Monthly overview row actions). Pure so link building can be unit-tested.
 */

/** Country code added to 10-digit local numbers. */
const DEFAULT_COUNTRY_CODE = "91";

/**
 * Normalise a phone number to digits with a country code, as WhatsApp needs.
 * "098765 43210" → "919876543210", "+91 98765-43210" → "919876543210".
 * Returns "" when it doesn't look like a phone number.
 */
export function normalizePhone(phone?: string | null): string {
    let digits = (phone || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length === 10) return DEFAULT_COUNTRY_CODE + digits;
    return digits.length >= 11 && digits.length <= 15 ? digits : "";
}

/** `tel:` link, or "" without a usable number. */
export function telLink(phone?: string | null): string {
    const digits = normalizePhone(phone);
    return digits ? `tel:+${digits}` : "";
}

/** WhatsApp click-to-chat link with a pre-filled message, or "" without a usable number. */
export function whatsAppLink(phone: string | null | undefined, text: string): string {
    const digits = normalizePhone(phone);
    return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : "";
}

/** Friendly payment reminder quoting the balance still owed (not the invoice total). */
export function paymentReminderText(args: {
    tenantName?: string;
    unitNumber: string;
    billingPeriod: string;
    remaining: number;
    /** Set when part of the invoice is already paid. */
    paid?: number;
}): string {
    const name = (args.tenantName || "").trim().split(/\s+/)[0];
    const paidLine = args.paid && args.paid > 0 ? ` (₹${args.paid.toLocaleString("en-IN")} received, thank you)` : "";
    return (
        `Hi${name ? ` ${name}` : ""}, a reminder that ₹${args.remaining.toLocaleString("en-IN")} is still due ` +
        `for ${args.unitNumber} — ${args.billingPeriod}${paidLine}. ` +
        `Please pay at your earliest convenience and share the receipt/UPI reference. Thank you!`
    );
}
