"use client";

import { useState } from "react";
import { doc, updateDoc, addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Modal } from "@/components/ui";
import type { InventoryItem, Building } from "@/types";

interface InventoryTabProps {
    allInventory: InventoryItem[];
    buildings: Building[];
}

export function InventoryTab({ allInventory, buildings }: InventoryTabProps) {
    const [inventoryFilter, setInventoryFilter] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [name, setName] = useState("");
    const [qty, setQty] = useState("");
    const [building, setBuilding] = useState("");
    const [location, setLocation] = useState("");
    const [condition, setCondition] = useState("good");
    const [notes, setNotes] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const getBuildingName = (buildingId: string) => buildings.find(b => b.id === buildingId)?.name || "Unknown";

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !qty) return;
        setIsSubmitting(true);
        try {
            await addDoc(collection(db, "inventory"), {
                name, quantity: Number(qty), buildingId: building || "",
                buildingName: building ? getBuildingName(building) : "General",
                location, condition, notes, createdBy: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            });
            setIsModalOpen(false);
            setName(""); setQty(""); setBuilding(""); setLocation(""); setCondition("good"); setNotes("");
            alert("Inventory item added!");
        } catch (error) { console.error(error); alert("Failed to add inventory item."); } finally { setIsSubmitting(false); }
    };

    const handleUpdateQty = async (itemId: string, newQty: number) => {
        try {
            await updateDoc(doc(db, "inventory", itemId), { quantity: newQty, updatedAt: new Date().toISOString() });
        } catch (error) { console.error(error); alert("Failed to update quantity."); }
    };

    const filtered = inventoryFilter ? allInventory.filter(i => i.buildingId === inventoryFilter) : allInventory;

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-cyan-200 overflow-hidden">
                <div className="bg-cyan-50 px-5 py-4 border-b border-cyan-200 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-cyan-800">📦 Building Inventory</h2>
                        <p className="text-xs text-cyan-600 mt-1">Track items, supplies & equipment</p>
                    </div>
                    <button onClick={() => setIsModalOpen(true)} className="text-sm bg-cyan-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-cyan-700 transition">+ Add Item</button>
                </div>
                <div className="p-4 space-y-4">
                    <select value={inventoryFilter} onChange={(e) => setInventoryFilter(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                        <option value="">All Buildings</option>
                        {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>

                    <div className="space-y-2">
                        {filtered.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-6">No inventory items yet.</p>
                        ) : filtered.map(item => (
                            <div key={item.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h4 className="font-bold text-gray-900 text-sm">{item.name}</h4>
                                        <p className="text-[10px] text-gray-500">{item.buildingName || "General"}{item.location ? ` · ${item.location}` : ""}</p>
                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded mt-1 inline-block ${item.condition === "good" ? "bg-green-100 text-green-700" : item.condition === "fair" ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>{item.condition}</span>
                                        {item.notes && <p className="text-[10px] text-gray-500 mt-1">{item.notes}</p>}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button onClick={() => handleUpdateQty(item.id, Math.max(0, Number(item.quantity) - 1))} className="w-7 h-7 bg-gray-200 rounded-md font-bold text-gray-700 hover:bg-gray-300">−</button>
                                        <span className="text-lg font-bold text-gray-900 min-w-7.5 text-center">{item.quantity}</span>
                                        <button onClick={() => handleUpdateQty(item.id, Number(item.quantity) + 1)} className="w-7 h-7 bg-cyan-100 rounded-md font-bold text-cyan-700 hover:bg-cyan-200">+</button>
                                    </div>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-1">Updated: {new Date(item.updatedAt || item.createdAt).toLocaleDateString()}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
                <h3 className="text-lg font-bold text-gray-800">📦 Add Inventory Item</h3>
                <form onSubmit={handleAdd} className="space-y-3 mt-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Item Name *</label>
                        <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. Water Pump, Fire Extinguisher" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Quantity *</label>
                        <input type="number" required min="0" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Building</label>
                        <select value={building} onChange={(e) => setBuilding(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            <option value="">General (Shared)</option>
                            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Location / Area</label>
                        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. Store room" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Condition</label>
                        <select value={condition} onChange={(e) => setCondition(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            <option value="good">✅ Good</option>
                            <option value="fair">⚠️ Fair</option>
                            <option value="poor">❌ Poor / Needs Replacement</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notes</label>
                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div className="flex gap-2 pt-2">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="flex-1 py-2 bg-cyan-600 text-white rounded-md text-sm font-medium hover:bg-cyan-700 disabled:bg-cyan-400">{isSubmitting ? "Saving..." : "Add Item"}</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
