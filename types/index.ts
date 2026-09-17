// Shared TypeScript types for the Property Manager application

export interface Building {
    id: string;
    name: string;
    address: string;
    totalUnits: number;
    createdAt: string;
}

export interface Unit {
    id: string;
    buildingId: string;
    unitNumber: string;
    baseRent: number;
    status: "vacant" | "occupied";
    tenantEmail?: string;
    tenantName?: string;
    tenantPhone?: string;
    moveInDate?: string;
    lastMeterReading?: number;
    paymentDay?: number;
    securityDeposit?: number;
    securityDepositDate?: string;
    lastChecklistDeduction?: number;
    coTenants?: CoTenant[];
    documents?: UnitDocument[];
    notes?: UnitNote[];
    tenantHistory?: TenantHistoryEntry[];
    emergencyContact?: string;
    leaseStart?: string;
    leaseEnd?: string;
    /** Per-unit electricity rate override (₹/unit); falls back to global default when unset. */
    electricityRate?: number;
    /** When set, the unit is leased under a corporate `Tenant` doc — invoices
     *  generated for this unit will be rolled up into that tenant's monthly
     *  `MasterInvoice`. See `docs/CORPORATE_TENANT_BILLING.md`. */
    tenantId?: string;
}

export interface CoTenant {
    name: string;
    phone: string;
    email: string;
    addedAt: string;
}

export interface UnitDocument {
    name: string;
    url: string;
    uploadedAt: string;
}

export interface UnitNote {
    text: string;
    author: string;
    createdAt: string;
}

export interface TenantHistoryEntry {
    tenantName: string;
    tenantEmail: string;
    tenantPhone: string;
    moveInDate: string;
    moveOutDate: string;
    securityDeposit: number;
    securityRefund: number;
    coTenants: CoTenant[];
}

export interface Invoice {
    id: string;
    unitId: string;
    unitNumber: string;
    tenantEmail: string;
    status: "unpaid" | "pending" | "paid" | "written-off";
    totalAmount: number;
    billingPeriod: string;
    /** Human-readable date range the rent covers, e.g. "8 Sep 2026 – 8 Oct 2026". */
    rentPeriod?: string;
    /** Month label for which electricity consumption is billed, e.g. "August 2026". */
    electricityPeriod?: string;
    baseRent: number;
    previousReading?: number;
    currentReading?: number;
    electricityConsumed?: number;
    electricityRate?: number;
    electricityCharge?: number;
    carryForward?: number;
    meterChanged?: boolean;
    manualUnitsReason?: string;
    isCustom?: boolean;
    transactionId?: string;
    amountPaid?: number;
    paidAt?: string;
    paymentScreenshotUrl?: string;
    paymentNote?: string;
    /** Bookkeeping fields set when an invoice is marked uncollectible
     *  (tenant absconded / cannot be recovered). Preserves the audit
     *  trail without polluting pending collections. */
    writtenOff?: boolean;
    writtenOffAt?: string;
    writtenOffBy?: string;
    writtenOffReason?: string;
    /** When set, this invoice is rolled up into a corporate `MasterInvoice`.
     *  Payment flows through the master; per-unit settlement is disabled. */
    masterInvoiceId?: string;
    createdAt: string;
}

export interface MaintenanceTicket {
    id: string;
    category: string;
    unitId?: string;
    unitNumber: string;
    buildingName: string;
    tenantEmail?: string;
    reportedBy?: string;
    description: string;
    status: "pending" | "in-progress" | "resolved";
    photoUrl?: string;
    resolutionPhotoUrl?: string;
    resolutionNote?: string;
    resolvedAt?: string;
    resolvedBy?: string;
    comments: TicketComment[];
    createdAt: string;
}

export interface TicketComment {
    author: string;
    text: string;
    timestamp: string;
}

