/**
 * Seeded, in-memory data for the public `/demo` route.
 *
 * Nothing in this file touches Firebase. It exists so prospective users
 * can click around a realistic view of the app without an account and
 * without any risk of mutating real tenant data.
 *
 * The shapes mirror the production types in `types/index.ts` so the real
 * presentational components (HomeTab, MonthCollectionsCard, …) can render
 * this data unchanged.
 */

import type {
    Expense,
    Invoice,
    LedgerEntry,
    MaintenanceTicket,
    Unit,
} from "@/types";

const now = new Date();
const iso = (d: Date) => d.toISOString();
const monthLabel = (d: Date) =>
    d.toLocaleString("default", { month: "long", year: "numeric" });

const currentMonth = monthLabel(now);
const prevMonth = monthLabel(new Date(now.getFullYear(), now.getMonth() - 1, 1));

export const DEMO_BUILDING_ID = "demo_bldg_sunrise";
export const DEMO_BUILDING_NAME = "Sunrise Residency (Demo)";

export const demoUnits: Unit[] = [
    {
        id: "demo_unit_101",
        buildingId: DEMO_BUILDING_ID,
        unitNumber: "101",
        baseRent: 12000,
        status: "occupied",
        tenantEmail: "aarav.demo@example.com",
        tenantName: "Aarav Sharma",
        tenantPhone: "9000000001",
        moveInDate: "2026-01-08",
        paymentDay: 8,
        lastMeterReading: 1420,
        securityDeposit: 24000,
    },
    {
        id: "demo_unit_102",
        buildingId: DEMO_BUILDING_ID,
        unitNumber: "102",
        baseRent: 10500,
        status: "occupied",
        tenantEmail: "priya.demo@example.com",
        tenantName: "Priya Verma",
        tenantPhone: "9000000002",
        moveInDate: "2025-11-15",
        paymentDay: 15,
        lastMeterReading: 2210,
        securityDeposit: 21000,
        coTenants: [
            { name: "Rahul Verma", phone: "9000000012", email: "rahul.demo@example.com", addedAt: "2026-02-01T00:00:00Z" },
        ],
    },
    {
        id: "demo_unit_201",
        buildingId: DEMO_BUILDING_ID,
        unitNumber: "201",
        baseRent: 15000,
        status: "occupied",
        tenantEmail: "corporate.demo@example.com",
        tenantName: "Acme Corp (Guest House)",
        tenantPhone: "9000000003",
        moveInDate: "2025-07-01",
        paymentDay: 1,
        lastMeterReading: 3105,
        securityDeposit: 30000,
    },
    {
        id: "demo_unit_202",
        buildingId: DEMO_BUILDING_ID,
        unitNumber: "202",
        baseRent: 11500,
        status: "vacant",
    },
    {
        id: "demo_unit_301",
        buildingId: DEMO_BUILDING_ID,
        unitNumber: "301",
        baseRent: 13500,
        status: "vacant",
    },
];

export const demoInvoices: Invoice[] = [
    // Current month — one paid, one partial, one unpaid
    {
        id: "demo_inv_101_curr",
        unitId: "demo_unit_101",
        unitNumber: "101",
        tenantEmail: "aarav.demo@example.com",
        status: "paid",
        totalAmount: 13240,
        baseRent: 12000,
        electricityCharge: 1240,
        electricityConsumed: 155,
        electricityRate: 8,
        amountPaid: 13240,
        billingPeriod: currentMonth,
        createdAt: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        paidAt: iso(new Date(now.getFullYear(), now.getMonth(), 4)),
        transactionId: "DEMO-UPI-1001",
    },
    {
        id: "demo_inv_102_curr",
        unitId: "demo_unit_102",
        unitNumber: "102",
        tenantEmail: "priya.demo@example.com",
        status: "pending",
        totalAmount: 11700,
        baseRent: 10500,
        electricityCharge: 1200,
        electricityConsumed: 150,
        electricityRate: 8,
        amountPaid: 6000, // Partial payment — rent partially covered
        billingPeriod: currentMonth,
        createdAt: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        transactionId: "",
    },
    {
        id: "demo_inv_201_curr",
        unitId: "demo_unit_201",
        unitNumber: "201",
        tenantEmail: "corporate.demo@example.com",
        status: "unpaid",
        totalAmount: 16800,
        baseRent: 15000,
        electricityCharge: 1800,
        electricityConsumed: 225,
        electricityRate: 8,
        amountPaid: 0,
        billingPeriod: currentMonth,
        createdAt: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        transactionId: "",
    },
    // Previous month — one carrying balance, one fully paid
    {
        id: "demo_inv_102_prev",
        unitId: "demo_unit_102",
        unitNumber: "102",
        tenantEmail: "priya.demo@example.com",
        status: "pending",
        totalAmount: 11420,
        baseRent: 10500,
        electricityCharge: 920,
        amountPaid: 4000,
        billingPeriod: prevMonth,
        createdAt: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        transactionId: "",
    },
    {
        id: "demo_inv_101_prev",
        unitId: "demo_unit_101",
        unitNumber: "101",
        tenantEmail: "aarav.demo@example.com",
        status: "paid",
        totalAmount: 13120,
        baseRent: 12000,
        electricityCharge: 1120,
        amountPaid: 13120,
        billingPeriod: prevMonth,
        createdAt: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        paidAt: iso(new Date(now.getFullYear(), now.getMonth() - 1, 7)),
        transactionId: "DEMO-UPI-0998",
    },
];

