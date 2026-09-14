"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, addDoc, writeBatch, doc, arrayUnion } from "firebase/firestore";
import { mapSnapshot } from "@/lib/firestore";
import { Modal } from "@/components/ui";
import type { Building, Tenant, Unit, MasterInvoice } from "@/types";

/**
 * Admin tenants list — corporate (multi-unit) tenant management. See
 * `docs/CORPORATE_TENANT_BILLING.md` §6.1.
 *
 * Retail tenants can still live inside the per-unit fields (Unit.tenantName
 * etc.) — this screen surfaces the first-class `Tenant` docs, primarily
 * corporate ones. Creating a tenant here also assigns units to it in one
 * `writeBatch`.
 */
export default function AdminTenantsPage() {
    const { user, role, loading } = useAuth();
    const router = useRouter();

    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [buildings, setBuildings] = useState<Building[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [masterInvoices, setMasterInvoices] = useState<MasterInvoice[]>([]);
    const [filter, setFilter] = useState<"all" | "corporate" | "retail">("all");
    const [isNewOpen, setIsNewOpen] = useState(false);

    useEffect(() => {
        if (!loading && (!user || role !== "admin")) router.push("/");
    }, [user, role, loading, router]);

    useEffect(() => {
        const off1 = onSnapshot(collection(db, "tenants"), (snap) => setTenants(mapSnapshot<Tenant>(snap)));
        const off2 = onSnapshot(collection(db, "buildings"), (snap) => setBuildings(mapSnapshot<Building>(snap)));
        const off3 = onSnapshot(collection(db, "units"), (snap) => setUnits(mapSnapshot<Unit>(snap)));
        const off4 = onSnapshot(collection(db, "masterInvoices"), (snap) => setMasterInvoices(mapSnapshot<MasterInvoice>(snap)));
        return () => { off1(); off2(); off3(); off4(); };
    }, []);

    const visible = tenants.filter((t) => filter === "all" || t.kind === filter);
    const corporateCount = tenants.filter((t) => t.kind === "corporate").length;
    const unitsUnderCorporate = tenants
        .filter((t) => t.kind === "corporate")
        .reduce((s, t) => s + (t.unitIds?.length || 0), 0);
    const outstandingMI = masterInvoices
        .filter((m) => m.status === "unpaid" || m.status === "partial")
        .reduce((s, m) => s + Math.max(0, Number(m.totalAmount || 0) - Number(m.amountPaid || 0)), 0);

    if (loading || !user) return <div className="p-8 text-center text-gray-500">Loading…</div>;

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Admin</Link>
                        <h1 className="text-lg font-bold text-gray-900">Tenants</h1>
                    </div>
                    <button onClick={() => setIsNewOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-2 rounded-lg">+ New corporate tenant</button>
                </div>
            </div>

            <div className="max-w-5xl mx-auto p-4 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                    <KpiTile label="Corporate tenants" value={String(corporateCount)} tone="indigo" />
                    <KpiTile label="Units under corporate" value={String(unitsUnderCorporate)} tone="blue" />
                    <KpiTile label="Outstanding (master)" value={`₹${outstandingMI.toLocaleString()}`} tone="amber" />
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <div className="flex gap-2">
                            {(["all", "corporate", "retail"] as const).map((k) => (
                                <button key={k} onClick={() => setFilter(k)} className={`text-xs font-bold px-3 py-1 rounded-full ${filter === k ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{k}</button>
                            ))}
                        </div>
                        <span className="text-xs text-gray-500">{visible.length} tenant{visible.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {visible.length === 0 && (
                            <p className="px-4 py-8 text-center text-sm text-gray-400">No tenants yet. Click <span className="font-bold">+ New corporate tenant</span> to start.</p>
                        )}
                        {visible.map((t) => {
                            const openMI = masterInvoices.filter((m) => m.tenantId === t.id && (m.status === "unpaid" || m.status === "partial"));
                            const openAmt = openMI.reduce((s, m) => s + Math.max(0, Number(m.totalAmount || 0) - Number(m.amountPaid || 0)), 0);
                            return (
                                <Link key={t.id} href={`/admin/tenants/${t.id}`} className="block px-4 py-3 hover:bg-gray-50 transition">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-gray-900 text-sm">{t.name}</span>
                                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${t.kind === "corporate" ? "bg-indigo-100 text-indigo-800" : "bg-gray-100 text-gray-700"}`}>{t.kind}</span>
                                                {t.gstin && <span className="text-[10px] text-gray-500">GSTIN: {t.gstin}</span>}
                                            </div>
                                            <p className="text-[11px] text-gray-500 mt-0.5">{t.billingContact.email} · {t.unitIds?.length || 0} unit{t.unitIds?.length !== 1 ? "s" : ""}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            {openAmt > 0 && <p className="text-sm font-bold text-amber-700">₹{openAmt.toLocaleString()}</p>}
                                            <p className="text-[10px] text-gray-400">{openMI.length} open MI</p>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </div>

            {isNewOpen && (
                <NewCorporateTenantModal
                    buildings={buildings}
                    units={units}
                    tenants={tenants}
                    createdBy={user.email || "admin"}
                    onClose={() => setIsNewOpen(false)}
                    onCreated={(id) => router.push(`/admin/tenants/${id}`)}
                />
            )}
        </div>
    );
}

function KpiTile({ label, value, tone }: { label: string; value: string; tone: "indigo" | "blue" | "amber" }) {
    const cls = tone === "indigo" ? "border-indigo-200 text-indigo-800" : tone === "blue" ? "border-blue-200 text-blue-800" : "border-amber-200 text-amber-800";
    return (
        <div className={`bg-white border rounded-xl p-3 ${cls}`}>
            <p className="text-[10px] font-bold uppercase opacity-70">{label}</p>
            <p className="text-xl font-bold mt-0.5">{value}</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// New corporate tenant modal
// ---------------------------------------------------------------------------

function NewCorporateTenantModal({
    buildings,
    units,
    tenants,
    createdBy,
    onClose,
    onCreated,
}: {
    buildings: Building[];
    units: Unit[];
    tenants: Tenant[];
    createdBy: string;
    onClose: () => void;
    onCreated: (id: string) => void;
}) {
    const [name, setName] = useState("");
    const [gstin, setGstin] = useState("");
    const [pan, setPan] = useState("");
    const [contactName, setContactName] = useState("");
    const [contactEmail, setContactEmail] = useState("");
    const [contactPhone, setContactPhone] = useState("");
    const [billingAddress, setBillingAddress] = useState("");
    const [buildingId, setBuildingId] = useState<string>(buildings[0]?.id || "");
    const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Only offer units that are not already tied to a tenant
    const linkedUnitIds = new Set(tenants.flatMap((t) => t.unitIds || []));
    const availableUnits = units
        .filter((u) => u.buildingId === buildingId)
        .filter((u) => !u.tenantId && !linkedUnitIds.has(u.id))
        .sort((a, b) => String(a.unitNumber).localeCompare(String(b.unitNumber), undefined, { numeric: true }));

    const toggleUnit = (id: string) => {
        setSelectedUnitIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleSubmit = async () => {
        setError(null);
        if (!name.trim() || !contactEmail.trim() || !contactName.trim()) { setError("Company name, contact name and email are required."); return; }
        if (selectedUnitIds.size === 0) { setError("Assign at least one unit."); return; }
        setBusy(true);
        try {
            const now = new Date().toISOString();
            const tenantRef = await addDoc(collection(db, "tenants"), {
                kind: "corporate",
                name: name.trim(),
                gstin: gstin.trim() || null,
                pan: pan.trim() || null,
                billingContact: { name: contactName.trim(), email: contactEmail.trim(), phone: contactPhone.trim() },
                billingAddress: billingAddress.trim() || null,
                unitIds: Array.from(selectedUnitIds),
                billingMode: "consolidated",
                paymentAllocationStrategy: "rent-first-then-electricity",
                createdAt: now,
                createdBy,
            });
            // Link every selected unit
            const batch = writeBatch(db);
            selectedUnitIds.forEach((uid) => {
                batch.update(doc(db, "units", uid), {
                    tenantId: tenantRef.id,
                    tenantName: name.trim(),
                    tenantEmail: contactEmail.trim(),
                    tenantPhone: contactPhone.trim() || null,
                    status: "occupied",
                    moveInDate: now.slice(0, 10),
                    tenantHistory: arrayUnion({
                        tenantName: name.trim(),
                        tenantEmail: contactEmail.trim(),
                        tenantPhone: contactPhone.trim() || "",
                        moveInDate: now.slice(0, 10),
                        moveOutDate: "",
                        securityDeposit: 0,
                        securityRefund: 0,
                        coTenants: [],
                    }),
                });
            });
            await batch.commit();
            onCreated(tenantRef.id);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal isOpen onClose={onClose} className="max-w-2xl" bottomSheet>
            <div className="flex items-start justify-between mb-4">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">New corporate tenant</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Company profile + unit assignments in one atomic batch.</p>
                </div>
                <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-700">×</button>
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                <section>
                    <h3 className="text-xs font-bold uppercase text-gray-500 mb-2">Company</h3>
                    <div className="grid grid-cols-2 gap-2">
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Legal name *" className="col-span-2 border rounded px-3 py-2 text-sm" />
                        <input value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="GSTIN" className="border rounded px-3 py-2 text-sm" />
                        <input value={pan} onChange={(e) => setPan(e.target.value)} placeholder="PAN" className="border rounded px-3 py-2 text-sm" />
                        <input value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} placeholder="Billing address" className="col-span-2 border rounded px-3 py-2 text-sm" />
                    </div>
                </section>
                <section>
                    <h3 className="text-xs font-bold uppercase text-gray-500 mb-2">Billing contact</h3>
                    <div className="grid grid-cols-2 gap-2">
                        <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact name *" className="border rounded px-3 py-2 text-sm" />
                        <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Phone" className="border rounded px-3 py-2 text-sm" />
                        <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Email *" className="col-span-2 border rounded px-3 py-2 text-sm" />
                    </div>
                </section>
                <section>
                    <h3 className="text-xs font-bold uppercase text-gray-500 mb-2">Assign units</h3>
                    <select value={buildingId} onChange={(e) => { setBuildingId(e.target.value); setSelectedUnitIds(new Set()); }} className="border rounded px-3 py-2 text-sm w-full mb-2">
                        {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <div className="border rounded-lg max-h-60 overflow-y-auto divide-y divide-gray-100">
                        {availableUnits.length === 0 && <p className="p-3 text-xs text-gray-400 text-center">No vacant units in this building.</p>}
                        {availableUnits.map((u) => (
                            <label key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                                <input type="checkbox" checked={selectedUnitIds.has(u.id)} onChange={() => toggleUnit(u.id)} className="h-4 w-4" />
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-gray-800">{u.unitNumber}</p>
                                    <p className="text-[10px] text-gray-500">Rent ₹{Number(u.baseRent || 0).toLocaleString()}</p>
                                </div>
                            </label>
                        ))}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{selectedUnitIds.size} selected</p>
                </section>

                {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
            </div>

            <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                <button onClick={onClose} disabled={busy} className="flex-1 py-2 text-sm font-bold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cancel</button>
                <button onClick={handleSubmit} disabled={busy} className="flex-1 py-2 text-sm font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300">{busy ? "Creating…" : "Create"}</button>
            </div>
        </Modal>
    );
}