export interface LedgerEntry {
    id: string;
    tenantEmail: string;
    unitId: string;
    unitNumber: string;
    invoiceId: string;
    billingPeriod: string;
    invoiceAmount: number;
    amountPaid: number;
    balance: number;
    transactionId: string;
    type: string;
    paymentMode?: string;
    paymentReference?: string | null;
    settledBy?: string;
    correctedAt?: string;
    correctionNote?: string;
    correctedBy?: string;
    originalAmountPaid?: number;
    createdAt: string;
}

/**
 * A single row in the DailyLedger — a manager-recorded cash movement.
 * Inflows and outflows share this schema; distinguish via `direction`.
 * Deletions are soft — `deleted:true` is respected everywhere so historical
 * totals remain immutable.
 */
export interface DailyLedgerEntry {
    id: string;
    /** YYYY-MM-DD */
    date: string;
    direction: "inflow" | "outflow";
    category: string;
    amount: number;
    description?: string;
    unitId?: string;
    unitNumber?: string;
    buildingId?: string;
    buildingName?: string;
    tenantName?: string;
    tenantEmail?: string;
    invoiceId?: string;
    expenseId?: string;
    paymentMode?: string;
    paymentReference?: string | null;
    workerName?: string;
    hoursWorked?: number;
    quantity?: number;
    vendor?: string;
    receiptUrl?: string;
    note?: string | null;
    createdBy?: string;
    recordedBy?: string;
    deleted?: boolean;
    createdAt: string;
}

export interface Expense {
    id: string;
    amount: number;
    category: string;
    description: string;
    date: string;
    buildingId?: string;
    buildingName?: string;
    receiptUrl?: string;
    createdBy?: string;
    createdAt: string;
    settled?: boolean;
    settledAt?: string;
    settledBy?: string;
    deleted?: boolean;
    deletedAt?: string;
    deletedBy?: string;
    /** When an admin logs an expense, it's mirrored to dailyLedger and this
     * field cross-links the two documents so soft-delete can cascade. */
    dailyLedgerId?: string;
}

export interface Allocation {
    id: string;
    amount: number;
    note?: string;
    date: string;
    buildingId?: string;
    buildingName?: string;
    createdBy?: string;
    createdAt: string;
}

export interface InventoryItem {
    id: string;
    name: string;
    quantity: number;
    buildingId?: string;
    buildingName?: string;
    location?: string;
    condition: "good" | "fair" | "poor";
    notes?: string;
    createdBy?: string;
    createdAt: string;
    updatedAt: string;
}

export interface Checklist {
    id: string;
    unitId: string;
    unitNumber: string;
    buildingId: string;
    type: "move-in" | "move-out";
    rooms: ChecklistRoom[];
    notes: string;
    deduction: number;
    tenantEmail: string;
    tenantName: string;
    createdAt: string;
    createdBy: string;
}

export interface ChecklistRoom {
    room: string;
    condition: string;
    damages: string;
    photoUrl?: string;
}

export interface Contact {
    id: string;
    name: string;
    role: string;
    phone: string;
    createdAt: string;
}

export interface Announcement {
    id: string;
    title: string;
    message: string;
    target: string;
    author: string;
    createdAt: string;
}

export interface AppUser {
    id: string;
    name?: string;
    email?: string;
    phone?: string;
    role: "admin" | "employee" | "tenant";
    createdAt: string;
    /** Unit number the tenant occupies (denormalized for /status command). */
    unitNumber?: string;
    // ── Telegram integration (see docs/TELEGRAM_INTEGRATION.md §4.1) ──
    /** Numeric chat id set once the user completes `/start <code>`. */
    telegramChatId?: string;
    /** Optional Telegram @username captured from the webhook update. */
    telegramUsername?: string;
    /** True after `/start <code>`, false after `/stop`. */
    telegramOptIn?: boolean;
    /** ISO timestamp of last opt-in. */
    telegramOptInAt?: string;
    /** One-time code used inside the `t.me/<bot>?start=<code>` deep-link. */
    telegramLinkCode?: string;
}

