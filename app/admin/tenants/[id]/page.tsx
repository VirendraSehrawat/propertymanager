"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, doc, writeBatch, addDoc } from "firebase/firestore";
import { mapSnapshot } from "@/lib/firestore";
import type { Building, Invoice, MasterInvoice, Tenant, Unit } from "@/types";
import { groupChildInvoices, GroupingError } from "@/lib/masterAllocation";

/**
 * Corporate tenant detail — see `docs/CORPORATE_TENANT_BILLING.md` §6.1.
 *
 * Shows the units grid, current master invoices, and a "Group into master
 * invoice" flow that picks the current-month per-unit invoices for this
 * tenant's units and rolls them up in one `writeBatch`.
 */
export default function TenantDetailPage() {
    const { user, role, loading } = useAuth();
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const tenantId = params.id;

    const [tenant, setTenant] = useState<Tenant | null>(null);
    const [buildings, setBuildings] = useState<Building[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [masterInvoices, setMasterInvoices] = useState<MasterInvoice[]>([]);

    const [isGroupOpen, setIsGroupOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);

    useEffect(() => {
        if (!loading && (!user || role !== "admin")) router.push("/");
    }, [user, role, loading, router]);

    useEffect(() => {
        const off1 = onSnapshot(doc(db, "tenants", tenantId), (snap) => {
            if (!snap.exists()) { setTenant(null); return; }
            setTenant({ id: snap.id, ...snap.data() } as Tenant);
        });
        const off2 = onSnapshot(collection(db, "buildings"), (s) => setBuildings(mapSnapshot<Building>(s)));
        const off3 = onSnapshot(collection(db, "units"), (s) => setUnits(mapSnapshot<Unit>(s)));
        const off4 = onSnapshot(collection(db, "invoices"), (s) => setInvoices(mapSnapshot<Invoice>(s)));
        const off5 = onSnapshot(collection(db, "masterInvoices"), (s) => setMasterInvoices(mapSnapshot<MasterInvoice>(s)));
        return () => { off1(); off2(); off3(); off4(); off5(); };
    }, [tenantId]);

    const tenantUnits = useMemo(() => units.filter((u) => tenant?.unitIds?.includes(u.id)), [units, tenant]);
    const tenantMI = useMemo(
        () => masterInvoices.filter((m) => m.tenantId === tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        [masterInvoices, tenantId],
    );

    // Current-month per-unit invoices for this tenant's units, not yet grouped
    const currentMonthLabel = new Date().toLocaleString("default", { month: "long", year: "numeric" });
    const groupableThisMonth = useMemo(
        () => invoices.filter(
            (inv) => tenant?.unitIds?.includes(inv.unitId)
                && inv.billingPeriod === currentMonthLabel
                && !inv.masterInvoiceId
                && inv.status !== "paid",
        ),
        [invoices, tenant, currentMonthLabel],
    );

    if (loading || !user) return <div className="p-8 text-center text-gray-500">Loading…</div>;
    if (!tenant) return <div className="p-8 text-center text-gray-500">Tenant not found.</div>;

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <Link href="/admin/tenants" className="text-sm text-gray-500 hover:text-gray-700 shrink-0">← Tenants</Link>
                        <h1 className="text-lg font-bold text-gray-900 truncate">{tenant.name}</h1>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${tenant.kind === "corporate" ? "bg-indigo-100 text-indigo-800" : "bg-gray-100 text-gray-700"}`}>{tenant.kind}</span>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto p-4 space-y-4">
                {flash && <p className="text-xs bg-green-50 border border-green-200 text-green-800 rounded p-2">{flash}</p>}

                {/* Company card */}
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <h2 className="text-xs font-bold uppercase text-gray-500 mb-2">Company</h2>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                        <Row k="GSTIN" v={tenant.gstin || "—"} />
                        <Row k="PAN" v={tenant.pan || "—"} />
                        <Row k="Billing contact" v={`${tenant.billingContact.name} · ${tenant.billingContact.email}`} />
                        <Row k="Phone" v={tenant.billingContact.phone || "—"} />
                        <Row k="Address" v={tenant.billingAddress || "—"} />
                        <Row k="Mode" v={tenant.billingMode} />
                    </dl>
                </div>

                {/* Units grid */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h2 className="text-xs font-bold uppercase text-gray-500">Units ({tenantUnits.length})</h2>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {tenantUnits.map((u) => {
                            const b = buildings.find((x) => x.id === u.buildingId);
                            return (
                                <div key={u.id} className="px-4 py-2 flex items-center justify-between">
                                    <div>
                                        <p className="font-bold text-gray-800 text-sm">{u.unitNumber}</p>
                                        <p className="text-[10px] text-gray-500">{b?.name || "—"} · Rent ₹{Number(u.baseRent || 0).toLocaleString()}</p>
                                    </div>
                                </div>
                            );
                        })}
                        {tenantUnits.length === 0 && <p className="px-4 py-6 text-sm text-gray-400 text-center">No units assigned.</p>}
                    </div>
                </div>

                {/* Current-month grouping CTA */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <div>
                            <h2 className="text-sm font-bold text-gray-800">Group this month — {currentMonthLabel}</h2>
                            <p className="text-[11px] text-gray-500 mt-0.5">{groupableThisMonth.length} eligible child invoice{groupableThisMonth.length !== 1 ? "s" : ""}</p>
                        </div>
                        <button
                            disabled={groupableThisMonth.length === 0 || busy}
                            onClick={() => setIsGroupOpen(true)}
                            className="text-xs font-bold bg-indigo-600 text-white px-3 py-1.5 rounded-lg disabled:bg-gray-300"
                        >
                            Generate master invoice
                        </button>
                    </div>
                    <ul className="divide-y divide-gray-100">
                        {groupableThisMonth.map((inv) => (
                            <li key={inv.id} className="px-4 py-2 text-xs flex justify-between">
                                <span className="text-gray-700">{inv.unitNumber}</span>
                                <span className="text-gray-500">₹{Number(inv.totalAmount || 0).toLocaleString()}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Master invoice history */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                        <h2 className="text-xs font-bold uppercase text-gray-500">Master invoices ({tenantMI.length})</h2>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {tenantMI.length === 0 && <p className="px-4 py-6 text-sm text-gray-400 text-center">None yet.</p>}
                        {tenantMI.map((m) => {
                            const remaining = Math.max(0, Number(m.totalAmount || 0) - Number(m.amountPaid || 0));
                            const canUngroup = (m.status === "unpaid" || m.status === "void") && Number(m.amountPaid || 0) === 0;
                            return (
                                <div key={m.id} className="px-4 py-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-gray-800 text-sm">{m.id}</span>
                                                <StatusChip status={m.status} />
                                            </div>
                                            <p className="text-[11px] text-gray-500 mt-0.5">{m.billingPeriod} · {m.childInvoiceIds.length} unit{m.childInvoiceIds.length !== 1 ? "s" : ""}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-sm font-bold text-gray-900">₹{Number(m.totalAmount || 0).toLocaleString()}</p>
                                            <p className="text-[10px] text-amber-700">₹{remaining.toLocaleString()} due</p>
                                        </div>
                                    </div>
                                    {canUngroup && (
                                        <button
                                            onClick={() => handleUngroup(m)}
                                            className="mt-2 text-[10px] text-red-600 hover:underline"
                                        >
                                            Ungroup → break back into per-unit invoices
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {isGroupOpen && (
                <GroupConfirmModal
                    tenant={tenant}
                    invoices={groupableThisMonth}
                    createdBy={user.email || "admin"}
                    onClose={() => setIsGroupOpen(false)}
                    onDone={(msg) => { setIsGroupOpen(false); setFlash(msg); setTimeout(() => setFlash(null), 4000); }}
                />
            )}
        </div>
    );

    async function handleUngroup(m: MasterInvoice) {
        if (!confirm(`Ungroup ${m.id}? Per-unit invoices will be released.`)) return;
        setBusy(true);
        try {
            const batch = writeBatch(db);
            m.childInvoiceIds.forEach((cid) => {
                batch.update(doc(db, "invoices", cid), { masterInvoiceId: null });
            });
            batch.delete(doc(db, "masterInvoices", m.id));
            await batch.commit();
            // Audit ledger rows (post-commit; keep atomicity of the primary change)
            for (const cid of m.childInvoiceIds) {
                await addDoc(collection(db, "ledgerEntries"), {
                    invoiceId: cid,
                    amount: 0,
                    type: "ungrouping",
                    masterInvoiceId: m.id,
                    createdBy: user?.email || "admin",
                    createdAt: new Date().toISOString(),
                });
            }
            setFlash(`${m.id} ungrouped.`);
        } catch (e) {
            alert(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
            setTimeout(() => setFlash(null), 4000);
        }
    }
}

function Row({ k, v }: { k: string; v: string }) {
    return (
        <>
            <dt className="text-xs text-gray-500">{k}</dt>
            <dd className="text-xs text-gray-800 truncate">{v}</dd>
        </>
    );
}

function StatusChip({ status }: { status: MasterInvoice["status"] }) {
    const cls =
        status === "paid" ? "bg-green-100 text-green-800" :
            status === "partial" ? "bg-amber-100 text-amber-800" :
                status === "void" ? "bg-gray-100 text-gray-600" :
                    "bg-red-100 text-red-800";
    return <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${cls}`}>{status}</span>;
}

// ---------------------------------------------------------------------------
// Group confirm modal
// ---------------------------------------------------------------------------

function GroupConfirmModal({
    tenant,
    invoices,
    createdBy,
    onClose,
    onDone,
}: {
    tenant: Tenant;
    invoices: Invoice[];
    createdBy: string;
    onClose: () => void;
    onDone: (msg: string) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Preview via pure fn
    const preview = (() => {
        try {
            return groupChildInvoices({ children: invoices, tenant, createdBy });
        } catch (e) {
            if (e instanceof GroupingError) return { error: e.message };
            return { error: e instanceof Error ? e.message : String(e) };
        }
    })();

    const handleConfirm = async () => {
        if ("error" in preview) { setError(preview.error); return; }
        setBusy(true);
        try {
            const { master, childPatches } = preview;
            const batch = writeBatch(db);
            // Note: setDoc via doc ref with explicit id
            const mRef = doc(db, "masterInvoices", master.id);
            // Strip `undefined`s — Firestore rejects them
            const clean: Record<string, unknown> = {};
            Object.entries(master).forEach(([k, v]) => { if (v !== undefined) clean[k] = v; });
            batch.set(mRef, clean);
            childPatches.forEach(({ invoiceId, masterInvoiceId }) => {
                batch.update(doc(db, "invoices", invoiceId), { masterInvoiceId });
            });
            await batch.commit();
            // Zero-amount audit rows per child
            for (const cp of childPatches) {
                await addDoc(collection(db, "ledgerEntries"), {
                    invoiceId: cp.invoiceId,
                    amount: 0,
                    type: "grouping",
                    masterInvoiceId: cp.masterInvoiceId,
                    createdBy,
                    createdAt: new Date().toISOString(),
                });
            }
            onDone(`Grouped ${childPatches.length} invoice${childPatches.length !== 1 ? "s" : ""} into ${master.id}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-3">
                    <h2 className="text-lg font-bold">Generate master invoice</h2>
                    <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-700">×</button>
                </div>
                {"error" in preview ? (
                    <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{preview.error}</p>
                ) : (
                    <>
                        <p className="text-xs text-gray-600 mb-2">Rolling up <span className="font-bold">{preview.master.childInvoiceIds.length}</span> invoices into <code className="text-[11px] bg-gray-100 px-1">{preview.master.id}</code>.</p>
                        <div className="border rounded-lg divide-y divide-gray-100 max-h-60 overflow-y-auto text-xs">
                            {preview.master.lines.map((l) => (
                                <div key={l.invoiceId} className="px-3 py-2 flex justify-between">
                                    <span>{l.unitNumber}</span>
                                    <span className="text-gray-600">₹{l.baseRent.toLocaleString()} rent + ₹{l.electricityCharge.toLocaleString()} elec</span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-3 flex justify-between text-sm">
                            <span className="text-gray-500">Total</span>
                            <span className="font-bold">₹{preview.master.totalAmount.toLocaleString()}</span>
                        </div>
                        {preview.master.amountPaid > 0 && (
                            <p className="text-[11px] text-amber-700 mt-1">₹{preview.master.amountPaid.toLocaleString()} already paid on children — will carry into master.</p>
                        )}
                    </>
                )}
                {error && <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
                <div className="mt-4 flex gap-2">
                    <button onClick={onClose} disabled={busy} className="flex-1 py-2 text-sm font-bold bg-gray-100 rounded-lg">Cancel</button>
                    <button onClick={handleConfirm} disabled={busy || "error" in preview} className="flex-1 py-2 text-sm font-bold bg-indigo-600 text-white rounded-lg disabled:bg-gray-300">{busy ? "Grouping…" : "Confirm"}</button>
                </div>
            </div>
        </div>
    );
}
