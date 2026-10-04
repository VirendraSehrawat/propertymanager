"use client";

import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Unit } from "@/types";

interface AdminTenantsTabProps {
    occupiedUnits: Unit[];
}

export function AdminTenantsTab({ occupiedUnits }: AdminTenantsTabProps) {
    const [selectedUnitForLease, setSelectedUnitForLease] = useState<Unit | null>(null);
    const [tenantPhone, setTenantPhone] = useState("");
    const [emergencyContact, setEmergencyContact] = useState("");
    const [leaseStart, setLeaseStart] = useState("");
    const [leaseEnd, setLeaseEnd] = useState("");
    const [isUpdatingLease, setIsUpdatingLease] = useState(false);

    const getLeaseStatus = (endDate?: string) => {
        if (!endDate) return { label: "Setup Lease", color: "bg-gray-100 text-gray-600" };
        const daysLeft = Math.ceil((new Date(endDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft < 0) return { label: "Expired", color: "bg-red-100 text-red-800" };
        if (daysLeft <= 60) return { label: `Expires in ${daysLeft} days`, color: "bg-orange-100 text-orange-800" };
        return { label: "Active", color: "bg-green-100 text-green-800" };
    };

    const handleOpenLeaseModal = (unit: Unit) => {
        setSelectedUnitForLease(unit);
        setTenantPhone(unit.tenantPhone || "");
        setEmergencyContact(unit.emergencyContact || "");
        setLeaseStart(unit.leaseStart || "");
        setLeaseEnd(unit.leaseEnd || "");
    };

    const handleUpdateLease = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUnitForLease) return;
        setIsUpdatingLease(true);
        try {
            await updateDoc(doc(db, "units", selectedUnitForLease.id), {
                tenantPhone,
                emergencyContact,
                leaseStart,
                leaseEnd,
            });
            setSelectedUnitForLease(null);
        } catch (error) {
            console.error("Failed to update lease:", error);
            alert("Failed to update lease.");
        } finally {
            setIsUpdatingLease(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">👥 Active Tenants & Leases</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{occupiedUnits.length} occupied units with registered lease contracts</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {occupiedUnits.map(unit => {
                    const status = getLeaseStatus(unit.leaseEnd);
                    return (
                        <div key={unit.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h3 className="font-bold text-gray-900 text-base">{unit.tenantName || unit.tenantEmail}</h3>
                                        <p className="text-xs text-gray-500 mt-0.5">Unit {unit.unitNumber} · Rent: ₹{unit.baseRent || 8000}</p>
                                    </div>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.color}`}>
                                        {status.label}
                                    </span>
                                </div>

                                <div className="mt-4 space-y-1 text-xs text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">
                                    <p><span className="font-semibold text-gray-500">Email:</span> {unit.tenantEmail || "—"}</p>
                                    <p><span className="font-semibold text-gray-500">Phone:</span> {unit.tenantPhone || "—"}</p>
                                    <p><span className="font-semibold text-gray-500">Emergency:</span> {unit.emergencyContact || "—"}</p>
                                    <p><span className="font-semibold text-gray-500">Lease:</span> {unit.leaseStart ? `${unit.leaseStart} to ${unit.leaseEnd || "Ongoing"}` : "Not set"}</p>
                                </div>
                            </div>

                            <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end">
                                <button
                                    onClick={() => handleOpenLeaseModal(unit)}
                                    className="text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition"
                                >
                                    ✏️ Edit Lease & Contact
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Edit Lease Modal */}
            {selectedUnitForLease && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <h3 className="text-base font-bold text-gray-900">Lease & Contact Details</h3>
                                <p className="text-xs text-gray-500">Unit {selectedUnitForLease.unitNumber} · {selectedUnitForLease.tenantEmail}</p>
                            </div>
                            <button onClick={() => setSelectedUnitForLease(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <form onSubmit={handleUpdateLease} className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Tenant Phone</label>
                                <input
                                    type="text"
                                    value={tenantPhone}
                                    onChange={(e) => setTenantPhone(e.target.value)}
                                    placeholder="+91 9876543210"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Emergency Contact</label>
                                <input
                                    type="text"
                                    value={emergencyContact}
                                    onChange={(e) => setEmergencyContact(e.target.value)}
                                    placeholder="Name - Phone"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">Lease Start</label>
                                    <input
                                        type="date"
                                        value={leaseStart}
                                        onChange={(e) => setLeaseStart(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">Lease End</label>
                                    <input
                                        type="date"
                                        value={leaseEnd}
                                        onChange={(e) => setLeaseEnd(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 pt-3">
                                <button
                                    type="button"
                                    onClick={() => setSelectedUnitForLease(null)}
                                    className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isUpdatingLease}
                                    className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50"
                                >
                                    {isUpdatingLease ? "Saving..." : "Save Lease"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
