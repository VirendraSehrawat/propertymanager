"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc, collection, query, where, onSnapshot, writeBatch, addDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";

interface Unit {
    id: string;
    unitNumber: string;
    baseRent: number;
    status: string;
    tenantEmail: string;
    tenantName?: string;
    tenantPhone?: string;
    lastMeterReading?: number;
    buildingId: string;
    createdAt: string;
    documents?: { name: string; url: string; uploadedAt: string }[];
    notes?: { text: string; author: string; createdAt: string }[];
}

export default function BuildingUnitsPage() {
    const { id } = useParams();
    const router = useRouter();
    const { role, loading } = useAuth();

    const [building, setBuilding] = useState<any>(null);
    const [units, setUnits] = useState<Unit[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);

    const [unitNumber, setUnitNumber] = useState("");
    const [baseRent, setBaseRent] = useState("8000");

    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [selectedUnit, setSelectedUnit] = useState<any>(null);
    const [tenantEmail, setTenantEmail] = useState("");
    const [tenantName, setTenantName] = useState("");
    const [tenantPhone, setTenantPhone] = useState("");

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingUnit, setEditingUnit] = useState<any>(null);
    const [editUnitNumber, setEditUnitNumber] = useState("");
    const [editBaseRent, setEditBaseRent] = useState("");

    // NEW: Document Upload States
    const [isDocModalOpen, setIsDocModalOpen] = useState(false);
    const [selectedUnitForDoc, setSelectedUnitForDoc] = useState<any>(null);
    const [docName, setDocName] = useState("");
    const [docFile, setDocFile] = useState<File | null>(null);
    const [isUploadingDoc, setIsUploadingDoc] = useState(false);

    // NEW: Assign Existing Tenant to Another Room
    const [isAssignExistingModalOpen, setIsAssignExistingModalOpen] = useState(false);
    const [selectedVacantUnit, setSelectedVacantUnit] = useState<any>(null);
    const [selectedExistingTenant, setSelectedExistingTenant] = useState("");

    // NEW: Single Room Meter Reading & Invoice
    const [isMeterModalOpen, setIsMeterModalOpen] = useState(false);
    const [meterUnit, setMeterUnit] = useState<any>(null);
    const [meterReading, setMeterReading] = useState("");
    const [meterMonth, setMeterMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [isGeneratingMeterInvoice, setIsGeneratingMeterInvoice] = useState(false);
    const [meterElectricityRate] = useState(12);

    // NEW: Tenant Profile & Notes
    const [isTenantProfileOpen, setIsTenantProfileOpen] = useState(false);
    const [profileUnit, setProfileUnit] = useState<any>(null);
    const [profileName, setProfileName] = useState("");
    const [profilePhone, setProfilePhone] = useState("");
    const [profileEmail, setProfileEmail] = useState("");
    const [profileNote, setProfileNote] = useState("");
    const [isSavingProfile, setIsSavingProfile] = useState(false);

    useEffect(() => {
        if (!loading && role !== "admin") router.push("/");
    }, [role, loading, router]);

    useEffect(() => {
        if (!id) return;
        const fetchBuilding = async () => {
            const docSnap = await getDoc(doc(db, "buildings", id as string));
            if (docSnap.exists()) setBuilding({ id: docSnap.id, ...docSnap.data() });
        };
        fetchBuilding();
    }, [id]);

    useEffect(() => {
        if (!id) return;
        const unsub = onSnapshot(query(collection(db, "units"), where("buildingId", "==", id)), (snapshot) => {
            setUnits(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Unit)).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })));
        });
        return () => unsub();
    }, [id]);

    const handleAutoGenerate = async () => {
        if (!building || units.length > 0) return; setIsGenerating(true);
        try {
            const batch = writeBatch(db);
            for (let i = 1; i <= building.totalUnits; i++) {
                batch.set(doc(collection(db, "units")), { buildingId: id, unitNumber: `Unit ${i}`, baseRent: 8000, status: "vacant", tenantEmail: "", createdAt: new Date().toISOString() });
            }
            await batch.commit();
        } catch (error) { console.error(error); } finally { setIsGenerating(false); }
    };

    const handleManualAdd = async (e: React.FormEvent) => {
        e.preventDefault(); if (!unitNumber || !baseRent) return;
        try { await addDoc(collection(db, "units"), { buildingId: id, unitNumber, baseRent: Number(baseRent), status: "vacant", tenantEmail: "", createdAt: new Date().toISOString() }); setUnitNumber(""); setBaseRent("8000"); } catch (error) { console.error(error); }
    };

    const handleAssignTenant = async (e: React.FormEvent) => {
        e.preventDefault(); if (!selectedUnit || !tenantEmail) return;
        try { await updateDoc(doc(db, "units", selectedUnit.id), { status: "occupied", tenantEmail: tenantEmail.toLowerCase(), tenantName, tenantPhone }); setIsAssignModalOpen(false); setSelectedUnit(null); setTenantEmail(""); setTenantName(""); setTenantPhone(""); } catch (error) { console.error(error); }
    };

    const handleRemoveTenant = async (unitId: string) => {
        if (!window.confirm("Remove this tenant?")) return;
        try { await updateDoc(doc(db, "units", unitId), { status: "vacant", tenantEmail: "" }); } catch (error) { console.error(error); }
    };

    const handleAssignExistingTenant = async (e: React.FormEvent) => {
        e.preventDefault(); if (!selectedVacantUnit || !selectedExistingTenant) return;
        const sourceUnit = units.find(u => u.id === selectedExistingTenant);
        if (!sourceUnit) return;
        try {
            await updateDoc(doc(db, "units", selectedVacantUnit.id), { status: "occupied", tenantEmail: sourceUnit.tenantEmail, tenantName: sourceUnit.tenantName || "", tenantPhone: sourceUnit.tenantPhone || "" });
            setIsAssignExistingModalOpen(false); setSelectedVacantUnit(null); setSelectedExistingTenant("");
        } catch (error) { console.error(error); }
    };

    const handleMeterInvoice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!meterUnit || !meterReading || !meterMonth) return;
        setIsGeneratingMeterInvoice(true);
        try {
            const [year, month] = meterMonth.split("-");
            const monthName = new Date(Number(year), Number(month) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
            const monthKey = `${month}_${year}`;

            const reading = Number(meterReading);
            const previousReading = Number(meterUnit.lastMeterReading) || 0;
            const unitsConsumed = Math.max(0, reading - previousReading);
            const electricityCharge = unitsConsumed * meterElectricityRate;
            const totalAmount = Number(meterUnit.baseRent || 0) + electricityCharge;

            const invoiceId = `inv_${meterUnit.id}_${monthKey}`;
            const batch = writeBatch(db);

            batch.set(doc(db, "invoices", invoiceId), {
                unitId: meterUnit.id,
                unitNumber: meterUnit.unitNumber,
                tenantEmail: meterUnit.tenantEmail,
                baseRent: meterUnit.baseRent || 0,
                previousReading,
                currentReading: reading,
                electricityConsumed: unitsConsumed,
                electricityRate: meterElectricityRate,
                electricityCharge,
                totalAmount,
                billingPeriod: monthName,
                status: "unpaid",
                transactionId: "",
                createdAt: new Date().toISOString()
            }, { merge: true });

            batch.update(doc(db, "units", meterUnit.id), { lastMeterReading: reading });
            await batch.commit();

            alert(`Invoice generated for ${meterUnit.unitNumber}!\n\nRent: ₹${meterUnit.baseRent || 0}\nElectricity: ${unitsConsumed} units × ₹${meterElectricityRate} = ₹${electricityCharge}\nTotal: ₹${totalAmount}`);
            setIsMeterModalOpen(false); setMeterUnit(null); setMeterReading("");
        } catch (error) { console.error(error); alert("Failed to generate invoice."); } finally { setIsGeneratingMeterInvoice(false); }
    };

    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault(); if (!editingUnit || !editUnitNumber || !editBaseRent) return;
        try { await updateDoc(doc(db, "units", editingUnit.id), { unitNumber: editUnitNumber, baseRent: Number(editBaseRent) }); setIsEditModalOpen(false); setEditingUnit(null); } catch (error) { console.error(error); }
    };

    // --- NEW: Handle Document Upload ---
    const handleDocUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUnitForDoc || !docName || !docFile) return;
        setIsUploadingDoc(true);

        try {
            const fileRef = ref(storage, `tenant_docs/${selectedUnitForDoc.id}/${Date.now()}_${docFile.name}`);
            await uploadBytes(fileRef, docFile);
            const fileUrl = await getDownloadURL(fileRef);

            await updateDoc(doc(db, "units", selectedUnitForDoc.id), {
                documents: arrayUnion({
                    name: docName,
                    url: fileUrl,
                    uploadedAt: new Date().toISOString()
                })
            });

            setIsDocModalOpen(false);
            setSelectedUnitForDoc(null);
            setDocName("");
            setDocFile(null);
        } catch (error) {
            console.error(error);
            alert("Failed to upload document.");
        } finally {
            setIsUploadingDoc(false);
        }
    };

    const handleSaveTenantProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profileUnit) return;
        setIsSavingProfile(true);
        try {
            await updateDoc(doc(db, "units", profileUnit.id), {
                tenantName: profileName,
                tenantPhone: profilePhone,
                tenantEmail: profileEmail.toLowerCase()
            });
            setIsTenantProfileOpen(false);
            setProfileUnit(null);
        } catch (error) { console.error(error); alert("Failed to update tenant."); } finally { setIsSavingProfile(false); }
    };

    const handleAddNote = async () => {
        if (!profileUnit || !profileNote.trim()) return;
        try {
            await updateDoc(doc(db, "units", profileUnit.id), {
                notes: arrayUnion({ text: profileNote.trim(), author: "Admin", createdAt: new Date().toISOString() })
            });
            setProfileNote("");
        } catch (error) { console.error(error); alert("Failed to add note."); }
    };

    const openTenantProfile = (unit: Unit) => {
        setProfileUnit(unit);
        setProfileName(unit.tenantName || "");
        setProfilePhone(unit.tenantPhone || "");
        setProfileEmail(unit.tenantEmail || "");
        setProfileNote("");
        setIsTenantProfileOpen(true);
    };

    if (!building) return <div className="p-8 text-center text-gray-500">Loading building details...</div>;

    return (
        <div className="min-h-screen bg-gray-50">
            <nav className="bg-white shadow-sm px-6 py-4 flex items-center gap-4 border-b border-gray-200">
                <button onClick={() => router.push("/admin")} className="text-blue-600 hover:underline">&larr; Back</button>
                <h1 className="text-xl font-bold text-gray-800">{building.name} - Unit Management</h1>
            </nav>

            <main className="p-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Left Sidebar */}
                <div className="lg:col-span-1 space-y-6">
                    {units.length === 0 && (
                        <div className="bg-white p-6 rounded-lg shadow-sm border border-blue-200 bg-blue-50">
                            <h2 className="text-lg font-semibold text-blue-800 mb-2">Fast Setup</h2>
                            <button onClick={handleAutoGenerate} disabled={isGenerating} className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 transition disabled:bg-blue-400">{isGenerating ? "Generating..." : "Auto-Generate Units"}</button>
                        </div>
                    )}
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                        <h2 className="text-lg font-semibold text-gray-800 mb-4">Add Single Unit</h2>
                        <form onSubmit={handleManualAdd} className="space-y-4">
                            <div><label className="block text-sm font-medium text-gray-700 mb-1">Unit Number</label><input type="text" value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div>
                            <div><label className="block text-sm font-medium text-gray-700 mb-1">Base Rent (₹)</label><input type="number" value={baseRent} onChange={(e) => setBaseRent(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div>
                            <button type="submit" className="w-full bg-gray-800 text-white py-2 rounded-md hover:bg-gray-900 transition">Add Unit</button>
                        </form>
                    </div>
                </div>

                {/* Right Area: Units Grid */}
                <div className="lg:col-span-2">
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                        <h2 className="text-lg font-semibold text-gray-800 mb-4">All Units ({units.length})</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {units.map((unit) => (
                                <div key={unit.id} className={`border rounded-lg p-5 transition flex flex-col justify-between ${unit.status === 'occupied' ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>

                                    <div>
                                        <div className="flex justify-between items-start">
                                            <h3 className="font-bold text-gray-900 text-lg">{unit.unitNumber}</h3>
                                            <button onClick={() => { setEditingUnit(unit); setEditUnitNumber(unit.unitNumber); setEditBaseRent(unit.baseRent.toString()); setIsEditModalOpen(true); }} className="text-xs text-gray-500 hover:text-blue-600 bg-white border border-gray-200 px-2 py-1 rounded shadow-sm">✎ Edit</button>
                                        </div>
                                        <p className="text-sm text-gray-600 mt-1">Rent: ₹{unit.baseRent}</p>

                                        {unit.status === 'occupied' && (
                                            <div className="mt-3">
                                                <p className="text-xs text-blue-800 font-medium bg-blue-100 p-1.5 rounded truncate">👤 {unit.tenantEmail}</p>

                                                {/* --- NEW: Document List --- */}
                                                <div className="mt-3 pt-3 border-t border-blue-200">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="text-xs font-bold text-gray-500 uppercase">Documents</span>
                                                        <button onClick={() => { setSelectedUnitForDoc(unit); setIsDocModalOpen(true); }} className="text-xs text-blue-600 hover:underline font-medium">+ Add Doc</button>
                                                    </div>

                                                    {unit.documents && unit.documents.length > 0 ? (
                                                        <ul className="space-y-1">
                                                            {unit.documents.map((doc: any, i: number) => (
                                                                <li key={i}><a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">📄 {doc.name}</a></li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        <p className="text-xs text-gray-400 italic">No files attached.</p>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-4 pt-4 border-t border-gray-200/50 flex items-center justify-between">
                                        <span className={`text-xs px-2 py-1 rounded-full font-bold ${unit.status === 'vacant' ? 'bg-gray-100 text-gray-600' : 'bg-blue-200 text-blue-800'}`}>
                                            {unit.status.toUpperCase()}
                                        </span>

                                        {unit.status === 'vacant' ? (
                                            <div className="flex gap-2">
                                                <button onClick={() => { setSelectedVacantUnit(unit); setIsAssignExistingModalOpen(true); }} className="text-sm text-green-600 hover:underline font-medium">Existing Tenant</button>
                                                <button onClick={() => { setSelectedUnit(unit); setIsAssignModalOpen(true); }} className="text-sm text-blue-600 hover:underline font-medium">New Tenant</button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                <button onClick={() => openTenantProfile(unit)} className="text-sm text-indigo-600 hover:underline font-medium">👤 Profile</button>
                                                <button onClick={() => { setMeterUnit(unit); setMeterReading(""); setIsMeterModalOpen(true); }} className="text-sm text-purple-600 hover:underline font-medium">⚡ Meter</button>
                                                <button onClick={() => handleRemoveTenant(unit.id)} className="text-sm text-red-600 hover:underline font-medium">Remove</button>
                                            </div>
                                        )}
                                    </div>

                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>

            {/* --- ADMIN DOCUMENT MODAL --- */}
            {isDocModalOpen && selectedUnitForDoc && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
                        <h2 className="text-xl font-bold mb-2">Upload Document</h2>
                        <p className="text-sm text-gray-600 mb-4">Attach a file (like Police Verification or Lease Agreement) to <strong className="text-gray-900">{selectedUnitForDoc.unitNumber}</strong>.</p>
                        <form onSubmit={handleDocUpload} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Document Type / Name</label>
                                <select required value={docName} onChange={(e) => setDocName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
                                    <option value="" disabled>Select document type...</option>
                                    <option value="Police Verification">Police Verification</option>
                                    <option value="Lease Agreement">Lease Agreement</option>
                                    <option value="ID Proof">ID Proof</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Select File (PDF/Image)</label>
                                <input type="file" accept="image/*,.pdf" required onChange={(e) => setDocFile(e.target.files ? e.target.files[0] : null)} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-gray-100" />
                            </div>
                            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
                                <button type="button" onClick={() => setIsDocModalOpen(false)} disabled={isUploadingDoc} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
                                <button type="submit" disabled={isUploadingDoc} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">{isUploadingDoc ? "Uploading..." : "Save Document"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* KEEP EXISTING MODALS: Edit Unit and Assign Tenant */}
            {isEditModalOpen && editingUnit && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl"><h2 className="text-xl font-bold mb-4">Edit Unit Details</h2><form onSubmit={handleEditSubmit}><div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-1">Unit Number / Name</label><input type="text" required value={editUnitNumber} onChange={(e) => setEditUnitNumber(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div><div className="mb-6"><label className="block text-sm font-medium text-gray-700 mb-1">Base Rent (₹)</label><input type="number" required value={editBaseRent} onChange={(e) => setEditBaseRent(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div><div className="flex justify-end gap-3"><button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Save Changes</button></div></form></div>
                </div>
            )}

            {isAssignModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl"><h2 className="text-xl font-bold mb-4">Assign Tenant to {selectedUnit?.unitNumber}</h2><form onSubmit={handleAssignTenant}><div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-1">Tenant Name</label><input type="text" required value={tenantName} onChange={(e) => setTenantName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="John Doe" /></div><div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label><input type="tel" required value={tenantPhone} onChange={(e) => setTenantPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="+91 9876543210" /></div><div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-1">Tenant Email</label><input type="email" required value={tenantEmail} onChange={(e) => setTenantEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="tenant@example.com" /></div><div className="flex justify-end gap-3 mt-6"><button type="button" onClick={() => setIsAssignModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Confirm Assignment</button></div></form></div>
                </div>
            )}

            {isAssignExistingModalOpen && selectedVacantUnit && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl"><h2 className="text-xl font-bold mb-4">Assign Existing Tenant to {selectedVacantUnit.unitNumber}</h2><form onSubmit={handleAssignExistingTenant}><div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-1">Select Existing Tenant</label><select required value={selectedExistingTenant} onChange={(e) => setSelectedExistingTenant(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md"><option value="" disabled>Choose a tenant...</option>{units.filter(u => u.status === "occupied").map(u => (<option key={u.id} value={u.id}>{u.unitNumber} - {u.tenantEmail}</option>))}</select></div><p className="text-xs text-gray-500 mb-4">This will assign the selected tenant to <strong>{selectedVacantUnit.unitNumber}</strong> as an additional room. The tenant will remain in their current unit as well.</p><div className="flex justify-end gap-3 mt-6"><button type="button" onClick={() => { setIsAssignExistingModalOpen(false); setSelectedVacantUnit(null); setSelectedExistingTenant(""); }} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">Assign Room</button></div></form></div>
                </div>
            )}

            {/* METER READING MODAL */}
            {isMeterModalOpen && meterUnit && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
                        <h2 className="text-xl font-bold mb-1">⚡ Meter Reading — {meterUnit.unitNumber}</h2>
                        <p className="text-sm text-gray-500 mb-4">{meterUnit.tenantEmail} • Last reading: <strong className="font-mono">{meterUnit.lastMeterReading || 0}</strong></p>
                        <form onSubmit={handleMeterInvoice} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Billing Month</label>
                                <input type="month" required value={meterMonth} onChange={(e) => setMeterMonth(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Current Meter Reading</label>
                                <input type="number" required min={meterUnit.lastMeterReading || 0} value={meterReading} onChange={(e) => setMeterReading(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono" placeholder="e.g. 1250" />
                            </div>
                            {meterReading && (() => {
                                const prev = Number(meterUnit.lastMeterReading) || 0;
                                const curr = Number(meterReading);
                                const consumed = Math.max(0, curr - prev);
                                const elecCharge = consumed * meterElectricityRate;
                                const total = Number(meterUnit.baseRent || 0) + elecCharge;
                                return (
                                    <div className="bg-gray-50 border border-gray-200 rounded-md p-3 text-sm space-y-1">
                                        <div className="flex justify-between"><span>Units consumed:</span><span className="font-mono font-bold">{consumed}</span></div>
                                        <div className="flex justify-between"><span>Electricity (×₹{meterElectricityRate}):</span><span className="font-mono">₹{elecCharge}</span></div>
                                        <div className="flex justify-between"><span>Base Rent:</span><span className="font-mono">₹{meterUnit.baseRent || 0}</span></div>
                                        <div className="flex justify-between border-t pt-1 mt-1"><span className="font-bold">Total Invoice:</span><span className="font-bold text-green-700">₹{total}</span></div>
                                    </div>
                                );
                            })()}
                            <div className="flex justify-end gap-3 mt-4">
                                <button type="button" onClick={() => { setIsMeterModalOpen(false); setMeterUnit(null); }} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
                                <button type="submit" disabled={isGeneratingMeterInvoice} className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-purple-400">{isGeneratingMeterInvoice ? "Generating..." : "Generate Invoice"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* TENANT PROFILE MODAL */}
            {isTenantProfileOpen && profileUnit && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
                    <div className="bg-white rounded-lg p-6 max-w-lg w-full shadow-xl my-8">
                        <h2 className="text-xl font-bold mb-1">👤 Tenant Profile — {profileUnit.unitNumber}</h2>
                        <p className="text-sm text-gray-500 mb-5">Modify tenant details, upload documents, and add notes.</p>

                        {/* Edit Details */}
                        <form onSubmit={handleSaveTenantProfile} className="space-y-3 mb-6">
                            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label><input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div>
                            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone</label><input type="tel" value={profilePhone} onChange={(e) => setProfilePhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div>
                            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label><input type="email" required value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div>
                            <button type="submit" disabled={isSavingProfile} className="w-full py-2 bg-indigo-600 text-white rounded-md text-sm font-bold hover:bg-indigo-700 disabled:bg-indigo-400">{isSavingProfile ? "Saving..." : "Save Details"}</button>
                        </form>

                        {/* Documents */}
                        <div className="border-t border-gray-200 pt-4 mb-4">
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-sm font-bold text-gray-800">📄 Documents</h3>
                                <button onClick={() => { setSelectedUnitForDoc(profileUnit); setIsDocModalOpen(true); }} className="text-xs text-blue-600 hover:underline font-medium">+ Upload</button>
                            </div>
                            {profileUnit.documents && profileUnit.documents.length > 0 ? (
                                <ul className="space-y-1 max-h-32 overflow-y-auto">
                                    {profileUnit.documents.map((d: { name: string; url: string }, i: number) => (
                                        <li key={i}><a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">📄 {d.name}</a></li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-xs text-gray-400 italic">No documents attached.</p>
                            )}
                        </div>

                        {/* Notes */}
                        <div className="border-t border-gray-200 pt-4">
                            <h3 className="text-sm font-bold text-gray-800 mb-2">📝 Notes</h3>
                            <div className="max-h-40 overflow-y-auto space-y-2 mb-3">
                                {profileUnit.notes && profileUnit.notes.length > 0 ? (
                                    profileUnit.notes.map((n: { text: string; author: string; createdAt: string }, i: number) => (
                                        <div key={i} className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs">
                                            <p className="text-gray-800">{n.text}</p>
                                            <p className="text-gray-400 mt-1">{n.author} • {new Date(n.createdAt).toLocaleDateString()}</p>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-xs text-gray-400 italic">No notes yet.</p>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <input type="text" value={profileNote} onChange={(e) => setProfileNote(e.target.value)} placeholder="Add a note..." className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                <button onClick={handleAddNote} disabled={!profileNote.trim()} className="px-4 py-2 bg-yellow-500 text-white rounded-md text-sm font-bold hover:bg-yellow-600 disabled:bg-yellow-300">Add</button>
                            </div>
                        </div>

                        <div className="flex justify-end mt-6 pt-4 border-t border-gray-200">
                            <button onClick={() => { setIsTenantProfileOpen(false); setProfileUnit(null); }} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md font-medium">Close</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}