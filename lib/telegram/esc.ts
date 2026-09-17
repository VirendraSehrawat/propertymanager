/**
 * Framework-free HTML escaper for Telegram's HTML parse_mode.
 *
 * Kept in its own file (no firebase / firestore imports) so it can be
 * unit-tested without pulling in the whole client SDK.
 *
 * Only 3 characters need escaping per Telegram Bot API docs:
 *   &  <  >
 * (' and " are safe outside tag attributes, which we never construct
 * dynamically.)
 */
export function esc(input: string | number | null | undefined): string {
    if (input === null || input === undefined) return "";
    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
