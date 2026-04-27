"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc, collection, query, where, onSnapshot, writeBatch, addDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";

export default function BuildingUnitsPage() {
    const { id } = useParams();
    const router = useRouter();
    const { role, loading } = useAuth();

    const [building, setBuilding] = useState<any>(null);
    const [units, setUnits] = useState<any[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);

    // Form state for manual unit addition
    const [unitNumber, setUnitNumber] = useState("");
    const [baseRent, setBaseRent] = useState("");

    // Assign Tenant Modal State
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [selectedUnit, setSelectedUnit] = useState<any>(null);
    const [tenantEmail, setTenantEmail] = useState("");

    // Edit Unit Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingUnit, setEditingUnit] = useState<any>(null);
    const [editUnitNumber, setEditUnitNumber] = useState("");
    const [editBaseRent, setEditBaseRent] = useState("");

    useEffect(() => {
        if (!loading && role !== "admin") router.push("/");
    }, [role, loading, router]);

    useEffect(() => {
        if (!id) return;
        const fetchBuilding = async () => {
            const docRef = doc(db, "buildings", id as string);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                setBuilding({ id: docSnap.id, ...docSnap.data() });
            }
        };
        fetchBuilding();
    }, [id]);

    useEffect(() => {
        if (!id) return;
        const q = query(collection(db, "units"), where("buildingId", "==", id));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const unitsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            unitsData.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
            setUnits(unitsData);
        });
        return () => unsubscribe();
    }, [id]);

    const handleAutoGenerate = async () => {
        if (!building || units.length > 0) return;
        setIsGenerating(true);
        try {
            const batch = writeBatch(db);
            for (let i = 1; i <= building.totalUnits; i++) {
                const unitRef = doc(collection(db, "units"));
                batch.set(unitRef, {
                    buildingId: id,
                    unitNumber: `Unit ${i}`,
                    baseRent: 0,
                    status: "vacant",
                    tenantEmail: "",
                    createdAt: new Date().toISOString()
                });
            }
            await batch.commit();
        } catch (error) {
            console.error("Error generating units: ", error);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleManualAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!unitNumber || !baseRent) return;
        try {
            await addDoc(collection(db, "units"), {
                buildingId: id,
                unitNumber,
                baseRent: Number(baseRent),
                status: "vacant",
                tenantEmail: "",
                createdAt: new Date().toISOString()
            });
            setUnitNumber("");
            setBaseRent("");
        } catch (error) {
            console.error("Error adding unit: ", error);
        }
    };

    const handleAssignTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUnit || !tenantEmail) return;
        try {
            const unitRef = doc(db, "units", selectedUnit.id);
            await updateDoc(unitRef, {
                status: "occupied",
                tenantEmail: tenantEmail.toLowerCase()
            });
            setIsAssignModalOpen(false);
            setSelectedUnit(null);
            setTenantEmail("");
        } catch (error) {
            console.error("Error assigning tenant: ", error);
        }
    };

    const handleRemoveTenant = async (unitId: string) => {
        if (!window.confirm("Are you sure you want to remove this tenant?")) return;
        try {
            const unitRef = doc(db, "units", unitId);
            await updateDoc(unitRef, {
                status: "vacant",
                tenantEmail: ""
            });
        } catch (error) {
            console.error("Error removing tenant: ", error);
        }
    };

    // --- NEW: Open Edit Modal ---
    const openEditModal = (unit: any) => {
        setEditingUnit(unit);
        setEditUnitNumber(unit.unitNumber);
        setEditBaseRent(unit.baseRent.toString());
        setIsEditModalOpen(true);
    };

    // --- NEW: Handle Edit Submit ---
    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingUnit || !editUnitNumber || !editBaseRent) return;

        try {
            const unitRef = doc(db, "units", editingUnit.id);
            await updateDoc(unitRef, {
                unitNumber: editUnitNumber,
                baseRent: Number(editBaseRent)
            });

            setIsEditModalOpen(false);
            setEditingUnit(null);
        } catch (error) {
            console.error("Error updating unit:", error);
        }
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
                            <button onClick={handleAutoGenerate} disabled={isGenerating} className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 transition disabled:bg-blue-400">
                                {isGenerating ? "Generating..." : "Auto-Generate Units"}
                            </button>
                        </div>
                    )}

                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                        <h2 className="text-lg font-semibold text-gray-800 mb-4">Add Single Unit</h2>
                        <form onSubmit={handleManualAdd} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Unit Number</label>
                                <input type="text" value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Apt 101" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Base Rent (₹)</label>
                                <input type="number" value={baseRent} onChange={(e) => setBaseRent(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="15000" />
                            </div>
                            <button type="submit" className="w-full bg-gray-800 text-white py-2 rounded-md hover:bg-gray-900 transition">Add Unit</button>
                        </form>
                    </div>
                </div>

                {/* Right Area: Units Grid */}
                <div className="lg:col-span-2">
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                        <h2 className="text-lg font-semibold text-gray-800 mb-4">All Units ({units.length})</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                            {units.map((unit) => (
                                <div key={unit.id} className={`border rounded-lg p-4 transition flex flex-col justify-between ${unit.status === 'occupied' ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-blue-300'}`}>
                                    <div>
                                        {/* Header with Edit Button */}
                                        <div className="flex justify-between items-start">
                                            <h3 className="font-bold text-gray-800 text-lg">{unit.unitNumber}</h3>
                                            <button
                                                onClick={() => openEditModal(unit)}
                                                className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded"
                                            >
                                                ✎ Edit
                                            </button>
                                        </div>

                                        <p className="text-sm text-gray-600 mt-1">Rent: ₹{unit.baseRent}</p>

                                        {unit.status === 'occupied' && (
                                            <p className="text-xs text-green-700 mt-2 truncate bg-green-100 p-1 rounded inline-block">
                                                👤 {unit.tenantEmail}
                                            </p>
                                        )}
                                    </div>

                                    <div className="mt-4 flex items-center justify-between">
                                        <span className={`text-xs px-2 py-1 rounded-full ${unit.status === 'vacant' ? 'bg-gray-100 text-gray-600' : 'bg-green-200 text-green-800'}`}>
                                            {unit.status.toUpperCase()}
                                        </span>

                                        {unit.status === 'vacant' ? (
                                            <button
                                                onClick={() => { setSelectedUnit(unit); setIsAssignModalOpen(true); }}
                                                className="text-sm text-blue-600 hover:underline font-medium"
                                            >
                                                Assign &rarr;
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleRemoveTenant(unit.id)}
                                                className="text-sm text-red-600 hover:underline font-medium"
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>

            {/* --- EDIT UNIT MODAL --- */}
            {isEditModalOpen && editingUnit && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
                        <h2 className="text-xl font-bold mb-4">Edit Unit Details</h2>

                        <form onSubmit={handleEditSubmit}>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Unit Number / Name</label>
                                <input
                                    type="text"
                                    required
                                    value={editUnitNumber}
                                    onChange={(e) => setEditUnitNumber(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500"
                                />
                            </div>
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Base Rent (₹)</label>
                                <input
                                    type="number"
                                    required
                                    value={editBaseRent}
                                    onChange={(e) => setEditBaseRent(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500"
                                />
                            </div>
                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsEditModalOpen(false)}
                                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                >
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Assign Tenant Modal */}
            {isAssignModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
                        <h2 className="text-xl font-bold mb-4">Assign Tenant to {selectedUnit?.unitNumber}</h2>
                        <form onSubmit={handleAssignTenant}>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Tenant Email</label>
                                <input type="email" required value={tenantEmail} onChange={(e) => setTenantEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500" placeholder="tenant@example.com" />
                            </div>
                            <div className="flex justify-end gap-3 mt-6">
                                <button type="button" onClick={() => setIsAssignModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Confirm Assignment</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    );
}