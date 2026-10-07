"use client";

import { useState } from "react";
import { doc, updateDoc, addDoc, collection, getDoc, getDocs, where, query, writeBatch, deleteField } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { carryForwardFromInvoices } from "@/lib/allocation";
import type { Invoice, Unit } from "@/types";

interface AdminInvoicesTabProps {
    pendingInvoices: Invoice[];
    unpaidInvoices: Invoice[];
    paidInvoices: Invoice[];
    occupiedUnits: Unit[];
    allInvoicesForDashboard: Invoice[];
    electricityRate?: number;
}

export function AdminInvoicesTab({
    pendingInvoices,
    unpaidInvoices,
    paidInvoices,
    occupiedUnits,
    allInvoicesForDashboard,
    electricityRate = 12,
}: AdminInvoicesTabProps) {
    const [subTab, setSubTab] = useState<"pending" | "unpaid" | "paid">("pending");

    // Single Invoice Modal States
    const [isSingleInvModalOpen, setIsSingleInvModalOpen] = useState(false);
    const [singleInvUnit, setSingleInvUnit] = useState("");
    const [singleInvMonth, setSingleInvMonth] = useState("");
    const [singleInvReading, setSingleInvReading] = useState("");
    const [isGeneratingSingleInv, setIsGeneratingSingleInv] = useState(false);
    const [singleInvMeterChanged, setSingleInvMeterChanged] = useState(false);
    const [singleInvUnitsConsumed, setSingleInvUnitsConsumed] = useState("");
    const [singleInvNewReading, setSingleInvNewReading] = useState("");
    const [singleInvChargeType, setSingleInvChargeType] = useState<"both" | "rent" | "electricity">("both");

    // Custom Invoice Modal States
    const [isCustomInvModalOpen, setIsCustomInvModalOpen] = useState(false);
    const [customInvUnit, setCustomInvUnit] = useState("");
    const [customInvAmount, setCustomInvAmount] = useState("");
    const [customInvTitle, setCustomInvTitle] = useState("");
    const [isSubmittingCustomInv, setIsSubmittingCustomInv] = useState(false);

    // Late Fee Modal States
    const [isLateFeeModalOpen, setIsLateFeeModalOpen] = useState(false);
    const [lateFeeAmount, setLateFeeAmount] = useState<number>(500);
    const [isApplyingLateFees, setIsApplyingLateFees] = useState(false);

    const handleApplyLateFees = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsApplyingLateFees(true);
        try {
            const standardUnpaid = unpaidInvoices.filter(inv => !inv.isCustom);
            if (standardUnpaid.length === 0) {
                alert("There are currently no unpaid standard invoices to penalize.");
                setIsLateFeeModalOpen(false);
                return;
            }
            const batch = writeBatch(db);
            let count = 0;
            for (const inv of standardUnpaid) {
                const penaltyTitle = `Late Fee: ${inv.billingPeriod}`;
                const existingFeeQuery = query(
                    collection(db, "invoices"),
                    where("unitId", "==", inv.unitId),
                    where("billingPeriod", "==", penaltyTitle)
                );
                const existingFeeSnap = await getDocs(existingFeeQuery);
                if (existingFeeSnap.empty) {
                    const newInvRef = doc(collection(db, "invoices"));
                    batch.set(newInvRef, {
                        unitId: inv.unitId,
                        unitNumber: inv.unitNumber,
                        tenantEmail: inv.tenantEmail,
                        totalAmount: Number(lateFeeAmount),
                        billingPeriod: penaltyTitle,
                        isCustom: true,
                        status: "unpaid",
                        transactionId: "",
                        createdAt: new Date().toISOString()
                    });
                    count++;
                }
            }
            if (count > 0) {
                await batch.commit();
                alert(`Successfully generated late fees for ${count} overdue tenants.`);
            } else {
                alert("Late fees have already been generated for all currently overdue invoices.");
            }
            setIsLateFeeModalOpen(false);
        } catch (error) {
            console.error(error);
            alert("Failed to apply late fees.");
        } finally {
            setIsApplyingLateFees(false);
        }
    };

    // Handlers
    const handleApproveInvoice = async (invId: string) => {
        try {
            const inv = pendingInvoices.find(i => i.id === invId);
            await updateDoc(doc(db, "invoices", invId), { status: "paid", paidAt: new Date().toISOString() });
            if (inv) {
                const invoiceAmount = Number(inv.totalAmount || 0);
                const amountPaid = Number(inv.amountPaid || invoiceAmount);
                await addDoc(collection(db, "ledger"), {
                    tenantEmail: inv.tenantEmail,
                    unitId: inv.unitId,
                    unitNumber: inv.unitNumber,
                    invoiceId: invId,
                    billingPeriod: inv.billingPeriod || "Ad-Hoc",
                    invoiceAmount,
                    amountPaid,
                    balance: amountPaid - invoiceAmount,
                    transactionId: inv.transactionId || "",
                    type: "payment",
                    settledBy: "admin",
                    createdAt: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error("Failed to approve invoice:", error);
            alert("Failed to approve invoice.");
        }
    };

    const handleRejectInvoice = async (invId: string) => {
        if (!window.confirm("Reject this payment?")) return;
        try {
            await updateDoc(doc(db, "invoices", invId), { status: "unpaid", transactionId: "" });
        } catch (error) {
            console.error("Failed to reject invoice:", error);
            alert("Failed to reject invoice.");
        }
    };

    const handleCreateCustomInvoice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!customInvUnit || !customInvAmount || !customInvTitle) return;
        setIsSubmittingCustomInv(true);
        try {
            const selectedUnit = occupiedUnits.find(u => u.id === customInvUnit);
            if (!selectedUnit) return;
            await addDoc(collection(db, "invoices"), {
                unitId: selectedUnit.id,
                unitNumber: selectedUnit.unitNumber,
                tenantEmail: selectedUnit.tenantEmail,
                totalAmount: Number(customInvAmount),
                billingPeriod: customInvTitle,
                isCustom: true,
                status: "unpaid",
                transactionId: "",
                createdAt: new Date().toISOString()
            });
            setIsCustomInvModalOpen(false);
            setCustomInvUnit("");
            setCustomInvAmount("");
            setCustomInvTitle("");
        } catch (error) {
            console.error("Failed to create custom invoice:", error);
            alert("Failed to create invoice.");
        } finally {
            setIsSubmittingCustomInv(false);
        }
    };

    const handleGenerateSingleInvoice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!singleInvUnit || !singleInvMonth) return;
        const needsMeter = singleInvChargeType !== "rent";
        if (needsMeter && !singleInvMeterChanged && !singleInvReading) return;
        if (needsMeter && singleInvMeterChanged && !singleInvUnitsConsumed) return;
        const unit = occupiedUnits.find(u => u.id === singleInvUnit);
        if (!unit) return;

        const [year, month] = singleInvMonth.split("-");
        const monthKey = `${month}_${year}`;
        const chargeSuffix = singleInvChargeType === "rent" ? "_rent" : singleInvChargeType === "electricity" ? "_elec" : "";
        const invoiceId = `inv_${unit.id}_${monthKey}${chargeSuffix}`;

        const existingSnap = await getDoc(doc(db, "invoices", invoiceId));
        if (existingSnap.exists()) {
            const existing = existingSnap.data();
            if (!window.confirm(`⚠️ Invoice already exists for ${unit.unitNumber} — ${existing.billingPeriod}\n\nStatus: ${existing.status?.toUpperCase()}\nAmount: ₹${existing.totalAmount}\n\nDo you want to OVERRIDE this invoice?`)) return;
        }

        setIsGeneratingSingleInv(true);
        try {
            const monthName = new Date(Number(year), Number(month) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
            const chargeLabel = singleInvChargeType === "rent" ? " (Rent only)" : singleInvChargeType === "electricity" ? " (Electricity only)" : "";
            const billingPeriodLabel = `${monthName}${chargeLabel}`;

            let reading = 0;
            const previousReading = Number(unit.lastMeterReading) || 0;
            let unitsConsumed = 0;

            if (needsMeter) {
                if (singleInvMeterChanged) {
                    unitsConsumed = Number(singleInvUnitsConsumed);
                    reading = singleInvNewReading ? Number(singleInvNewReading) : 0;
                } else {
                    reading = Number(singleInvReading);
                    unitsConsumed = Math.max(0, reading - previousReading);
                }
            } else {
                reading = previousReading;
            }
            const electricityCharge = needsMeter ? unitsConsumed * electricityRate : 0;
            const baseRentApplied = singleInvChargeType === "electricity" ? 0 : Number(unit.baseRent || 0);

            const carryForward = carryForwardFromInvoices(
                allInvoicesForDashboard.filter(i => (i.tenantEmail || "") === (unit.tenantEmail || "")),
                { excludeInvoiceId: invoiceId, excludeBillingPeriod: monthName }
            );
            const baseTotal = baseRentApplied + electricityCharge;
            const totalAmount = Math.max(0, baseTotal + carryForward);

            const batch = writeBatch(db);
            batch.set(doc(db, "invoices", invoiceId), {
                unitId: unit.id,
                unitNumber: unit.unitNumber,
                tenantEmail: unit.tenantEmail,
                baseRent: baseRentApplied,
                previousReading,
                currentReading: reading,
                electricityConsumed: unitsConsumed,
                electricityRate: needsMeter ? electricityRate : 0,
                electricityCharge,
                chargeType: singleInvChargeType,
                ...(singleInvMeterChanged ? { meterChanged: true } : { meterChanged: deleteField() }),
                ...(carryForward !== 0 ? { carryForward } : { carryForward: deleteField() }),
                totalAmount,
                billingPeriod: billingPeriodLabel,
                status: "unpaid",
                transactionId: "",
                createdAt: new Date().toISOString()
            }, { merge: true });

            if (needsMeter) {
                batch.update(doc(db, "units", unit.id), { lastMeterReading: reading });
            }
            await batch.commit();

            alert(`Invoice generated for ${unit.unitNumber}! Total: ₹${totalAmount}`);
            setIsSingleInvModalOpen(false);
            setSingleInvUnit("");
            setSingleInvMonth("");
            setSingleInvReading("");
            setSingleInvMeterChanged(false);
            setSingleInvUnitsConsumed("");
            setSingleInvNewReading("");
            setSingleInvChargeType("both");
        } catch (error) {
            console.error("Failed to generate invoice:", error);
            alert("Failed to generate invoice.");
        } finally {
            setIsGeneratingSingleInv(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Header & Sub-Tabs */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-wrap justify-between items-center gap-3">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setSubTab("pending")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                            subTab === "pending" ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                    >
                        Pending Verification ({pendingInvoices.length})
                    </button>
                    <button
                        onClick={() => setSubTab("unpaid")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                            subTab === "unpaid" ? "bg-rose-100 text-rose-900" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                    >
                        Unpaid Invoices ({unpaidInvoices.length})
                    </button>
                    <button
                        onClick={() => setSubTab("paid")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                            subTab === "paid" ? "bg-emerald-100 text-emerald-900" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                    >
                        Paid Records ({paidInvoices.length})
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsLateFeeModalOpen(true)}
                        className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                    >
                        ⚡ Apply Late Fees
                    </button>
                    <button
                        onClick={() => setIsSingleInvModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                    >
                        + Generate Invoice
                    </button>
                    <button
                        onClick={() => setIsCustomInvModalOpen(true)}
                        className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                    >
                        + Custom Bill
                    </button>
                </div>
            </div>

            {/* Invoices List Content */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-gray-600">
                        <thead className="bg-gray-50 text-gray-500 uppercase font-bold border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3">Unit</th>
                                <th className="px-4 py-3">Tenant</th>
                                <th className="px-4 py-3">Billing Period</th>
                                <th className="px-4 py-3 text-right">Rent</th>
                                <th className="px-4 py-3 text-right">Electricity</th>
                                <th className="px-4 py-3 text-right">Total</th>
                                <th className="px-4 py-3 text-center">Status / Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {(subTab === "pending" ? pendingInvoices : subTab === "unpaid" ? unpaidInvoices : paidInvoices).map(inv => (
                                <tr key={inv.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 font-bold text-gray-900">{inv.unitNumber}</td>
                                    <td className="px-4 py-3">
                                        <div>{inv.tenantEmail}</div>
                                        {subTab === "pending" && (inv.submittedByName || inv.submittedBy) && (
                                            <div className="text-[10px] text-amber-700 mt-0.5">
                                                🙋 Requested by: {inv.submittedByName || inv.submittedBy}
                                                {inv.submittedByName && inv.submittedBy ? ` (${inv.submittedBy})` : ""}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">{inv.billingPeriod}</td>
                                    <td className="px-4 py-3 text-right">₹{Number(inv.baseRent || 0).toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right">₹{Number(inv.electricityCharge || 0).toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right font-bold text-gray-900">₹{Number(inv.totalAmount || 0).toLocaleString()}</td>
                                    <td className="px-4 py-3 text-center">
                                        {subTab === "pending" ? (
                                            <div className="flex items-center justify-center gap-2">
                                                {inv.paymentScreenshotUrl && (
                                                    <a href={inv.paymentScreenshotUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Screenshot</a>
                                                )}
                                                <button onClick={() => handleApproveInvoice(inv.id)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded font-bold">Approve</button>
                                                <button onClick={() => handleRejectInvoice(inv.id)} className="bg-rose-600 hover:bg-rose-700 text-white px-2 py-1 rounded font-bold">Reject</button>
                                            </div>
                                        ) : (
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                inv.status === "paid" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                                            }`}>
                                                {inv.status}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Custom Invoice Modal */}
            {isCustomInvModalOpen && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-base font-bold text-gray-900">Create Custom Invoice</h3>
                            <button onClick={() => setIsCustomInvModalOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <form onSubmit={handleCreateCustomInvoice} className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Target Unit</label>
                                <select
                                    required
                                    value={customInvUnit}
                                    onChange={(e) => setCustomInvUnit(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-purple-500"
                                >
                                    <option value="">Select occupied unit...</option>
                                    {occupiedUnits.map(u => (
                                        <option key={u.id} value={u.id}>{u.unitNumber} - {u.tenantName || u.tenantEmail}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Bill Title / Description</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. AC Repair Fee / Parking"
                                    value={customInvTitle}
                                    onChange={(e) => setCustomInvTitle(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-purple-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Amount (₹)</label>
                                <input
                                    type="number"
                                    required
                                    min="1"
                                    placeholder="e.g. 1200"
                                    value={customInvAmount}
                                    onChange={(e) => setCustomInvAmount(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-purple-500"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-3">
                                <button type="button" onClick={() => setIsCustomInvModalOpen(false)} className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                                <button type="submit" disabled={isSubmittingCustomInv} className="px-4 py-2 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition disabled:opacity-50">
                                    {isSubmittingCustomInv ? "Creating..." : "Create Invoice"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Single Invoice Modal */}
            {isSingleInvModalOpen && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-base font-bold text-gray-900">Generate Single Invoice</h3>
                            <button onClick={() => setIsSingleInvModalOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <form onSubmit={handleGenerateSingleInvoice} className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Select Unit</label>
                                <select
                                    required
                                    value={singleInvUnit}
                                    onChange={(e) => setSingleInvUnit(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                >
                                    <option value="">Choose occupied unit...</option>
                                    {occupiedUnits.map(u => (
                                        <option key={u.id} value={u.id}>{u.unitNumber} - {u.tenantName || u.tenantEmail}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Billing Month</label>
                                <input
                                    type="month"
                                    required
                                    value={singleInvMonth}
                                    onChange={(e) => setSingleInvMonth(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Charge Type</label>
                                <select
                                    value={singleInvChargeType}
                                    onChange={(e) => setSingleInvChargeType(e.target.value as "both" | "rent" | "electricity")}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                >
                                    <option value="both">Rent + Electricity</option>
                                    <option value="rent">Rent Only</option>
                                    <option value="electricity">Electricity Only</option>
                                </select>
                            </div>
                            {singleInvChargeType !== "rent" && (
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">Current Meter Reading</label>
                                    <input
                                        type="number"
                                        required={!singleInvMeterChanged}
                                        placeholder="e.g. 1420"
                                        value={singleInvReading}
                                        onChange={(e) => setSingleInvReading(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                                    />
                                </div>
                            )}
                            <div className="flex justify-end gap-2 pt-3">
                                <button type="button" onClick={() => setIsSingleInvModalOpen(false)} className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                                <button type="submit" disabled={isGeneratingSingleInv} className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
                                    {isGeneratingSingleInv ? "Generating..." : "Generate Invoice"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Late Fee Modal */}
            {isLateFeeModalOpen && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-base font-bold text-gray-900">Apply Overdue Late Penalty</h3>
                            <button onClick={() => setIsLateFeeModalOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <form onSubmit={handleApplyLateFees} className="space-y-3">
                            <p className="text-xs text-gray-600">
                                This will generate a separate penalty charge for all standard unpaid invoices currently overdue.
                            </p>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Late Fee Amount (₹)</label>
                                <input
                                    type="number"
                                    min="50"
                                    required
                                    value={lateFeeAmount}
                                    onChange={(e) => setLateFeeAmount(Number(e.target.value))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-amber-500"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-3">
                                <button type="button" onClick={() => setIsLateFeeModalOpen(false)} className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                                <button type="submit" disabled={isApplyingLateFees} className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition disabled:opacity-50">
                                    {isApplyingLateFees ? "Applying..." : "Generate Late Charges"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
