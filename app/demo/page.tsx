"use client";

import { useState } from "react";
import Link from "next/link";
import { HomeTab } from "@/components/employee/HomeTab";
import {
    demoExpenses,
    demoHomeMonth,
    demoInvoices,
    demoLedger,
    demoTickets,
    demoUnits,
} from "@/lib/demo/seedData";

type Role = "tenant" | "employee" | "admin";

const ROLES: { id: Role; emoji: string; title: string; subtitle: string }[] = [
    { id: "tenant", emoji: "🏠", title: "Tenant", subtitle: "Pay rent, raise tickets, see invoices" },
    { id: "employee", emoji: "👷", title: "Employee / Manager", subtitle: "Collect rent, meter readings, expenses" },
    { id: "admin", emoji: "👑", title: "Admin / Owner", subtitle: "Portfolio KPIs, financials, approvals" },
];

const FEATURES: Record<Role, { emoji: string; title: string; body: string }[]> = {
    tenant: [
        { emoji: "🧾", title: "Monthly Invoices", body: "View current rent + electricity breakdown with billing period labels." },
        { emoji: "💳", title: "UPI Payment", body: "Pay with any UPI app and submit the transaction reference for verification." },
        { emoji: "🛠️", title: "Maintenance Tickets", body: "Raise plumbing / electrical / cleaning issues with photos." },
        { emoji: "📜", title: "Payment History", body: "Download receipts; see partial-payment splits." },
        { emoji: "💬", title: "Telegram Notifications", body: "Link once, get invoice + payment confirmations instantly." },
        { emoji: "📄", title: "Document Vault", body: "Lease agreements and KYC docs shared by the landlord." },
    ],
    employee: [
        { emoji: "🏘", title: "Monthly Property Overview", body: "Every occupied unit grouped as Rent Paid / Rent Pending / Electricity Pending." },
        { emoji: "⚡", title: "Meter Reading", body: "Enter current reading, auto-generates invoice with rent-first split." },
        { emoji: "💰", title: "Collections", body: "Full + partial payments; rent-first allocation; corporate master invoices." },
        { emoji: "🧾", title: "Expense Logging", body: "19 categories including Food & Drinks, Plumbing, Electrical, with receipts." },
        { emoji: "📒", title: "Daily Ledger", body: "Cash inflow/outflow log reconciled against invoices + expenses." },
        { emoji: "🔄", title: "Tenant Transfer", body: "Move tenant between units; co-tenants can stay with the old room or move along." },
        { emoji: "📦", title: "Inventory & Checklists", body: "Track furniture, appliances, monthly maintenance checklists." },
    ],
    admin: [
        { emoji: "📊", title: "Portfolio Dashboard", body: "Income, expenses, net profit, occupancy — day/month toggle." },
        { emoji: "✅", title: "Payment Verification", body: "Approve tenant-submitted UPI references; ledger entries auto-created." },
        { emoji: "📅", title: "Monthly Generation", body: "One-click rent + electricity invoices for the whole building." },
        { emoji: "🏢", title: "Corporate Billing", body: "Master invoices roll up multiple unit invoices for a single tenant entity." },
        { emoji: "📥", title: "CSV Financial Export", body: "Monthly income + expense export for accounting." },
        { emoji: "👥", title: "Access Control", body: "Roles for admin, employee, tenant; user management per building." },
        { emoji: "📢", title: "Broadcast Notices", body: "Push announcements to a single building or every tenant." },
    ],
};

