"use client";

import { useMemo, useRef, useState } from "react";
import { doc, getDoc, writeBatch, deleteField } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { computeRentPeriod, computeElectricityPeriod } from "@/lib/billingPeriods";
import { carryForwardFromInvoices, carryForwardBreakdown, composeInvoiceTotal } from "@/lib/allocation";
import { notifyInvoiceCreated } from "@/lib/notify";
import { billingMonthLabel, buildMeterRound, nextPendingUnitId } from "@/lib/meterRound";
import type { Unit, Invoice } from "@/types";

interface MeterTabProps {
    occupiedUnits: Unit[];
    allInvoices: Invoice[];
    electricityRate: number;
    /** Used to group and order the meter round by building. */
    buildings?: { id: string; name: string }[];
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
 *
 * Works as a "meter round": units are ordered by building then unit number,
 * the first unit still needing a reading for the billing month is selected
 * automatically, and saving moves straight on to the next one.
 */
export function MeterTab({ occupiedUnits, allInvoices, electricityRate, buildings = [] }: MeterTabProps) {
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
    const [showAllUnits, setShowAllUnits] = useState(false);
    // Units saved in this round whose invoice may not have reached the listener yet.
    const [savedUnitIds, setSavedUnitIds] = useState<ReadonlySet<string>>(new Set());
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const readingInputRef = useRef<HTMLInputElement>(null);

    const buildingNames = useMemo(() => Object.fromEntries(buildings.map((b) => [b.id, b.name])), [buildings]);
    const round = buildMeterRound(occupiedUnits, allInvoices, billingMonth, buildingNames, savedUnitIds);
    // An explicit pick wins; otherwise the round's first pending unit is active.
    const activeUnitId = selectedMeterUnit && occupiedUnits.some((u) => u.id === selectedMeterUnit)
        ? selectedMeterUnit
        : nextPendingUnitId(round);
    const activeStop = round.stops.find((s) => s.unit.id === activeUnitId);
    const hasNextPending = nextPendingUnitId(round, activeUnitId) !== "";

    const showToast = (text: string) => {
        setToast(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    };

    const resetReadingFields = () => {
        setCurrentReading("");
        setPreviousReadingOverride("");
        setMeterChanged(false);
        setManualUnitsConsumed("");
        setManualUnitsReason("");
        setNewMeterReading("");
    };

    const goToUnit = (unitId: string) => {
        setSelectedMeterUnit(unitId);
        resetReadingFields();
        requestAnimationFrame(() => readingInputRef.current?.focus());
    };

    const handleGenerateMeterInvoice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeUnitId || !billingMonth) return;
        if (!meterChanged && !currentReading) return;
        if (meterChanged && !manualUnitsConsumed) return;

        // Guard: billing month is what stamps `billingPeriod` on the invoice.
        // If the user leaves it on a past month by accident, warn before
        // generating so we don't backdate rent/electricity to the wrong period.
        const now = new Date();
        const nowYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        if (billingMonth < nowYm) {
            const chosenLabel = new Date(billingMonth + "-01").toLocaleString("default", { month: "long", year: "numeric" });
            const nowLabel = now.toLocaleString("default", { month: "long", year: "numeric" });
            if (!window.confirm(
                `⚠️ Billing month is in the past.\n\n` +
                `Chosen: ${chosenLabel}\nCurrent: ${nowLabel}\n\n` +
                `The invoice will be stamped as ${chosenLabel}. Continue?`,
            )) return;
        } else if (billingMonth > nowYm) {
            const chosenLabel = new Date(billingMonth + "-01").toLocaleString("default", { month: "long", year: "numeric" });
            if (!window.confirm(
                `⚠️ Billing month is in the future (${chosenLabel}). Continue?`,
            )) return;
        }

        const unit = occupiedUnits.find((u) => u.id === activeUnitId);
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
                { excludeInvoiceId: invoiceId, excludeBillingPeriod: monthName },
            );
            const carryForwardDetails = carryForwardBreakdown(
                allInvoices.filter((i) => (i.tenantEmail || "") === (unit.tenantEmail || "")),
                { excludeInvoiceId: invoiceId, excludeBillingPeriod: monthName },
            ).map((s) => ({ billingPeriod: s.billingPeriod, amount: s.amount }));
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
                ...(carryForwardDetails.length > 0 ? { carryForwardDetails } : { carryForwardDetails: deleteField() }),
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