/**
 * A tenant's application for a vacant unit. Created by the tenant, reviewed
 * and approved/rejected by admin/employee.
 */
export interface Application {
    id: string;
    tenantEmail: string;
    unitId: string;
    unitNumber: string;
    buildingId?: string;
    securityDeposit?: number;
    transactionId?: string;
    idProofUrl?: string;
    paymentProofUrl?: string;
    status: "pending" | "approved" | "rejected";
    createdAt: string;
}

export type EmployeeTab = "active" | "resolved" | "meter" | "collections" | "ledger" | "units" | "occupancy" | "checklist" | "expenses" | "inventory";

/**
 * Corporate (multi-unit) tenant billing — see
 * `docs/CORPORATE_TENANT_BILLING.md`.
 *
 * A `Tenant` is a first-class billable party. Retail tenants (one household,
 * one flat) may keep using the unit-embedded tenant fields; corporate tenants
 * (one company, N rooms) require a `Tenant` doc so multiple `Unit`s can share
 * a single billing identity.
 */
export interface Tenant {
    id: string;
    kind: "retail" | "corporate";
    /** Display name — company legal name for corporate, occupant name for retail. */
    name: string;
    gstin?: string;
    pan?: string;
    billingContact: {
        name: string;
        email: string;
        phone: string;
    };
    accountsContact?: { name: string; email: string; phone?: string };
    billingAddress?: string;
    /** Units currently assigned to this tenant; mirrors `Unit.tenantId`. */
    unitIds: string[];
    /** "consolidated" → one master invoice/month; "per-unit" → legacy flow. */
    billingMode: "per-unit" | "consolidated";
    /** Payment allocation strategy for master invoices. */
    paymentAllocationStrategy?: "rent-first-then-electricity" | "pro-rata";
    /** Day of month the master invoice is generated. */
    billingDayOfMonth?: number;
    notes?: string;
    createdAt: string;
    createdBy?: string;
    archivedAt?: string;
}

/**
 * A rolled-up monthly bill covering multiple per-unit `Invoice` documents.
 * The child invoices remain the source of truth for meter readings and per-
 * unit ledger entries; the master invoice is a billing wrapper that aggregates
 * their totals and takes one payment.
 */
export interface MasterInvoice {
    id: string;
    tenantId: string;
    tenantName: string;
    /** e.g. "September 2026" */
    billingPeriod: string;
    childInvoiceIds: string[];
    /** Denormalised snapshot of each child at generation time. */
    lines: MasterInvoiceLine[];
    subtotalRent: number;
    subtotalElectricity: number;
    subtotalCarryForward: number;
    adjustments?: { label: string; amount: number }[];
    totalAmount: number;
    amountPaid: number;
    status: "unpaid" | "partial" | "paid" | "void";
    paidAt?: string;
    transactionId?: string;
    paymentMode?: string;
    paymentReference?: string | null;
    paymentScreenshotUrl?: string;
    paymentNote?: string;
    /** GST-style invoice number, e.g. "MI/2026-27/00042". */
    invoiceNumber?: string;
    pdfUrl?: string;
    /** ID of a master invoice this one supersedes (void + re-issue chain). */
    supersedes?: string;
    createdBy?: string;
    createdAt: string;
    voidedAt?: string;
    voidedBy?: string;
    voidReason?: string;
}

export interface MasterInvoiceLine {
    invoiceId: string;
    unitId: string;
    unitNumber: string;
    baseRent: number;
    previousReading?: number;
    currentReading?: number;
    electricityConsumed?: number;
    electricityRate?: number;
    electricityCharge: number;
    carryForward: number;
    /** Meter irregularity flags copied from the child invoice for PDF rendering. */
    meterChanged?: boolean;
    manualUnitsReason?: string;
    lineTotal: number;
}