export const demoTickets: MaintenanceTicket[] = [
    {
        id: "demo_tkt_1",
        category: "Plumbing",
        unitId: "demo_unit_102",
        unitNumber: "102",
        buildingName: DEMO_BUILDING_NAME,
        tenantEmail: "priya.demo@example.com",
        description: "Kitchen sink leak under the trap",
        status: "pending",
        comments: [],
        createdAt: iso(new Date(now.getTime() - 2 * 86400000)),
    },
    {
        id: "demo_tkt_2",
        category: "Electrical",
        unitId: "demo_unit_201",
        unitNumber: "201",
        buildingName: DEMO_BUILDING_NAME,
        description: "Bedroom MCB tripping intermittently",
        status: "in-progress",
        comments: [],
        createdAt: iso(new Date(now.getTime() - 4 * 86400000)),
    },
    {
        id: "demo_tkt_3",
        category: "Common Area",
        unitId: "demo_unit_101",
        unitNumber: "101",
        buildingName: DEMO_BUILDING_NAME,
        description: "Lobby lightbulb replaced",
        status: "resolved",
        resolvedAt: iso(new Date(now.getTime() - 1 * 86400000)),
        resolvedBy: "demo.employee@example.com",
        comments: [],
        createdAt: iso(new Date(now.getTime() - 3 * 86400000)),
    },
];

export const demoExpenses: Expense[] = [
    {
        id: "demo_exp_1",
        amount: 1800,
        category: "Plumbing",
        description: "Replaced bathroom tap in unit 102",
        date: iso(new Date(now.getTime() - 1 * 86400000)).slice(0, 10),
        buildingId: DEMO_BUILDING_ID,
        buildingName: DEMO_BUILDING_NAME,
        createdBy: "demo.employee@example.com",
        createdAt: iso(new Date(now.getTime() - 1 * 86400000)),
    },
    {
        id: "demo_exp_2",
        amount: 650,
        category: "Food & Drinks",
        description: "Tea & snacks for monthly meeting",
        date: iso(new Date(now.getTime() - 3 * 86400000)).slice(0, 10),
        buildingId: DEMO_BUILDING_ID,
        buildingName: DEMO_BUILDING_NAME,
        createdBy: "demo.employee@example.com",
        createdAt: iso(new Date(now.getTime() - 3 * 86400000)),
    },
    {
        id: "demo_exp_3",
        amount: 4200,
        category: "Electrical",
        description: "Replaced common-area wiring on 2nd floor",
        date: iso(new Date(now.getTime() - 7 * 86400000)).slice(0, 10),
        buildingId: DEMO_BUILDING_ID,
        buildingName: DEMO_BUILDING_NAME,
        createdBy: "demo.admin@example.com",
        createdAt: iso(new Date(now.getTime() - 7 * 86400000)),
        settled: true,
        settledAt: iso(new Date(now.getTime() - 6 * 86400000)),
        settledBy: "demo.admin@example.com",
    },
];

export const demoLedger: LedgerEntry[] = [
    {
        id: "demo_le_1",
        tenantEmail: "aarav.demo@example.com",
        unitId: "demo_unit_101",
        unitNumber: "101",
        invoiceId: "demo_inv_101_curr",
        billingPeriod: currentMonth,
        invoiceAmount: 13240,
        amountPaid: 13240,
        balance: 0,
        transactionId: "DEMO-UPI-1001",
        type: "payment",
        paymentMode: "UPI",
        settledBy: "demo.employee@example.com",
        createdAt: iso(new Date(now.getFullYear(), now.getMonth(), 4)),
    },
    {
        id: "demo_le_2",
        tenantEmail: "priya.demo@example.com",
        unitId: "demo_unit_102",
        unitNumber: "102",
        invoiceId: "demo_inv_102_curr",
        billingPeriod: currentMonth,
        invoiceAmount: 11700,
        amountPaid: 6000,
        balance: -5700,
        transactionId: "DEMO-UPI-1002",
        type: "partial",
        paymentMode: "Cash",
        settledBy: "demo.employee@example.com",
        createdAt: iso(new Date(now.getFullYear(), now.getMonth(), 6)),
    },
];

/** Default month shown in the `homeMonth` state (YYYY-MM). */
export const demoHomeMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