            // Move straight on to the next unit still needing a reading.
            const saved = new Set(savedUnitIds).add(unit.id);
            const nextId = nextPendingUnitId(
                buildMeterRound(occupiedUnits, allInvoices, billingMonth, buildingNames, saved),
                unit.id,
            );
            const nextUnit = occupiedUnits.find((u) => u.id === nextId);
            setSavedUnitIds(saved);
            showToast(
                `✅ ${unit.unitNumber}: ₹${totalAmount.toLocaleString()} invoice (${unitsConsumed} units)` +
                (nextUnit ? ` · Next: ${nextUnit.unitNumber}` : " · Round complete 🎉"),
            );
            goToUnit(nextId);
        } catch (error) {
            console.error(error);
            alert("Failed to generate invoice.");
        } finally {
            setIsGeneratingInvoice(false);
        }
    };

    const selectedUnit = activeStop?.unit;
    const visibleStops = round.stops.filter((s) => showAllUnits || !s.done || s.unit.id === activeUnitId);
    const stopsByBuilding = visibleStops.reduce<Record<string, typeof visibleStops>>((acc, stop) => {
        (acc[stop.buildingName] = acc[stop.buildingName] || []).push(stop);
        return acc;
    }, {});
    const roundLabel = billingMonthLabel(billingMonth);

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
                {/* Round progress */}
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between items-center gap-2 text-xs">
                        <span className="font-bold text-purple-800">
                            🚶 Meter round · {roundLabel}
                        </span>
                        <span className="font-bold text-purple-700">
                            {round.doneCount} of {round.total} done{activeStop ? ` · ${activeStop.buildingName}` : ""}
                        </span>
                    </div>
                    <div className="h-2 bg-purple-100 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-600 transition-all" style={{ width: `${round.total ? (round.doneCount / round.total) * 100 : 0}%` }} />
                    </div>
                    {round.total > 0 && round.doneCount === round.total && (
                        <p className="text-xs text-green-700 font-medium">🎉 Every occupied unit has an invoice for {roundLabel}. Switch to <strong>All units</strong> to redo one.</p>
                    )}
                </div>

                <div>
                    <div className="flex justify-between items-center mb-1">
                        <label htmlFor="meterUnit" className="block text-sm font-medium text-gray-700">Unit</label>
                        <div className="flex text-[11px] font-bold rounded-md border border-gray-300 overflow-hidden">
                            <button type="button" onClick={() => setShowAllUnits(false)} className={`px-2 py-1 ${!showAllUnits ? "bg-purple-600 text-white" : "bg-white text-gray-600"}`}>Pending</button>
                            <button type="button" onClick={() => setShowAllUnits(true)} className={`px-2 py-1 ${showAllUnits ? "bg-purple-600 text-white" : "bg-white text-gray-600"}`}>All units</button>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <select id="meterUnit" required value={activeUnitId} onChange={(e) => goToUnit(e.target.value)} className="flex-1 min-w-0 px-3 py-2.5 border border-gray-300 rounded-lg">
                            <option value="" disabled>{visibleStops.length ? "Choose a unit..." : "No units pending"}</option>
                            {Object.entries(stopsByBuilding).map(([buildingName, stops]) => (
                                <optgroup key={buildingName} label={buildingName}>
                                    {stops.map(({ unit: u, done }) => (
                                        <option key={u.id} value={u.id}>{done ? "✓ " : ""}{u.unitNumber} — {u.tenantName || u.tenantEmail || "Tenant"} (Last: {u.lastMeterReading || 0})</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                        {hasNextPending && (
                            <button type="button" onClick={() => goToUnit(nextPendingUnitId(round, activeUnitId))} className="shrink-0 px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-50" title="Tenant not home? Come back to this unit later.">
                                Skip →
                            </button>
                        )}
                    </div>
                    {activeStop?.done && (
                        <p className="text-[11px] text-amber-700 mt-1">⚠️ {activeStop.unit.unitNumber} already has an invoice for {roundLabel} — saving will ask before overriding it.</p>
                    )}
                </div>

                {selectedUnit && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
                        <p><strong>Unit:</strong> {selectedUnit.unitNumber} | <strong>Tenant:</strong> {selectedUnit.tenantEmail || selectedUnit.tenantName || "—"}</p>
                        <p><strong>Last Meter Reading (from system):</strong> {selectedUnit.lastMeterReading || 0} | <strong>Base Rent:</strong> ₹{selectedUnit.baseRent || 0} | <strong>Rate:</strong> ₹{Number(selectedUnit.electricityRate) > 0 ? Number(selectedUnit.electricityRate) : electricityRate}/unit{Number(selectedUnit.electricityRate) > 0 ? " (custom)" : " (default)"}</p>
                    </div>
                )}

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Billing Month</label>
                    <input type="month" required value={billingMonth} onChange={(e) => { setBillingMonth(e.target.value); setSavedUnitIds(new Set()); goToUnit(""); }} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" />
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

                {selectedUnit && (
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
                            <input ref={readingInputRef} type="number" inputMode="numeric" required min="0" value={currentReading} onChange={(e) => setCurrentReading(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="e.g. 1250" />
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
                    const previewMonthName = new Date(Number(pYear), Number(pMonth) - 1).toLocaleString("default", { month: "long", year: "numeric" });
                    const carryForward = carryForwardFromInvoices(
                        allInvoices.filter((i) => (i.tenantEmail || "") === (selectedUnit.tenantEmail || "")),
                        { excludeInvoiceId: previewInvoiceId, excludeBillingPeriod: previewMonthName },
                    );
                    const carryForwardSources = carryForwardBreakdown(
                        allInvoices.filter((i) => (i.tenantEmail || "") === (selectedUnit.tenantEmail || "")),
                        { excludeInvoiceId: previewInvoiceId, excludeBillingPeriod: previewMonthName },
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
                                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 space-y-0.5">
                                    <p className="font-medium">Includes ₹{carryForward.toLocaleString()} carried forward from unpaid previous invoices:</p>
                                    {carryForwardSources.map((s) => (
                                        <div key={s.invoiceId} className="flex justify-between">
                                            <span>• {s.billingPeriod}</span>
                                            <span className="font-mono">+₹{s.amount.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })()}

                <button type="submit" disabled={isGeneratingInvoice || !selectedUnit} className="w-full py-3 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 transition shadow-sm disabled:bg-purple-400">
                    {isGeneratingInvoice ? "Generating..." : hasNextPending && !activeStop?.done ? "Save & next →" : "Generate Invoice"}
                </button>
            </form>

            {toast && (
                <div role="status" className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 bg-gray-900 text-white text-sm rounded-lg shadow-lg px-4 py-3 flex items-start gap-3">
                    <span className="flex-1">{toast}</span>
                    <button type="button" onClick={() => setToast(null)} className="text-gray-400 hover:text-white" aria-label="Dismiss">✕</button>
                </div>
            )}
        </div>
    );
}
