"use client";

import { useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useUploadWithProgress, UploadProgressBar } from "@/lib/useUpload";
import type { Building, Checklist, Unit } from "@/types";

interface ChecklistTabProps {
    allUnits: Unit[];
    occupiedUnits: Unit[];
    buildings: Building[];
    allChecklists: Checklist[];
    userEmail: string;
}

type RoomRow = { room: string; condition: string; photo: File | null; damages: string };

export function ChecklistTab({ allUnits, occupiedUnits, buildings, allChecklists, userEmail }: ChecklistTabProps) {
    const { uploadFile, uploadProgress, isUploading } = useUploadWithProgress();

    const [checklistType, setChecklistType] = useState<"move-in" | "move-out">("move-in");
    const [checklistUnit, setChecklistUnit] = useState("");
    const [checklistRooms, setChecklistRooms] = useState<RoomRow[]>([{ room: "Living Room", condition: "good", photo: null, damages: "" }]);
    const [checklistNotes, setChecklistNotes] = useState("");
    const [checklistDeduction, setChecklistDeduction] = useState("");
    const [isSubmittingChecklist, setIsSubmittingChecklist] = useState(false);

    const getBuildingName = (buildingId: string) => buildings.find(b => b.id === buildingId)?.name || "—";

    const handleAddRoom = () => setChecklistRooms(prev => [...prev, { room: "", condition: "good", photo: null, damages: "" }]);
    const handleRemoveRoom = (idx: number) => setChecklistRooms(prev => prev.filter((_, i) => i !== idx));

    const handleSubmitChecklist = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!checklistUnit) return;
        setIsSubmittingChecklist(true);
        try {
            const unit = allUnits.find(u => u.id === checklistUnit);
            const roomsData = [];
            for (const room of checklistRooms) {
                let photoUrl = "";
                if (room.photo) {
                    photoUrl = await uploadFile(`checklists/${checklistUnit}/${Date.now()}_${room.photo.name}`, room.photo);
                }
                roomsData.push({ room: room.room, condition: room.condition, damages: room.damages, photoUrl });
            }
            await addDoc(collection(db, "checklists"), {
                unitId: checklistUnit,
                unitNumber: unit?.unitNumber || "",
                buildingId: unit?.buildingId || "",
                type: checklistType,
                rooms: roomsData,
                notes: checklistNotes,
                deduction: checklistType === "move-out" ? Number(checklistDeduction) || 0 : 0,
                tenantEmail: unit?.tenantEmail || "",
                tenantName: unit?.tenantName || "",
                createdAt: new Date().toISOString(),
                createdBy: userEmail,
            });
            alert(`${checklistType === "move-in" ? "Move-in" : "Move-out"} checklist saved!`);
            setChecklistUnit("");
            setChecklistRooms([{ room: "Living Room", condition: "good", photo: null, damages: "" }]);
            setChecklistNotes("");
            setChecklistDeduction("");
        } catch (error) {
            console.error(error);
            alert("Failed to save checklist.");
        } finally {
            setIsSubmittingChecklist(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-pink-200 overflow-hidden">
                <div className="bg-pink-50 px-5 py-4 border-b border-pink-200">
                    <h2 className="text-lg font-bold text-pink-800">📋 Move-in / Move-out Checklist</h2>
                    <p className="text-xs text-pink-600 mt-1">Photographic room inspection with damage tracking</p>
                </div>
                <form onSubmit={handleSubmitChecklist} className="p-5 space-y-4">
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setChecklistType("move-in")} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition ${checklistType === "move-in" ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600"}`}>🏠 Move-In</button>
                        <button type="button" onClick={() => setChecklistType("move-out")} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition ${checklistType === "move-out" ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600"}`}>📦 Move-Out</button>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Select Unit</label>
                        <select required value={checklistUnit} onChange={(e) => setChecklistUnit(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg">
                            <option value="" disabled>Choose a unit...</option>
                            {(checklistType === "move-in" ? allUnits : occupiedUnits).map(u => (
                                <option key={u.id} value={u.id}>{u.unitNumber} — {u.tenantEmail || "Vacant"} ({getBuildingName(u.buildingId)})</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <label className="text-sm font-bold text-gray-700">Room Inspection</label>
                            <button type="button" onClick={handleAddRoom} className="text-xs bg-pink-100 text-pink-700 px-3 py-1 rounded-full font-bold hover:bg-pink-200">+ Add Room</button>
                        </div>
                        {checklistRooms.map((room, idx) => (
                            <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
                                <div className="flex gap-2 items-center">
                                    <input type="text" placeholder="Room name (e.g. Bedroom 1)" value={room.room} onChange={(e) => { const updated = [...checklistRooms]; updated[idx].room = e.target.value; setChecklistRooms(updated); }} className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm" required />
                                    {checklistRooms.length > 1 && <button type="button" onClick={() => handleRemoveRoom(idx)} className="text-red-500 text-lg font-bold hover:text-red-700">×</button>}
                                </div>
                                <div className="flex gap-2">
                                    <select value={room.condition} onChange={(e) => { const updated = [...checklistRooms]; updated[idx].condition = e.target.value; setChecklistRooms(updated); }} className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm">
                                        <option value="good">✅ Good</option>
                                        <option value="fair">⚠️ Fair</option>
                                        <option value="damaged">❌ Damaged</option>
                                    </select>
                                    <input type="file" accept="image/*" onChange={(e) => { const updated = [...checklistRooms]; updated[idx].photo = e.target.files?.[0] || null; setChecklistRooms(updated); }} className="flex-1 text-xs text-gray-500" />
                                </div>
                                {(room.condition === "fair" || room.condition === "damaged") && (
                                    <textarea placeholder="Describe damages..." value={room.damages} onChange={(e) => { const updated = [...checklistRooms]; updated[idx].damages = e.target.value; setChecklistRooms(updated); }} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" rows={2} />
                                )}
                            </div>
                        ))}
                    </div>

                    {checklistType === "move-out" && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                            <label className="block text-sm font-medium text-red-700 mb-1">Security Deposit Deduction (₹)</label>
                            <input type="number" min="0" value={checklistDeduction} onChange={(e) => setChecklistDeduction(e.target.value)} className="w-full px-3 py-2 border border-red-300 rounded-lg" placeholder="0 if no deduction" />
                            <p className="text-[10px] text-red-500 mt-1">Amount to deduct from security deposit for damages</p>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">General Notes</label>
                        <textarea value={checklistNotes} onChange={(e) => setChecklistNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Any additional observations..." />
                    </div>

                    {isUploading && <UploadProgressBar progress={uploadProgress} />}
                    <button type="submit" disabled={isSubmittingChecklist || isUploading} className="w-full py-3 bg-pink-600 text-white rounded-lg font-bold hover:bg-pink-700 transition shadow-sm disabled:bg-pink-400">
                        {isSubmittingChecklist ? "Saving..." : `Save ${checklistType === "move-in" ? "Move-In" : "Move-Out"} Checklist`}
                    </button>
                </form>
            </div>

            {allChecklists.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
                        <h3 className="text-sm font-bold text-gray-800">Recent Inspections</h3>
                    </div>
                    <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                        {allChecklists.slice(0, 20).map(cl => (
                            <div key={cl.id} className="px-5 py-3 hover:bg-gray-50">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${cl.type === "move-in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{cl.type}</span>
                                        <p className="font-bold text-gray-900 text-sm mt-0.5">{cl.unitNumber}</p>
                                        <p className="text-[10px] text-gray-500">{cl.tenantName || cl.tenantEmail} · {new Date(cl.createdAt).toLocaleDateString()}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-gray-600">{cl.rooms?.length || 0} rooms</p>
                                        {cl.deduction > 0 && <p className="text-xs text-red-600 font-bold">-₹{cl.deduction}</p>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
