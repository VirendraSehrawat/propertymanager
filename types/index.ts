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
    status: "unpaid" | "pending" | "paid";
    totalAmount: number;
    billingPeriod: string;
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
    settledBy?: string;
    correctedAt?: string;
    correctionNote?: string;
    correctedBy?: string;
    originalAmountPaid?: number;
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
}

export type EmployeeTab = "active" | "resolved" | "meter" | "collections" | "ledger" | "units" | "occupancy" | "checklist" | "expenses" | "inventory";
