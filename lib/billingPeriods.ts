/**
 * Billing period helpers.
 *
 * Business rule:
 *   - Rent is charged for the UPCOMING month, running from the tenant's
 *     payment day in the billing month to the same day in the next month.
 *     If no `paymentDay` is set, we fall back to the 1st of the month.
 *   - Electricity is charged for the PREVIOUS month, based on the meter
 *     reading taken at the start of the billing month.
 *
 * Example: invoice generated for billing month "September 2026" on unit
 * with `paymentDay = 8` → rent period is "8 Sep 2026 – 8 Oct 2026" and
 * electricity period is "August 2026".
 */

const FMT_DAY = { day: "numeric", month: "short", year: "numeric" } as const;

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** Parse a "YYYY-MM" string to a [year, monthIndex] pair. */
function parseYm(ym: string): [number, number] {
    const [y, m] = ym.split("-").map(Number);
    return [y, (m || 1) - 1];
}

/** Get the last day of a month (1-31). */
function lastDayOfMonth(year: number, monthIndex: number): number {
    return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Compute the rent period from the billing month and the tenant's
 * payment day. Returns "8 Sep 2026 – 8 Oct 2026" style label.
 */
export function computeRentPeriod(billingYm: string, paymentDay?: number): string {
    const [y, mi] = parseYm(billingYm);
    const day = Math.min(Math.max(1, Number(paymentDay) || 1), lastDayOfMonth(y, mi));
    const start = new Date(y, mi, day);
    // End day = same day next month, clamped to that month's last day.
    const endMonthDay = Math.min(day, lastDayOfMonth(y, mi + 1));
    const end = new Date(y, mi + 1, endMonthDay);
    return `${start.toLocaleDateString("en-IN", FMT_DAY)} – ${end.toLocaleDateString("en-IN", FMT_DAY)}`;
}

/**
 * Compute the electricity period from the billing month. The reading is
 * taken at the start of the billing month, so units consumed cover the
 * PREVIOUS calendar month.
 */
export function computeElectricityPeriod(billingYm: string): string {
    const [y, mi] = parseYm(billingYm);
    const prev = new Date(y, mi - 1, 1);
    return prev.toLocaleString("default", { month: "long", year: "numeric" });
}

/** Convert a "Month YYYY" label back to a "YYYY-MM" string (best-effort). */
export function billingLabelToYm(label: string): string {
    const d = new Date(label);
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
