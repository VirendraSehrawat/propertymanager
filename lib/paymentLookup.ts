/**
 * Pure helpers for the Admin "Find Payments" lookup — search any apartment
 * or tenant (current occupant or a past tenant from `tenantHistory`) and
 * build a consolidated invoice + payment summary for them.
 *
 * Kept free of Firebase imports so it can be unit tested in isolation.
 */

export interface UnitLike {
    id: string;
    unitNumber: string;
    buildingId?: string;
    status?: string;
    tenantEmail?: string;
    tenantName?: string;
    tenantPhone?: string;
    tenantHistory?: Array<{
        tenantEmail?: string;
        tenantName?: string;
        tenantPhone?: string;
        moveInDate?: string;
        moveOutDate?: string;
    }>;
}

export interface InvoiceLike {
    id: string;
    unitId: string;
    unitNumber?: string;
    tenantEmail?: string;
    billingPeriod?: string;
    status?: string;
    totalAmount?: number;
    amountPaid?: number;
    createdAt?: string;
}

export interface LedgerRowLike {
    id: string;
    invoiceId?: string;
    unitId?: string;
    tenantEmail?: string;
    amountPaid?: number;
    paymentMode?: string;
    paymentReference?: string | null;
    transactionId?: string;
    type?: string;
    createdAt?: string;
}

export type MatchKind = "current" | "historical";

export interface TenantMatch {
    unitId: string;
    unitNumber: string;
    buildingId?: string;
    tenantEmail: string;
    tenantName?: string;
    tenantPhone?: string;
    kind: MatchKind;
    moveInDate?: string;
    moveOutDate?: string;
}

/**
 * Searches both the current occupant of every unit and each unit's
 * `tenantHistory` for a case-insensitive match on name, email, phone, or
 * unit number. Returns one row per (unit, tenant) pair, current occupants
 * first, each sorted by unit number.
 */
export function searchTenantsAndUnits(query: string, units: UnitLike[]): TenantMatch[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const current: TenantMatch[] = [];
    const historical: TenantMatch[] = [];

    for (const u of units) {
        const unitNumMatch = (u.unitNumber || "").toLowerCase().includes(q);

        if (u.status === "occupied" || u.tenantEmail) {
            const hit = unitNumMatch ||
                (u.tenantName || "").toLowerCase().includes(q) ||
                (u.tenantEmail || "").toLowerCase().includes(q) ||
                (u.tenantPhone || "").includes(q);
            if (hit && u.tenantEmail) {
                current.push({
                    unitId: u.id,
                    unitNumber: u.unitNumber,
                    buildingId: u.buildingId,
                    tenantEmail: u.tenantEmail,
                    tenantName: u.tenantName,
                    tenantPhone: u.tenantPhone,
                    kind: "current",
                });
            }
        }

        for (const h of u.tenantHistory || []) {
            const hit = unitNumMatch ||
                (h.tenantName || "").toLowerCase().includes(q) ||
                (h.tenantEmail || "").toLowerCase().includes(q) ||
                (h.tenantPhone || "").includes(q);
            if (hit && h.tenantEmail) {
                historical.push({
                    unitId: u.id,
                    unitNumber: u.unitNumber,
                    buildingId: u.buildingId,
                    tenantEmail: h.tenantEmail,
                    tenantName: h.tenantName,
                    tenantPhone: h.tenantPhone,
                    kind: "historical",
                    moveInDate: h.moveInDate,
                    moveOutDate: h.moveOutDate,
                });
            }
        }
    }

    const byUnit = (a: TenantMatch, b: TenantMatch) =>
        a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true, sensitivity: "base" });

    // De-dupe historical rows that match an already-current tenant+unit pair.
    const currentKeys = new Set(current.map(m => `${m.unitId}|${m.tenantEmail}`));
    const dedupedHistorical = historical.filter(m => !currentKeys.has(`${m.unitId}|${m.tenantEmail}`));

    return [...current.sort(byUnit), ...dedupedHistorical.sort(byUnit)];
}

export interface InvoiceWithPayments extends InvoiceLike {
    payments: LedgerRowLike[];
}

export interface TenantPaymentSummary {
    invoices: InvoiceWithPayments[];
    totals: {
        invoiced: number;
        collected: number;
        due: number;
        invoiceCount: number;
        paymentCount: number;
    };
}

/**
 * Builds a consolidated view for one (unitId, tenantEmail) pair: every
 * invoice ever issued to them on that unit, each with its nested payment
 * (ledger) rows, newest invoice first.
 */
export function buildTenantPaymentSummary(
    unitId: string,
    tenantEmail: string,
    invoices: InvoiceLike[],
    ledgerRows: LedgerRowLike[]
): TenantPaymentSummary {
    const email = tenantEmail.toLowerCase();
    const matchingInvoices = invoices.filter(
        inv => inv.unitId === unitId && (inv.tenantEmail || "").toLowerCase() === email
    );

    const paymentsByInvoice = new Map<string, LedgerRowLike[]>();
    let unlinkedCollected = 0;
    const unlinkedPayments: LedgerRowLike[] = [];
    for (const row of ledgerRows) {
        if (row.unitId !== unitId || (row.tenantEmail || "").toLowerCase() !== email) continue;
        if (row.invoiceId) {
            const list = paymentsByInvoice.get(row.invoiceId) || [];
            list.push(row);
            paymentsByInvoice.set(row.invoiceId, list);
        } else {
            unlinkedCollected += Number(row.amountPaid || 0);
            unlinkedPayments.push(row);
        }
    }

    const invoicesWithPayments: InvoiceWithPayments[] = matchingInvoices
        .map(inv => ({
            ...inv,
            payments: (paymentsByInvoice.get(inv.id) || []).sort(
                (a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")
            ),
        }))
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    // Surface any credit/advance rows (no invoiceId) as a synthetic trailing row.
    if (unlinkedPayments.length > 0) {
        invoicesWithPayments.unshift({
            id: "__credit__",
            unitId,
            tenantEmail,
            billingPeriod: "Advance / Credit",
            totalAmount: 0,
            amountPaid: unlinkedCollected,
            status: "credit",
            createdAt: unlinkedPayments[unlinkedPayments.length - 1]?.createdAt,
            payments: unlinkedPayments.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")),
        });
    }

    const invoiced = matchingInvoices.reduce((s, inv) => s + Number(inv.totalAmount || 0), 0);
    const invoicedPaid = matchingInvoices.reduce((s, inv) => s + Number(inv.amountPaid || 0), 0);
    const collected = invoicedPaid + unlinkedCollected;
    const paymentCount = Array.from(paymentsByInvoice.values()).reduce((s, l) => s + l.length, 0) + unlinkedPayments.length;

    return {
        invoices: invoicesWithPayments,
        totals: {
            invoiced,
            collected,
            // Outstanding is against billed invoices only — unapplied credit
            // doesn't auto-offset a *different* invoice's due amount here.
            due: Math.max(0, invoiced - invoicedPaid),
            invoiceCount: matchingInvoices.length,
            paymentCount,
        },
    };
}
