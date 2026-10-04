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
export function parseYm(ym: string): [number, number] {
    const [y, m] = (ym || "").split("-").map(Number);
    return [y || new Date().getFullYear(), (m || 1) - 1];
}

/** Get the last day of a month (1-31). */
export function lastDayOfMonth(year: number, monthIndex: number): number {
    return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Normalise any date representation (YYYY-MM, "September 2026", "Sep 2026", or Date)
 * into a canonical ISO "YYYY-MM" string.
 */
export function toBillingYm(input?: string | Date | null): string {
    if (!input) return "";
    if (input instanceof Date) {
        if (isNaN(input.getTime())) return "";
        return `${input.getFullYear()}-${pad(input.getMonth() + 1)}`;
    }
    const str = String(input).trim();
    // Direct match for YYYY-MM
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(str)) {
        return str;
    }
    // Attempt parse
    const d = new Date(str.includes("-") || str.includes("/") ? str : `${str} 1`);
    if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    }
    return "";
}

/** Convert a "Month YYYY" label back to a "YYYY-MM" string (alias for toBillingYm). */
export function billingLabelToYm(label: string): string {
    return toBillingYm(label);
}

/** Convert a "YYYY-MM" string to a human-readable "Month YYYY" label (e.g. "September 2026"). */
export function billingYmToLabel(ym: string): string {
    const canonical = toBillingYm(ym);
    if (!canonical) return ym || "";
    const [y, mi] = parseYm(canonical);
    const d = new Date(y, mi, 1);
    return d.toLocaleString("default", { month: "long", year: "numeric" });
}

/** Get current month in canonical "YYYY-MM" format. */
export function getCurrentBillingYm(): string {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** Get previous month's "YYYY-MM" from a given "YYYY-MM" or "Month YYYY". */
export function getPreviousBillingYm(ymOrLabel: string): string {
    const canonical = toBillingYm(ymOrLabel) || getCurrentBillingYm();
    const [y, mi] = parseYm(canonical);
    const prev = new Date(y, mi - 1, 1);
    return `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
}

/** Get next month's "YYYY-MM" from a given "YYYY-MM" or "Month YYYY". */
export function getNextBillingYm(ymOrLabel: string): string {
    const canonical = toBillingYm(ymOrLabel) || getCurrentBillingYm();
    const [y, mi] = parseYm(canonical);
    const next = new Date(y, mi + 1, 1);
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
}

/**
 * Compare two billing periods. Returns:
 * < 0 if a < b (a is earlier than b)
 * 0 if a === b
 * > 0 if a > b (a is later than b)
 */
export function compareBillingYm(a: string, b: string): number {
    const ymA = toBillingYm(a);
    const ymB = toBillingYm(b);
    return ymA.localeCompare(ymB);
}

/** Checks whether two period strings (YYYY-MM or labels) represent the same month. */
export function isSameBillingMonth(a?: string | null, b?: string | null): boolean {
    if (!a || !b) return false;
    const ymA = toBillingYm(a);
    const ymB = toBillingYm(b);
    return Boolean(ymA && ymB && ymA === ymB);
}

/**
 * Compute the rent period from the billing month and the tenant's
 * payment day. Returns "8 Sep 2026 – 8 Oct 2026" style label.
 */
export function computeRentPeriod(billingYm: string, paymentDay?: number): string {
    const canonical = toBillingYm(billingYm) || billingYm;
    const [y, mi] = parseYm(canonical);
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
    const canonical = toBillingYm(billingYm) || billingYm;
    const [y, mi] = parseYm(canonical);
    const prev = new Date(y, mi - 1, 1);
    return prev.toLocaleString("default", { month: "long", year: "numeric" });
}

