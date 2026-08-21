"use client";

import type { Unit, Building } from "@/types";

interface OccupancyTabProps {
    allUnits: Unit[];
    buildings: Building[];
}

export function OccupancyTab({ allUnits, buildings }: OccupancyTabProps) {
    const totalUnits = allUnits.length;
    const occupiedCount = allUnits.filter(u => u.status === "occupied").length;
    const vacantCount = totalUnits - occupiedCount;
    const overallRate = totalUnits > 0 ? Math.round((occupiedCount / totalUnits) * 100) : 0;

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-emerald-200 overflow-hidden">
                <div className="bg-emerald-50 px-5 py-4 border-b border-emerald-200">
                    <h2 className="text-lg font-bold text-emerald-800">📊 Occupancy Dashboard</h2>
                    <p className="text-xs text-emerald-600 mt-1">Visual overview of occupancy across all buildings</p>
                </div>
                <div className="p-5 space-y-5">
                    <div className="grid grid-cols-3 gap-3">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                            <p className="text-2xl font-bold text-emerald-700">{overallRate}%</p>
                            <p className="text-[10px] font-bold text-emerald-600 uppercase">Occupied</p>
                        </div>
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                            <p className="text-2xl font-bold text-blue-700">{occupiedCount}</p>
                            <p className="text-[10px] font-bold text-blue-600 uppercase">Filled</p>
                        </div>
                        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
                            <p className="text-2xl font-bold text-orange-700">{vacantCount}</p>
                            <p className="text-[10px] font-bold text-orange-600 uppercase">Vacant</p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {buildings.map(bldg => {
                            const bldgUnits = allUnits.filter(u => u.buildingId === bldg.id);
                            const bldgOccupied = bldgUnits.filter(u => u.status === "occupied").length;
                            const bldgTotal = bldgUnits.length;
                            const rate = bldgTotal > 0 ? Math.round((bldgOccupied / bldgTotal) * 100) : 0;
                            const barColor = rate >= 80 ? "bg-emerald-500" : rate >= 50 ? "bg-yellow-500" : "bg-red-500";
                            return (
                                <div key={bldg.id} className="border border-gray-200 rounded-lg p-4">
                                    <div className="flex justify-between items-center mb-2">
                                        <div>
                                            <h3 className="font-bold text-gray-900 text-sm">{bldg.name}</h3>
                                            <p className="text-[10px] text-gray-500">{bldg.address}</p>
                                        </div>
                                        <span className={`text-lg font-bold ${rate >= 80 ? "text-emerald-700" : rate >= 50 ? "text-yellow-700" : "text-red-700"}`}>{rate}%</span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                                        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${rate}%` }} />
                                    </div>
                                    <div className="flex justify-between mt-1.5 text-[10px] text-gray-500">
                                        <span>{bldgOccupied} occupied</span>
                                        <span>{bldgTotal - bldgOccupied} vacant</span>
                                        <span>{bldgTotal} total</span>
                                    </div>
                                    {bldgUnits.filter(u => u.status === "vacant").length > 0 && (
                                        <div className="mt-2 pt-2 border-t border-gray-100">
                                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Vacant Units:</p>
                                            <div className="flex flex-wrap gap-1">
                                                {bldgUnits.filter(u => u.status === "vacant").map(u => (
                                                    <span key={u.id} className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">{u.unitNumber}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
