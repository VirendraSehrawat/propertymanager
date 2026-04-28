"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { collection, addDoc, onSnapshot, query, orderBy, where, doc, updateDoc, getDocs, writeBatch, deleteDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export default function AdminDashboard() {
    const { user, role, loading } = useAuth();
    const router = useRouter();

    const [buildings, setBuildings] = useState<any[]>([]);
    const [applications, setApplications] = useState<any[]>([]);
    const [pendingInvoices, setPendingInvoices] = useState<any[]>([]);
    const [maintenanceTickets, setMaintenanceTickets] = useState<any[]>([]);

    // NEW: Contacts Directory States
    const [contacts, setContacts] = useState<any[]>([]);
    const [contactName, setContactName] = useState("");
    const [contactRole, setContactRole] = useState("Plumber");
    const [contactPhone, setContactPhone] = useState("");
    const [isSubmittingContact, setIsSubmittingContact] = useState(false);

    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [totalUnits, setTotalUnits] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
    const [occupiedUnits, setOccupiedUnits] = useState<any[]>([]);
    const [electricityRate, setElectricityRate] = useState<number>(8);
    const [meterReadings, setMeterReadings] = useState<Record<string, number>>({});
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
            const appsData: any[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            appsData.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            setApplications(appsData);
        });

        const unsubInvoices = onSnapshot(query(collection(db, "invoices"), where("status", "==", "pending")), (snapshot) => {
            const invData: any[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            invData.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            setPendingInvoices(invData);
        });

        const unsubTickets = onSnapshot(collection(db, "maintenance"), (snapshot) => {
            const tData: any[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            tData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setMaintenanceTickets(tData);
        });

        // NEW: Fetch Contacts
        const unsubContacts = onSnapshot(collection(db, "contacts"), (snapshot) => {
            setContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        return () => { unsubBldgs(); unsubApps(); unsubInvoices(); unsubTickets(); unsubContacts(); };
    }, [role]);

    // --- Contacts Logic ---
    const handleAddContact = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!contactName || !contactPhone) return;
        setIsSubmittingContact(true);
        try {
            await addDoc(collection(db, "contacts"), {
                name: contactName, role: contactRole, phone: contactPhone, createdAt: new Date().toISOString()
            });
            setContactName(""); setContactPhone("");
        } catch (error) { console.error(error); } finally { setIsSubmittingContact(false); }
    };

    const handleDeleteContact = async (id: string) => {
        if (window.confirm("Remove this contact?")) {
            await deleteDoc(doc(db, "contacts", id));
        }
    };

    // --- Other existing logic (kept intact) ---
    const handleUpdateTicketStatus = async (ticketId: string, newStatus: string) => {
        try { await updateDoc(doc(db, "maintenance", ticketId), { status: newStatus }); } catch (error) { console.error(error); }
    };

    const openInvoiceModal = async () => {
        const unitsSnap = await getDocs(query(collection(db, "units"), where("status", "==", "occupied")));
        const unitsData: any[] = unitsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const initialReadings: Record<string, number> = {};
        unitsData.forEach(u => { initialReadings[u.id] = u.lastMeterReading || 0; });
        setOccupiedUnits(unitsData); setMeterReadings(initialReadings); setIsInvoiceModalOpen(true);
    };

    const handleConfirmInvoices = async (e: React.FormEvent) => {
        e.preventDefault(); setIsGeneratingInvoices(true);
        try {
            const date = new Date(); const monthName = date.toLocaleString('default', { month: 'long', year: 'numeric' }); const monthKey = `${date.getMonth() + 1}_${date.getFullYear()}`;
            const batch = writeBatch(db); let count = 0;
            occupiedUnits.forEach((unit) => {
                const invoiceId = `inv_${unit.id}_${monthKey}`; const invoiceRef = doc(db, "invoices", invoiceId); const unitRef = doc(db, "units", unit.id);
                const currentReading = Number(meterReadings[unit.id]) || 0; const previousReading = Number(unit.lastMeterReading) || 0;
                const unitsConsumed = Math.max(0, currentReading - previousReading); const electricityCharge = unitsConsumed * electricityRate; const totalAmount = Number(unit.baseRent) + electricityCharge;
                batch.set(invoiceRef, { unitId: unit.id, unitNumber: unit.unitNumber, tenantEmail: unit.tenantEmail, baseRent: unit.baseRent, previousReading, currentReading, electricityConsumed: unitsConsumed, electricityRate, electricityCharge, totalAmount, billingPeriod: monthName, status: "unpaid", transactionId: "", createdAt: new Date().toISOString() }, { merge: true });
                batch.update(unitRef, { lastMeterReading: currentReading }); count++;
            });
            await batch.commit(); alert(`Successfully generated invoices for ${count} units.`); setIsInvoiceModalOpen(false);
        } catch (error) { alert("Failed to generate invoices."); } finally { setIsGeneratingInvoices(false); }
    };

    const handleApproveInvoice = async (invId: string) => { try { await updateDoc(doc(db, "invoices", invId), { status: "paid", paidAt: new Date().toISOString() }); } catch (error) { console.error(error); } };
    const handleRejectInvoice = async (invId: string) => { if (!window.confirm("Reject this payment?")) return; try { await updateDoc(doc(db, "invoices", invId), { status: "unpaid", transactionId: "" }); } catch (error) { console.error(error); } };
    const handleAddBuilding = async (e: React.FormEvent) => { e.preventDefault(); setIsSubmitting(true); try { await addDoc(collection(db, "buildings"), { name, address, totalUnits: Number(totalUnits), createdAt: new Date().toISOString() }); setName(""); setAddress(""); setTotalUnits(""); } catch (error) { console.error(error); } finally { setIsSubmitting(false); } };
    const handleApproveApp = async (appId: string, unitId: string, tenantEmail: string) => { try { await updateDoc(doc(db, "units", unitId), { status: "occupied", tenantEmail, lastMeterReading: 0 }); await updateDoc(doc(db, "applications", appId), { status: "approved" }); } catch (error) { console.error(error); } };
    const handleRejectApp = async (appId: string) => { try { await updateDoc(doc(db, "applications", appId), { status: "rejected" }); } catch (error) { console.error(error); } };
    const handleLogout = async () => { await signOut(auth); router.push("/"); };

    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    if (!user || role !== "admin") return null;

    const activeTicketsCount = maintenanceTickets.filter(t => t.status !== "resolved").length;

    return (
        <div className="min-h-screen bg-gray-50">
            <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center border-b border-gray-200 sticky top-0 z-10">
                <h1 className="text-xl font-bold text-gray-800">Admin Portal</h1>
                <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600 hidden sm:block">{user.email}</span>
                    <button onClick={handleLogout} className="text-sm px-4 py-2 bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition">Logout</button>
                </div>
            </nav>

            <main className="p-6 max-w-7xl mx-auto space-y-8">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Command Center</h2>
                        <p className="text-sm text-gray-500">Manage billing, maintenance, portfolio, and staff.</p>
                    </div>
                    <button onClick={openInvoiceModal} className="px-6 py-3 bg-gray-900 text-white font-medium rounded-md hover:bg-gray-800 transition shadow-sm whitespace-nowrap">
                        + Generate {new Date().toLocaleString('default', { month: 'short' })} Invoices
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                    {/* LEFT COLUMN */}
                    <div className="space-y-8">

                        {/* UPDATED: Maintenance Board */}
                        <div className="bg-white rounded-lg shadow-sm border border-orange-200 overflow-hidden">
                            <div className="bg-orange-50 px-6 py-4 border-b border-orange-200 flex justify-between items-center">
                                <h2 className="text-lg font-bold text-orange-800">🔧 Maintenance Board</h2>
                                {activeTicketsCount > 0 && <span className="bg-orange-200 text-orange-800 text-xs font-bold px-3 py-1 rounded-full">{activeTicketsCount} Active</span>}
                            </div>
                            <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
                                {maintenanceTickets.length === 0 ? <p className="p-6 text-sm text-gray-500 text-center">No maintenance requests.</p> : (
                                    maintenanceTickets.map((ticket) => (
                                        <div key={ticket.id} className={`p-6 flex flex-col gap-3 transition ${ticket.status === 'resolved' ? 'bg-gray-50 opacity-75' : 'bg-white'}`}>
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{ticket.category}</span>
                                                    <p className="font-bold text-gray-900 text-lg">{ticket.unitNumber}</p>
                                                    <p className="text-xs text-gray-500">{ticket.buildingName}</p>
                                                </div>
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold ${ticket.status === 'pending' ? 'bg-red-100 text-red-800' : ticket.status === 'in-progress' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>{ticket.status.toUpperCase()}</span>
                                            </div>

                                            <div className="bg-gray-100 p-3 rounded-md text-sm text-gray-700 border border-gray-200">
                                                <strong>Issue:</strong> {ticket.description}
                                            </div>

                                            {/* CareTaker Comments */}
                                            {ticket.comments && ticket.comments.length > 0 && (
                                                <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                                                    <p className="text-xs font-bold text-yellow-800 mb-1">Staff Notes:</p>
                                                    {ticket.comments.map((c: any, i: number) => (
                                                        <p key={i} className="text-xs text-gray-700 border-b border-yellow-100 pb-1 mb-1 last:border-0 last:mb-0 last:pb-0">
                                                            <span className="font-semibold">{c.author}:</span> {c.text}
                                                        </p>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="flex gap-4 mt-2">
                                                {ticket.photoUrl && <a href={ticket.photoUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">📷 Issue Photo</a>}
                                                {ticket.resolutionPhotoUrl && <a href={ticket.resolutionPhotoUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-green-600 font-bold hover:underline">✅ Proof of Fix</a>}
                                            </div>

                                            {/* Manual Override for Admin */}
                                            {ticket.status !== 'resolved' && (
                                                <div className="flex gap-2 mt-2 pt-3 border-t border-gray-100">
                                                    <button onClick={() => handleUpdateTicketStatus(ticket.id, 'resolved')} className="flex-1 py-2 bg-green-50 text-green-700 border border-green-200 rounded-md text-sm font-medium hover:bg-green-100">Force Resolve</button>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Invoices & Apps (Kept Intact) */}
                        {pendingInvoices.length > 0 && (
                            <div className="bg-white rounded-lg shadow-sm border border-green-300 overflow-hidden">
                                <div className="bg-green-50 px-6 py-4 border-b border-green-200 flex justify-between items-center"><h2 className="text-lg font-bold text-green-800">💸 Payment Verifications</h2></div>
                                <div className="divide-y divide-gray-200">
                                    {pendingInvoices.map((inv) => (
                                        <div key={inv.id} className="p-6 flex flex-col gap-3 hover:bg-gray-50">
                                            <div><p className="text-sm text-gray-500 mb-1">Unit <strong className="text-gray-800 text-lg">{inv.unitNumber}</strong> • {inv.billingPeriod}</p><p className="font-medium text-gray-700">{inv.tenantEmail}</p></div>
                                            <div className="flex gap-2 w-full mt-2"><button onClick={() => handleRejectInvoice(inv.id)} className="flex-1 py-2 border border-red-200 text-red-600 rounded-md text-sm">Reject</button><button onClick={() => handleApproveInvoice(inv.id)} className="flex-1 py-2 bg-green-600 text-white rounded-md text-sm">Verify & Paid</button></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {applications.length > 0 && (
                            <div className="bg-white rounded-lg shadow-sm border border-blue-200 overflow-hidden">
                                <div className="bg-blue-50 px-6 py-4 border-b border-blue-200 flex justify-between items-center"><h2 className="text-lg font-bold text-blue-800">📥 New Applications</h2></div>
                                <div className="divide-y divide-gray-200">
                                    {applications.map((app) => (
                                        <div key={app.id} className="p-6 flex flex-col gap-3 hover:bg-gray-50">
                                            <div><p className="text-sm text-gray-500">Unit: <strong className="text-gray-800">{app.unitNumber}</strong></p><p className="font-medium text-blue-600">{app.tenantEmail}</p></div>
                                            <div className="flex gap-2 w-full mt-2"><button onClick={() => handleRejectApp(app.id)} className="flex-1 py-2 border border-red-200 text-red-600 rounded-md text-sm">Reject</button><button onClick={() => handleApproveApp(app.id, app.unitId, app.tenantEmail)} className="flex-1 py-2 bg-blue-600 text-white rounded-md text-sm">Approve</button></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* RIGHT COLUMN */}
                    <div className="space-y-8">

                        {/* NEW: Contacts Directory */}
                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                            <h2 className="text-lg font-semibold text-gray-800 mb-4">Service Contacts</h2>
                            <form onSubmit={handleAddContact} className="flex flex-col sm:flex-row gap-2 mb-6">
                                <select value={contactRole} onChange={(e) => setContactRole(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 text-sm">
                                    <option>Plumber</option><option>Electrician</option><option>HVAC</option><option>Cleaner</option><option>Other</option>
                                </select>
                                <input type="text" placeholder="Name" required value={contactName} onChange={(e) => setContactName(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                <input type="text" placeholder="Phone" required value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                <button type="submit" disabled={isSubmittingContact} className="bg-gray-800 text-white px-4 py-2 rounded-md hover:bg-gray-900 text-sm">+</button>
                            </form>

                            <div className="space-y-3 max-h-64 overflow-y-auto">
                                {contacts.length === 0 ? <p className="text-sm text-gray-500">No contacts saved.</p> : (
                                    contacts.map(c => (
                                        <div key={c.id} className="flex justify-between items-center border border-gray-100 p-3 rounded-md bg-gray-50">
                                            <div>
                                                <span className="text-xs font-bold text-gray-500 uppercase">{c.role}</span>
                                                <p className="font-medium text-gray-800">{c.name}</p>
                                                <p className="text-sm text-blue-600">{c.phone}</p>
                                            </div>
                                            <button onClick={() => handleDeleteContact(c.id)} className="text-red-500 hover:text-red-700 text-xs">🗑️</button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Building Portfolio */}
                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                            <h2 className="text-lg font-semibold text-gray-800 mb-4">Your Portfolio</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {buildings.map((bldg) => (
                                    <div key={bldg.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition shadow-sm">
                                        <h3 className="font-bold text-gray-800 truncate">{bldg.name}</h3>
                                        <p className="text-xs text-gray-500 mt-1 truncate">{bldg.address}</p>
                                        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-sm">
                                            <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold">{bldg.totalUnits} Units</span>
                                            <button onClick={() => router.push(`/admin/buildings/${bldg.id}`)} className="text-blue-600 hover:underline font-medium text-xs">Manage &rarr;</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Add Building Form */}
                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                            <h2 className="text-lg font-semibold text-gray-800 mb-4">Add New Building</h2>
                            <form onSubmit={handleAddBuilding} className="space-y-4">
                                <div><label className="block text-sm font-medium text-gray-700 mb-1">Building Name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div>
                                <div><label className="block text-sm font-medium text-gray-700 mb-1">Address</label><input type="text" value={address} onChange={(e) => setAddress(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div>
                                <div><label className="block text-sm font-medium text-gray-700 mb-1">Total Units</label><input type="number" min="1" value={totalUnits} onChange={(e) => setTotalUnits(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div>
                                <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700">{isSubmitting ? "Adding..." : "Add Building"}</button>
                            </form>
                        </div>
                    </div>
                </div>
            </main>

            {/* (Invoice Modal - Kept exactly as previous) */}
            {isInvoiceModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
                    {/* ... Modal Content ... */}
                    <div className="bg-white rounded-lg p-6 max-w-2xl w-full shadow-xl my-8">
                        <h2 className="text-xl font-bold text-gray-900 mb-2">Generate Monthly Invoices</h2>
                        <form onSubmit={handleConfirmInvoices}>
                            <div className="mb-6 bg-blue-50 border border-blue-200 p-4 rounded-md flex justify-between">
                                <div><label className="block text-sm font-bold text-blue-900 mb-1">Electricity Rate</label></div>
                                <input type="number" step="0.01" required value={electricityRate} onChange={(e) => setElectricityRate(Number(e.target.value))} className="w-24 px-3 py-2 border border-gray-300 rounded-md" />
                            </div>
                            <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-md mb-6">
                                <table className="min-w-full divide-y divide-gray-200 text-sm">
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {occupiedUnits.map((unit) => (
                                            <tr key={unit.id} className="hover:bg-gray-50">
                                                <td className="px-4 py-3"><p className="font-bold">{unit.unitNumber}</p></td>
                                                <td className="px-4 py-3 text-right">
                                                    <input type="number" required min={unit.lastMeterReading || 0} value={meterReadings[unit.id] !== undefined ? meterReadings[unit.id] : ''} onChange={(e) => handleReadingChange(unit.id, e.target.value)} className="w-24 px-2 py-1 border border-gray-300 rounded-md text-right font-mono" />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex justify-end gap-3"><button type="button" onClick={() => setIsInvoiceModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button type="submit" disabled={isGeneratingInvoices || occupiedUnits.length === 0} className="px-6 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:bg-gray-400">Generate & Send Bills</button></div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}