export default function DemoPage() {
    const [role, setRole] = useState<Role>("employee");
    const [showInteractive, setShowInteractive] = useState(false);
    const [homeMonth, setHomeMonth] = useState(demoHomeMonth);

    const occupiedUnits = demoUnits.filter(u => u.status === "occupied");
    const vacantUnits = demoUnits.filter(u => u.status === "vacant");
    const activeTickets = demoTickets.filter(t => t.status !== "resolved");
    const resolvedTickets = demoTickets.filter(t => t.status === "resolved");

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-indigo-50 pb-16">
            {/* Demo banner */}
            <div className="bg-amber-500 text-white text-center text-xs font-bold py-2 px-3 sticky top-0 z-40">
                🧪 DEMO MODE — all data on this page is fictional. Nothing you click here is saved to any database.
                <Link href="/" className="underline ml-2">Back to login</Link>
            </div>

            {/* Hero */}
            <div className="max-w-5xl mx-auto px-4 pt-10 pb-6 text-center">
                <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">
                    Property Manager — Live Demo
                </h1>
                <p className="text-sm sm:text-base text-gray-600 mt-3 max-w-2xl mx-auto">
                    Explore the full feature set with seeded data. No account needed, no real tenants shown,
                    nothing you do is persisted. Pick a role below to see what that user sees.
                </p>
            </div>

            {/* Role switcher */}
            <div className="max-w-5xl mx-auto px-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {ROLES.map(r => {
                        const active = r.id === role;
                        return (
                            <button
                                key={r.id}
                                onClick={() => { setRole(r.id); setShowInteractive(false); }}
                                className={`text-left p-4 rounded-xl border-2 transition shadow-sm ${
                                    active
                                        ? "border-indigo-500 bg-indigo-50 shadow-md"
                                        : "border-gray-200 bg-white hover:border-indigo-200"
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-2xl">{r.emoji}</span>
                                    <span className="font-bold text-gray-900">{r.title}</span>
                                </div>
                                <p className="text-xs text-gray-600 mt-1">{r.subtitle}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Feature grid */}
            <div className="max-w-5xl mx-auto px-4 mt-8">
                <h2 className="text-lg font-bold text-gray-800 mb-3">
                    What a {ROLES.find(r => r.id === role)!.title.toLowerCase()} can do
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {FEATURES[role].map(f => (
                        <div key={f.title} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-xl">{f.emoji}</span>
                                <h3 className="font-bold text-gray-900 text-sm">{f.title}</h3>
                            </div>
                            <p className="text-xs text-gray-600 leading-relaxed">{f.body}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Interactive section — employee only (uses real HomeTab component) */}
            {role === "employee" && (
                <div className="max-w-5xl mx-auto px-4 mt-10">
                    <div className="bg-white rounded-xl border border-indigo-200 shadow-sm overflow-hidden">
                        <div className="bg-indigo-50 px-5 py-4 border-b border-indigo-200 flex justify-between items-center flex-wrap gap-2">
                            <div>
                                <h2 className="text-lg font-bold text-indigo-900">🚀 Try the Employee Home Tab</h2>
                                <p className="text-xs text-indigo-700 mt-0.5">
                                    This is the real component — rendered with mock data. Click around safely.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowInteractive(v => !v)}
                                className="bg-indigo-600 text-white text-sm font-bold px-4 py-2 rounded-md hover:bg-indigo-700"
                            >
                                {showInteractive ? "Hide" : "Launch Interactive Demo"}
                            </button>
                        </div>
                        {showInteractive && (
                            <div className="p-4 bg-gray-50">
                                <HomeTab
                                    allInvoices={demoInvoices}
                                    occupiedUnits={occupiedUnits}
                                    allUnits={demoUnits}
                                    vacantUnits={vacantUnits}
                                    activeTickets={activeTickets}
                                    resolvedTickets={resolvedTickets}
                                    allExpenses={demoExpenses}
                                    allLedgerEntries={demoLedger}
                                    homeMonth={homeMonth}
                                    setHomeMonth={setHomeMonth}
                                    onNavigate={(tab) => alert(`Demo: would navigate to "${tab}" tab.`)}
                                    onOpenTodayCollections={() => alert("Demo: would open Today's Collections modal.")}
                                    openTenantProfile={(u) => alert(`Demo: would open profile for ${u.unitNumber} — ${u.tenantName ?? "—"}`)}
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Tenant / admin: screenshot placeholders → describe + CTA */}
            {role !== "employee" && (
                <div className="max-w-5xl mx-auto px-4 mt-10">
                    <div className="bg-white rounded-xl border border-gray-200 p-6 text-center shadow-sm">
                        <p className="text-sm text-gray-700">
                            The <strong>{ROLES.find(r => r.id === role)!.title}</strong> interface is driven by live Firestore data
                            and isn&apos;t safe to render against a shared demo dataset in-browser.
                        </p>
                        <p className="text-xs text-gray-500 mt-2">
                            To see it in action, request a trial login from your administrator — the UI mirrors the feature list above.
                        </p>
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="max-w-5xl mx-auto px-4 mt-10 text-center">
                <p className="text-xs text-gray-500">
                    All data here is fictional. Need the real thing?{" "}
                    <Link href="/" className="text-indigo-600 font-bold underline">Sign in</Link>
                </p>
            </div>
        </div>
    );
}
