"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, writeBatch, deleteField } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { computeRentPeriod, computeElectricityPeriod } from "@/lib/billingPeriods";
import { notifyInvoiceCreated } from "@/lib/notify";
import { billingMonthLabel, buildMeterRound, meterInvoiceId, nextPendingUnitId } from "@/lib/meterRound";
import {
    buildMeterInvoice,
    checkMeterReading,
    recentConsumption,
    SPIKE_FACTOR,
    type ExistingInvoice,
    type MeterInput,
    type MeterInvoiceResult,
} from "@/lib/meterInvoice";
import { useUploadWithProgress } from "@/lib/useUpload";
import type { Unit, Invoice, MeterDraft } from "@/types";
import { confirmAction, toast as notify } from "@/components/ui";
import { useSubmitGuard } from "@/lib/useSubmitGuard";
import { commitOrQueue } from "@/lib/offlineQueue";
import { FirstTimeHint } from "./FirstTimeHint";

interface MeterTabProps {
    occupiedUnits: Unit[];
    allInvoices: Invoice[];
    electricityRate: number;
    /** Used to group and order the meter round by building. */
    buildings?: { id: string; name: string }[];
    /** Open on this unit (e.g. "⚡ Enter meter" from the Monthly overview). */
    initialUnitId?: string;
    /** Open on this billing month ("YYYY-MM"). */
    initialBillingMonth?: string;
    /** Called once the initial unit/month have been applied. */
    onInitialConsumed?: () => void;
    /** Called with "YYYY-MM" when an older billing month is picked, so the page can load it (§7.1). */
    onNeedHistory?: (ym: string) => void;
}

/** Firestore write for a built invoice: merge the fields, delete the cleared ones. */
function invoiceWrite(result: MeterInvoiceResult): Record<string, unknown> {
    return {
        ...result.fields,
        ...Object.fromEntries(result.clearKeys.map((k) => [k, deleteField()])),
    };
}

/** Cloudinary path for a meter photo; unique per upload. */
function meterPhotoPath(unitId: string, billingMonth: string, fileName: string): string {
    return `meter_photos/${unitId}/${billingMonth}_${Date.now()}_${fileName}`;
}

function draftToInput(draft: MeterDraft): MeterInput {
    return {
        previousReading: draft.previousReading,
        currentReading: draft.currentReading,
        meterChanged: draft.meterChanged,
        manualUnits: draft.manualUnits,
        manualUnitsReason: draft.manualUnitsReason,
        newMeterReading: draft.newMeterReading,
        meterPhotoUrl: draft.meterPhotoUrl,
    };
}

/**
 * Meter reading tab — records the current month's meter reading for an
 * occupied unit and generates the corresponding invoice (rent + electricity
 * + carry-forward). Extracted from `app/employee/page.tsx` as Section 3
 * step 2 of `docs/REFACTOR_PLAN.md`.
 *
 * All form state is local. Parent still owns the Firestore listeners for
 * `units` and `ledger`; this component only performs one-shot reads on
 * submit and a batched write. Invoice maths and sanity checks live in
 * `lib/meterInvoice.ts`.
 *
 * Works as a "meter round": units are ordered by building then unit number,
 * the first unit still needing a reading for the billing month is selected
 * automatically, and saving moves straight on to the next one. A reading can
 * also be saved as a draft on the unit and turned into invoices later in one go.
 */
