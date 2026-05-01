/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { collection, query, where, onSnapshot, doc, getDoc, addDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function TenantDashboard() {
    const { user, role, loading } = useAuth();
    const router = useRouter();

    const [unit, setUnit] = useState<any>(null);
    const [buildingName, setBuildingName] = useState<string>("");
    const [isFetchingUnit, setIsFetchingUnit] = useState(true);

    // --- NEW: Notice Board State ---
    const [announcements, setAnnouncements] = useState<any[]>([]);

    const [upiId, setUpiId] = useState("");
    const [payeeName, setPayeeName] = useState("");

    const [buildings, setBuildings] = useState<any[]>([]);
    const [vacantUnits, setVacantUnits] = useState<any[]>([]);
    const [myApplications, setMyApplications] = useState<any[]>([]);

    const [myInvoices, setMyInvoices] = useState<any[]>([]);
    const [isPayModalOpen, setIsPayModalOpen] = useState(false);
    const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
    const [payTxnId, setPayTxnId] = useState("");
    const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

    const [myTickets, setMyTickets] = useState<any[]>([]);
    const [isMaintModalOpen, setIsMaintModalOpen] = useState(false);
    const [maintCategory, setMaintCategory] = useState("Plumbing");
    const [maintDesc, setMaintDesc] = useState("");
    const [maintFile, setMaintFile] = useState<File | null>(null);
    const [isSubmittingMaint, setIsSubmittingMaint] = useState(false);

    const [isAppModalOpen, setIsAppModalOpen] = useState(false);
    const [selectedUnit, setSelectedUnit] = useState<any>(null);
    const [idFile, setIdFile] = useState<File | null>(null);
    const [paymentFile, setPaymentFile] = useState<File | null>(null);
    const [appTxnId, setAppTxnId] = useState("");
    const [isSubmittingApp, setIsSubmittingApp] = useState(false);

    const [isUpdatePaymentModalOpen, setIsUpdatePaymentModalOpen] = useState(false);
    const [selectedAppToUpdate, setSelectedAppToUpdate] = useState<any>(null);

    useEffect(() => {
        if (!loading && (!user || role !== "tenant")) router.push("/");
    }, [user, role, loading, router]);

    useEffect(() => {
        if (!user?.email || role !== "tenant") return;
        const emailLower = user.email.toLowerCase();

        const unsubUnit = onSnapshot(query(collection(db, "units"), where("tenantEmail", "==", emailLower)), async (snapshot) => {
            if (!snapshot.empty) {
                const unitDoc = snapshot.docs[0];
                const unitData = unitDoc.data();
                setUnit({ id: unitDoc.id, ...unitData });
                if (unitData.buildingId) {
                    const bldgSnap = await getDoc(doc(db, "buildings", unitData.buildingId));
                    if (bldgSnap.exists()) setBuildingName(bldgSnap.data().name);
                }
            } else {
                setUnit(null);
            }
            setIsFetchingUnit(false);
        });

        const unsubBuildings = onSnapshot(collection(db, "buildings"), (snapshot) => { setBuildings(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any))); });
        const unsubVacant = onSnapshot(query(collection(db, "units"), where("status", "==", "vacant")), (snapshot) => { setVacantUnits(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }))); });
        const unsubApps = onSnapshot(query(collection(db, "applications"), where("tenantEmail", "==", emailLower)), (snapshot) => { setMyApplications(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any))); });
        const unsubTickets = onSnapshot(query(collection(db, "maintenance"), where("tenantEmail", "==", emailLower)), (snapshot) => { setMyTickets(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())); });
        const unsubInvoices = onSnapshot(query(collection(db, "invoices"), where("tenantEmail", "==", emailLower)), (snapshot) => { setMyInvoices(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())); });

        const unsubSettings = onSnapshot(doc(db, "settings", "payment"), (docSnap) => {
            if (docSnap.exists()) { setUpiId(docSnap.data().upiId || ""); setPayeeName(docSnap.data().payeeName || ""); }
        });

        // --- NEW: Fetch Announcements ---
        const unsubAnnouncements = onSnapshot(collection(db, "announcements"), (snapshot) => {
            const annData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
            annData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setAnnouncements(annData);
        });

        return () => { unsubUnit(); unsubVacant(); unsubApps(); unsubTickets(); unsubInvoices(); unsubBuildings(); unsubSettings(); unsubAnnouncements(); };
    }, [user?.email, role]);

    const groupedVacantUnits = buildings.map(bldg => ({ ...bldg, availableUnits: vacantUnits.filter(u => u.buildingId === bldg.id) })).filter(bldg => bldg.availableUnits.length > 0);

    const handleAppSubmit = async (e: React.FormEvent) => { e.preventDefault(); if (!user?.email || !selectedUnit || !idFile) { alert("ID Proof is required!"); return; } setIsSubmittingApp(true); try { const idRef = ref(storage, `applications/${user.uid}/id_${Date.now()}_${idFile.name}`); await uploadBytes(idRef, idFile); const idUrl = await getDownloadURL(idRef); let payUrl = ""; if (paymentFile) { const payRef = ref(storage, `applications/${user.uid}/payment_${Date.now()}_${paymentFile.name}`); await uploadBytes(payRef, paymentFile); payUrl = await getDownloadURL(payRef); } await addDoc(collection(db, "applications"), { tenantEmail: user.email.toLowerCase(), unitId: selectedUnit.id, unitNumber: selectedUnit.unitNumber, buildingId: selectedUnit.buildingId, securityDeposit: selectedUnit.baseRent, transactionId: appTxnId || "", idProofUrl: idUrl, paymentProofUrl: payUrl, status: "pending", createdAt: new Date().toISOString() }); setIsAppModalOpen(false); setSelectedUnit(null); setIdFile(null); setPaymentFile(null); setAppTxnId(""); } catch (error) { console.error(error); alert("Upload failed. Please try again."); } finally { setIsSubmittingApp(false); } };
    const handleUpdatePayment = async (e: React.FormEvent) => { e.preventDefault(); if (!selectedAppToUpdate || !paymentFile || !appTxnId) return; setIsSubmittingApp(true); try { const payRef = ref(storage, `applications/${user?.uid}/payment_${Date.now()}_${paymentFile.name}`); await uploadBytes(payRef, paymentFile); const payUrl = await getDownloadURL(payRef); await updateDoc(doc(db, "applications", selectedAppToUpdate.id), { paymentProofUrl: payUrl, transactionId: appTxnId }); setIsUpdatePaymentModalOpen(false); setSelectedAppToUpdate(null); setPaymentFile(null); setAppTxnId(""); } catch (error) { console.error(error); alert("Payment upload failed."); } finally { setIsSubmittingApp(false); } };
    const handlePayInvoice = async (e: React.FormEvent) => { e.preventDefault(); if (!selectedInvoice || !payTxnId) return; setIsSubmittingPayment(true); try { await updateDoc(doc(db, "invoices", selectedInvoice.id), { status: "pending", transactionId: payTxnId, submittedAt: new Date().toISOString() }); setIsPayModalOpen(false); setSelectedInvoice(null); setPayTxnId(""); } catch (error) { console.error(error); alert("Failed to submit payment."); } finally { setIsSubmittingPayment(false); } };
    const handleMaintenanceSubmit = async (e: React.FormEvent) => { e.preventDefault(); if (!user?.email || !unit || !maintDesc) return; setIsSubmittingMaint(true); try { let photoUrl = ""; if (maintFile) { const fileRef = ref(storage, `maintenance/${user.uid}/${Date.now()}_${maintFile.name}`); await uploadBytes(fileRef, maintFile); photoUrl = await getDownloadURL(fileRef); } await addDoc(collection(db, "maintenance"), { tenantEmail: user.email.toLowerCase(), unitId: unit.id, unitNumber: unit.unitNumber, buildingName, category: maintCategory, description: maintDesc, photoUrl, status: "pending", createdAt: new Date().toISOString() }); setMaintCategory("Plumbing"); setMaintDesc(""); setMaintFile(null); setIsMaintModalOpen(false); } catch { alert("Failed to submit ticket."); } finally { setIsSubmittingMaint(false); } };
    const handleLogout = async () => { await signOut(auth); router.push("/"); };

    if (loading || isFetchingUnit) return <div className="min-h-screen flex items-center justify-center bg-gray-50">Loading your portal...</div>;
    if (!user || role !== "tenant") return null;

    const upiLink = selectedInvoice && upiId ? `upi://pay?pa=${upiId}&pn=${encodeURIComponent(payeeName)}&am=${selectedInvoice.totalAmount}&cu=INR` : "";
    const qrCodeUrl = upiLink ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiLink)}` : "";

    // --- NEW: Filter Announcements ---
    // If the tenant is assigned to a unit, show "all" notices + notices for their specific building.
    // If they are not assigned yet (just browsing), only show "all" notices.
    const relevantAnnouncements = announcements.filter(ann =>
        ann.target === "all" || (unit && ann.target === unit.buildingId)
    );

    return (
        <div className="min-h-screen bg-gray-50">
            <nav className="bg-blue-600 px-6 py-4 flex justify-between items-center text-white shadow-md">
                <h1 className="text-xl font-bold">Tenant Portal</h1>
                <button onClick={handleLogout} className="text-sm bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded transition">Logout</button>
            </nav>

            <main className="p-6 max-w-4xl mx-auto mt-4 space-y-6">

                {/* --- NEW: TENANT NOTICE BOARD --- */}
                {relevantAnnouncements.length > 0 && (
                    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-xl">📢</span>
                            <h2 className="text-lg font-bold text-yellow-900">Notice Board</h2>
                        </div>
                        <div className="space-y-3 mt-3">
                            {relevantAnnouncements.map((ann) => (
                                <div key={ann.id} className="bg-white p-4 rounded border border-yellow-200 shadow-sm">
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className="font-bold text-gray-900">{ann.title}</h3>
                                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{new Date(ann.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{ann.message}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {!unit ? (
                    <div className="space-y-6">
                        <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-200 text-center mb-8"><h2 className="text-xl font-bold text-gray-800 mb-2">Welcome! Browse available units.</h2><p className="text-sm text-gray-500">Apply with your ID. You can upload the security deposit receipt later.</p></div>
                        {groupedVacantUnits.length === 0 ? <p className="text-gray-500 text-center">No units are currently available.</p> : (
                            <div className="space-y-10">
                                {groupedVacantUnits.map((bldg) => (
                                    <div key={bldg.id} className="space-y-4">
                                        <div className="border-b border-gray-200 pb-2"><h3 className="text-lg font-bold text-gray-900">{bldg.name}</h3><p className="text-sm text-gray-500">{bldg.address}</p></div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            {bldg.availableUnits.map((vUnit: any) => {
                                                const existingApp = myApplications.find(app => app.unitId === vUnit.id);
                                                return (
                                                    <div key={vUnit.id} className="bg-white border border-gray-200 rounded-lg p-5 flex flex-col justify-between shadow-sm">
                                                        <div><h4 className="font-bold text-lg text-gray-900">{vUnit.unitNumber}</h4><p className="text-gray-600 mt-1">Rent & Deposit: ₹{vUnit.baseRent}</p></div>
                                                        <div className="mt-4">
                                                            {existingApp ? (existingApp.paymentProofUrl ? <span className="block w-full text-center bg-orange-50 border border-orange-200 text-orange-800 py-2 rounded-md text-sm font-medium">Under Review</span> : <button onClick={() => { setSelectedAppToUpdate(existingApp); setIsUpdatePaymentModalOpen(true); }} className="w-full bg-yellow-500 text-white py-2 rounded-md text-sm font-medium hover:bg-yellow-600 transition">+ Add Deposit Receipt</button>) : <button onClick={() => { setSelectedUnit(vUnit); setIsAppModalOpen(true); }} className="w-full bg-blue-600 text-white py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition">Apply Now</button>}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-8">
                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-l-4 border-l-blue-500">
                            <div><h2 className="text-2xl font-bold text-gray-900">{unit.unitNumber}</h2><p className="text-sm text-gray-500">{buildingName}</p></div>
                            <div className="text-left md:text-right"><p className="text-sm text-gray-500">Monthly Rent</p><p className="text-2xl font-bold text-gray-900">₹{unit.baseRent}</p></div>
                        </div>

                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                            <h3 className="text-lg font-bold text-gray-800 mb-4">My Invoices</h3>
                            {myInvoices.length === 0 ? <p className="text-gray-500 text-sm">You have no invoices generated yet.</p> : (
                                <div className="space-y-3">
                                    {myInvoices.map(invoice => (
                                        <div key={invoice.id} className="border border-gray-200 p-4 rounded-md flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white hover:shadow-sm transition">
                                            <div className="w-full lg:w-auto">
                                                <div className="flex items-center gap-3 mb-2"><p className="font-bold text-gray-800 text-lg">{invoice.billingPeriod}</p><span className={`px-2 py-0.5 text-xs font-bold rounded-full ${invoice.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{invoice.status.toUpperCase()}</span></div>
                                                {invoice.isCustom ? (
                                                    <div className="bg-yellow-50 border border-yellow-100 p-3 rounded text-sm text-gray-700 mb-2 max-w-sm"><div className="flex justify-between items-center font-bold"><span>Ad-Hoc Charge:</span><span className="text-lg">₹{invoice.totalAmount}</span></div></div>
                                                ) : (
                                                    <div className="bg-gray-50 border border-gray-100 p-3 rounded text-sm text-gray-600 mb-2 max-w-sm"><div className="flex justify-between mb-1"><span>Base Rent:</span><span className="font-medium">₹{invoice.baseRent}</span></div><div className="flex justify-between mb-1"><span>Electricity ({invoice.electricityConsumed} units):</span><span className="font-medium">+ ₹{invoice.electricityCharge}</span></div><div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-gray-900 font-bold"><span>Total Due:</span><span>₹{invoice.totalAmount}</span></div></div>
                                                )}
                                            </div>

                                            {invoice.status === 'unpaid' ? <button onClick={() => { setSelectedInvoice(invoice); setIsPayModalOpen(true); }} className="px-6 py-3 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 w-full lg:w-auto shadow-sm">Pay ₹{invoice.totalAmount} Now</button> : invoice.status === 'pending' ? <span className="px-6 py-3 bg-orange-50 border border-orange-200 text-orange-800 rounded-md text-sm font-medium w-full lg:w-auto text-center">Verification Pending</span> : <span className="px-6 py-3 bg-green-50 border border-green-200 text-green-800 rounded-md text-sm font-medium w-full lg:w-auto text-center">Payment Verified ✅</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 gap-4"><button onClick={() => setIsMaintModalOpen(true)} className="bg-white border border-gray-300 p-6 rounded-lg shadow-sm hover:border-orange-400 hover:bg-orange-50 flex flex-col items-center justify-center text-gray-700 transition-all"><span className="text-2xl mb-2">🔧</span><span className="font-semibold text-lg text-orange-600">Request Maintenance</span><span className="text-xs mt-1 text-gray-400">Report an issue with your unit</span></button></div>

                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                            <h3 className="text-lg font-bold text-gray-800 mb-4">Maintenance Requests</h3>
                            {myTickets.length === 0 ? <p className="text-gray-500 text-sm">No requests found.</p> : (
                                <div className="space-y-3">
                                    {myTickets.map(ticket => (
                                        <div key={ticket.id} className="border border-gray-100 bg-gray-50 p-4 rounded-md flex justify-between items-center"><div><p className="font-semibold text-gray-800">{ticket.category}</p><p className="text-sm text-gray-600 truncate max-w-xs">{ticket.description}</p></div><span className="px-3 py-1 bg-gray-200 rounded-full text-xs font-bold text-gray-700">{ticket.status.toUpperCase()}</span></div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </main>

            {/* --- MODALS --- */}
            {isAppModalOpen && selectedUnit && (<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto"><div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl my-8"><h2 className="text-xl font-bold text-gray-900 mb-2">Apply for {selectedUnit.unitNumber}</h2><form onSubmit={handleAppSubmit} className="space-y-5"><div><label className="block text-sm font-medium text-gray-700 mb-1">ID Proof (PDF/Image) *</label><input type="file" accept="image/*,.pdf" required onChange={(e) => setIdFile(e.target.files ? e.target.files[0] : null)} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700" /></div><div className="pt-4 border-t border-gray-100"><p className="text-sm font-bold text-gray-800 mb-2">Security Deposit (Optional for now)</p><p className="text-xs text-gray-500 mb-3">You can submit the application now and upload the ₹{selectedUnit.baseRent} deposit receipt later.</p><div className="space-y-4"><div><label className="block text-sm font-medium text-gray-700 mb-1">Payment Screenshot</label><input type="file" accept="image/*,.pdf" onChange={(e) => setPaymentFile(e.target.files ? e.target.files[0] : null)} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-green-50 file:text-green-700" /></div><div><label className="block text-sm font-medium text-gray-700 mb-1">Transaction ID</label><input type="text" value={appTxnId} onChange={(e) => setAppTxnId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div></div></div><div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100"><button type="button" onClick={() => setIsAppModalOpen(false)} disabled={isSubmittingApp} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button type="submit" disabled={isSubmittingApp} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">{isSubmittingApp ? "Submitting..." : "Submit Application"}</button></div></form></div></div>)}
            {isUpdatePaymentModalOpen && selectedAppToUpdate && (<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto"><div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl my-8"><h2 className="text-xl font-bold text-gray-900 mb-2">Upload Deposit Receipt</h2><p className="text-sm text-gray-600 mb-6">Securing unit <strong className="text-gray-900">{selectedAppToUpdate.unitNumber}</strong>.</p><form onSubmit={handleUpdatePayment} className="space-y-4"><div><label className="block text-sm font-medium text-gray-700 mb-1">Payment Screenshot *</label><input type="file" accept="image/*,.pdf" required onChange={(e) => setPaymentFile(e.target.files ? e.target.files[0] : null)} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-green-50 file:text-green-700" /></div><div><label className="block text-sm font-medium text-gray-700 mb-1">Transaction ID *</label><input type="text" required value={appTxnId} onChange={(e) => setAppTxnId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div><div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100"><button type="button" onClick={() => setIsUpdatePaymentModalOpen(false)} disabled={isSubmittingApp} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button type="submit" disabled={isSubmittingApp} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">{isSubmittingApp ? "Uploading..." : "Upload Payment"}</button></div></form></div></div>)}
            {isPayModalOpen && selectedInvoice && (<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto"><div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl my-8"><h2 className="text-xl font-bold text-gray-900 mb-2">Pay Invoice</h2><p className="text-sm text-gray-600 mb-4">Total Amount Due: <strong className="text-xl text-gray-900">₹{selectedInvoice.totalAmount}</strong></p>{!upiId ? (<div className="bg-yellow-50 border border-yellow-200 p-4 rounded-md mb-6 text-sm text-yellow-800 text-center">The property manager has not set up their UPI details yet. Please contact them directly to complete payment.</div>) : (<div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex flex-col items-center justify-center mb-6"><p className="text-xs font-bold text-blue-800 uppercase tracking-widest mb-3">Pay via UPI</p><div className="bg-white p-2 rounded-lg shadow-sm border border-gray-200 mb-4 hidden sm:block"><img src={qrCodeUrl} alt="UPI QR Code" className="w-32 h-32" /></div><p className="text-xs text-gray-500 mb-3 hidden sm:block">Scan with GPay, PhonePe, or Paytm</p><a href={upiLink} className="w-full bg-blue-600 text-white text-center py-3 rounded-md font-bold shadow-sm hover:bg-blue-700 transition sm:hidden">Open UPI App to Pay</a><div className="text-xs text-gray-500 mt-2 font-mono">UPI ID: {upiId}</div></div>)}<form onSubmit={handlePayInvoice} className="space-y-4"><div><label className="block text-sm font-bold text-gray-700 mb-1">Enter 12-Digit UTR / Transaction ID</label><p className="text-xs text-gray-500 mb-2">After paying via UPI, enter the reference number below to submit for verification.</p><input type="text" required value={payTxnId} onChange={(e) => setPayTxnId(e.target.value)} className="w-full px-3 py-3 border border-gray-300 rounded-md focus:ring-blue-500 font-mono tracking-wider" placeholder="e.g., 312345678901" /></div><div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100"><button type="button" onClick={() => setIsPayModalOpen(false)} disabled={isSubmittingPayment} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md font-medium">Cancel</button><button type="submit" disabled={isSubmittingPayment} className="px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 font-medium disabled:bg-gray-400">{isSubmittingPayment ? "Submitting..." : "Submit for Verification"}</button></div></form></div></div>)}
            {isMaintModalOpen && (<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto"><div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl"><h2 className="text-xl font-bold text-gray-900 mb-4">Request Maintenance</h2><form onSubmit={handleMaintenanceSubmit} className="space-y-4"><div><label className="block text-sm font-medium text-gray-700 mb-1">Category</label><select value={maintCategory} onChange={(e) => setMaintCategory(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md"><option>Plumbing</option><option>Electrical</option><option>Appliance</option><option>Carpentry</option><option>Other</option></select></div><div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea required rows={3} value={maintDesc} onChange={(e) => setMaintDesc(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md"></textarea></div><div><label className="block text-sm font-medium text-gray-700 mb-1">Photo (Optional)</label><input type="file" accept="image/*" onChange={(e) => setMaintFile(e.target.files ? e.target.files[0] : null)} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-gray-100" /></div><div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100"><button type="button" onClick={() => setIsMaintModalOpen(false)} disabled={isSubmittingMaint} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button type="submit" disabled={isSubmittingMaint} className="px-4 py-2 bg-orange-600 text-white rounded-md">Submit Ticket</button></div></form></div></div>)}
        </div>
    );
}