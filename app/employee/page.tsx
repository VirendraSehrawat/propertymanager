/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { collection, onSnapshot, doc, updateDoc, arrayUnion, query, where, writeBatch, getDocs } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function EmployeeDashboard() {
    const { user, role, loading } = useAuth();
    const router = useRouter();

    const [activeTickets, setActiveTickets] = useState<any[]>([]);
    const [resolvedTickets, setResolvedTickets] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<"active" | "resolved" | "meter" | "collections" | "ledger">("active");

    const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);
    const [selectedTicket, setSelectedTicket] = useState<any>(null);
    const [resolutionNote, setResolutionNote] = useState("");
    const [resolutionFile, setResolutionFile] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Meter Reading States
    const [occupiedUnits, setOccupiedUnits] = useState<any[]>([]);
    const [selectedMeterUnit, setSelectedMeterUnit] = useState("");
    const [currentReading, setCurrentReading] = useState("");
    const [billingMonth, setBillingMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
    const [electricityRate] = useState(12); // ₹12 per unit consumed

    // Collections States
    const [allInvoices, setAllInvoices] = useState<any[]>([]);
    const [collectionFilter, setCollectionFilter] = useState("all");
    const [isSettling, setIsSettling] = useState("");

    // Tenant Profile States
    const [isTenantProfileOpen, setIsTenantProfileOpen] = useState(false);
    const [profileUnit, setProfileUnit] = useState<any>(null);
    const [profileName, setProfileName] = useState("");
    const [profilePhone, setProfilePhone] = useState("");
    const [profileEmail, setProfileEmail] = useState("");
    const [profileNote, setProfileNote] = useState("");
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileDocName, setProfileDocName] = useState("");
    const [profileDocFile, setProfileDocFile] = useState<File | null>(null);
    const [isUploadingDoc, setIsUploadingDoc] = useState(false);

    // Ledger state
    const [allLedgerEntries, setAllLedgerEntries] = useState<any[]>([]);
    const [ledgerFilter, setLedgerFilter] = useState("");

    useEffect(() => {
        // Note: Adjust the role check if your system uses "caretaker" or something else
        if (!loading && (!user || role !== "employee")) {
            router.push("/");
        }
    }, [user, role, loading, router]);

    useEffect(() => {
        if (role !== "employee") return;

        const unsubTickets = onSnapshot(collection(db, "maintenance"), (snapshot) => {
            const allTickets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

            // Sort newest first
            allTickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            setActiveTickets(allTickets.filter(t => t.status !== "resolved"));
            setResolvedTickets(allTickets.filter(t => t.status === "resolved"));
        });

        const unsubUnits = onSnapshot(query(collection(db, "units"), where("status", "==", "occupied")), (snapshot) => {
            setOccupiedUnits(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })));
        });

        const unsubInvoices = onSnapshot(collection(db, "invoices"), (snapshot) => {
            setAllInvoices(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
        });

        const unsubLedger = onSnapshot(collection(db, "ledger"), (snapshot) => {
            setAllLedgerEntries(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        });

        return () => { unsubTickets(); unsubUnits(); unsubInvoices(); unsubLedger(); };
    }, [role]);

    const handleMarkInProgress = async (ticketId: string) => {
        try {
            await updateDoc(doc(db, "maintenance", ticketId), {
                status: "in-progress",
                comments: arrayUnion({
                    author: "Maintenance Staff",
                    text: "Staff has acknowledged the issue and is working on it.",
                    timestamp: new Date().toISOString()
                })
            });
        } catch (error) {
            console.error("Failed to update status:", error);
            alert("Could not update ticket.");
        }
    };

    const handleResolveSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTicket || !resolutionFile) return;

        setIsSubmitting(true);
        try {
            // 1. Upload the proof photo to Firebase Storage
            const fileRef = ref(storage, `maintenance_resolutions/${selectedTicket.id}/${Date.now()}_${resolutionFile.name}`);
            await uploadBytes(fileRef, resolutionFile);
            const photoUrl = await getDownloadURL(fileRef);

            // 2. Update the Firestore ticket
            await updateDoc(doc(db, "maintenance", selectedTicket.id), {
                status: "resolved",
                resolutionPhotoUrl: photoUrl,
                comments: arrayUnion({
                    author: "Maintenance Staff",
                    text: resolutionNote || "Issue has been resolved.",
                    timestamp: new Date().toISOString()
                })
            });

            // 3. Reset UI
            setIsResolveModalOpen(false);
            setSelectedTicket(null);
            setResolutionNote("");
            setResolutionFile(null);
        } catch (error) {
            console.error(error);
            alert("Failed to submit resolution. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleLogout = async () => {
        await signOut(auth);
        router.push("/");
    };

    const handleGenerateMeterInvoice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedMeterUnit || !currentReading || !billingMonth) return;

        const unit = occupiedUnits.find(u => u.id === selectedMeterUnit);
        if (!unit) return;

        setIsGeneratingInvoice(true);
        try {
            const [year, month] = billingMonth.split("-");
            const monthName = new Date(Number(year), Number(month) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
            const monthKey = `${month}_${year}`;

            const reading = Number(currentReading);
            const previousReading = Number(unit.lastMeterReading) || 0;
            const unitsConsumed = Math.max(0, reading - previousReading);
            const electricityCharge = unitsConsumed * electricityRate;

            // Fetch tenant ledger balance (carry-forward)
            const ledgerSnap = await getDocs(query(collection(db, "ledger"), where("tenantEmail", "==", unit.tenantEmail)));
            const runningBalance = ledgerSnap.docs.reduce((sum, d) => sum + Number(d.data().balance || 0), 0);
            // Negative balance = tenant owes more, positive = tenant has credit
            const carryForward = -runningBalance; // amount to add (positive if due, negative if credit)
            const baseTotal = Number(unit.baseRent || 0) + electricityCharge;
            const totalAmount = Math.max(0, baseTotal + carryForward);

            const invoiceId = `inv_${unit.id}_${monthKey}`;
            const batch = writeBatch(db);

            // Create / update the invoice
            batch.set(doc(db, "invoices", invoiceId), {
                unitId: unit.id,
                unitNumber: unit.unitNumber,
                tenantEmail: unit.tenantEmail,
                baseRent: unit.baseRent || 0,
                previousReading,
                currentReading: reading,
                electricityConsumed: unitsConsumed,
                electricityRate,
                electricityCharge,
                carryForward: carryForward !== 0 ? carryForward : undefined,
                totalAmount,
                billingPeriod: monthName,
                status: "unpaid",
                transactionId: "",
                createdAt: new Date().toISOString()
            }, { merge: true });

            // Update last meter reading on the unit
            batch.update(doc(db, "units", unit.id), { lastMeterReading: reading });

            await batch.commit();
            const cfMsg = carryForward !== 0 ? `\nCarry Forward: ${carryForward > 0 ? '+' : ''}₹${carryForward}` : '';
            alert(`Invoice generated for ${unit.unitNumber}!\n\nRent: ₹${unit.baseRent || 0}\nElectricity: ${unitsConsumed} units × ₹${electricityRate} = ₹${electricityCharge}${cfMsg}\nTotal: ₹${totalAmount}`);
            setSelectedMeterUnit("");
            setCurrentReading("");
        } catch (error) {
            console.error(error);
            alert("Failed to generate invoice.");
        } finally {
            setIsGeneratingInvoice(false);
        }
    };

    const handleSettleInvoice = async (invId: string) => {
        if (!window.confirm("Mark this invoice as paid (cash collected)?")) return;
        setIsSettling(invId);
        try {
            await updateDoc(doc(db, "invoices", invId), { status: "paid", paidAt: new Date().toISOString(), transactionId: "CASH_COLLECTED" });
        } catch (error) {
            console.error(error);
            alert("Failed to settle invoice.");
        } finally {
            setIsSettling("");
        }
    };

    const openTenantProfile = (unit: any) => {
        setProfileUnit(unit);
        setProfileName(unit.tenantName || "");
        setProfilePhone(unit.tenantPhone || "");
        setProfileEmail(unit.tenantEmail || "");
        setProfileNote("");
        setIsTenantProfileOpen(true);
    };

    const handleSaveTenantProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profileUnit) return;
        setIsSavingProfile(true);
        try {
            await updateDoc(doc(db, "units", profileUnit.id), { tenantName: profileName, tenantPhone: profilePhone, tenantEmail: profileEmail.toLowerCase() });
            setIsTenantProfileOpen(false); setProfileUnit(null);
        } catch (error) { console.error(error); alert("Failed to update tenant."); } finally { setIsSavingProfile(false); }
    };

    const handleAddNote = async () => {
        if (!profileUnit || !profileNote.trim()) return;
        try {
            await updateDoc(doc(db, "units", profileUnit.id), { notes: arrayUnion({ text: profileNote.trim(), author: "Staff", createdAt: new Date().toISOString() }) });
            setProfileNote("");
            // Refresh profileUnit from occupiedUnits
            const updated = occupiedUnits.find(u => u.id === profileUnit.id);
            if (updated) setProfileUnit({ ...updated });
        } catch (error) { console.error(error); alert("Failed to add note."); }
    };

    const handleUploadTenantDoc = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profileUnit || !profileDocName || !profileDocFile) return;
        setIsUploadingDoc(true);
        try {
            const fileRef = ref(storage, `tenant_docs/${profileUnit.id}/${Date.now()}_${profileDocFile.name}`);
            await uploadBytes(fileRef, profileDocFile);
            const fileUrl = await getDownloadURL(fileRef);
            await updateDoc(doc(db, "units", profileUnit.id), { documents: arrayUnion({ name: profileDocName, url: fileUrl, uploadedAt: new Date().toISOString() }) });
            setProfileDocName(""); setProfileDocFile(null);
        } catch (error) { console.error(error); alert("Failed to upload document."); } finally { setIsUploadingDoc(false); }
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50">Loading...</div>;
    if (!user || role !== "employee") return null;

    return (
        <div className="min-h-screen bg-gray-100 pb-12">
            {/* MOBILE FRIENDLY NAV */}
            <nav className="bg-orange-600 px-4 py-4 flex justify-between items-center text-white shadow-md sticky top-0 z-10">
                <div>
                    <h1 className="text-xl font-bold tracking-tight">Staff Portal</h1>
                    <p className="text-xs text-orange-200">{user.email}</p>
                </div>
                <button onClick={handleLogout} className="text-sm bg-orange-700 hover:bg-orange-800 px-3 py-2 rounded-md font-medium transition shadow-sm">
                    Log Out
                </button>
            </nav>

            <main className="p-4 max-w-2xl mx-auto space-y-6 mt-2">

                {/* TABS */}
                <div className="flex bg-gray-200 rounded-lg p-1 shadow-inner">
                    <button
                        onClick={() => setActiveTab("collections")}
                        className={`flex-1 py-3 text-sm font-bold rounded-md transition ${activeTab === "collections" ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500"}`}
                    >
                        Collections
                    </button>
                    <button
                        onClick={() => setActiveTab("active")}
                        className={`flex-1 py-3 text-sm font-bold rounded-md transition ${activeTab === "active" ? "bg-white text-orange-600 shadow-sm" : "text-gray-500"}`}
                    >
                        Tasks ({activeTickets.length})
                    </button>
                    <button
                        onClick={() => setActiveTab("meter")}
                        className={`flex-1 py-3 text-sm font-bold rounded-md transition ${activeTab === "meter" ? "bg-white text-purple-600 shadow-sm" : "text-gray-500"}`}
                    >
                        Meter
                    </button>
                    <button
                        onClick={() => setActiveTab("resolved")}
                        className={`flex-1 py-3 text-sm font-bold rounded-md transition ${activeTab === "resolved" ? "bg-white text-green-600 shadow-sm" : "text-gray-500"}`}
                    >
                        Done
                    </button>
                    <button
                        onClick={() => setActiveTab("ledger")}
                        className={`flex-1 py-3 text-sm font-bold rounded-md transition ${activeTab === "ledger" ? "bg-white text-teal-600 shadow-sm" : "text-gray-500"}`}
                    >
                        Ledger
                    </button>
                </div>

                {/* COLLECTIONS TAB */}
                {activeTab === "collections" && (() => {
                    const pendingInvoices = allInvoices.filter(inv => inv.status === "unpaid" || inv.status === "pending");
                    const periods = [...new Set(pendingInvoices.map(inv => inv.billingPeriod).filter(Boolean))].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

                    const filteredInvoices = collectionFilter === "all"
                        ? pendingInvoices
                        : pendingInvoices.filter(inv => inv.billingPeriod === collectionFilter);

                    const totalPendingRent = filteredInvoices.reduce((sum, inv) => sum + Number(inv.baseRent || 0), 0);
                    const totalPendingElec = filteredInvoices.reduce((sum, inv) => sum + Number(inv.electricityCharge || 0), 0);

                    return (
                        <div className="space-y-4">
                            {/* Filter */}
                            <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Billing Period</label>
                                <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg font-medium">
                                    <option value="all">All Pending ({pendingInvoices.length})</option>
                                    {periods.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>

                            {/* Summary */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                                    <p className="text-xs font-bold text-red-600 uppercase">Pending Rent</p>
                                    <p className="text-xl font-bold text-red-800 mt-1">₹{totalPendingRent.toLocaleString()}</p>
                                </div>
                                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                                    <p className="text-xs font-bold text-yellow-600 uppercase">Pending Electricity</p>
                                    <p className="text-xl font-bold text-yellow-800 mt-1">₹{totalPendingElec.toLocaleString()}</p>
                                </div>
                            </div>

                            {/* Invoice List */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex justify-between items-center">
                                    <h3 className="text-sm font-bold text-gray-800">Pending Invoices</h3>
                                    <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">{filteredInvoices.length} pending</span>
                                </div>
                                <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                                    {filteredInvoices.length === 0 ? (
                                        <p className="p-6 text-sm text-gray-500 text-center">🎉 No pending invoices!</p>
                                    ) : (
                                        filteredInvoices.map(inv => (
                                            <div key={inv.id} className="px-5 py-4 flex justify-between items-center hover:bg-gray-50">
                                                <div>
                                                    <p className="font-bold text-gray-900">{inv.unitNumber}</p>
                                                    <p className="text-xs text-gray-500">{inv.tenantEmail}</p>
                                                    <p className="text-xs text-indigo-600 font-medium mt-0.5">{inv.billingPeriod}</p>
                                                    <button onClick={() => { const unit = occupiedUnits.find(u => u.id === inv.unitId); if (unit) openTenantProfile(unit); }} className="text-[10px] text-indigo-600 hover:underline mt-1">View Profile →</button>
                                                </div>
                                                <div className="text-right flex flex-col items-end gap-2">
                                                    <div>
                                                        <p className="font-bold text-gray-900">₹{Number(inv.totalAmount || 0).toLocaleString()}</p>
                                                        <p className="text-[10px] text-gray-400">Rent: ₹{inv.baseRent || 0} | Elec: ₹{inv.electricityCharge || 0}</p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleSettleInvoice(inv.id)}
                                                        disabled={isSettling === inv.id}
                                                        className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-md font-bold hover:bg-green-700 disabled:bg-green-400 transition"
                                                    >
                                                        {isSettling === inv.id ? "..." : "✓ Settle"}
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* METER READING TAB */}
                {activeTab === "meter" && (
                    <div className="bg-white rounded-xl shadow-sm border border-purple-200 overflow-hidden">
                        <div className="bg-purple-50 px-5 py-4 border-b border-purple-100">
                            <h2 className="text-lg font-bold text-purple-800">⚡ Record Meter Reading & Generate Invoice</h2>
                            <p className="text-xs text-purple-600 mt-1">Enter the current meter reading to calculate the electricity bill (₹{electricityRate}/unit)</p>
                        </div>
                        <form onSubmit={handleGenerateMeterInvoice} className="p-5 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Select Unit</label>
                                <select required value={selectedMeterUnit} onChange={(e) => setSelectedMeterUnit(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg">
                                    <option value="" disabled>Choose an occupied unit...</option>
                                    {occupiedUnits.map(u => (
                                        <option key={u.id} value={u.id}>{u.unitNumber} — {u.tenantEmail} (Last: {u.lastMeterReading || 0})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Billing Month</label>
                                <input type="month" required value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Current Meter Reading</label>
                                <input type="number" required min="0" value={currentReading} onChange={(e) => setCurrentReading(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="e.g. 1250" />
                            </div>

                            {/* Live Preview */}
                            {selectedMeterUnit && currentReading && (() => {
                                const unit = occupiedUnits.find(u => u.id === selectedMeterUnit);
                                if (!unit) return null;
                                const prev = Number(unit.lastMeterReading) || 0;
                                const curr = Number(currentReading);
                                const consumed = Math.max(0, curr - prev);
                                const elecCharge = consumed * electricityRate;
                                const total = Number(unit.baseRent || 0) + elecCharge;
                                return (
                                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
                                        <p className="font-bold text-gray-800 text-base">Invoice Preview</p>
                                        <div className="flex justify-between"><span className="text-gray-600">Previous Reading:</span><span className="font-mono">{prev}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-600">Current Reading:</span><span className="font-mono">{curr}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-600">Units Consumed:</span><span className="font-mono font-bold">{consumed}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-600">Electricity (×₹{electricityRate}):</span><span className="font-mono">₹{elecCharge}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-600">Base Rent:</span><span className="font-mono">₹{unit.baseRent || 0}</span></div>
                                        <div className="flex justify-between border-t border-gray-300 pt-2 mt-2"><span className="font-bold text-gray-900">Total Invoice:</span><span className="font-bold text-lg text-green-700">₹{total}</span></div>
                                    </div>
                                );
                            })()}

                            <button type="submit" disabled={isGeneratingInvoice} className="w-full py-3 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 transition shadow-sm disabled:bg-purple-400">
                                {isGeneratingInvoice ? "Generating..." : "Generate Invoice"}
                            </button>
                        </form>
                    </div>
                )}

                {/* LEDGER TAB */}
                {activeTab === "ledger" && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="bg-teal-50 px-5 py-4 border-b border-teal-200">
                            <h2 className="text-lg font-bold text-teal-800">📒 Tenant Payment Ledger</h2>
                        </div>
                        <div className="p-5 space-y-4">
                            <select value={ledgerFilter} onChange={(e) => setLedgerFilter(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                                <option value="">All Tenants</option>
                                {[...new Set(allLedgerEntries.map(e => e.tenantEmail))].map(email => {
                                    const u = occupiedUnits.find(u => u.tenantEmail === email);
                                    return <option key={email} value={email}>{u ? u.unitNumber + ' - ' : ''}{email}</option>;
                                })}
                            </select>
                            {(() => {
                                const filtered = ledgerFilter ? allLedgerEntries.filter(e => e.tenantEmail === ledgerFilter) : allLedgerEntries;
                                if (filtered.length === 0) return <p className="text-sm text-gray-500 text-center py-4">No payment records yet.</p>;
                                const tenantBalances: Record<string, { email: string; unitNumber: string; balance: number; count: number }> = {};
                                filtered.forEach(entry => {
                                    if (!tenantBalances[entry.tenantEmail]) tenantBalances[entry.tenantEmail] = { email: entry.tenantEmail, unitNumber: entry.unitNumber, balance: 0, count: 0 };
                                    tenantBalances[entry.tenantEmail].balance += Number(entry.balance || 0);
                                    tenantBalances[entry.tenantEmail].count++;
                                });
                                return !ledgerFilter ? (
                                    <div className="space-y-2">
                                        {Object.values(tenantBalances).map(t => (
                                            <div key={t.email} className="flex justify-between items-center border border-gray-100 p-3 rounded-md bg-gray-50 hover:bg-gray-100 cursor-pointer" onClick={() => setLedgerFilter(t.email)}>
                                                <div><p className="font-medium text-gray-800 text-sm">{t.unitNumber}</p><p className="text-xs text-gray-500">{t.email}</p></div>
                                                <div className="text-right"><span className={`font-bold text-sm ${t.balance >= 0 ? 'text-green-700' : 'text-red-700'}`}>{t.balance >= 0 ? `₹${t.balance} CR` : `₹${Math.abs(t.balance)} DUE`}</span><p className="text-[10px] text-gray-400">{t.count} payments</p></div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div>
                                        <div className={`mb-3 p-3 rounded-lg border ${tenantBalances[ledgerFilter]?.balance >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                            <div className="flex justify-between items-center"><span className="text-sm font-medium">Net Balance</span><span className={`font-bold ${tenantBalances[ledgerFilter]?.balance >= 0 ? 'text-green-700' : 'text-red-700'}`}>{tenantBalances[ledgerFilter]?.balance >= 0 ? `₹${tenantBalances[ledgerFilter]?.balance} Credit` : `₹${Math.abs(tenantBalances[ledgerFilter]?.balance || 0)} Due`}</span></div>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                                <thead><tr className="border-b text-gray-500"><th className="pb-1 text-left">Date</th><th className="pb-1 text-left">Period</th><th className="pb-1 text-right">Invoice</th><th className="pb-1 text-right">Paid</th><th className="pb-1 text-right">Bal</th></tr></thead>
                                                <tbody>{filtered.map(entry => (<tr key={entry.id} className="border-b border-gray-100"><td className="py-1.5">{new Date(entry.createdAt).toLocaleDateString()}</td><td className="py-1.5">{entry.billingPeriod}</td><td className="py-1.5 text-right">₹{entry.invoiceAmount}</td><td className="py-1.5 text-right text-green-700">₹{entry.amountPaid}</td><td className={`py-1.5 text-right font-bold ${Number(entry.balance) >= 0 ? 'text-green-700' : 'text-red-700'}`}>{Number(entry.balance) >= 0 ? '+' : ''}₹{entry.balance}</td></tr>))}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* TICKET LIST */}
                {activeTab !== "meter" && activeTab !== "collections" && activeTab !== "ledger" && (
                <div className="space-y-4">
                    {(activeTab === "active" ? activeTickets : resolvedTickets).length === 0 ? (
                        <div className="bg-white p-8 rounded-xl shadow-sm text-center border border-gray-200 mt-8">
                            <span className="text-4xl mb-3 block">🎉</span>
                            <p className="text-gray-600 font-medium">No tasks in this queue!</p>
                        </div>
                    ) : (
                        (activeTab === "active" ? activeTickets : resolvedTickets).map(ticket => (
                            <div key={ticket.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${ticket.status === 'resolved' ? 'border-green-200' : 'border-orange-200'}`}>

                                {/* Header */}
                                <div className={`px-4 py-3 border-b flex justify-between items-center ${ticket.status === 'resolved' ? 'bg-green-50 border-green-100' : 'bg-orange-50 border-orange-100'}`}>
                                    <div>
                                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{ticket.category}</span>
                                        <h3 className="font-bold text-gray-900 text-lg">Unit {ticket.unitNumber}</h3>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${ticket.status === 'pending' ? 'bg-red-100 text-red-800' :
                                            ticket.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                                                'bg-green-100 text-green-800'
                                        }`}>
                                        {ticket.status.toUpperCase()}
                                    </span>
                                </div>

                                {/* Body */}
                                <div className="p-4 space-y-4">
                                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-sm text-gray-700">
                                        <p className="font-semibold mb-1 text-gray-900">Issue Description:</p>
                                        {ticket.description}
                                    </div>

                                    {ticket.photoUrl && (
                                        <a href={ticket.photoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded-md hover:bg-blue-100 font-medium w-full justify-center border border-blue-200 transition">
                                            📷 View Tenant Photo
                                        </a>
                                    )}

                                    {/* Actions (Only for Active Tickets) */}
                                    {ticket.status !== 'resolved' && (
                                        <div className="pt-2 flex flex-col sm:flex-row gap-3">
                                            {ticket.status === 'pending' && (
                                                <button
                                                    onClick={() => handleMarkInProgress(ticket.id)}
                                                    className="w-full py-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-bold hover:bg-blue-100 transition shadow-sm"
                                                >
                                                    Start Work (In-Progress)
                                                </button>
                                            )}

                                            <button
                                                onClick={() => { setSelectedTicket(ticket); setIsResolveModalOpen(true); }}
                                                className="w-full py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition shadow-sm flex items-center justify-center gap-2"
                                            >
                                                ✅ Mark as Resolved
                                            </button>
                                        </div>
                                    )}

                                    {/* Proof of Resolution (Only for Resolved Tickets) */}
                                    {ticket.status === 'resolved' && ticket.resolutionPhotoUrl && (
                                        <div className="pt-2 border-t border-gray-100 mt-4">
                                            <p className="text-xs font-bold text-gray-500 uppercase mb-2">Resolution Proof</p>
                                            <img src={ticket.resolutionPhotoUrl} alt="Fixed" className="w-full h-48 object-cover rounded-lg border border-gray-200" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
                )}
            </main>

            {/* RESOLVE MODAL */}
            {isResolveModalOpen && selectedTicket && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fade-in-up">
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">Resolve Issue</h2>
                        <p className="text-sm text-gray-500 mb-6">Unit {selectedTicket.unitNumber} • {selectedTicket.category}</p>

                        <form onSubmit={handleResolveSubmit} className="space-y-5">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Upload Proof of Fix (Required) 📸</label>
                                <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:bg-gray-50 transition cursor-pointer relative">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        required
                                        onChange={(e) => setResolutionFile(e.target.files ? e.target.files[0] : null)}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    {resolutionFile ? (
                                        <span className="text-sm font-bold text-green-600">✅ {resolutionFile.name} selected</span>
                                    ) : (
                                        <span className="text-sm text-gray-500 font-medium">Tap to open camera or gallery</span>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Completion Notes (Optional)</label>
                                <textarea
                                    rows={3}
                                    value={resolutionNote}
                                    onChange={(e) => setResolutionNote(e.target.value)}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none resize-none"
                                    placeholder="e.g. Replaced the P-trap under the sink..."
                                ></textarea>
                            </div>

                            <div className="flex flex-col gap-3 mt-8">
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="w-full py-4 bg-green-600 text-white rounded-xl font-bold text-lg hover:bg-green-700 shadow-md disabled:bg-green-400 transition"
                                >
                                    {isSubmitting ? "Uploading..." : "Submit Resolution"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setIsResolveModalOpen(false); setResolutionFile(null); setResolutionNote(""); }}
                                    disabled={isSubmitting}
                                    className="w-full py-4 text-gray-600 hover:bg-gray-100 rounded-xl font-bold transition"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* TENANT PROFILE MODAL */}
            {isTenantProfileOpen && profileUnit && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center p-4 z-50 overflow-y-auto">
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-md shadow-2xl my-8">
                        <h2 className="text-xl font-bold mb-1">👤 {profileUnit.unitNumber} — Tenant Profile</h2>
                        <p className="text-sm text-gray-500 mb-5">Edit details, manage documents, and add notes.</p>

                        {/* Edit Details */}
                        <form onSubmit={handleSaveTenantProfile} className="space-y-3 mb-5">
                            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label><input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone</label><input type="tel" value={profilePhone} onChange={(e) => setProfilePhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label><input type="email" required value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                            <button type="submit" disabled={isSavingProfile} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:bg-indigo-400">{isSavingProfile ? "Saving..." : "Save Details"}</button>
                        </form>

                        {/* Documents */}
                        <div className="border-t border-gray-200 pt-4 mb-4">
                            <h3 className="text-sm font-bold text-gray-800 mb-2">📄 Documents</h3>
                            {profileUnit.documents && profileUnit.documents.length > 0 ? (
                                <ul className="space-y-1 max-h-28 overflow-y-auto mb-3">
                                    {profileUnit.documents.map((d: any, i: number) => (
                                        <li key={i}><a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">📄 {d.name}</a></li>
                                    ))}
                                </ul>
                            ) : (<p className="text-xs text-gray-400 italic mb-3">No documents.</p>)}
                            <form onSubmit={handleUploadTenantDoc} className="flex gap-2 items-end">
                                <div className="flex-1">
                                    <input type="text" value={profileDocName} onChange={(e) => setProfileDocName(e.target.value)} placeholder="Doc name" required className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs mb-1" />
                                    <input type="file" accept="image/*,.pdf" required onChange={(e) => setProfileDocFile(e.target.files ? e.target.files[0] : null)} className="w-full text-xs text-gray-500" />
                                </div>
                                <button type="submit" disabled={isUploadingDoc} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 disabled:bg-blue-400">{isUploadingDoc ? "..." : "Upload"}</button>
                            </form>
                        </div>

                        {/* Notes */}
                        <div className="border-t border-gray-200 pt-4">
                            <h3 className="text-sm font-bold text-gray-800 mb-2">📝 Notes</h3>
                            <div className="max-h-32 overflow-y-auto space-y-2 mb-3">
                                {profileUnit.notes && profileUnit.notes.length > 0 ? (
                                    profileUnit.notes.map((n: any, i: number) => (
                                        <div key={i} className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs">
                                            <p className="text-gray-800">{n.text}</p>
                                            <p className="text-gray-400 mt-1">{n.author} • {new Date(n.createdAt).toLocaleDateString()}</p>
                                        </div>
                                    ))
                                ) : (<p className="text-xs text-gray-400 italic">No notes yet.</p>)}
                            </div>
                            <div className="flex gap-2">
                                <input type="text" value={profileNote} onChange={(e) => setProfileNote(e.target.value)} placeholder="Add a note..." className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                                <button onClick={handleAddNote} disabled={!profileNote.trim()} className="px-4 py-2 bg-yellow-500 text-white rounded-lg text-sm font-bold hover:bg-yellow-600 disabled:bg-yellow-300">Add</button>
                            </div>
                        </div>

                        <button onClick={() => { setIsTenantProfileOpen(false); setProfileUnit(null); }} className="w-full mt-5 py-3 text-gray-600 hover:bg-gray-100 rounded-xl font-bold transition">Close</button>
                    </div>
                </div>
            )}
        </div>
    );
}