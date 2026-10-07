/**
 * Centralized Firestore collection names.
 *
 * Previously collection names were string literals scattered across pages and
 * components (`collection(db, "invoices")`, `doc(db, "units", id)`, …). A typo
 * silently created/read the wrong collection. Importing from here gives us a
 * single source of truth and lets TypeScript catch mistakes.
 *
 * Usage:
 *   import { COL } from "@/lib/collections";
 *   collection(db, COL.invoices);
 *   doc(db, COL.units, unitId);
 */

export const COL = {
    users: "users",
    buildings: "buildings",
    units: "units",
    invoices: "invoices",
    masterInvoices: "masterInvoices",
    maintenance: "maintenance",
    expenses: "expenses",
    /** Per-invoice payment history rows (single-unit flow). */
    ledger: "ledger",
    /** Per-invoice payment history rows written by the master-invoice flow. */
    ledgerEntries: "ledgerEntries",
    dailyLedger: "dailyLedger",
    allocations: "allocations",
    inventory: "inventory",
    checklists: "checklists",
    contacts: "contacts",
    announcements: "announcements",
    applications: "applications",
    tenants: "tenants",
    settings: "settings",
    tgMessages: "tgMessages",
} as const;

/** Union of all known collection names. */
export type CollectionName = (typeof COL)[keyof typeof COL];
