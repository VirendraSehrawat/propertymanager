/**
 * Pure helpers for the final (move-out) invoice. After a tenant is vacated the
 * employee can set any rent and electricity amount, either on the unit's open
 * invoice or on a fresh final invoice.
 */

export interface VacateAmounts {
    rent: number;
    electricity: number;
}

export function vacateAmountErrors(a: VacateAmounts): string[] {
    const errs: string[] = [];
    if (!Number.isFinite(a.rent) || a.rent < 0) errs.push("Rent must be 0 or more.");
    if (!Number.isFinite(a.electricity) || a.electricity < 0) errs.push("Electricity bill must be 0 or more.");
    return errs;
}

/** Fields to merge into an existing invoice when its rent / electricity is overridden. */
export function applyVacateAmounts(
    inv: { carryForward?: number; customItems?: { amount: number }[] },
    a: VacateAmounts,
): { baseRent: number; electricityCharge: number; totalAmount: number } {
    const extras = (inv.customItems || []).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    return {
        baseRent: a.rent,
        electricityCharge: a.electricity,
        totalAmount: a.rent + a.electricity + (Number(inv.carryForward) || 0) + extras,
    };
}

export function buildVacateInvoice(args: {
    unitId: string;
    unitNumber: string;
    tenantEmail: string;
    amounts: VacateAmounts;
    note?: string;
    now?: string;
}): { invoiceId: string; fields: Record<string, unknown> } {
    const now = args.now || new Date().toISOString();
    const ym = now.slice(0, 7);
    return {
        invoiceId: `inv_${args.unitId}_vacate_${now.replace(/\D/g, "").slice(0, 14)}`,
        fields: {
            unitId: args.unitId,
            unitNumber: args.unitNumber,
            tenantEmail: args.tenantEmail,
            baseRent: args.amounts.rent,
            previousReading: 0,
            currentReading: 0,
            electricityConsumed: 0,
            electricityCharge: args.amounts.electricity,
            totalAmount: args.amounts.rent + args.amounts.electricity,
            billingPeriod: "Final bill (Move-out)",
            billingYm: ym,
            status: "unpaid",
            transactionId: "",
            isCustom: true,
            manualUnitsReason: args.note?.trim() || "Move-out final bill",
            createdAt: now,
        },
    };
}

export interface VacatePlan {
    deposit: number;
    deduction: number;
    refund: number;
    historyEntry: {
        tenantName: string;
        tenantEmail: string;
        tenantPhone: string;
        moveInDate: string;
        moveOutDate: string;
        securityDeposit: number;
        securityRefund: number;
        coTenants: unknown[];
    };
    unitUpdate: Record<string, unknown>;
}

/** Security-deposit refund, history entry and unit patch for removing a tenant. */
export function buildVacatePlan(
    unit: {
        tenantName?: string; tenantEmail?: string; tenantPhone?: string; moveInDate?: string;
        securityDeposit?: number | string; lastChecklistDeduction?: number | string; coTenants?: unknown[];
    } | undefined,
    now: string,
): VacatePlan {
    const deposit = unit?.securityDeposit ? Number(unit.securityDeposit) : 0;
    const deduction = unit?.lastChecklistDeduction ? Number(unit.lastChecklistDeduction) : 0;
    const refund = Math.max(0, deposit - deduction);
    return {
        deposit,
        deduction,
        refund,
        historyEntry: {
            tenantName: unit?.tenantName || "",
            tenantEmail: unit?.tenantEmail || "",
            tenantPhone: unit?.tenantPhone || "",
            moveInDate: unit?.moveInDate || "",
            moveOutDate: now,
            securityDeposit: deposit,
            securityRefund: refund,
            coTenants: unit?.coTenants || [],
        },
        unitUpdate: {
            status: "vacant",
            tenantEmail: "",
            tenantName: "",
            tenantPhone: "",
            moveInDate: "",
            paymentDay: "",
            securityDeposit: "",
            securityDepositDate: "",
            lastChecklistDeduction: "",
            coTenants: [],
        },
    };
}
