"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut } from "firebase/auth";
import {
    collection,
    onSnapshot,
    query,
    orderBy,
    where,
    doc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { mapSnapshot } from "@/lib/firestore";
import { useAuth } from "@/context/AuthContext";
import type {
    Building,
    Invoice,
    MaintenanceTicket,
    Contact,
    Announcement,
    Expense,
    LedgerEntry,
    DailyLedgerEntry,
    AppUser,
    Application,
    Unit,
    MasterInvoice,
} from "@/types";
import { TabButton } from "@/components/ui";
import { DailyLedgerTab } from "@/components/employee";
import {
    AdminOverviewTab,
    AdminBuildingsTab,
    AdminTenantsTab,
    AdminInvoicesTab,
    AdminExpensesTab,
    AdminLedgerTab,
    AdminUsersTab,
    AdminMaintenanceTab,
    AdminApplicationsTab,
    AdminAnnouncementsTab,
    AdminContactsTab,
    AdminSettingsTab,
} from "@/components/admin";

type AdminTab =
    | "overview"
    | "buildings"
    | "tenants"
    | "invoices"
    | "expenses"
    | "ledger"
    | "daily"
    | "users"
    | "maintenance"
    | "applications"
    | "announcements"
    | "contacts"
    | "settings";

export default function AdminDashboard() {
    const { user, role, loading } = useAuth();
    const router = useRouter();

    const [activeTab, setActiveTab] = useState<AdminTab>("overview");

    // Core Data States
    const [buildings, setBuildings] = useState<Building[]>([]);
    const [allUnits, setAllUnits] = useState<Unit[]>([]);
    const [occupiedUnits, setOccupiedUnits] = useState<Unit[]>([]);
    const [applications, setApplications] = useState<Application[]>([]);
    const [pendingInvoices, setPendingInvoices] = useState<Invoice[]>([]);
    const [paidInvoices, setPaidInvoices] = useState<Invoice[]>([]);
    const [unpaidInvoices, setUnpaidInvoices] = useState<Invoice[]>([]);
    const [maintenanceTickets, setMaintenanceTickets] = useState<MaintenanceTicket[]>([]);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [allLedgerEntries, setAllLedgerEntries] = useState<LedgerEntry[]>([]);
    const [allUsers, setAllUsers] = useState<AppUser[]>([]);
    const [dailyLedgerEntries, setDailyLedgerEntries] = useState<DailyLedgerEntry[]>([]);
    const [masterInvoices, setMasterInvoices] = useState<MasterInvoice[]>([]);

    // Settings States
    const [upiId, setUpiId] = useState("");
    const [payeeName, setPayeeName] = useState("");

    // Date & Export States
    const [exportMonth, setExportMonth] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    const [isExporting, setIsExporting] = useState(false);

    const allInvoicesForDashboard = [...paidInvoices, ...unpaidInvoices, ...pendingInvoices];
    const dashboardPeriods = [...new Set(allInvoicesForDashboard.filter(inv => !inv.isCustom && inv.billingPeriod).map(inv => inv.billingPeriod!))].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    const [dashboardMonth, setDashboardMonth] = useState(() => {
        const now = new Date();
        return now.toLocaleString('default', { month: 'long', year: 'numeric' });
    });

    // Global month state
    const [globalMonth, setGlobalMonthState] = useState<string>(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });

    const applyGlobalMonth = (ym: string) => {
        setGlobalMonthState(ym);
        const [y, m] = ym.split("-").map(Number);
        const label = new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
        setDashboardMonth(label);
        setExportMonth(ym);
    };

    // Financial export handler
    const handleExportFinancials = () => {
        if (!exportMonth) {
            alert("Please select a month to export.");
            return;
        }
        setIsExporting(true);
        try {
            const [year, month] = exportMonth.split("-");
            const targetMonth = parseInt(month, 10);
            const targetYear = parseInt(year, 10);

            const monthIncome = paidInvoices.filter(inv => {
                if (!inv.paidAt) return false;
                const d = new Date(inv.paidAt);
                return d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth;
            });

            const monthExpenses = expenses.filter(exp => {
                if (!exp.date) return false;
                const d = new Date(exp.date);
                return d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth;
            });

            let csvContent = "Date,Type,Category/Unit,Description/Tenant,Amount (INR)\n";
            let totalInc = 0;
            let totalExp = 0;

            monthIncome.forEach(inv => {
                const dateStr = new Date(inv.paidAt!).toLocaleDateString();
                const amount = Number(inv.totalAmount || 0);
                totalInc += amount;
                csvContent += `"${dateStr}","Income","Unit ${inv.unitNumber}","${inv.tenantEmail}","${amount}"\n`;
            });

            monthExpenses.forEach(exp => {
                const dateStr = new Date(exp.date).toLocaleDateString();
                const amount = Number(exp.amount || 0);
                totalExp += amount;
                csvContent += `"${dateStr}","Expense","${exp.category}","${exp.description}","-${amount}"\n`;
            });

            const currentNetProfit = totalInc - totalExp;
            csvContent += `\n"","","","TOTAL INCOME","${totalInc}"\n`;
            csvContent += `"","","","TOTAL EXPENSES","-${totalExp}"\n`;
            csvContent += `"","","","NET PROFIT","${currentNetProfit}"\n`;

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `Property_Financials_${exportMonth}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error("Export failed", error);
            alert("Failed to generate report.");
        } finally {
            setIsExporting(false);
        }
    };

    // Route Protection
    useEffect(() => {
        if (!loading && (!user || role !== "admin")) router.push("/");
        if (role === "admin") document.title = "Admin Portal | Property Manager";
    }, [user, role, loading, router]);

    // Firestore Listeners
    useEffect(() => {
        if (role !== "admin") return;

        const unsubBldgs = onSnapshot(query(collection(db, "buildings"), orderBy("createdAt", "desc")), (snapshot) => {
            setBuildings(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Building)));
        });

        const unsubApps = onSnapshot(query(collection(db, "applications"), where("status", "==", "pending")), (snapshot) => {
            const appsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Application));
            appsData.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            setApplications(appsData);
        });

        const unsubAllInvoices = onSnapshot(collection(db, "invoices"), (snapshot) => {
            const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Invoice));
            setPendingInvoices(all.filter(i => i.status === "pending").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
            setPaidInvoices(all.filter(i => i.status === "paid"));
            setUnpaidInvoices(all.filter(i => i.status === "unpaid"));
        });

        const unsubTickets = onSnapshot(collection(db, "maintenance"), (snapshot) => {
            const tData = mapSnapshot<MaintenanceTicket>(snapshot);
            tData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setMaintenanceTickets(tData);
        });

        const unsubContacts = onSnapshot(collection(db, "contacts"), (snapshot) => {
            setContacts(mapSnapshot<Contact>(snapshot));
        });

        const unsubOccupied = onSnapshot(query(collection(db, "units"), where("status", "==", "occupied")), (snapshot) => {
            setOccupiedUnits(mapSnapshot<Unit>(snapshot).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })));
        });

        const unsubExpenses = onSnapshot(collection(db, "expenses"), (snapshot) => {
            const expData = mapSnapshot<Expense>(snapshot);
            expData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setExpenses(expData);
        });

        const unsubSettings = onSnapshot(doc(db, "settings", "payment"), (docSnap) => {
            if (docSnap.exists()) {
                setUpiId(docSnap.data().upiId || "");
                setPayeeName(docSnap.data().payeeName || "");
            }
        });

        const unsubAnnouncements = onSnapshot(collection(db, "announcements"), (snapshot) => {
            const annData = mapSnapshot<Announcement>(snapshot);
            annData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setAnnouncements(annData);
        });

        const unsubLedger = onSnapshot(collection(db, "ledger"), (snapshot) => {
            setAllLedgerEntries(mapSnapshot<LedgerEntry>(snapshot).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        });

        const unsubUsers = onSnapshot(collection(db, "users"), (snapshot) => {
            setAllUsers(mapSnapshot<AppUser>(snapshot).sort((a, b) => (a.email || "").localeCompare(b.email || "")));
        });

        const unsubDailyLedger = onSnapshot(collection(db, "dailyLedger"), (snapshot) => {
            setDailyLedgerEntries(mapSnapshot<DailyLedgerEntry>(snapshot).sort((a, b) => (b.date || "").localeCompare(a.date || "")));
        });

        const unsubMasterInvoices = onSnapshot(collection(db, "masterInvoices"), (snapshot) => {
            setMasterInvoices(mapSnapshot<MasterInvoice>(snapshot));
        });

        const unsubAllUnits = onSnapshot(collection(db, "units"), (snapshot) => {
            setAllUnits(mapSnapshot<Unit>(snapshot));
        });

        return () => {
            unsubBldgs();
            unsubApps();
            unsubAllInvoices();
            unsubTickets();
            unsubContacts();
            unsubOccupied();
            unsubExpenses();
            unsubSettings();
            unsubAnnouncements();
            unsubLedger();
            unsubUsers();
            unsubDailyLedger();
            unsubMasterInvoices();
            unsubAllUnits();
        };
    }, [role]);

    if (loading || !user || role !== "admin") {
        return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">Loading Admin Portal...</div>;
    }

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col font-sans pb-16">
            {/* Top Navigation */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-xs">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">🏢</span>
                        <div>
                            <h1 className="text-base font-black text-gray-900 tracking-tight leading-tight">Property Manager Admin</h1>
                            <p className="text-[11px] text-gray-400 font-medium">Portfolio & Operational Control Center</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="hidden sm:inline-block text-xs bg-purple-100 text-purple-800 font-bold px-2.5 py-1 rounded-full">
                            Admin: {user.email}
                        </span>
                        <Link href="/employee" className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold px-3 py-1.5 rounded-lg transition">
                            Switch to Employee Portal →
                        </Link>
                        <button
                            onClick={() => signOut(auth)}
                            className="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-3 py-1.5 rounded-lg transition"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>

                {/* Subheader: Global Month Selector & Navigation Tabs */}
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-t border-gray-100 py-2 flex flex-wrap justify-between items-center gap-2">
                    {/* Navigation Tabs Bar */}
                    <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full">
                        <TabButton isActive={activeTab === "overview"} onClick={() => setActiveTab("overview")} label="📊 Overview" />
                        <TabButton isActive={activeTab === "buildings"} onClick={() => setActiveTab("buildings")} label="🏢 Buildings" count={buildings.length} />
                        <TabButton isActive={activeTab === "tenants"} onClick={() => setActiveTab("tenants")} label="👥 Tenants" count={occupiedUnits.length} />
                        <TabButton isActive={activeTab === "invoices"} onClick={() => setActiveTab("invoices")} label="💳 Invoices" count={pendingInvoices.length} />
                        <TabButton isActive={activeTab === "expenses"} onClick={() => setActiveTab("expenses")} label="💸 Expenses" />
                        <TabButton isActive={activeTab === "ledger"} onClick={() => setActiveTab("ledger")} label="📑 Ledger" />
                        <TabButton isActive={activeTab === "daily"} onClick={() => setActiveTab("daily")} label="📅 Daily Ledger" />
                        <TabButton isActive={activeTab === "users"} onClick={() => setActiveTab("users")} label="👤 Users" count={allUsers.length} />
                        <TabButton isActive={activeTab === "maintenance"} onClick={() => setActiveTab("maintenance")} label="🛠️ Repairs" count={maintenanceTickets.filter(t => t.status !== "resolved").length} />
                        <TabButton isActive={activeTab === "applications"} onClick={() => setActiveTab("applications")} label="📝 Applications" count={applications.length} />
                        <TabButton isActive={activeTab === "announcements"} onClick={() => setActiveTab("announcements")} label="📢 Notices" />
                        <TabButton isActive={activeTab === "contacts"} onClick={() => setActiveTab("contacts")} label="📞 Contacts" />
                        <TabButton isActive={activeTab === "settings"} onClick={() => setActiveTab("settings")} label="⚙️ Settings" />
                    </div>

                    {/* Global Month Picker */}
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-gray-500 uppercase">Period:</label>
                        <input
                            type="month"
                            value={globalMonth}
                            onChange={(e) => applyGlobalMonth(e.target.value)}
                            className="bg-gray-50 border border-gray-300 rounded-lg px-2.5 py-1 text-xs font-bold text-gray-700 outline-none focus:border-blue-500"
                        />
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full flex-1">
                {activeTab === "overview" && (
                    <AdminOverviewTab
                        paidInvoices={paidInvoices}
                        unpaidInvoices={unpaidInvoices}
                        pendingInvoices={pendingInvoices}
                        expenses={expenses}
                        dashboardMonth={dashboardMonth}
                        setDashboardMonth={setDashboardMonth}
                        dashboardPeriods={dashboardPeriods}
                        exportMonth={exportMonth}
                        setExportMonth={setExportMonth}
                        handleExportFinancials={handleExportFinancials}
                        isExporting={isExporting}
                    />
                )}

                {activeTab === "buildings" && (
                    <AdminBuildingsTab buildings={buildings} allUnits={allUnits} />
                )}

                {activeTab === "tenants" && (
                    <AdminTenantsTab occupiedUnits={occupiedUnits} />
                )}

                {activeTab === "invoices" && (
                    <AdminInvoicesTab
                        pendingInvoices={pendingInvoices}
                        unpaidInvoices={unpaidInvoices}
                        paidInvoices={paidInvoices}
                        occupiedUnits={occupiedUnits}
                        allInvoicesForDashboard={allInvoicesForDashboard}
                    />
                )}

                {activeTab === "expenses" && (
                    <AdminExpensesTab expenses={expenses} currentUserEmail={user?.email || "admin"} />
                )}

                {activeTab === "ledger" && (
                    <AdminLedgerTab ledgerEntries={allLedgerEntries} currentUserEmail={user?.email || "admin"} allInvoices={allInvoicesForDashboard} masterInvoices={masterInvoices} />
                )}

                {activeTab === "daily" && (
                    <DailyLedgerTab
                        entries={dailyLedgerEntries}
                        buildings={buildings}
                        allUnits={allUnits}
                        allInvoices={allInvoicesForDashboard}
                        currentUserEmail={user?.email || "admin"}
                    />
                )}

                {activeTab === "users" && (
                    <AdminUsersTab users={allUsers} currentUserId={user?.uid} />
                )}

                {activeTab === "maintenance" && (
                    <AdminMaintenanceTab tickets={maintenanceTickets} currentUserEmail={user?.email || "admin"} />
                )}

                {activeTab === "applications" && (
                    <AdminApplicationsTab applications={applications} />
                )}

                {activeTab === "announcements" && (
                    <AdminAnnouncementsTab announcements={announcements} currentUserEmail={user?.email || "admin"} />
                )}

                {activeTab === "contacts" && (
                    <AdminContactsTab contacts={contacts} />
                )}

                {activeTab === "settings" && (
                    <AdminSettingsTab initialUpiId={upiId} initialPayeeName={payeeName} />
                )}
            </main>
        </div>
    );
}