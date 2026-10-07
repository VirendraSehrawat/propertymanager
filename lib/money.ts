/**
 * Shared money helpers.
 *
 * The app does all arithmetic in whole/half rupees. These helpers centralize
 * the two patterns that were duplicated across pages and components:
 *
 *   1. Coercing a possibly-string / possibly-undefined Firestore field into a
 *      safe non-negative number (`toAmount`).
 *   2. Formatting a number as an Indian-rupee string for display
 *      (`formatRupees`).
 *
 * Keeping these in one place avoids float-drift bugs (e.g. `0.1 + 0.2`) and
 * guarantees the Employee, Admin and Tenant views render identical strings.
 */

/**
 * Coerce an unknown Firestore field into a finite number.
 * Returns `0` for null/undefined/NaN/Infinity.
 */
export function toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Coerce into a finite, non-negative amount (₹ can't be negative at a field
 * level — credits are modelled explicitly, not as negative charges).
 */
export function toAmount(value: unknown): number {
    return Math.max(0, toNumber(value));
}

/**
 * Round to whole rupees using half-up rounding, avoiding `-0`.
 */
export function roundRupees(value: unknown): number {
    const r = Math.round(toNumber(value));
    return r === 0 ? 0 : r;
}

/**
 * Round to 2 decimal places without binary-float drift
 * (e.g. `roundPaise(0.1 + 0.2) === 0.3`).
 */
export function roundPaise(value: unknown): number {
    const r = Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
    return r === 0 ? 0 : r;
}

/**
 * Format a number as an Indian-locale rupee string, e.g. `₹1,23,456`.
 * Pass `{ withDecimals: true }` to keep two decimal places.
 */
export function formatRupees(
    value: unknown,
    opts: { withDecimals?: boolean } = {},
): string {
    const n = toNumber(value);
    const formatted = n.toLocaleString("en-IN", {
        minimumFractionDigits: opts.withDecimals ? 2 : 0,
        maximumFractionDigits: opts.withDecimals ? 2 : 0,
    });
    return `\u20B9${formatted}`;
}
