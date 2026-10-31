/**
 * Search helpers for the Collections lists (Pending Invoices and Settled
 * Collections). Invoices only carry `unitNumber` and `tenantEmail`, so the
 * tenant's name and phone are looked up from the unit — but only while the
 * unit still belongs to the invoice's tenant, so a new occupant's name never
 * matches an old tenant's invoices. Pure so matching can be unit-tested.
 */

export interface SearchableInvoice {
    unitId?: string;
    unitNumber?: string;
    tenantEmail?: string;
    billingPeriod?: string;
    transactionId?: string;
}

export interface SearchableUnit {
    id: string;
    tenantEmail?: string;
    tenantName?: string;
    tenantPhone?: string;
}

/** Name / phone of the invoice's tenant, from the unit when it is still theirs. */
export interface InvoiceContact {
    tenantName?: string;
    tenantPhone?: string;
}

/** Minimum digits before a query is also matched against phone numbers. */
const MIN_PHONE_DIGITS = 3;

/** Units keyed by id, for fast name/phone lookup from `invoice.unitId`. */
export function unitsById<U extends SearchableUnit>(units: U[]): Map<string, U> {
    return new Map(units.map(u => [u.id, u]));
}

export function invoiceContact(inv: SearchableInvoice, units: Map<string, SearchableUnit>): InvoiceContact {
    const unit = inv.unitId ? units.get(inv.unitId) : undefined;
    if (!unit) return {};
    const sameTenant = !inv.tenantEmail || !unit.tenantEmail
        || unit.tenantEmail.toLowerCase() === inv.tenantEmail.toLowerCase();
    return sameTenant ? { tenantName: unit.tenantName, tenantPhone: unit.tenantPhone } : {};
}

/**
 * True when the invoice matches the query by unit number, tenant email, tenant
 * name or phone. Phone matching ignores spaces, dashes and a leading +91 / 0,
 * so "98765 43210", "+919876543210" and "43210" all find the same tenant.
 * `extra` adds more text fields to match (e.g. billing period, payment ref).
 */
export function matchesInvoiceSearch(
    inv: SearchableInvoice,
    query: string,
    units: Map<string, SearchableUnit>,
    extra: (string | undefined)[] = [],
): boolean {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    const { tenantName, tenantPhone } = invoiceContact(inv, units);
    const text = [inv.unitNumber, inv.tenantEmail, tenantName, ...extra];
    if (text.some(t => (t || "").toLowerCase().includes(q))) return true;

    const qDigits = q.replace(/\D/g, "");
    // Only treat it as a phone search when the query is essentially a number.
    if (qDigits.length < MIN_PHONE_DIGITS || /[a-z]/.test(q)) return false;
    const phoneDigits = (tenantPhone || "").replace(/\D/g, "");
    if (!phoneDigits) return false;
    const local = (d: string) => d.replace(/^(91|0)(?=\d{10}$)/, "");
    return local(phoneDigits).includes(local(qDigits));
}
