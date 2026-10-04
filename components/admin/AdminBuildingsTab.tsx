"use client";

import { useState } from "react";
import Link from "next/link";
import { collection, addDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Building, Unit } from "@/types";

interface AdminBuildingsTabProps {
    buildings: Building[];
    allUnits: Unit[];
}

export function AdminBuildingsTab({ buildings, allUnits }: AdminBuildingsTabProps) {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [totalUnits, setTotalUnits] = useState("10");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleAddBuilding = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !address) return;
        setIsSubmitting(true);
        try {
            await addDoc(collection(db, "buildings"), {
                name,
                address,
                totalUnits: Number(totalUnits) || 0,
                createdAt: new Date().toISOString(),
            });
            setName("");
            setAddress("");
            setTotalUnits("10");
            setIsAddModalOpen(false);
        } catch (error) {
            console.error("Failed to add building:", error);
            alert("Failed to add building.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-200">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">🏢 Properties & Buildings</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{buildings.length} properties managed across the portfolio</p>
                </div>
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition"
                >
                    + Add New Building
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {buildings.map(bldg => {
                    const bldgUnits = allUnits.filter(u => u.buildingId === bldg.id);
                    const occupiedUnits = bldgUnits.filter(u => u.status === "occupied");
                    const vacantUnits = bldgUnits.filter(u => u.status === "vacant");

                    return (
                        <div key={bldg.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col justify-between hover:border-blue-300 transition">
                            <div>
                                <div className="flex justify-between items-start">
                                    <h3 className="font-bold text-gray-900 text-base">{bldg.name}</h3>
                                    <span className="text-xs bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded-full border border-blue-200">
                                        {bldgUnits.length} Units
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">{bldg.address}</p>

                                <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-gray-100">
                                    <div className="bg-emerald-50 rounded-lg p-2 text-center">
                                        <p className="text-[10px] font-bold text-emerald-700 uppercase">Occupied</p>
                                        <p className="text-base font-black text-emerald-800">{occupiedUnits.length}</p>
                                    </div>
                                    <div className="bg-amber-50 rounded-lg p-2 text-center">
                                        <p className="text-[10px] font-bold text-amber-700 uppercase">Vacant</p>
                                        <p className="text-base font-black text-amber-800">{vacantUnits.length}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end">
                                <Link
                                    href={`/admin/buildings/${bldg.id}`}
                                    className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                >
                                    Manage Units & Docs →
                                </Link>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Add Building Modal */}
            {isAddModalOpen && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-base font-bold text-gray-900">Add New Building</h3>
                            <button onClick={() => setIsAddModalOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <form onSubmit={handleAddBuilding} className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Building / Property Name</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Sunrise Residency"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Address</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. 123 Main Road, City"
                                    value={address}
                                    onChange={(e) => setAddress(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Total Unit Capacity</label>
                                <input
                                    type="number"
                                    required
                                    min="1"
                                    value={totalUnits}
                                    onChange={(e) => setTotalUnits(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-3">
                                <button
                                    type="button"
                                    onClick={() => setIsAddModalOpen(false)}
                                    className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50"
                                >
                                    {isSubmitting ? "Creating..." : "Save Building"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
