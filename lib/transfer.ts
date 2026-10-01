/**
 * Pure helpers for the "Transfer Tenant" flow.
 *
 * Extracted from the inline logic in `app/employee/page.tsx` so that
 * decisions about how co-tenants are handled during a transfer can be
 * unit-tested without Firestore or React. The component calls these
 * builders and then forwards the plain-object results to Firestore
 * `batch.update(...)` calls.
 *
 * See `docs/BUSINESS_RULES.md` for the co-tenant transfer rule.
 */

import type { CoTenant, Unit } from "@/types";

export interface TransferInput {
    source: Unit;
    destUnitId: string;
    transferDate: string;
    /**
     * When the source unit has co-tenants, this flag decides whether
     * they stay in the old unit (true) or move with the primary tenant
     * to the new unit (false — legacy behavior).
     * Ignored when the source has no co-tenants.
     */
    coTenantsStay: boolean;
    /**
     * Index of the co-tenant to promote to primary of the source unit
     * when `coTenantsStay` is true. Clamped to the valid range.
     */
    promoteCoTenantIdx?: number;
    /** ISO timestamp used for `moveOutDate` on the history entry. */
    now: string;
    /** Destination unit — used to compose the alert message / audit note. */
    destUnitNumber: string;
}

export interface TransferPlan {
    /** Shape of the arrayUnion history entry pushed onto source.tenantHistory. */
    historyEntry: {
        tenantName: string;
        tenantEmail: string;
        tenantPhone: string;
        moveInDate: string;
        moveOutDate: string;
        securityDeposit: number;
        securityRefund: number;
        coTenants: CoTenant[];
        note: string;
    };
    /** Patch to apply to the source unit (excluding the arrayUnion). */
    sourceUpdate: Record<string, unknown>;
    /** Patch to apply to the destination unit. */
    destUpdate: Record<string, unknown>;
    /** True when the old unit stays occupied with a promoted co-tenant. */
    keepCoTenantsInSource: boolean;
    /** The co-tenant that was promoted (null when none). */
    promotedCoTenant: CoTenant | null;
}

/**
 * Build the Firestore patches for a tenant transfer.
 *
 * Behaviour:
 *   - `coTenantsStay=false` (default) → source cleared, co-tenants
 *     carried to destination (legacy behaviour).
 *   - `coTenantsStay=true` and source has co-tenants → source stays
 *     `occupied`; the chosen co-tenant is promoted into the primary
 *     fields; the remaining co-tenants stay on the source unit;
 *     destination gets `coTenants: []`.
 *   - `coTenantsStay=true` but source has no co-tenants → treated as
 *     `false` (nothing to keep behind).
 */
export function buildTransferPlan(input: TransferInput): TransferPlan {
    const { source, transferDate, now, destUnitNumber } = input;
    const sourceCoTenants = source.coTenants || [];
    const hasCoTenants = sourceCoTenants.length > 0;
    const keepCoTenantsInSource = hasCoTenants && input.coTenantsStay;

    const historyEntry = {
        tenantName: source.tenantName || "",
        tenantEmail: source.tenantEmail || "",
        tenantPhone: source.tenantPhone || "",
        moveInDate: source.moveInDate || "",
        moveOutDate: now,
        securityDeposit: Number(source.securityDeposit || 0),
        securityRefund: 0,
        coTenants: sourceCoTenants,
        note: `Transferred to ${destUnitNumber}`,
    };

    let sourceUpdate: Record<string, unknown>;
    let promotedCoTenant: CoTenant | null = null;

    if (keepCoTenantsInSource) {
        const rawIdx = Number.isFinite(input.promoteCoTenantIdx)
            ? Number(input.promoteCoTenantIdx)
            : 0;
        const idx = Math.min(Math.max(0, rawIdx), sourceCoTenants.length - 1);
        promotedCoTenant = sourceCoTenants[idx];
        const remainingCoTenants = sourceCoTenants.filter((_, i) => i !== idx);
        sourceUpdate = {
            status: "occupied",
            tenantEmail: (promotedCoTenant.email || "").toLowerCase(),
            tenantName: promotedCoTenant.name || "",
            tenantPhone: promotedCoTenant.phone || "",
            coTenants: remainingCoTenants,
        };
    } else {
        sourceUpdate = {
            status: "vacant",
            tenantEmail: "",
            tenantName: "",
            tenantPhone: "",
            moveInDate: "",
            paymentDay: "",
            coTenants: [],
        };
    }

    const destUpdate: Record<string, unknown> = {
        status: "occupied",
        tenantEmail: source.tenantEmail || "",
        tenantName: source.tenantName || "",
        tenantPhone: source.tenantPhone || "",
        moveInDate: transferDate,
        paymentDay: source.paymentDay || "",
        securityDeposit: source.securityDeposit || "",
        securityDepositDate: source.securityDepositDate || "",
        // Co-tenants either stay back in the old unit or move with the primary.
        coTenants: keepCoTenantsInSource ? [] : sourceCoTenants,
    };

    return {
        historyEntry,
        sourceUpdate,
        destUpdate,
        keepCoTenantsInSource,
        promotedCoTenant,
    };
}