export function MeterTab({ occupiedUnits, allInvoices, electricityRate, buildings = [], initialUnitId = "", initialBillingMonth = "", onInitialConsumed, onNeedHistory }: MeterTabProps) {
    const submitGuard = useSubmitGuard(); // ignore double taps on the generate buttons (§7.3)
    // A deep-linked unit with a draft reading for the month opens with that reading filled in.
    const [initialDraft] = useState(() => {
        const draft = occupiedUnits.find((u) => u.id === initialUnitId)?.meterDraft;
        return draft && (!initialBillingMonth || draft.billingMonth === initialBillingMonth) ? draft : undefined;
    });
    const [selectedMeterUnit, setSelectedMeterUnit] = useState(initialUnitId);
    const [currentReading, setCurrentReading] = useState(initialDraft?.currentReading !== undefined ? String(initialDraft.currentReading) : "");
    const [previousReadingOverride, setPreviousReadingOverride] = useState(initialDraft ? String(initialDraft.previousReading) : "");
    const [meterChanged, setMeterChanged] = useState(Boolean(initialDraft?.meterChanged));
    const [manualUnitsConsumed, setManualUnitsConsumed] = useState(initialDraft?.manualUnits !== undefined ? String(initialDraft.manualUnits) : "");
    const [manualUnitsReason, setManualUnitsReason] = useState(initialDraft?.manualUnitsReason || "");
    const [newMeterReading, setNewMeterReading] = useState(initialDraft?.newMeterReading !== undefined ? String(initialDraft.newMeterReading) : "");
    const [meterPhoto, setMeterPhoto] = useState<File | null>(null);
    const [spikeChecked, setSpikeChecked] = useState(false);
    const [formError, setFormError] = useState("");
    const [billingMonth, setBillingMonth] = useState(() => {
        if (/^\d{4}-\d{2}$/.test(initialBillingMonth)) return initialBillingMonth;
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    });
    const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
    const [draftProgress, setDraftProgress] = useState<{ current: number; total: number } | null>(null);
    const [showAllUnits, setShowAllUnits] = useState(false);
    // Units saved in this round whose invoice may not have reached the listener yet.
    const [savedUnitIds, setSavedUnitIds] = useState<ReadonlySet<string>>(new Set());
    // Drafts saved in this session, until the units listener catches up.
    const [localDrafts, setLocalDrafts] = useState<Record<string, MeterDraft | null>>({});
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const readingInputRef = useRef<HTMLInputElement>(null);
    const photoInputRef = useRef<HTMLInputElement>(null);
    const { uploadFile, isUploading } = useUploadWithProgress();

    // The initial unit/month only seed state; tell the parent so returning to
    // the tab later starts a normal round again.
    useEffect(() => {
        if (initialUnitId || initialBillingMonth) onInitialConsumed?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const units = useMemo(() => occupiedUnits.map((u) => {
        if (!(u.id in localDrafts)) return u;
        const draft = localDrafts[u.id];
        return { ...u, meterDraft: draft ?? undefined };
    }), [occupiedUnits, localDrafts]);
    const buildingNames = useMemo(() => Object.fromEntries(buildings.map((b) => [b.id, b.name])), [buildings]);
    const round = buildMeterRound(units, allInvoices, billingMonth, buildingNames, savedUnitIds);
    // An explicit pick wins; otherwise the round's first pending unit is active.
    const activeUnitId = selectedMeterUnit && units.some((u) => u.id === selectedMeterUnit)
        ? selectedMeterUnit
        : nextPendingUnitId(round);
    const activeStop = round.stops.find((s) => s.unit.id === activeUnitId);
    const hasNextPending = nextPendingUnitId(round, activeUnitId) !== "";
    const selectedUnit = activeStop?.unit;
    const busy = isGeneratingInvoice || isUploading || draftProgress !== null;

    // --- What the form currently describes ---
    const input: MeterInput | null = selectedUnit ? {
        previousReading: previousReadingOverride !== "" ? Number(previousReadingOverride) : (Number(selectedUnit.lastMeterReading) || 0),
        currentReading: !meterChanged && currentReading !== "" ? Number(currentReading) : undefined,
        meterChanged,
        manualUnits: manualUnitsConsumed !== "" ? Number(manualUnitsConsumed) : undefined,
        manualUnitsReason,
        newMeterReading: meterChanged && newMeterReading !== "" ? Number(newMeterReading) : undefined,
    } : null;
    const hasEntry = meterChanged ? manualUnitsConsumed !== "" : currentReading !== "";
    const history = selectedUnit ? recentConsumption(allInvoices, selectedUnit.id, billingMonth) : [];
    const check = input ? checkMeterReading(input, history) : null;
    const localExisting = selectedUnit ? allInvoices.find((i) => i.id === meterInvoiceId(selectedUnit.id, billingMonth)) : undefined;
    const preview = selectedUnit && input && hasEntry
        ? buildMeterInvoice({ unit: selectedUnit, billingMonth, input, defaultRate: electricityRate, invoices: allInvoices, existing: localExisting })
        : null;
    const readingBlocked = Boolean(check?.belowPrevious) || preview?.decision.kind === "blocked";
    const needsSpikeCheck = Boolean(check?.isSpike) && !spikeChecked;

    const showToast = (text: string) => {
        setToast(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    };

    const resetReadingFields = (draft?: MeterDraft) => {
        setCurrentReading(draft?.currentReading !== undefined ? String(draft.currentReading) : "");
        setPreviousReadingOverride(draft ? String(draft.previousReading) : "");
        setMeterChanged(Boolean(draft?.meterChanged));
        setManualUnitsConsumed(draft?.manualUnits !== undefined ? String(draft.manualUnits) : "");
        setManualUnitsReason(draft?.manualUnitsReason || "");
        setNewMeterReading(draft?.newMeterReading !== undefined ? String(draft.newMeterReading) : "");
        setMeterPhoto(null);
        if (photoInputRef.current) photoInputRef.current.value = "";
        setSpikeChecked(false);
        setFormError("");
    };

    const goToUnit = (unitId: string) => {
        setSelectedMeterUnit(unitId);
        // Reopening a drafted unit picks up its saved reading.
        const draft = units.find((u) => u.id === unitId)?.meterDraft;
        resetReadingFields(draft?.billingMonth === billingMonth ? draft : undefined);
        requestAnimationFrame(() => readingInputRef.current?.focus());
    };

    /** Move to the next unit still needing a reading, after `unitId` was handled. */
    const advanceFrom = (unitId: string, opts: { saved?: ReadonlySet<string>; drafts?: Record<string, MeterDraft | null> }) => {
        const nextUnits = opts.drafts
            ? occupiedUnits.map((u) => (u.id in opts.drafts! ? { ...u, meterDraft: opts.drafts![u.id] ?? undefined } : u))
            : units;
        const nextId = nextPendingUnitId(
            buildMeterRound(nextUnits, allInvoices, billingMonth, buildingNames, opts.saved ?? savedUnitIds),
            unitId,
        );
        goToUnit(nextId);
        return occupiedUnits.find((u) => u.id === nextId);
    };

    /** Billing month sanity: confirm before stamping invoices in the past or future. */
    const confirmBillingMonth = async (): Promise<boolean> => {
        const now = new Date();
        const nowYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const chosenLabel = billingMonthLabel(billingMonth);
        if (billingMonth < nowYm) {
            const nowLabel = now.toLocaleString("default", { month: "long", year: "numeric" });
            return confirmAction({
                title: "⚠️ Billing month is in the past",
                message: `Chosen: ${chosenLabel}\nCurrent: ${nowLabel}\n\nThe invoice will be stamped as ${chosenLabel}.`,
                confirmLabel: "Continue",
            });
        }
        if (billingMonth > nowYm) {
            return confirmAction({ title: "⚠️ Billing month is in the future", message: `The invoice will be stamped as ${chosenLabel}.`, confirmLabel: "Continue" });
        }
        return true;
    };

    /** Shared checks for both "Save & next" and "Save reading only". */
    const validateEntry = (): boolean => {
        if (!selectedUnit || !input || !billingMonth || !hasEntry) return false;
        if (check?.belowPrevious) {
            setFormError("The current reading is lower than the previous one. Tick “Meter was changed”, or enter manual units with a reason.");
            return false;
        }
        if (needsSpikeCheck) {
            setFormError("This reading is unusually high. Re-check the meter and tick the box to confirm.");
            return false;
        }
        return true;
    };

    const uploadPhoto = async (unit: Unit): Promise<string | undefined> => {
        if (!meterPhoto) return undefined;
        try {
            return await uploadFile(meterPhotoPath(unit.id, billingMonth, meterPhoto.name), meterPhoto);
        } catch (err) {
            // No signal for the upload: keep the reading, drop the photo (§7.2).
            console.warn("Meter photo upload failed, saving without it", err);
            notify.info("The meter photo couldn't upload (no signal) — the reading is saved without it.");
            return undefined;
        }
    };

    /** The existing invoice for this unit and month, from the server — or, offline, from the loaded list (§7.2). */
    const readExistingInvoice = async (invoiceId: string): Promise<(ExistingInvoice & { billingPeriod?: string }) | null> => {
        try {
            const snap = await getDoc(doc(db, "invoices", invoiceId));
            return snap.exists() ? (snap.data() as ExistingInvoice & { billingPeriod?: string }) : null;
        } catch {
            const local = allInvoices.find((i) => i.id === invoiceId);
            return local ? (local as unknown as ExistingInvoice & { billingPeriod?: string }) : null;
        }
    };

    const handleGenerateMeterInvoice = (e: React.FormEvent) => submitGuard(async () => {
        e.preventDefault();
        if (!validateEntry() || !selectedUnit || !input) return;
        if (!(await confirmBillingMonth())) return;
        const unit = selectedUnit;

        setIsGeneratingInvoice(true);
        setFormError("");
        try {
            const invoiceId = meterInvoiceId(unit.id, billingMonth);
            const existing = await readExistingInvoice(invoiceId);
            // Check the decision before uploading, so a blocked invoice doesn't leave an orphan photo.
            const dryRun = buildMeterInvoice({ unit, billingMonth, input, defaultRate: electricityRate, invoices: allInvoices, existing });
            if (dryRun.decision.kind === "blocked") {
                setFormError(`Can't replace ${unit.unitNumber}'s ${dryRun.billingPeriod} invoice. ${dryRun.decision.reason}`);
                return;
            }
            if (existing) {
                const paid = Number(existing.amountPaid) || 0;
                const outcome = dryRun.decision.kind === "override" && paid > 0
                    ? `\n\n₹${paid.toLocaleString()} already paid stays on the invoice → ${dryRun.decision.status === "paid" ? "PAID" : "PARTIAL"} against the new total ₹${dryRun.totalAmount.toLocaleString()}.`
                    : "";
                if (!(await confirmAction({
                    title: `⚠️ Invoice already exists for ${unit.unitNumber} — ${existing.billingPeriod}`,
                    message: `Status: ${existing.status?.toUpperCase()}\nAmount: ₹${existing.totalAmount}${outcome}\n\nDo you want to OVERRIDE this invoice?`,
                    confirmLabel: "Override",
                    destructive: true,
                }))) return;
            }

            const meterPhotoUrl = (await uploadPhoto(unit)) || unit.meterDraft?.meterPhotoUrl;
            const result = buildMeterInvoice({
                unit, billingMonth, input: { ...input, meterPhotoUrl }, defaultRate: electricityRate, invoices: allInvoices, existing,
            });

            const batch = writeBatch(db);
            batch.set(doc(db, "invoices", invoiceId), invoiceWrite(result), { merge: true });
            batch.update(doc(db, "units", unit.id), {
                lastMeterReading: result.lastMeterReading,
                ...(unit.meterDraft ? { meterDraft: deleteField() } : {}),
            });
            await commitOrQueue(batch.commit());

            // Fire-and-forget Telegram notification (admin + tenant if linked).
            notifyInvoiceCreated(invoiceId);

            // Move straight on to the next unit still needing a reading.
            const saved = new Set(savedUnitIds).add(unit.id);
            const drafts = unit.meterDraft ? { ...localDrafts, [unit.id]: null } : localDrafts;
            setSavedUnitIds(saved);
            setLocalDrafts(drafts);
            const nextUnit = advanceFrom(unit.id, { saved, drafts });
            showToast(
                `✅ ${unit.unitNumber}: ₹${result.totalAmount.toLocaleString()} invoice (${result.unitsConsumed} units)` +
                (nextUnit ? ` · Next: ${nextUnit.unitNumber}` : " · Round complete 🎉"),
            );
        } catch (error) {
            console.error(error);
            setFormError("Failed to generate invoice. Check the connection and try again.");
        } finally {
            setIsGeneratingInvoice(false);
        }
    });

    /** Save the reading on the unit without an invoice; generate invoices later in one go. */
    const handleSaveDraft = async () => {
        if (!validateEntry() || !selectedUnit || !input) return;
        const unit = selectedUnit;
        setIsGeneratingInvoice(true);
        setFormError("");
        try {
            const meterPhotoUrl = (await uploadPhoto(unit)) || unit.meterDraft?.meterPhotoUrl;
            const draft: MeterDraft = {
                billingMonth,
                previousReading: input.previousReading,
                ...(input.currentReading !== undefined ? { currentReading: input.currentReading } : {}),
                ...(meterChanged ? { meterChanged: true } : {}),
                ...(input.manualUnits !== undefined && input.manualUnits > 0 ? { manualUnits: input.manualUnits } : {}),
                ...(manualUnitsReason.trim() ? { manualUnitsReason: manualUnitsReason.trim() } : {}),
                ...(input.newMeterReading !== undefined ? { newMeterReading: input.newMeterReading } : {}),
                ...(meterPhotoUrl ? { meterPhotoUrl } : {}),
                savedAt: new Date().toISOString(),
            };
            const batch = writeBatch(db);
            batch.update(doc(db, "units", unit.id), { meterDraft: draft });
            await commitOrQueue(batch.commit());

            const drafts = { ...localDrafts, [unit.id]: draft };
            setLocalDrafts(drafts);
            const nextUnit = advanceFrom(unit.id, { drafts });
            showToast(
                `📝 ${unit.unitNumber}: reading ${input.currentReading ?? `${input.manualUnits} units`} saved as draft` +
                (nextUnit ? ` · Next: ${nextUnit.unitNumber}` : " · All readings taken"),
            );
        } catch (error) {
            console.error(error);
            setFormError("Failed to save the reading. Check the connection and try again.");
        } finally {
            setIsGeneratingInvoice(false);
        }
    };

    /** Turn every draft reading for the billing month into an invoice. */
    const handleGenerateDrafts = () => submitGuard(async () => {
        const drafted = round.stops.filter((s) => s.drafted && s.unit.meterDraft);
        if (!drafted.length) return;
        if (!(await confirmAction({
            title: `Generate ${drafted.length} invoice${drafted.length === 1 ? "" : "s"}?`,
            message: `For ${billingMonthLabel(billingMonth)}, from the saved readings.`,
            confirmLabel: "Generate",
        }))) return;
        if (!(await confirmBillingMonth())) return;

        const saved = new Set(savedUnitIds);
        const drafts = { ...localDrafts };
        const skipped: string[] = [];
        let total = 0;
        setDraftProgress({ current: 0, total: drafted.length });
        try {
            for (let i = 0; i < drafted.length; i++) {
                const unit = drafted[i].unit;
                setDraftProgress({ current: i + 1, total: drafted.length });
                const draftInput = draftToInput(unit.meterDraft as MeterDraft);
                if (checkMeterReading(draftInput).belowPrevious) {
                    skipped.push(`${unit.unitNumber} (reading below previous)`);
                    continue;
                }
                try {
                    const invoiceId = meterInvoiceId(unit.id, billingMonth);
                    // Never override in bulk — an existing invoice needs a person to look at it.
                    if (await readExistingInvoice(invoiceId)) {
                        skipped.push(`${unit.unitNumber} (invoice already exists)`);
                        continue;
                    }
                    const result = buildMeterInvoice({ unit, billingMonth, input: draftInput, defaultRate: electricityRate, invoices: allInvoices });
                    const batch = writeBatch(db);
                    batch.set(doc(db, "invoices", invoiceId), invoiceWrite(result), { merge: true });
                    batch.update(doc(db, "units", unit.id), { lastMeterReading: result.lastMeterReading, meterDraft: deleteField() });
                    await commitOrQueue(batch.commit());
                    notifyInvoiceCreated(invoiceId);
                    saved.add(unit.id);
                    drafts[unit.id] = null;
                    total += 1;
                } catch (error) {
                    console.error(error);
                    skipped.push(`${unit.unitNumber} (save failed)`);
                }
            }
        } finally {
            setDraftProgress(null);
            setSavedUnitIds(saved);
            setLocalDrafts(drafts);
        }
        showToast(
            `✅ ${total} invoice${total === 1 ? "" : "s"} generated` +
            (skipped.length ? ` · Skipped: ${skipped.join(", ")}` : ""),
        );
    });

    const visibleStops = round.stops.filter((s) => showAllUnits || (!s.done && !s.drafted) || s.unit.id === activeUnitId);
    const stopsByBuilding = visibleStops.reduce<Record<string, typeof visibleStops>>((acc, stop) => {
        (acc[stop.buildingName] = acc[stop.buildingName] || []).push(stop);
        return acc;
    }, {});
    const roundLabel = billingMonthLabel(billingMonth);
    const readCount = round.doneCount + round.draftCount;

    return (
        <div className="space-y-3">
            <FirstTimeHint id="meter" title="First time on the meter round?" helpHref="/employee/help#meter">
                <p>Check the <b>billing month</b>, then walk unit by unit: the next unit still needing a reading is picked for you.</p>
                <p>Type the reading and tap <b>Save &amp; next</b> to create the invoice, or <b>📝 Save reading only</b> to go faster and tap <b>Generate N invoices</b> at the end. <b>Skip</b> if nobody is home.</p>
                <p>A reading lower than last month&apos;s is blocked — tick <b>Meter was changed</b> if it was replaced. Add a 📷 photo of the meter when you can.</p>
            </FirstTimeHint>
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
                        <div className="h-2 bg-purple-100 rounded-full overflow-hidden flex">
                            <div className="h-full bg-purple-600 transition-all" style={{ width: `${round.total ? (round.doneCount / round.total) * 100 : 0}%` }} />
                            <div className="h-full bg-purple-300 transition-all" style={{ width: `${round.total ? (round.draftCount / round.total) * 100 : 0}%` }} />
                        </div>
                        {round.draftCount > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-purple-200 rounded-md px-2 py-1.5">
                                <span className="text-xs text-purple-800">📝 <strong>{round.draftCount}</strong> reading{round.draftCount === 1 ? "" : "s"} saved without an invoice</span>
                                <button type="button" onClick={handleGenerateDrafts} disabled={busy} className="px-2.5 py-1 bg-purple-600 text-white rounded text-xs font-bold hover:bg-purple-700 disabled:bg-purple-300">
                                    {draftProgress ? `Generating ${draftProgress.current} of ${draftProgress.total}…` : `Generate ${round.draftCount} invoice${round.draftCount === 1 ? "" : "s"}`}
                                </button>
                            </div>
                        )}
                        {round.total > 0 && round.doneCount === round.total && (
                            <p className="text-xs text-green-700 font-medium">🎉 Every occupied unit has an invoice for {roundLabel}. Switch to <strong>All units</strong> to redo one.</p>
                        )}
                        {round.total > 0 && round.draftCount > 0 && readCount === round.total && (
                            <p className="text-xs text-purple-700 font-medium">🚶 Every reading is taken. Generate the draft invoices when you&apos;re ready.</p>
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
                                        {stops.map(({ unit: u, done, drafted }) => (
                                            <option key={u.id} value={u.id}>{done ? "✓ " : drafted ? "📝 " : ""}{u.unitNumber} — {u.tenantName || u.tenantEmail || "Tenant"} (Last: {u.lastMeterReading || 0})</option>
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
                        {activeStop?.drafted && (
                            <p className="text-[11px] text-purple-700 mt-1">📝 Draft reading loaded for {activeStop.unit.unitNumber}. Save again to update it, or generate its invoice now.</p>
                        )}
                    </div>

                    {selectedUnit && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
                            <p><strong>Unit:</strong> {selectedUnit.unitNumber} | <strong>Tenant:</strong> {selectedUnit.tenantEmail || selectedUnit.tenantName || "—"}</p>
                            <p><strong>Last Meter Reading (from system):</strong> {selectedUnit.lastMeterReading || 0} | <strong>Base Rent:</strong> ₹{selectedUnit.baseRent || 0} | <strong>Rate:</strong> ₹{Number(selectedUnit.electricityRate) > 0 ? Number(selectedUnit.electricityRate) : electricityRate}/unit{Number(selectedUnit.electricityRate) > 0 ? " (custom)" : " (default)"}</p>
                            {history.length > 0 && (
                                <p><strong>Recent usage:</strong> {history.join(", ")} units (avg {check?.average ?? 0})</p>
                            )}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Billing Month</label>
                        <input type="month" required value={billingMonth} onChange={(e) => { setBillingMonth(e.target.value); onNeedHistory?.(e.target.value); setSavedUnitIds(new Set()); setSelectedMeterUnit(""); resetReadingFields(); }} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" />
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
                        <input type="checkbox" id="meterChanged" checked={meterChanged} onChange={(e) => { setMeterChanged(e.target.checked); setFormError(""); }} className="w-4 h-4 accent-yellow-600" />
                        <label htmlFor="meterChanged" className="text-sm text-yellow-800 font-medium cursor-pointer">⚠️ Meter was changed / replaced</label>
                    </div>

                    {selectedUnit && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Previous Month Reading</label>
                            <input type="number" inputMode="decimal" min="0" value={previousReadingOverride !== "" ? previousReadingOverride : (selectedUnit?.lastMeterReading ?? "")} onChange={(e) => setPreviousReadingOverride(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="Auto-filled from system" />
                            <p className="text-[10px] text-gray-500 mt-1">Auto-filled from last saved reading. Edit if incorrect.</p>
                        </div>
                    )}

                    {!meterChanged ? (
                        <>
                            <div>
                                <label htmlFor="currentReading" className="block text-sm font-medium text-gray-700 mb-1">Current Month Reading *</label>
                                <input id="currentReading" ref={readingInputRef} type="number" inputMode="numeric" required min="0" value={currentReading} onChange={(e) => { setCurrentReading(e.target.value); setSpikeChecked(false); setFormError(""); }} className={`w-full px-3 py-2.5 border rounded-lg ${check?.belowPrevious ? "border-red-400 bg-red-50" : "border-gray-300"}`} placeholder="e.g. 1250" />
                                {preview && !check?.belowPrevious && (
                                    <p className="text-xs text-gray-600 mt-1 font-mono">
                                        = {preview.unitsConsumed} units × ₹{preview.electricityRate} = <strong>₹{preview.electricityCharge.toLocaleString()}</strong>
                                    </p>
                                )}
                            </div>

                            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-3">
                                <p className="text-xs text-orange-700 font-medium">📝 Optional: Override units consumed manually</p>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Manual Units Consumed</label>
                                    <input type="number" inputMode="decimal" min="0" value={manualUnitsConsumed} onChange={(e) => { setManualUnitsConsumed(e.target.value); setFormError(""); }} className="w-full px-3 py-2.5 border border-orange-300 rounded-lg" placeholder="Leave empty to auto-calculate from readings" />
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
                                <input type="number" inputMode="decimal" required min="0" value={manualUnitsConsumed} onChange={(e) => { setManualUnitsConsumed(e.target.value); setSpikeChecked(false); }} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="e.g. 120" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">New Meter Reading (starting reading of new meter)</label>
                                <input type="number" inputMode="decimal" min="0" value={newMeterReading} onChange={(e) => setNewMeterReading(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="e.g. 0 or starting value" />
                                <p className="text-xs text-gray-500 mt-1">This will be saved as the last reading for next month</p>
                            </div>
                        </div>
                    )}

                    {/* Reading sanity checks */}
                    {check?.belowPrevious && (
                        <div role="alert" className="bg-red-50 border border-red-300 rounded-lg p-3 text-xs text-red-800">
                            <p className="font-bold">⛔ Reading {input?.currentReading} is lower than the previous reading {input?.previousReading}.</p>
                            <p className="mt-0.5">Check for a typo. If the meter was replaced or rolled over, tick <strong>⚠️ Meter was changed</strong>, or enter <strong>Manual Units Consumed</strong> with a reason.</p>
                        </div>
                    )}
                    {check?.isSpike && hasEntry && (
                        <div role="alert" className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-900 space-y-2">
                            <p><strong>⚠️ {check.unitsConsumed} units is more than {SPIKE_FACTOR}× this unit&apos;s usual {check.average} units</strong> (average of the last {history.length} month{history.length === 1 ? "" : "s"}).</p>
                            <label className="flex items-center gap-2 font-medium cursor-pointer">
                                <input type="checkbox" checked={spikeChecked} onChange={(e) => { setSpikeChecked(e.target.checked); setFormError(""); }} className="w-4 h-4 accent-amber-600" />
                                I&apos;ve re-checked the meter — the reading is correct
                            </label>
                        </div>
                    )}

                    {/* Meter photo */}
                    {selectedUnit && (
                        <div>
                            <label htmlFor="meterPhoto" className="block text-sm font-medium text-gray-700 mb-1">📷 Meter photo <span className="text-gray-400 font-normal">(optional)</span></label>
                            <input id="meterPhoto" ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={(e) => setMeterPhoto(e.target.files?.[0] || null)} className="w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-purple-100 file:text-purple-700 file:font-bold" />
                            <p className="text-[10px] text-gray-500 mt-1">
                                {meterPhoto
                                    ? `✓ ${meterPhoto.name} will be attached to the invoice.`
                                    : selectedUnit.meterDraft?.meterPhotoUrl && activeStop?.drafted
                                        ? "✓ Photo from the draft will be attached."
                                        : "Saved with the invoice as evidence if the bill is disputed."}
                            </p>
                        </div>
                    )}

                    {preview && selectedUnit && input && (
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
                                    <div className="flex justify-between"><span className="text-gray-600">Previous Reading:</span><span className="font-mono">{input.previousReading}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-600">Current Reading:</span><span className="font-mono">{Number(currentReading)}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-600">Calculated Units:</span><span className="font-mono">{Math.max(0, Number(currentReading) - input.previousReading)}</span></div>
                                </>
                            )}
                            {!meterChanged && Number(manualUnitsConsumed) > 0 && (
                                <div className="bg-orange-50 border border-orange-200 rounded p-2 text-xs text-orange-800">📝 Manual override: {manualUnitsConsumed} units — {manualUnitsReason || "No reason"}</div>
                            )}
                            <div className="flex justify-between"><span className="text-gray-600">Units Consumed:</span><span className="font-mono font-bold">{preview.unitsConsumed}</span></div>
                            <div className="border-t border-gray-200 pt-2 mt-2 space-y-1">
                                <div className="flex justify-between"><span className="text-gray-600">🏠 Base Rent:</span><span className="font-mono">₹{Number(selectedUnit.baseRent || 0).toLocaleString()}</span></div>
                                <div className="flex justify-between"><span className="text-gray-600">⚡ Electricity (×₹{preview.electricityRate}):</span><span className="font-mono">₹{preview.electricityCharge.toLocaleString()}</span></div>
                                {preview.carryForward !== 0 ? (
                                    <div className={`flex justify-between ${preview.carryForward > 0 ? "text-amber-800" : "text-emerald-700"}`}>
                                        <span className="font-medium">{preview.carryForward > 0 ? "⚠️ Previous Balance Due:" : "✓ Advance / Credit:"}</span>
                                        <span className="font-mono font-bold">{preview.carryForward > 0 ? "+" : "−"}₹{Math.abs(preview.carryForward).toLocaleString()}</span>
                                    </div>
                                ) : (
                                    <div className="flex justify-between text-gray-400 text-xs"><span>Previous Balance:</span><span className="font-mono">—</span></div>
                                )}
                            </div>
                            <div className="flex justify-between border-t border-gray-300 pt-2 mt-2"><span className="font-bold text-gray-900">Total Invoice:</span><span className="font-bold text-lg text-green-700">₹{preview.totalAmount.toLocaleString()}</span></div>
                            {preview.carryForward > 0 && (
                                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 space-y-0.5">
                                    <p className="font-medium">Includes ₹{preview.carryForward.toLocaleString()} carried forward from unpaid previous invoices:</p>
                                    {preview.carryForwardSources.map((s) => (
                                        <div key={s.invoiceId} className="flex justify-between">
                                            <span>• {s.billingPeriod}</span>
                                            <span className="font-mono">+₹{s.amount.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {preview.decision.kind === "override" && preview.decision.amountPaid > 0 && (
                                <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                                    💰 ₹{preview.decision.amountPaid.toLocaleString()} already paid stays on this invoice → it will be <strong>{preview.decision.status === "paid" ? "PAID" : "PARTIAL"}</strong>.
                                </div>
                            )}
                            {preview.decision.kind === "blocked" && (
                                <div role="alert" className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">
                                    ⛔ The existing {preview.billingPeriod} invoice can&apos;t be replaced here. {preview.decision.reason}
                                </div>
                            )}
                        </div>
                    )}

                    {formError && (
                        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2">
                        <button type="submit" disabled={busy || !selectedUnit || readingBlocked} className="flex-1 py-3 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 transition shadow-sm disabled:bg-purple-300">
                            {isUploading ? "Uploading photo..." : isGeneratingInvoice ? "Saving..." : hasNextPending && !activeStop?.done ? "Save & next →" : "Generate Invoice"}
                        </button>
                        {!activeStop?.done && (
                            <button type="button" onClick={handleSaveDraft} disabled={busy || !selectedUnit || !hasEntry || Boolean(check?.belowPrevious)} className="sm:w-auto py-3 px-4 border border-purple-300 text-purple-700 rounded-lg font-bold hover:bg-purple-50 disabled:opacity-50" title="Save the reading now and generate the invoice later">
                                📝 Save reading only
                            </button>
                        )}
                    </div>
                </form>

                {toast && (
                    <div role="status" className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 bg-gray-900 text-white text-sm rounded-lg shadow-lg px-4 py-3 flex items-start gap-3">
                        <span className="flex-1">{toast}</span>
                        <button type="button" onClick={() => setToast(null)} className="text-gray-400 hover:text-white" aria-label="Dismiss">✕</button>
                    </div>
                )}
            </div>
        </div>
    );
}
