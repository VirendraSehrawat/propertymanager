/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { collection, onSnapshot, doc, updateDoc, arrayUnion, query, where, writeBatch } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function EmployeeDashboard() {
    const { user, role, loading } = useAuth();
    const router = useRouter();

    const [activeTickets, setActiveTickets] = useState<any[]>([]);
    const [resolvedTickets, setResolvedTickets] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<"active" | "resolved" | "meter">("active");

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

        return () => { unsubTickets(); unsubUnits(); };
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
            const totalAmount = Number(unit.baseRent || 0) + electricityCharge;

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
                totalAmount,
                billingPeriod: monthName,
                status: "unpaid",
                transactionId: "",
                createdAt: new Date().toISOString()
            }, { merge: true });

            // Update last meter reading on the unit
            batch.update(doc(db, "units", unit.id), { lastMeterReading: reading });

            await batch.commit();
            alert(`Invoice generated for ${unit.unitNumber}!\n\nRent: ₹${unit.baseRent || 0}\nElectricity: ${unitsConsumed} units × ₹${electricityRate} = ₹${electricityCharge}\nTotal: ₹${totalAmount}`);
            setSelectedMeterUnit("");
            setCurrentReading("");
        } catch (error) {
            console.error(error);
            alert("Failed to generate invoice.");
        } finally {
            setIsGeneratingInvoice(false);
        }
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
                </div>

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

                {/* TICKET LIST */}
                {activeTab !== "meter" && (
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
        </div>
    );
}