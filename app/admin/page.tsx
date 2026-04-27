"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { collection, addDoc, onSnapshot, query, orderBy, where, doc, updateDoc, getDocs, writeBatch, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export default function AdminDashboard() {
    const { user, role, loading } = useAuth();
    const router = useRouter();

    const [buildings, setBuildings] = useState<any[]>([]);
    const [applications, setApplications] = useState<any[]>([]);
    const [pendingInvoices, setPendingInvoices] = useState<any[]>([]);

    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [totalUnits, setTotalUnits] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isGeneratingInvoices, setIsGeneratingInvoices] = useState(false);

    useEffect(() => {
        if (!loading && (!user || role !== "admin")) router.push("/");
    }, [user, role, loading, router]);

    useEffect(() => {
        if (role !== "admin") return;

        const unsubBldgs = onSnapshot(query(collection(db, "buildings"), orderBy("createdAt", "desc")), (snapshot) => {
            setBuildings(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        });

        const unsubApps = onSnapshot(query(collection(db, "applications"), where("status", "==", "pending")), (snapshot) => {
            const appsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            appsData.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            setApplications(appsData);
        });

        // NEW: Fetch Pending Invoice Payments
        const unsubInvoices = onSnapshot(query(collection(db, "invoices"), where("status", "==", "pending")), (snapshot) => {
            const invData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            invData.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            setPendingInvoices(invData);
        });

        return () => { unsubBldgs(); unsubApps(); unsubInvoices(); };
    }, [role]);

    // --- INVOICE GENERATION ENGINE ---
    const handleGenerateMonthlyInvoices = async () => {
        if (!window.confirm("Generate invoices for all occupied units for the current month?")) return;
        setIsGeneratingInvoices(true);

        try {
            const date = new Date();
            const monthName = date.toLocaleString('default', { month: 'long', year: 'numeric' }); // e.g., "April 2026"
            const monthKey = `${date.getMonth() + 1}_${date.getFullYear()}`; // e.g., "4_2026"

            // 1. Get all occupied units
            const unitsSnap = await getDocs(query(collection(db, "units"), where("status", "==", "occupied")));

            const batch = writeBatch(db);
            let count = 0;

            unitsSnap.forEach((unitDoc) => {
                const unit = unitDoc.data();
                // 2. Create deterministic ID to prevent double-billing
                const invoiceId = `inv_${unitDoc.id}_${monthKey}`;
                const invoiceRef = doc(db, "invoices", invoiceId);

                // 3. Set the invoice data (merge: true ensures we don't overwrite if it exists)
                batch.set(invoiceRef, {
                    unitId: unitDoc.id,
                    unitNumber: unit.unitNumber,
                    tenantEmail: unit.tenantEmail,
                    amountDue: unit.baseRent,
                    billingPeriod: monthName,
                    status: "unpaid", // Can be 'unpaid', 'pending', 'paid'
                    transactionId: "",
                    createdAt: new Date().toISOString()
                }, { merge: true });

                count++;
            });

            await batch.commit();
            alert(`Successfully processed invoices for ${count} occupied units for ${monthName}.`);

        } catch (error) {
            console.error("Error generating invoices:", error);
            alert("Failed to generate invoices.");
        } finally {
            setIsGeneratingInvoices(false);
        }
    };

    const handleApproveInvoice = async (invoiceId: string) => {
        try {
            await updateDoc(doc(db, "invoices", invoiceId), {
                status: "paid",
                paidAt: new Date().toISOString()
            });
        } catch (error) {
            console.error("Error approving invoice:", error);
        }
    };

    const handleRejectInvoice = async (invoiceId: string) => {
        if (!window.confirm("Reject this payment and mark as unpaid?")) return;
        try {
            await updateDoc(doc(db, "invoices", invoiceId), {
                status: "unpaid",
                transactionId: "" // Clear the bad transaction ID
            });
        } catch (error) {
            console.error("Error rejecting invoice:", error);
        }
    };

    // --- (Keeping your existing Application and Building logic intact below) ---
    const handleAddBuilding = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await addDoc(collection(db, "buildings"), { name, address, totalUnits: Number(totalUnits), createdAt: new Date().toISOString() });
            setName(""); setAddress(""); setTotalUnits("");
        } catch (error) { console.error(error); } finally { setIsSubmitting(false); }
    };

    const handleApproveApp = async (appId: string, unitId: string, tenantEmail: string) => {
        try {
            await updateDoc(doc(db, "units", unitId), { status: "occupied", tenantEmail });
            await updateDoc(doc(db, "applications", appId), { status: "approved" });
        } catch (error) { console.error(error); }
    };

    const handleRejectApp = async (appId: string) => {
        try { await updateDoc(doc(db, "applications", appId), { status: "rejected" }); } catch (error) { console.error(error); }
    };

    const handleLogout = async () => { await signOut(auth); router.push("/"); };

    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    if (!user || role !== "admin") return null;

    return (
        <div className="min-h-screen bg-gray-50">
            <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center border-b border-gray-200">
                <h1 className="text-xl font-bold text-gray-800">Admin Portal</h1>
                <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600">{user.email}</span>
                    <button onClick={handleLogout} className="text-sm px-4 py-2 bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition">Logout</button>
                </div>
            </nav>

            <main className="p-6 max-w-7xl mx-auto space-y-8">

                {/* Top Header & Actions */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Financial Dashboard</h2>
                        <p className="text-sm text-gray-500">Manage billing and verify payments.</p>
                    </div>
                    <button
                        onClick={handleGenerateMonthlyInvoices}
                        disabled={isGeneratingInvoices}
                        className="px-6 py-3 bg-gray-900 text-white font-medium rounded-md hover:bg-gray-800 transition disabled:bg-gray-400 shadow-sm"
                    >
                        {isGeneratingInvoices ? "Generating..." : `+ Generate ${new Date().toLocaleString('default', { month: 'long' })} Invoices`}
                    </button>
                </div>

                {/* Invoice Approvals Inbox */}
                {pendingInvoices.length > 0 && (
                    <div className="bg-white rounded-lg shadow-sm border border-green-300 overflow-hidden">
                        <div className="bg-green-50 px-6 py-4 border-b border-green-200 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-green-800">💸 Payment Verifications Inbox</h2>
                            <span className="bg-green-200 text-green-800 text-xs font-bold px-3 py-1 rounded-full">{pendingInvoices.length} Pending Review</span>
                        </div>
                        <div className="divide-y divide-gray-200">
                            {pendingInvoices.map((inv) => (
                                <div key={inv.id} className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:bg-gray-50 transition">
                                    <div>
                                        <p className="text-sm text-gray-500 mb-1">Unit <strong className="text-gray-800 text-lg">{inv.unitNumber}</strong> • {inv.billingPeriod}</p>
                                        <p className="font-medium text-gray-700 mb-1">{inv.tenantEmail}</p>
                                        <div className="flex gap-4 mt-2">
                                            <span className="text-sm font-bold text-green-700">Amount: ₹{inv.amountDue}</span>
                                            <span className="text-sm text-gray-500 font-mono">Txn ID: {inv.transactionId}</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-3 w-full md:w-auto mt-4 md:mt-0">
                                        <button onClick={() => handleRejectInvoice(inv.id)} className="px-4 py-2 border border-red-200 text-red-600 rounded-md hover:bg-red-50 text-sm font-medium">
                                            Reject
                                        </button>
                                        <button onClick={() => handleApproveInvoice(inv.id)} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium shadow-sm">
                                            Verify & Mark Paid
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Applications Inbox */}
                {applications.length > 0 && (
                    <div className="bg-white rounded-lg shadow-sm border border-orange-200 overflow-hidden">
                        <div className="bg-orange-50 px-6 py-4 border-b border-orange-200 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-orange-800">📥 Tenant Applications</h2>
                        </div>
                        <div className="divide-y divide-gray-200">
                            {applications.map((app) => (
                                <div key={app.id} className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:bg-gray-50">
                                    <div>
                                        <p className="text-sm text-gray-500">Unit: <strong className="text-gray-800">{app.unitNumber}</strong></p>
                                        <p className="font-medium text-blue-600">{app.tenantEmail}</p>
                                        <p className="text-xs text-gray-400">Txn: {app.transactionId}</p>
                                    </div>
                                    <div className="flex gap-3">
                                        <button onClick={() => handleRejectApp(app.id)} className="px-4 py-2 border border-red-200 text-red-600 rounded-md text-sm">Reject</button>
                                        <button onClick={() => handleApproveApp(app.id, app.unitId, app.tenantEmail)} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm">Approve</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                            <h2 className="text-lg font-semibold text-gray-800 mb-4">Add New Building</h2>
                            <form onSubmit={handleAddBuilding} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Building Name</label>
                                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="North Block" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                                    <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="123 Main St" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Total Units</label>
                                    <input type="number" min="1" value={totalUnits} onChange={(e) => setTotalUnits(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                                </div>
                                <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700">
                                    {isSubmitting ? "Adding..." : "Add Building"}
                                </button>
                            </form>
                        </div>
                    </div>

                    <div className="lg:col-span-2">
                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                            <h2 className="text-lg font-semibold text-gray-800 mb-4">Your Portfolio</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {buildings.map((bldg) => (
                                    <div key={bldg.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300">
                                        <h3 className="font-bold text-gray-800">{bldg.name}</h3>
                                        <p className="text-sm text-gray-500 mt-1">{bldg.address}</p>
                                        <div className="mt-3 flex items-center justify-between text-sm">
                                            <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded">Units: {bldg.totalUnits}</span>
                                            <button onClick={() => router.push(`/admin/buildings/${bldg.id}`)} className="text-blue-600 hover:underline">Manage Units &rarr;</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

            </main>
        </div>
    );
}