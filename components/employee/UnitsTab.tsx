"use client";

import type { Building, Unit, CoTenant } from "@/types";

interface UnitsTabProps {
    allUnits: Unit[];
    buildings: Building[];
    unitSearch: string;
    setUnitSearch: (s: string) => void;
    expandedBuildings: string[];
    setExpandedBuildings: React.Dispatch<React.SetStateAction<string[]>>;
    onEditUnit: (unit: Unit) => void;
    onAssignUnit: (unit: Unit) => void;
    onRemoveTenant: (unitId: string) => void;
    onTransferUnit: (unit: Unit) => void;
    onUploadDoc: (unit: Unit) => void;
    onAddCoTenant: (unit: Unit) => void;
    onRemoveCoTenant: (unitId: string, coTenant: CoTenant) => void;
}

export function UnitsTab({
    allUnits,
    buildings,
    unitSearch,
    setUnitSearch,
    expandedBuildings,
    setExpandedBuildings,
    onEditUnit,
    onAssignUnit,
    onRemoveTenant,
    onTransferUnit,
    onUploadDoc,
    onAddCoTenant,
    onRemoveCoTenant,
}: UnitsTabProps) {
    const vacantUnits = allUnits.filter(u => u.status === "vacant");
    const occupiedForAssign = allUnits.filter(u => u.status === "occupied");

    const searchLower = unitSearch.toLowerCase().trim();
    const filteredBuildings = buildings.filter(bldg => {
        if (!searchLower) return true;
        const bldgUnits = allUnits.filter(u => u.buildingId === bldg.id);
        return bldgUnits.some(u =>
            (u.tenantName && u.tenantName.toLowerCase().includes(searchLower)) ||
            (u.tenantPhone && u.tenantPhone.includes(searchLower)) ||
            (u.unitNumber && u.unitNumber.toLowerCase().includes(searchLower))
        );
    });

    return (
        <div className="space-y-3">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-blue-50 px-5 py-4 border-b border-blue-200">
                    <h2 className="text-lg font-bold text-blue-800">🏠 Buildings & Units</h2>
                    <p className="text-xs text-blue-600 mt-1">
                        {vacantUnits.length} vacant · {occupiedForAssign.length} occupied · {buildings.length} buildings
                    </p>
                </div>
                <div className="px-4 pt-4">
                    <input
                        type="text"
                        placeholder="🔍 Search by tenant name or phone..."
                        value={unitSearch}
                        onChange={(e) => setUnitSearch(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                    />
                </div>
                <div className="p-4 space-y-2">
                    {filteredBuildings.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-8">
                            {searchLower ? "No matching tenants found." : "No buildings found."}
                        </p>
                    ) : (
                        filteredBuildings.map(bldg => {
                            let bldgUnits = allUnits.filter(u => u.buildingId === bldg.id);
                            if (searchLower) {
                                bldgUnits = bldgUnits.filter(u =>
                                    (u.tenantName && u.tenantName.toLowerCase().includes(searchLower)) ||
                                    (u.tenantPhone && u.tenantPhone.includes(searchLower)) ||
                                    (u.unitNumber && u.unitNumber.toLowerCase().includes(searchLower))
                                );
                            }
                            const bldgVacant = bldgUnits.filter(u => u.status === "vacant");
                            const isExpanded = expandedBuildings.includes(bldg.id) || !!searchLower;
                            const toggleBuilding = () => {
                                setExpandedBuildings(prev => isExpanded ? prev.filter(id => id !== bldg.id) : [...prev, bldg.id]);
                            };

                            return (
                                <div key={bldg.id} className="border border-gray-200 rounded-lg overflow-hidden">
                                    <button onClick={toggleBuilding} className="w-full flex justify-between items-center px-4 py-3 bg-gray-50 hover:bg-gray-100 transition">
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg">{isExpanded ? "▼" : "▶"}</span>
                                            <div className="text-left">
                                                <h3 className="font-bold text-gray-900 text-sm">{bldg.name}</h3>
                                                <p className="text-[10px] text-gray-500">{bldg.address}</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{bldgVacant.length} vacant</span>
                                            <span className="text-[10px] font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{bldgUnits.length} total</span>
                                        </div>
                                    </button>

                                    {isExpanded && (
                                        <div className="p-3 space-y-3 border-t border-gray-100 bg-white">
                                            {bldgUnits.length === 0 ? (
                                                <p className="text-xs text-gray-400 text-center py-2">No units in this building.</p>
                                            ) : (
                                                bldgUnits.map(unit => (
                                                    <div key={unit.id} className={`border rounded-lg p-3 ${unit.status === "vacant" ? "border-green-200 bg-green-50" : "border-gray-100 bg-white"}`}>
                                                        <div className="flex justify-between items-start">
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <h4 className="font-bold text-gray-900 text-sm">{unit.unitNumber}</h4>
                                                                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${unit.status === "vacant" ? "bg-green-200 text-green-800" : "bg-orange-100 text-orange-700"}`}>{unit.status}</span>
                                                                </div>
                                                                <p className="text-xs text-gray-500 mt-0.5">Rent: ₹{unit.baseRent || 8000}/mo{unit.securityDeposit ? ` · Deposit: ₹${Number(unit.securityDeposit).toLocaleString()}` : ""}{unit.paymentDay ? ` · Pays on: ${unit.paymentDay}th` : ""}</p>
                                                                {unit.status === "occupied" && (
                                                                    <div className="mt-1.5 text-xs text-gray-600">
                                                                        <p>👤 {unit.tenantName || "—"}{unit.tenantEmail ? ` · ${unit.tenantEmail}` : ""}</p>
                                                                        {unit.tenantPhone && <p>📞 {unit.tenantPhone}</p>}
                                                                        {unit.coTenants && unit.coTenants.length > 0 && (
                                                                            <div className="mt-1 pl-2 border-l-2 border-indigo-200">
                                                                                <p className="text-[10px] font-bold text-indigo-600 uppercase">Co-tenants ({unit.coTenants.length})</p>
                                                                                {unit.coTenants.map((ct, i: number) => (
                                                                                    <div key={i} className="flex items-center gap-2.5 mt-1">
                                                                                        <span className="text-[10px] text-gray-600">👤 {ct.name || ct.email || "—"}{ct.phone && !ct.email ? ` · 📞 ${ct.phone}` : ""}{ct.email ? ` · ${ct.email}` : ""}</span>
                                                                                        <button onClick={() => onRemoveCoTenant(unit.id, ct)} className="text-[10px] text-red-400 hover:text-red-600 ml-1">✕</button>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-col gap-3 shrink-0">
                                                                <button onClick={() => onEditUnit(unit)} className="text-xs text-blue-600 hover:underline">✏️ Edit</button>
                                                                {unit.status === "vacant" ? (
                                                                    <button onClick={() => onAssignUnit(unit)} className="text-xs bg-green-600 text-white px-2 py-1 rounded-md font-medium hover:bg-green-700">+ Assign</button>
                                                                ) : (
                                                                    <>
                                                                        <button onClick={() => onRemoveTenant(unit.id)} className="text-xs text-red-500 hover:underline">Remove</button>
                                                                        <button onClick={() => onTransferUnit(unit)} className="text-xs text-orange-600 hover:underline">🔄 Transfer</button>
                                                                        <button onClick={() => onUploadDoc(unit)} className="text-xs text-purple-600 hover:underline">📄 Doc</button>
                                                                        <button onClick={() => onAddCoTenant(unit)} className="text-xs text-indigo-600 hover:underline">👥 Add</button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {unit.documents && unit.documents.length > 0 && (
                                                            <div className="mt-2 pt-2 border-t border-gray-100">
                                                                <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Documents</p>
                                                                <div className="space-y-1.5">
                                                                    {unit.documents.map((d, i: number) => (
                                                                        <a key={i} href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline block py-0.5">📎 {d.name}</a>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {unit.tenantHistory && unit.tenantHistory.length > 0 && (
                                                            <details className="mt-2 pt-2 border-t border-gray-100">
                                                                <summary className="text-[10px] font-bold text-gray-500 uppercase cursor-pointer hover:text-gray-700">📜 Tenant History ({unit.tenantHistory.length})</summary>
                                                                <div className="mt-1 space-y-1.5">
                                                                    {[...unit.tenantHistory].reverse().map((h, i: number) => (
                                                                        <div key={i} className="bg-gray-50 rounded p-1.5 text-[10px] text-gray-600">
                                                                            <span className="font-semibold text-gray-800">{h.tenantName || h.tenantEmail || "Unknown"}</span>
                                                                            {h.tenantPhone && <span> · 📞 {h.tenantPhone}</span>}
                                                                            <br />
                                                                            <span>📅 {h.moveInDate ? new Date(h.moveInDate).toLocaleDateString() : "?"} → {new Date(h.moveOutDate).toLocaleDateString()}</span>
                                                                            {h.securityDeposit && <span> · 💰 ₹{h.securityDeposit}</span>}
                                                                            {h.coTenants && h.coTenants.length > 0 && <span> · 👥 {h.coTenants.length} co-tenant(s)</span>}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </details>
                                                        )}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
