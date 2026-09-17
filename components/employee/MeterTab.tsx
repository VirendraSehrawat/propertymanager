"use client";

import { useState } from "react";
import { doc, getDoc, writeBatch, deleteField } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { computeRentPeriod, computeElectricityPeriod } from "@/lib/billingPeriods";
import { carryForwardFromInvoices, composeInvoiceTotal } from "@/lib/allocation";
import { notifyInvoiceCreated } from "@/lib/notify";
import type { Unit, Invoice } from "@/types";

interface MeterTabProps {
    occupiedUnits: Unit[];
    allInvoices: Invoice[];
    electricityRate: number;
}

/**
 * Meter reading tab — records the current month's meter reading for an
 * occupied unit and generates the corresponding invoice (rent + electricity
 * + carry-forward). Extracted from `app/employee/page.tsx` as Section 3
 * step 2 of `docs/REFACTOR_PLAN.md`.
 *
 * All form state is local. Parent still owns the Firestore listeners for
 * `units` and `ledger`; this component only performs one-shot reads on
 * submit and a batched write.
 */
export function MeterTab({ occupiedUnits, allInvoices, electricityRate }: MeterTabProps) {
    const [selectedMeterUnit, setSelectedMeterUnit] = useState("");
    const [currentReading, setCurrentReading] = useState("");
    const [previousReadingOverride, setPreviousReadingOverride] = useState("");
    const [meterChanged, setMeterChanged] = useState(false);
    const [manualUnitsConsumed, setManualUnitsConsumed] = useState("");
    const [manualUnitsReason, setManualUnitsReason] = useState("");
    const [newMeterReading, setNewMeterReading] = useState("");
    const [billingMonth, setBillingMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    });
    const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);

    const handleGenerateMeterInvoice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedMeterUnit || !billingMonth) return;
        if (!meterChanged && !currentReading) return;
        if (meterChanged && !manualUnitsConsumed) return;

        const unit = occupiedUnits.find((u) => u.id === selectedMeterUnit);
        if (!unit) return;

        const [year, month] = billingMonth.split("-");
        const monthKey = `${month}_${year}`;
        const invoiceId = `inv_${unit.id}_${monthKey}`;

        const existingSnap = await getDoc(doc(db, "invoices", invoiceId));
        if (existingSnap.exists()) {
            const existing = existingSnap.data();
            if (!window.confirm(`⚠️ Invoice already exists for ${unit.unitNumber} — ${existing.billingPeriod}\n\nStatus: ${existing.status?.toUpperCase()}\nAmount: ₹${existing.totalAmount}\n\nDo you want to OVERRIDE this invoice?`)) return;
        }

        setIsGeneratingInvoice(true);
        try {
            const monthName = new Date(Number(year), Number(month) - 1).toLocaleString("default", { month: "long", year: "numeric" });

            let reading: number;
            let previousReading: number;
            let unitsConsumed: number;
            let manualOverrideNote = "";

            if (meterChanged) {
                unitsConsumed = Number(manualUnitsConsumed);
                previousReading = previousReadingOverride ? Number(previousReadingOverride) : (Number(unit.lastMeterReading) || 0);
                reading = newMeterReading ? Number(newMeterReading) : 0;
            } else {
                reading = Number(currentReading);
                previousReading = previousReadingOverride ? Number(previousReadingOverride) : (Number(unit.lastMeterReading) || 0);
                if (manualUnitsConsumed && Number(manualUnitsConsumed) > 0) {
                    unitsConsumed = Number(manualUnitsConsumed);
                    manualOverrideNote = manualUnitsReason || "Manual units entered";
                } else {
                    unitsConsumed = Math.max(0, reading - previousReading);
                }
            }

            const effectiveRate = Number(unit.electricityRate) > 0 ? Number(unit.electricityRate) : electricityRate;
            const electricityCharge = unitsConsumed * effectiveRate;

            const carryForward = carryForwardFromInvoices(
                allInvoices.filter((i) => (i.tenantEmail || "") === (unit.tenantEmail || "")),
                { excludeInvoiceId: invoiceId },
            );
            const baseRent = Number(unit.baseRent || 0);
            const { total: totalAmount } = composeInvoiceTotal({ baseRent, electricityCharge, carryForward });

            const batch = writeBatch(db);
            batch.set(doc(db, "invoices", invoiceId), {
                unitId: unit.id,
                unitNumber: unit.unitNumber,
                tenantEmail: unit.tenantEmail,
                baseRent: unit.baseRent || 0,
                previousReading,
                currentReading: reading,
                electricityConsumed: unitsConsumed,
                electricityRate: effectiveRate,
                electricityCharge,
                ...(meterChanged ? { meterChanged: true } : { meterChanged: deleteField() }),
                ...(manualOverrideNote ? { manualUnitsReason: manualOverrideNote } : { manualUnitsReason: deleteField() }),
                ...(carryForward !== 0 ? { carryForward } : { carryForward: deleteField() }),
                totalAmount,
                billingPeriod: monthName,
                rentPeriod: computeRentPeriod(billingMonth, Number(unit.paymentDay) || undefined),
                electricityPeriod: computeElectricityPeriod(billingMonth),
                status: "unpaid",
                transactionId: "",
                createdAt: new Date().toISOString(),
            }, { merge: true });

            batch.update(doc(db, "units", unit.id), { lastMeterReading: reading });
            await batch.commit();

            // Fire-and-forget Telegram notification (admin + tenant if linked).
            notifyInvoiceCreated(invoiceId);

            const cfMsg = carryForward !== 0 ? `\n${carryForward > 0 ? "⚠️ Previous Balance Due" : "✓ Advance / Credit"}: ${carryForward > 0 ? "+" : "−"}₹${Math.abs(carryForward).toLocaleString()}` : "";
            const meterNote = meterChanged ? "\n⚠️ Meter was changed — units entered manually" : "";
            const manualNote = manualOverrideNote ? `\n📝 Manual units: ${manualOverrideNote}` : "";
            const rentP = computeRentPeriod(billingMonth, Number(unit.paymentDay) || undefined);
            const elecP = computeElectricityPeriod(billingMonth);
            alert(`Invoice generated for ${unit.unitNumber}!${meterNote}${manualNote}\n\n🏠 Rent (${rentP}): ₹${Number(unit.baseRent || 0).toLocaleString()}\n⚡ Electricity (${elecP}): ${unitsConsumed} units × ₹${effectiveRate} = ₹${electricityCharge.toLocaleString()}${cfMsg}\n─────────────\nTotal: ₹${totalAmount.toLocaleString()}`);

            setSelectedMeterUnit("");
            setCurrentReading("");
            setPreviousReadingOverride("");
            setMeterChanged(false);
            setManualUnitsConsumed("");
            setManualUnitsReason("");
            setNewMeterReading("");
        } catch (error) {
            console.error(error);
            alert("Failed to generate invoice.");
        } finally {
            setIsGeneratingInvoice(false);
        }
    };

    const selectedUnit = occupiedUnits.find((x) => x.id === selectedMeterUnit);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-purple-200 overflow-hidden">
            <div className="bg-purple-50 px-5 py-4 border-b border-purple-100">
                <h2 className="text-lg font-bold text-purple-800">⚡ Record Meter Reading & Generate Invoice</h2>
                <p className="text-xs text-purple-600 mt-1">Enter readings to calculate electricity bill. Default rate ₹{electricityRate}/unit — per-tenant rate can be set in the Tenant Profile.</p>
            </div>

            <div className="mx-5 mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                <p className="font-bold flex items-center gap-1">📌 How this invoice works</p>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    <li><strong>🏠 Rent</strong> is for the <strong>upcoming month</strong> (from tenant&apos;s payment day).</li>
                    <li><strong>⚡ Electricity</strong> is for the <strong>month that just ended</strong> — the units read now were consumed last month.</li>
                </ul>
                {billingMonth && (() => {
                    const rp = computeRentPeriod(billingMonth, Number(selectedUnit?.paymentDay) || undefined);
                    const ep = computeElectricityPeriod(billingMonth);
                    return (
                        <div className="mt-2 pt-2 border-t border-amber-200 grid grid-cols-1 sm:grid-cols-2 gap-1.5 font-medium">
                            <p>🏠 <span className="text-amber-700">Collecting rent for:</span> {rp}</p>
                            <p>⚡ <span className="text-amber-700">Charging electricity for:</span> {ep}</p>
                        </div>
                    );
                })()}
            </div>

            <form onSubmit={handleGenerateMeterInvoice} className="p-5 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Select Unit</label>
                    <select required value={selectedMeterUnit} onChange={(e) => { setSelectedMeterUnit(e.target.value); setPreviousReadingOverride(""); }} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg">
                        <option value="" disabled>Choose an occupied unit...</option>
                        {occupiedUnits.map((u) => (
                            <option key={u.id} value={u.id}>{u.unitNumber} — {u.tenantEmail || u.tenantName || "Tenant"} (Last: {u.lastMeterReading || 0})</option>
                        ))}
                    </select>
                </div>

                {selectedUnit && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
                        <p><strong>Unit:</strong> {selectedUnit.unitNumber} | <strong>Tenant:</strong> {selectedUnit.tenantEmail || selectedUnit.tenantName || "—"}</p>
                        <p><strong>Last Meter Reading (from system):</strong> {selectedUnit.lastMeterReading || 0} | <strong>Base Rent:</strong> ₹{selectedUnit.baseRent || 0} | <strong>Rate:</strong> ₹{Number(selectedUnit.electricityRate) > 0 ? Number(selectedUnit.electricityRate) : electricityRate}/unit{Number(selectedUnit.electricityRate) > 0 ? " (custom)" : " (default)"}</p>
                    </div>
                )}

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Billing Month</label>
                    <input type="month" required value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" />
                    {billingMonth && (() => {
                        const rp = computeRentPeriod(billingMonth, Number(selectedUnit?.paymentDay) || undefined);
                        const ep = computeElectricityPeriod(billingMonth);
                        return (
                            <p className="text-[11px] text-purple-700 mt-1">
                                → Rent: <span className="font-medium">{rp}</span> · Electricity: <span className="font-medium">{ep}</span>
                            </p>
                        );
                    })()}
                </div>

                <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <input type="checkbox" id="meterChanged" checked={meterChanged} onChange={(e) => setMeterChanged(e.target.checked)} className="w-4 h-4 accent-yellow-600" />
                    <label htmlFor="meterChanged" className="text-sm text-yellow-800 font-medium cursor-pointer">⚠️ Meter was changed / replaced</label>
                </div>

                {selectedMeterUnit && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Previous Month Reading</label>
                        <input type="number" min="0" value={previousReadingOverride || (selectedUnit?.lastMeterReading ?? "")} onChange={(e) => setPreviousReadingOverride(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="Auto-filled from system" />
                        <p className="text-[10px] text-gray-500 mt-1">Auto-filled from last saved reading. Edit if incorrect.</p>
                    </div>
                )}

                {!meterChanged ? (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Current Month Reading *</label>
                            <input type="number" required min="0" value={currentReading} onChange={(e) => setCurrentReading(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="e.g. 1250" />
                        </div>

                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-3">
                            <p className="text-xs text-orange-700 font-medium">📝 Optional: Override units consumed manually</p>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Manual Units Consumed</label>
                                <input type="number" min="0" value={manualUnitsConsumed} onChange={(e) => setManualUnitsConsumed(e.target.value)} className="w-full px-3 py-2.5 border border-orange-300 rounded-lg" placeholder="Leave empty to auto-calculate from readings" />
                            </div>
                            {manualUnitsConsumed && Number(manualUnitsConsumed) > 0 && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Reason for manual entry *</label>
                                    <input type="text" required value={manualUnitsReason} onChange={(e) => setManualUnitsReason(e.target.value)} className="w-full px-3 py-2.5 border border-orange-300 rounded-lg" placeholder="e.g. Shared meter, faulty reading, estimated" />
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="space-y-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                        <p className="text-xs text-yellow-700 font-medium">Enter units consumed manually (from old + new meter final readings)</p>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Units Consumed *</label>
                            <input type="number" required min="0" value={manualUnitsConsumed} onChange={(e) => setManualUnitsConsumed(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="e.g. 120" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">New Meter Reading (starting reading of new meter)</label>
                            <input type="number" min="0" value={newMeterReading} onChange={(e) => setNewMeterReading(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="e.g. 0 or starting value" />
                            <p className="text-xs text-gray-500 mt-1">This will be saved as the last reading for next month</p>
                        </div>
                    </div>
                )}

                {selectedUnit && (meterChanged ? manualUnitsConsumed : currentReading) && (() => {
                    const prev = previousReadingOverride ? Number(previousReadingOverride) : (Number(selectedUnit.lastMeterReading) || 0);
                    const hasManualOverride = !meterChanged && manualUnitsConsumed && Number(manualUnitsConsumed) > 0;
                    const consumed = meterChanged
                        ? Number(manualUnitsConsumed)
                        : hasManualOverride
                            ? Number(manualUnitsConsumed)
                            : Math.max(0, Number(currentReading) - prev);
                    const effectiveRate = Number(selectedUnit.electricityRate) > 0 ? Number(selectedUnit.electricityRate) : electricityRate;
                    const elecCharge = consumed * effectiveRate;
                    const [pYear, pMonth] = billingMonth.split("-");
                    const previewInvoiceId = `inv_${selectedUnit.id}_${pMonth}_${pYear}`;
                    const carryForward = carryForwardFromInvoices(
                        allInvoices.filter((i) => (i.tenantEmail || "") === (selectedUnit.tenantEmail || "")),
                        { excludeInvoiceId: previewInvoiceId },
                    );
                    const rent = Number(selectedUnit.baseRent || 0);
                    const { total } = composeInvoiceTotal({ baseRent: rent, electricityCharge: elecCharge, carryForward });
                    return (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
                            <p className="font-bold text-gray-800 text-base">Invoice Preview</p>
                            <div className="bg-blue-50 border border-blue-200 rounded p-2 text-[11px] text-blue-900 space-y-0.5">
                                <p>🏠 <strong>Rent period:</strong> {computeRentPeriod(billingMonth, Number(selectedUnit.paymentDay) || undefined)}</p>
                                <p>⚡ <strong>Electricity for:</strong> {computeElectricityPeriod(billingMonth)}</p>
                            </div>
                            {meterChanged ? (
                                <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-800 mb-2">⚠️ Meter changed — units entered manually</div>
                            ) : (
                                <>
                                    <div className="flex justify-between"><span className="text-gray-600">Previous Reading:</span><span className="font-mono">{prev}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-600">Current Reading:</span><span className="font-mono">{Number(currentReading)}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-600">Calculated Units:</span><span className="font-mono">{Math.max(0, Number(currentReading) - prev)}</span></div>
                                </>
                            )}
                            {hasManualOverride && (
                                <div className="bg-orange-50 border border-orange-200 rounded p-2 text-xs text-orange-800">📝 Manual override: {manualUnitsConsumed} units — {manualUnitsReason || "No reason"}</div>
                            )}
                            <div className="flex justify-between"><span className="text-gray-600">Units Consumed:</span><span className="font-mono font-bold">{consumed}</span></div>
                            <div className="border-t border-gray-200 pt-2 mt-2 space-y-1">
                                <div className="flex justify-between"><span className="text-gray-600">🏠 Base Rent:</span><span className="font-mono">₹{rent.toLocaleString()}</span></div>
                                <div className="flex justify-between"><span className="text-gray-600">⚡ Electricity (×₹{effectiveRate}):</span><span className="font-mono">₹{elecCharge.toLocaleString()}</span></div>
                                {carryForward !== 0 ? (
                                    <div className={`flex justify-between ${carryForward > 0 ? "text-amber-800" : "text-emerald-700"}`}>
                                        <span className="font-medium">{carryForward > 0 ? "⚠️ Previous Balance Due:" : "✓ Advance / Credit:"}</span>
                                        <span className="font-mono font-bold">{carryForward > 0 ? "+" : "−"}₹{Math.abs(carryForward).toLocaleString()}</span>
                                    </div>
                                ) : (
                                    <div className="flex justify-between text-gray-400 text-xs"><span>Previous Balance:</span><span className="font-mono">—</span></div>
                                )}
                            </div>
                            <div className="flex justify-between border-t border-gray-300 pt-2 mt-2"><span className="font-bold text-gray-900">Total Invoice:</span><span className="font-bold text-lg text-green-700">₹{total.toLocaleString()}</span></div>
                            {carryForward > 0 && (
                                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">Includes ₹{carryForward.toLocaleString()} carried forward from unpaid previous invoices.</p>
                            )}
                        </div>
                    );
                })()}

                <button type="submit" disabled={isGeneratingInvoice} className="w-full py-3 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 transition shadow-sm disabled:bg-purple-400">
                    {isGeneratingInvoice ? "Generating..." : "Generate Invoice"}
                </button>
            </form>
        </div>
    );
}
