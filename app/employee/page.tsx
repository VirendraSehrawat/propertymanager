/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, doc, updateDoc, arrayUnion, query, where, writeBatch, getDocs, addDoc, getDoc, deleteField } from "firebase/firestore";
import { useUploadWithProgress, UploadProgressBar } from "@/lib/useUpload";

export default function EmployeeDashboard() {
    const { user, role, loading } = useAuth();
    const router = useRouter();
    const { uploadFile, uploadProgress, isUploading } = useUploadWithProgress();

    const [activeTickets, setActiveTickets] = useState<any[]>([]);
    const [resolvedTickets, setResolvedTickets] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<"active" | "resolved" | "meter" | "collections" | "ledger" | "units" | "occupancy" | "checklist" | "expenses" | "inventory">("active");

    const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);
    const [selectedTicket, setSelectedTicket] = useState<any>(null);
    const [resolutionNote, setResolutionNote] = useState("");
    const [resolutionFile, setResolutionFile] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Meter Reading States
    const [occupiedUnits, setOccupiedUnits] = useState<any[]>([]);
    const [selectedMeterUnit, setSelectedMeterUnit] = useState("");
    const [currentReading, setCurrentReading] = useState("");
    const [meterChanged, setMeterChanged] = useState(false);
    const [manualUnitsConsumed, setManualUnitsConsumed] = useState("");
    const [newMeterReading, setNewMeterReading] = useState("");
    const [billingMonth, setBillingMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
    const [electricityRate] = useState(12); // ₹12 per unit consumed

    // Collections States
    const [allInvoices, setAllInvoices] = useState<any[]>([]);
    const [collectionFilter, setCollectionFilter] = useState("all");
    const [isSettling, setIsSettling] = useState("");

    // Tenant Profile States
    const [isTenantProfileOpen, setIsTenantProfileOpen] = useState(false);
    const [profileUnit, setProfileUnit] = useState<any>(null);
    const [profileName, setProfileName] = useState("");
    const [profilePhone, setProfilePhone] = useState("");
    const [profileEmail, setProfileEmail] = useState("");
    const [profileNote, setProfileNote] = useState("");
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileDocName, setProfileDocName] = useState("");
    const [profileDocFile, setProfileDocFile] = useState<File | null>(null);
    const [isUploadingDoc, setIsUploadingDoc] = useState(false);

    // Ledger state
    const [allLedgerEntries, setAllLedgerEntries] = useState<any[]>([]);
    const [ledgerFilter, setLedgerFilter] = useState("");

    // Unit Management States
    const [allUnits, setAllUnits] = useState<any[]>([]);
    const [buildings, setBuildings] = useState<any[]>([]);
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [assignUnit, setAssignUnit] = useState<any>(null);
    const [assignEmail, setAssignEmail] = useState("");
    const [assignName, setAssignName] = useState("");
    const [assignPhone, setAssignPhone] = useState("");
    const [assignMode, setAssignMode] = useState<"new" | "existing">("new");
    const [assignExistingUnit, setAssignExistingUnit] = useState("");
    const [isEditUnitModalOpen, setIsEditUnitModalOpen] = useState(false);
    const [editUnit, setEditUnit] = useState<any>(null);
    const [editUnitNumber, setEditUnitNumber] = useState("");
    const [editBaseRent, setEditBaseRent] = useState("");
    const [unitDocUnit, setUnitDocUnit] = useState<any>(null);
    const [unitDocName, setUnitDocName] = useState("");
    const [unitDocFile, setUnitDocFile] = useState<File | null>(null);
    const [isUnitDocModalOpen, setIsUnitDocModalOpen] = useState(false);
    const [expandedBuildings, setExpandedBuildings] = useState<string[]>([]);

    // Move-in/Move-out Checklist States
    const [checklistType, setChecklistType] = useState<"move-in" | "move-out">("move-in");
    const [checklistUnit, setChecklistUnit] = useState("");
    const [checklistRooms, setChecklistRooms] = useState<{ room: string; condition: string; photo: File | null; photoUrl?: string; damages: string }[]>([{ room: "Living Room", condition: "good", photo: null, damages: "" }]);
    const [checklistNotes, setChecklistNotes] = useState("");
    const [isSubmittingChecklist, setIsSubmittingChecklist] = useState(false);
    const [allChecklists, setAllChecklists] = useState<any[]>([]);
    const [checklistDeduction, setChecklistDeduction] = useState("");

    // Multiple Tenants States
    const [isAddCoTenantOpen, setIsAddCoTenantOpen] = useState(false);
    const [coTenantUnit, setCoTenantUnit] = useState<any>(null);
    const [coTenantName, setCoTenantName] = useState("");
    const [coTenantPhone, setCoTenantPhone] = useState("");
    const [coTenantEmail, setCoTenantEmail] = useState("");

    // Expense States
    const [allExpenses, setAllExpenses] = useState<any[]>([]);
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [expenseAmount, setExpenseAmount] = useState("");
    const [expenseCategory, setExpenseCategory] = useState("Maintenance");
    const [expenseDesc, setExpenseDesc] = useState("");
    const [expenseDate, setExpenseDate] = useState("");
    const [expenseBuilding, setExpenseBuilding] = useState("");
    const [expenseReceipt, setExpenseReceipt] = useState<File | null>(null);
    const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);

    // Inventory States
    const [allInventory, setAllInventory] = useState<any[]>([]);
    const [isInventoryModalOpen, setIsInventoryModalOpen] = useState(false);
    const [invItemName, setInvItemName] = useState("");
    const [invItemQty, setInvItemQty] = useState("");
    const [invItemBuilding, setInvItemBuilding] = useState("");
    const [invItemLocation, setInvItemLocation] = useState("");
    const [invItemCondition, setInvItemCondition] = useState("good");
    const [invItemNotes, setInvItemNotes] = useState("");
    const [isSubmittingInventory, setIsSubmittingInventory] = useState(false);
    const [inventoryFilter, setInventoryFilter] = useState("");

    useEffect(() => {
        if (!loading && (!user || role !== "employee")) {
            router.push("/");
        }
        if (role === "employee") document.title = "Employee Portal | Property Manager";
    }, [user, role, loading, router]);

    useEffect(() => {
        if (role !== "employee") return;

        const unsubTickets = onSnapshot(collection(db, "maintenance"), (snapshot) => {
            const allTickets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

            // Sort newest first
            allTickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            setActiveTickets(allTickets.filter(t => t.status !== "resolved"));
            setResolvedTickets(allTickets.filter(t => t.status === "resolved"));
        });

        const unsubUnits = onSnapshot(query(collection(db, "units"), where("status", "==", "occupied")), (snapshot) => {
            setOccupiedUnits(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })));
        });

        const unsubInvoices = onSnapshot(collection(db, "invoices"), (snapshot) => {
            setAllInvoices(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
        });

        const unsubLedger = onSnapshot(collection(db, "ledger"), (snapshot) => {
            setAllLedgerEntries(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        });

        const unsubAllUnits = onSnapshot(collection(db, "units"), (snapshot) => {
            setAllUnits(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a: any, b: any) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })));
        });

        const unsubBuildings = onSnapshot(collection(db, "buildings"), (snapshot) => {
            setBuildings(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
        });

        const unsubChecklists = onSnapshot(collection(db, "checklists"), (snapshot) => {
            setAllChecklists(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        });

        const unsubExpenses = onSnapshot(collection(db, "expenses"), (snapshot) => {
            setAllExpenses(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a: any, b: any) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()));
        });

        const unsubInventory = onSnapshot(collection(db, "inventory"), (snapshot) => {
            setAllInventory(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a: any, b: any) => a.name?.localeCompare(b.name)));
        });

        return () => { unsubTickets(); unsubUnits(); unsubInvoices(); unsubLedger(); unsubAllUnits(); unsubBuildings(); unsubChecklists(); unsubExpenses(); unsubInventory(); };
    }, [role]);

    const handleMarkInProgress = async (ticketId: string) => {
        try {
            await updateDoc(doc(db, "maintenance", ticketId), {
                status: "in-progress",
                comments: arrayUnion({
                    author: "Maintenance Staff",
                    text: "Staff has acknowledged the issue and is working on it.",
                    timestamp: new Date().toISOString()
                })
            });
        } catch (error) {
            console.error("Failed to update status:", error);
            alert("Could not update ticket.");
        }
    };

    const handleResolveSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTicket || !resolutionFile) return;

        setIsSubmitting(true);
        try {
            // 1. Upload the proof photo to Firebase Storage
            const photoUrl = await uploadFile(`maintenance_resolutions/${selectedTicket.id}/${Date.now()}_${resolutionFile.name}`, resolutionFile);

            // 2. Update the Firestore ticket
            await updateDoc(doc(db, "maintenance", selectedTicket.id), {
                status: "resolved",
                resolutionPhotoUrl: photoUrl,
                comments: arrayUnion({
                    author: "Maintenance Staff",
                    text: resolutionNote || "Issue has been resolved.",
                    timestamp: new Date().toISOString()
                })
            });

            // 3. Reset UI
            setIsResolveModalOpen(false);
            setSelectedTicket(null);
            setResolutionNote("");
            setResolutionFile(null);
        } catch (error) {
            console.error(error);
            alert("Failed to submit resolution. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleLogout = async () => {
        await signOut(auth);
        router.push("/");
    };

    const handleGenerateMeterInvoice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedMeterUnit || !billingMonth) return;
        if (!meterChanged && !currentReading) return;
        if (meterChanged && !manualUnitsConsumed) return;

        const unit = occupiedUnits.find(u => u.id === selectedMeterUnit);
        if (!unit) return;

        const [year, month] = billingMonth.split("-");
        const monthKey = `${month}_${year}`;
        const invoiceId = `inv_${unit.id}_${monthKey}`;

        // Check if invoice already exists
        const existingSnap = await getDoc(doc(db, "invoices", invoiceId));
        if (existingSnap.exists()) {
            const existing = existingSnap.data();
            if (!window.confirm(`⚠️ Invoice already exists for ${unit.unitNumber} — ${existing.billingPeriod}\n\nStatus: ${existing.status?.toUpperCase()}\nAmount: ₹${existing.totalAmount}\n\nDo you want to OVERRIDE this invoice?`)) return;
        }

        setIsGeneratingInvoice(true);
        try {
            const monthName = new Date(Number(year), Number(month) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

            let reading: number;
            let previousReading: number;
            let unitsConsumed: number;

            if (meterChanged) {
                // Meter was replaced — user enters units consumed directly + new meter reading
                unitsConsumed = Number(manualUnitsConsumed);
                previousReading = Number(unit.lastMeterReading) || 0;
                reading = newMeterReading ? Number(newMeterReading) : 0;
            } else {
                reading = Number(currentReading);
                previousReading = Number(unit.lastMeterReading) || 0;
                unitsConsumed = Math.max(0, reading - previousReading);
            }
            const electricityCharge = unitsConsumed * electricityRate;

            // Fetch tenant ledger balance (carry-forward)
            const ledgerSnap = await getDocs(query(collection(db, "ledger"), where("tenantEmail", "==", unit.tenantEmail)));
            const runningBalance = ledgerSnap.docs.reduce((sum, d) => sum + Number(d.data().balance || 0), 0);
            // Negative balance = tenant owes more, positive = tenant has credit
            const carryForward = -runningBalance; // amount to add (positive if due, negative if credit)
            const baseTotal = Number(unit.baseRent || 0) + electricityCharge;
            const totalAmount = Math.max(0, baseTotal + carryForward);

            const batch = writeBatch(db);

            // Create / update the invoice
            batch.set(doc(db, "invoices", invoiceId), {
                unitId: unit.id,
                unitNumber: unit.unitNumber,
                tenantEmail: unit.tenantEmail,
                baseRent: unit.baseRent || 0,
                previousReading,
                currentReading: reading,
                electricityConsumed: unitsConsumed,
                electricityRate,
                electricityCharge,
                ...(meterChanged ? { meterChanged: true } : { meterChanged: deleteField() }),
                ...(carryForward !== 0 ? { carryForward } : { carryForward: deleteField() }),
                totalAmount,
                billingPeriod: monthName,
                status: "unpaid",
                transactionId: "",
                createdAt: new Date().toISOString()
            }, { merge: true });

            // Update last meter reading on the unit
            batch.update(doc(db, "units", unit.id), { lastMeterReading: reading });

            await batch.commit();
            const cfMsg = carryForward !== 0 ? `\nCarry Forward: ${carryForward > 0 ? '+' : ''}₹${carryForward}` : '';
            const meterNote = meterChanged ? '\n⚠️ Meter was changed — units entered manually' : '';
            alert(`Invoice generated for ${unit.unitNumber}!${meterNote}\n\nRent: ₹${unit.baseRent || 0}\nElectricity: ${unitsConsumed} units × ₹${electricityRate} = ₹${electricityCharge}${cfMsg}\nTotal: ₹${totalAmount}`);
            setSelectedMeterUnit("");
            setCurrentReading("");
            setMeterChanged(false);
            setManualUnitsConsumed("");
            setNewMeterReading("");
        } catch (error) {
            console.error(error);
            alert("Failed to generate invoice.");
        } finally {
            setIsGeneratingInvoice(false);
        }
    };

    const handleSettleInvoice = async (invId: string) => {
        if (!window.confirm("Mark this invoice as paid (cash collected)?")) return;
        setIsSettling(invId);
        try {
            const inv = allInvoices.find((i: any) => i.id === invId);
            await updateDoc(doc(db, "invoices", invId), { status: "paid", paidAt: new Date().toISOString(), transactionId: "CASH_COLLECTED" });
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
                    transactionId: "CASH_COLLECTED",
                    type: "payment",
                    settledBy: "employee",
                    createdAt: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error(error);
            alert("Failed to settle invoice.");
        } finally {
            setIsSettling("");
        }
    };

    const openTenantProfile = (unit: any) => {
        setProfileUnit(unit);
        setProfileName(unit.tenantName || "");
        setProfilePhone(unit.tenantPhone || "");
        setProfileEmail(unit.tenantEmail || "");
        setProfileNote("");
        setIsTenantProfileOpen(true);
    };

    const handleSaveTenantProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profileUnit) return;
        setIsSavingProfile(true);
        try {
            await updateDoc(doc(db, "units", profileUnit.id), { tenantName: profileName, tenantPhone: profilePhone, tenantEmail: profileEmail.toLowerCase() });
            setIsTenantProfileOpen(false); setProfileUnit(null);
        } catch (error) { console.error(error); alert("Failed to update tenant."); } finally { setIsSavingProfile(false); }
    };

    const handleAddNote = async () => {
        if (!profileUnit || !profileNote.trim()) return;
        try {
            await updateDoc(doc(db, "units", profileUnit.id), { notes: arrayUnion({ text: profileNote.trim(), author: "Staff", createdAt: new Date().toISOString() }) });
            setProfileNote("");
            // Refresh profileUnit from occupiedUnits
            const updated = occupiedUnits.find(u => u.id === profileUnit.id);
            if (updated) setProfileUnit({ ...updated });
        } catch (error) { console.error(error); alert("Failed to add note."); }
    };

    const handleUploadTenantDoc = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profileUnit || !profileDocName || !profileDocFile) return;
        setIsUploadingDoc(true);
        try {
            const fileUrl = await uploadFile(`tenant_docs/${profileUnit.id}/${Date.now()}_${profileDocFile.name}`, profileDocFile);
            await updateDoc(doc(db, "units", profileUnit.id), { documents: arrayUnion({ name: profileDocName, url: fileUrl, uploadedAt: new Date().toISOString() }) });
            setProfileDocName(""); setProfileDocFile(null);
        } catch (error) { console.error(error); alert("Failed to upload document."); } finally { setIsUploadingDoc(false); }
    };

    // --- Unit Management Handlers ---
    const vacantUnits = allUnits.filter(u => u.status === "vacant");
    const occupiedForAssign = allUnits.filter(u => u.status === "occupied");

    const handleAssignTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!assignUnit) return;
        if (assignMode === "new") {
            if (!assignName && !assignEmail && !assignPhone) { alert("Please enter at least a name, email, or phone."); return; }
            try {
                await updateDoc(doc(db, "units", assignUnit.id), { status: "occupied", tenantEmail: assignEmail ? assignEmail.toLowerCase() : "", tenantName: assignName, tenantPhone: assignPhone });
                setIsAssignModalOpen(false); setAssignUnit(null); setAssignEmail(""); setAssignName(""); setAssignPhone("");
            } catch (error) { console.error(error); alert("Failed to assign tenant."); }
        } else {
            if (!assignExistingUnit) return;
            const source = occupiedForAssign.find(u => u.id === assignExistingUnit);
            if (!source) return;
            try {
                await updateDoc(doc(db, "units", assignUnit.id), { status: "occupied", tenantEmail: source.tenantEmail, tenantName: source.tenantName || "", tenantPhone: source.tenantPhone || "" });
                setIsAssignModalOpen(false); setAssignUnit(null); setAssignExistingUnit("");
            } catch (error) { console.error(error); alert("Failed to assign tenant."); }
        }
    };

    const handleEditUnit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editUnit || !editUnitNumber || !editBaseRent) return;
        try {
            await updateDoc(doc(db, "units", editUnit.id), { unitNumber: editUnitNumber, baseRent: Number(editBaseRent) });
            setIsEditUnitModalOpen(false); setEditUnit(null);
        } catch (error) { console.error(error); alert("Failed to update unit."); }
    };

    const handleRemoveTenant = async (unitId: string) => {
        if (!window.confirm("Remove this tenant from the unit?")) return;
        try {
            await updateDoc(doc(db, "units", unitId), { status: "vacant", tenantEmail: "", tenantName: "", tenantPhone: "" });
        } catch (error) { console.error(error); alert("Failed to remove tenant."); }
    };

    const handleUnitDocUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!unitDocUnit || !unitDocName || !unitDocFile) return;
        setIsUploadingDoc(true);
        try {
            const fileUrl = await uploadFile(`tenant_docs/${unitDocUnit.id}/${Date.now()}_${unitDocFile.name}`, unitDocFile);
            await updateDoc(doc(db, "units", unitDocUnit.id), { documents: arrayUnion({ name: unitDocName, url: fileUrl, uploadedAt: new Date().toISOString() }) });
            setIsUnitDocModalOpen(false); setUnitDocUnit(null); setUnitDocName(""); setUnitDocFile(null);
        } catch (error) { console.error(error); alert("Failed to upload document."); } finally { setIsUploadingDoc(false); }
    };

    // --- Checklist Handlers ---
    const handleAddRoom = () => {
        setChecklistRooms(prev => [...prev, { room: "", condition: "good", photo: null, damages: "" }]);
    };

    const handleRemoveRoom = (idx: number) => {
        setChecklistRooms(prev => prev.filter((_, i) => i !== idx));
    };

    const handleSubmitChecklist = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!checklistUnit) return;
        setIsSubmittingChecklist(true);
        try {
            const unit = allUnits.find(u => u.id === checklistUnit);
            // Upload all room photos
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
                createdBy: user?.email || ""
            });
            alert(`${checklistType === "move-in" ? "Move-in" : "Move-out"} checklist saved!`);
            setChecklistUnit("");
            setChecklistRooms([{ room: "Living Room", condition: "good", photo: null, damages: "" }]);
            setChecklistNotes("");
            setChecklistDeduction("");
        } catch (error) { console.error(error); alert("Failed to save checklist."); } finally { setIsSubmittingChecklist(false); }
    };

    // --- Multiple Tenants (Co-Tenants) ---
    const handleAddCoTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!coTenantUnit || !coTenantEmail) return;
        try {
            const newCoTenant = { name: coTenantName, phone: coTenantPhone, email: coTenantEmail.toLowerCase(), addedAt: new Date().toISOString() };
            await updateDoc(doc(db, "units", coTenantUnit.id), { coTenants: arrayUnion(newCoTenant) });
            setIsAddCoTenantOpen(false); setCoTenantUnit(null); setCoTenantName(""); setCoTenantPhone(""); setCoTenantEmail("");
        } catch (error) { console.error(error); alert("Failed to add co-tenant."); }
    };

    const handleRemoveCoTenant = async (unitId: string, coTenant: any) => {
        if (!window.confirm(`Remove co-tenant ${coTenant.name || coTenant.email}?`)) return;
        try {
            const unitDoc = allUnits.find(u => u.id === unitId);
            const updatedCoTenants = (unitDoc?.coTenants || []).filter((ct: any) => ct.email !== coTenant.email);
            await updateDoc(doc(db, "units", unitId), { coTenants: updatedCoTenants });
        } catch (error) { console.error(error); alert("Failed to remove co-tenant."); }
    };

    // --- Expense Handlers ---
    const handleAddExpense = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!expenseAmount || !expenseDesc) return;
        setIsSubmittingExpense(true);
        try {
            let receiptUrl = "";
            if (expenseReceipt) {
                receiptUrl = await uploadFile(`expense_receipts/${Date.now()}_${expenseReceipt.name}`, expenseReceipt);
            }
            await addDoc(collection(db, "expenses"), {
                amount: Number(expenseAmount),
                category: expenseCategory,
                description: expenseDesc,
                date: expenseDate || new Date().toISOString().split('T')[0],
                buildingId: expenseBuilding || "",
                buildingName: expenseBuilding ? getBuildingName(expenseBuilding) : "General",
                ...(receiptUrl ? { receiptUrl } : {}),
                createdBy: user?.email || "",
                createdAt: new Date().toISOString()
            });
            setIsExpenseModalOpen(false);
            setExpenseAmount(""); setExpenseDesc(""); setExpenseCategory("Maintenance"); setExpenseDate(""); setExpenseBuilding(""); setExpenseReceipt(null);
            alert("Expense logged!");
        } catch (error) { console.error(error); alert("Failed to log expense."); } finally { setIsSubmittingExpense(false); }
    };

    // --- Inventory Handlers ---
    const handleAddInventory = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!invItemName || !invItemQty) return;
        setIsSubmittingInventory(true);
        try {
            await addDoc(collection(db, "inventory"), {
                name: invItemName,
                quantity: Number(invItemQty),
                buildingId: invItemBuilding || "",
                buildingName: invItemBuilding ? getBuildingName(invItemBuilding) : "General",
                location: invItemLocation,
                condition: invItemCondition,
                notes: invItemNotes,
                createdBy: user?.email || "",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            setIsInventoryModalOpen(false);
            setInvItemName(""); setInvItemQty(""); setInvItemBuilding(""); setInvItemLocation(""); setInvItemCondition("good"); setInvItemNotes("");
            alert("Inventory item added!");
        } catch (error) { console.error(error); alert("Failed to add inventory item."); } finally { setIsSubmittingInventory(false); }
    };

    const handleUpdateInventoryQty = async (itemId: string, newQty: number) => {
        try {
            await updateDoc(doc(db, "inventory", itemId), { quantity: newQty, updatedAt: new Date().toISOString() });
        } catch (error) { console.error(error); alert("Failed to update quantity."); }
    };

    const getBuildingName = (buildingId: string) => {
        const bldg = buildings.find(b => b.id === buildingId);
        return bldg?.name || "Unknown";
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50">Loading...</div>;
    if (!user || role !== "employee") return null;

    return (
        <div className="min-h-screen bg-gray-100 pb-12">
            {/* MOBILE FRIENDLY NAV */}
            <nav className="bg-orange-600 px-4 py-4 flex justify-between items-center text-white shadow-md sticky top-0 z-10">
                <div>
                    <h1 className="text-xl font-bold tracking-tight">Staff Portal</h1>
                    <p className="text-xs text-orange-200">{user.email}</p>
                </div>
                <button onClick={handleLogout} className="text-sm bg-orange-700 hover:bg-orange-800 px-3 py-2 rounded-md font-medium transition shadow-sm">
                    Log Out
                </button>
                <Link href="/employee/help" className="text-sm bg-orange-700 hover:bg-orange-800 px-3 py-2 rounded-md font-medium transition shadow-sm">
                    ❓ Help
                </Link>
            </nav>

            <main className="p-4 max-w-2xl mx-auto space-y-6 mt-2">

                {/* TABS */}
                <div className="flex flex-wrap bg-gray-200 rounded-lg p-1 shadow-inner gap-1">
                    <button
                        onClick={() => setActiveTab("collections")}
                        className={`flex-1 min-w-[80px] py-2.5 text-xs font-bold rounded-md transition ${activeTab === "collections" ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500"}`}
                    >
                        Collections
                    </button>
                    <button
                        onClick={() => setActiveTab("active")}
                        className={`flex-1 min-w-[80px] py-2.5 text-xs font-bold rounded-md transition ${activeTab === "active" ? "bg-white text-orange-600 shadow-sm" : "text-gray-500"}`}
                    >
                        Tasks ({activeTickets.length})
                    </button>
                    <button
                        onClick={() => setActiveTab("meter")}
                        className={`flex-1 min-w-[80px] py-2.5 text-xs font-bold rounded-md transition ${activeTab === "meter" ? "bg-white text-purple-600 shadow-sm" : "text-gray-500"}`}
                    >
                        Meter
                    </button>
                    <button
                        onClick={() => setActiveTab("resolved")}
                        className={`flex-1 min-w-[80px] py-2.5 text-xs font-bold rounded-md transition ${activeTab === "resolved" ? "bg-white text-green-600 shadow-sm" : "text-gray-500"}`}
                    >
                        Done
                    </button>
                    <button
                        onClick={() => setActiveTab("ledger")}
                        className={`flex-1 min-w-[80px] py-2.5 text-xs font-bold rounded-md transition ${activeTab === "ledger" ? "bg-white text-teal-600 shadow-sm" : "text-gray-500"}`}
                    >
                        Ledger
                    </button>
                    <button
                        onClick={() => setActiveTab("units")}
                        className={`flex-1 min-w-[80px] py-2.5 text-xs font-bold rounded-md transition ${activeTab === "units" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500"}`}
                    >
                        Units
                    </button>
                    <button
                        onClick={() => setActiveTab("occupancy")}
                        className={`flex-1 min-w-[80px] py-2.5 text-xs font-bold rounded-md transition ${activeTab === "occupancy" ? "bg-white text-emerald-600 shadow-sm" : "text-gray-500"}`}
                    >
                        📊 Occupancy
                    </button>
                    <button
                        onClick={() => setActiveTab("checklist")}
                        className={`flex-1 min-w-[80px] py-2.5 text-xs font-bold rounded-md transition ${activeTab === "checklist" ? "bg-white text-pink-600 shadow-sm" : "text-gray-500"}`}
                    >
                        📋 Checklist
                    </button>
                    <button
                        onClick={() => setActiveTab("expenses")}
                        className={`flex-1 min-w-[80px] py-2.5 text-xs font-bold rounded-md transition ${activeTab === "expenses" ? "bg-white text-amber-600 shadow-sm" : "text-gray-500"}`}
                    >
                        💰 Expenses
                    </button>
                    <button
                        onClick={() => setActiveTab("inventory")}
                        className={`flex-1 min-w-[80px] py-2.5 text-xs font-bold rounded-md transition ${activeTab === "inventory" ? "bg-white text-cyan-600 shadow-sm" : "text-gray-500"}`}
                    >
                        📦 Inventory
                    </button>
                </div>

                {/* COLLECTIONS TAB */}
                {activeTab === "collections" && (() => {
                    const pendingInvoices = allInvoices.filter(inv => inv.status === "unpaid" || inv.status === "pending");
                    const periods = [...new Set(pendingInvoices.map(inv => inv.billingPeriod).filter(Boolean))].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

                    const filteredInvoices = collectionFilter === "all"
                        ? pendingInvoices
                        : pendingInvoices.filter(inv => inv.billingPeriod === collectionFilter);

                    const totalPendingRent = filteredInvoices.reduce((sum, inv) => sum + Number(inv.baseRent || 0), 0);
                    const totalPendingElec = filteredInvoices.reduce((sum, inv) => sum + Number(inv.electricityCharge || 0), 0);

                    return (
                        <div className="space-y-4">
                            {/* Filter */}
                            <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Billing Period</label>
                                <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg font-medium">
                                    <option value="all">All Pending ({pendingInvoices.length})</option>
                                    {periods.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>

                            {/* Summary */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                                    <p className="text-xs font-bold text-red-600 uppercase">Pending Rent</p>
                                    <p className="text-xl font-bold text-red-800 mt-1">₹{totalPendingRent.toLocaleString()}</p>
                                </div>
                                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                                    <p className="text-xs font-bold text-yellow-600 uppercase">Pending Electricity</p>
                                    <p className="text-xl font-bold text-yellow-800 mt-1">₹{totalPendingElec.toLocaleString()}</p>
                                </div>
                            </div>

                            {/* Invoice List */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex justify-between items-center">
                                    <h3 className="text-sm font-bold text-gray-800">Pending Invoices</h3>
                                    <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">{filteredInvoices.length} pending</span>
                                </div>
                                <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                                    {filteredInvoices.length === 0 ? (
                                        <p className="p-6 text-sm text-gray-500 text-center">🎉 No pending invoices!</p>
                                    ) : (
                                        filteredInvoices.map(inv => (
                                            <div key={inv.id} className="px-5 py-4 flex justify-between items-center hover:bg-gray-50">
                                                <div>
                                                    <p className="font-bold text-gray-900">{inv.unitNumber}</p>
                                                    <p className="text-xs text-gray-500">{inv.tenantEmail}</p>
                                                    <p className="text-xs text-indigo-600 font-medium mt-0.5">{inv.billingPeriod}</p>
                                                    <button onClick={() => { const unit = occupiedUnits.find(u => u.id === inv.unitId); if (unit) openTenantProfile(unit); }} className="text-[10px] text-indigo-600 hover:underline mt-1">View Profile →</button>
                                                </div>
                                                <div className="text-right flex flex-col items-end gap-2">
                                                    <div>
                                                        <p className="font-bold text-gray-900">₹{Number(inv.totalAmount || 0).toLocaleString()}</p>
                                                        <p className="text-[10px] text-gray-400">Rent: ₹{inv.baseRent || 0} | Elec: ₹{inv.electricityCharge || 0}</p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleSettleInvoice(inv.id)}
                                                        disabled={isSettling === inv.id}
                                                        className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-md font-bold hover:bg-green-700 disabled:bg-green-400 transition"
                                                    >
                                                        {isSettling === inv.id ? "..." : "✓ Settle"}
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* METER READING TAB */}
                {activeTab === "meter" && (
                    <div className="bg-white rounded-xl shadow-sm border border-purple-200 overflow-hidden">
                        <div className="bg-purple-50 px-5 py-4 border-b border-purple-100">
                            <h2 className="text-lg font-bold text-purple-800">⚡ Record Meter Reading & Generate Invoice</h2>
                            <p className="text-xs text-purple-600 mt-1">Enter the current meter reading to calculate the electricity bill (₹{electricityRate}/unit)</p>
                        </div>
                        <form onSubmit={handleGenerateMeterInvoice} className="p-5 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Select Unit</label>
                                <select required value={selectedMeterUnit} onChange={(e) => setSelectedMeterUnit(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg">
                                    <option value="" disabled>Choose an occupied unit...</option>
                                    {occupiedUnits.map(u => (
                                        <option key={u.id} value={u.id}>{u.unitNumber} — {u.tenantEmail} (Last: {u.lastMeterReading || 0})</option>
                                    ))}
                                </select>
                            </div>
                            {selectedMeterUnit && (() => {
                                const u = occupiedUnits.find(x => x.id === selectedMeterUnit);
                                if (!u) return null;
                                return (
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
                                        <p><strong>Unit:</strong> {u.unitNumber} | <strong>Tenant:</strong> {u.tenantEmail}</p>
                                        <p><strong>Last Meter Reading:</strong> {u.lastMeterReading || 0} | <strong>Base Rent:</strong> ₹{u.baseRent || 0}</p>
                                    </div>
                                );
                            })()}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Billing Month</label>
                                <input type="month" required value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" />
                            </div>

                            {/* Meter Changed Toggle */}
                            <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                <input type="checkbox" id="meterChanged" checked={meterChanged} onChange={(e) => setMeterChanged(e.target.checked)} className="w-4 h-4 accent-yellow-600" />
                                <label htmlFor="meterChanged" className="text-sm text-yellow-800 font-medium cursor-pointer">⚠️ Meter was changed / replaced</label>
                            </div>

                            {!meterChanged ? (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Current Meter Reading</label>
                                    <input type="number" required min="0" value={currentReading} onChange={(e) => setCurrentReading(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="e.g. 1250" />
                                </div>
                            ) : (
                                <div className="space-y-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                    <p className="text-xs text-yellow-700 font-medium">Enter units consumed manually (from old + new meter final readings)</p>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Units Consumed</label>
                                        <input type="number" required min="0" value={manualUnitsConsumed} onChange={(e) => setManualUnitsConsumed(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="e.g. 120" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">New Meter Reading (starting reading of new meter)</label>
                                        <input type="number" min="0" value={newMeterReading} onChange={(e) => setNewMeterReading(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg" placeholder="e.g. 0 or starting value" />
                                        <p className="text-xs text-gray-500 mt-1">This will be saved as the last reading for next month</p>
                                    </div>
                                </div>
                            )}

                            {/* Live Preview */}
                            {selectedMeterUnit && (meterChanged ? manualUnitsConsumed : currentReading) && (() => {
                                const unit = occupiedUnits.find(u => u.id === selectedMeterUnit);
                                if (!unit) return null;
                                const prev = Number(unit.lastMeterReading) || 0;
                                const consumed = meterChanged ? Number(manualUnitsConsumed) : Math.max(0, Number(currentReading) - prev);
                                const elecCharge = consumed * electricityRate;
                                const total = Number(unit.baseRent || 0) + elecCharge;
                                return (
                                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
                                        <p className="font-bold text-gray-800 text-base">Invoice Preview</p>
                                        {meterChanged ? (
                                            <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-800 mb-2">⚠️ Meter changed — units entered manually</div>
                                        ) : (
                                            <>
                                                <div className="flex justify-between"><span className="text-gray-600">Previous Reading:</span><span className="font-mono">{prev}</span></div>
                                                <div className="flex justify-between"><span className="text-gray-600">Current Reading:</span><span className="font-mono">{Number(currentReading)}</span></div>
                                            </>
                                        )}
                                        <div className="flex justify-between"><span className="text-gray-600">Units Consumed:</span><span className="font-mono font-bold">{consumed}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-600">Electricity (×₹{electricityRate}):</span><span className="font-mono">₹{elecCharge}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-600">Base Rent:</span><span className="font-mono">₹{unit.baseRent || 0}</span></div>
                                        <div className="flex justify-between border-t border-gray-300 pt-2 mt-2"><span className="font-bold text-gray-900">Total Invoice:</span><span className="font-bold text-lg text-green-700">₹{total}</span></div>
                                    </div>
                                );
                            })()}

                            <button type="submit" disabled={isGeneratingInvoice} className="w-full py-3 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 transition shadow-sm disabled:bg-purple-400">
                                {isGeneratingInvoice ? "Generating..." : "Generate Invoice"}
                            </button>
                        </form>
                    </div>
                )}

                {/* LEDGER TAB */}
                {activeTab === "ledger" && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="bg-teal-50 px-5 py-4 border-b border-teal-200">
                            <h2 className="text-lg font-bold text-teal-800">📒 Tenant Payment Ledger</h2>
                        </div>
                        <div className="p-5 space-y-4">
                            <select value={ledgerFilter} onChange={(e) => setLedgerFilter(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                                <option value="">All Tenants</option>
                                {[...new Set(allLedgerEntries.map(e => e.tenantEmail))].map(email => {
                                    const u = occupiedUnits.find(u => u.tenantEmail === email);
                                    return <option key={email} value={email}>{u ? u.unitNumber + ' - ' : ''}{email}</option>;
                                })}
                            </select>
                            {(() => {
                                const filtered = ledgerFilter ? allLedgerEntries.filter(e => e.tenantEmail === ledgerFilter) : allLedgerEntries;
                                if (filtered.length === 0) return <p className="text-sm text-gray-500 text-center py-4">No payment records yet.</p>;
                                const tenantBalances: Record<string, { email: string; unitNumber: string; balance: number; count: number }> = {};
                                filtered.forEach(entry => {
                                    if (!tenantBalances[entry.tenantEmail]) tenantBalances[entry.tenantEmail] = { email: entry.tenantEmail, unitNumber: entry.unitNumber, balance: 0, count: 0 };
                                    tenantBalances[entry.tenantEmail].balance += Number(entry.balance || 0);
                                    tenantBalances[entry.tenantEmail].count++;
                                });
                                return !ledgerFilter ? (
                                    <div className="space-y-2">
                                        {Object.values(tenantBalances).map(t => (
                                            <div key={t.email} className="flex justify-between items-center border border-gray-100 p-3 rounded-md bg-gray-50 hover:bg-gray-100 cursor-pointer" onClick={() => setLedgerFilter(t.email)}>
                                                <div><p className="font-medium text-gray-800 text-sm">{t.unitNumber}</p><p className="text-xs text-gray-500">{t.email}</p></div>
                                                <div className="text-right"><span className={`font-bold text-sm ${t.balance >= 0 ? 'text-green-700' : 'text-red-700'}`}>{t.balance >= 0 ? `₹${t.balance} CR` : `₹${Math.abs(t.balance)} DUE`}</span><p className="text-[10px] text-gray-400">{t.count} payments</p></div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div>
                                        <div className={`mb-3 p-3 rounded-lg border ${tenantBalances[ledgerFilter]?.balance >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                            <div className="flex justify-between items-center"><span className="text-sm font-medium">Net Balance</span><span className={`font-bold ${tenantBalances[ledgerFilter]?.balance >= 0 ? 'text-green-700' : 'text-red-700'}`}>{tenantBalances[ledgerFilter]?.balance >= 0 ? `₹${tenantBalances[ledgerFilter]?.balance} Credit` : `₹${Math.abs(tenantBalances[ledgerFilter]?.balance || 0)} Due`}</span></div>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                                <thead><tr className="border-b text-gray-500"><th className="pb-1 text-left">Date</th><th className="pb-1 text-left">Period</th><th className="pb-1 text-right">Invoice</th><th className="pb-1 text-right">Paid</th><th className="pb-1 text-right">Bal</th></tr></thead>
                                                <tbody>{filtered.map(entry => (<tr key={entry.id} className="border-b border-gray-100"><td className="py-1.5">{new Date(entry.createdAt).toLocaleDateString()}</td><td className="py-1.5">{entry.billingPeriod}</td><td className="py-1.5 text-right">₹{entry.invoiceAmount}</td><td className="py-1.5 text-right text-green-700">₹{entry.amountPaid}</td><td className={`py-1.5 text-right font-bold ${Number(entry.balance) >= 0 ? 'text-green-700' : 'text-red-700'}`}>{Number(entry.balance) >= 0 ? '+' : ''}₹{entry.balance}</td></tr>))}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* UNITS TAB */}
                {activeTab === "units" && (
                    <div className="space-y-3">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="bg-blue-50 px-5 py-4 border-b border-blue-200">
                                <h2 className="text-lg font-bold text-blue-800">🏠 Buildings & Units</h2>
                                <p className="text-xs text-blue-600 mt-1">{vacantUnits.length} vacant · {occupiedForAssign.length} occupied · {buildings.length} buildings</p>
                            </div>
                            <div className="p-4 space-y-2">
                                {buildings.length === 0 ? (
                                    <p className="text-sm text-gray-500 text-center py-8">No buildings found.</p>
                                ) : (
                                    buildings.map(bldg => {
                                        const bldgUnits = allUnits.filter(u => u.buildingId === bldg.id);
                                        const bldgVacant = bldgUnits.filter(u => u.status === "vacant");
                                        const isExpanded = expandedBuildings.includes(bldg.id);
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
                                                    <div className="p-3 space-y-2 border-t border-gray-100 bg-white">
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
                                                                            <p className="text-xs text-gray-500 mt-0.5">Rent: ₹{unit.baseRent || 8000}/mo</p>
                                                                            {unit.tenantEmail && (
                                                                                <div className="mt-1.5 text-xs text-gray-600">
                                                                                    <p>👤 {unit.tenantName || "—"} · {unit.tenantEmail}</p>
                                                                                    {unit.tenantPhone && <p>📞 {unit.tenantPhone}</p>}
                                                                                    {/* Co-tenants display */}
                                                                                    {unit.coTenants && unit.coTenants.length > 0 && (
                                                                                        <div className="mt-1 pl-2 border-l-2 border-indigo-200">
                                                                                            <p className="text-[10px] font-bold text-indigo-600 uppercase">Co-tenants ({unit.coTenants.length})</p>
                                                                                            {unit.coTenants.map((ct: any, i: number) => (
                                                                                                <div key={i} className="flex items-center gap-1 mt-0.5">
                                                                                                    <span className="text-[10px] text-gray-600">👤 {ct.name || ct.email}</span>
                                                                                                    <button onClick={() => handleRemoveCoTenant(unit.id, ct)} className="text-[10px] text-red-400 hover:text-red-600">✕</button>
                                                                                                </div>
                                                                                            ))}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex flex-col gap-1.5 shrink-0">
                                                                            <button onClick={() => { setEditUnit(unit); setEditUnitNumber(unit.unitNumber); setEditBaseRent(String(unit.baseRent || 8000)); setIsEditUnitModalOpen(true); }} className="text-xs text-blue-600 hover:underline">✏️ Edit</button>
                                                                            {unit.status === "vacant" ? (
                                                                                <button onClick={() => { setAssignUnit(unit); setAssignMode("new"); setAssignEmail(""); setAssignName(""); setAssignPhone(""); setAssignExistingUnit(""); setIsAssignModalOpen(true); }} className="text-xs bg-green-600 text-white px-2 py-1 rounded-md font-medium hover:bg-green-700">+ Assign</button>
                                                                            ) : (
                                                                                <>
                                                                                    <button onClick={() => handleRemoveTenant(unit.id)} className="text-xs text-red-500 hover:underline">Remove</button>
                                                                                    <button onClick={() => { setUnitDocUnit(unit); setUnitDocName(""); setUnitDocFile(null); setIsUnitDocModalOpen(true); }} className="text-xs text-purple-600 hover:underline">📄 Doc</button>
                                                                                    <button onClick={() => { setCoTenantUnit(unit); setCoTenantName(""); setCoTenantPhone(""); setCoTenantEmail(""); setIsAddCoTenantOpen(true); }} className="text-xs text-indigo-600 hover:underline">👥 Add</button>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    {unit.documents && unit.documents.length > 0 && (
                                                                        <div className="mt-2 pt-2 border-t border-gray-100">
                                                                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Documents</p>
                                                                            {unit.documents.map((d: any, i: number) => (
                                                                                <a key={i} href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline block">📎 {d.name}</a>
                                                                            ))}
                                                                        </div>
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
                )}

                {/* OCCUPANCY DASHBOARD TAB */}
                {activeTab === "occupancy" && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-xl shadow-sm border border-emerald-200 overflow-hidden">
                            <div className="bg-emerald-50 px-5 py-4 border-b border-emerald-200">
                                <h2 className="text-lg font-bold text-emerald-800">📊 Occupancy Dashboard</h2>
                                <p className="text-xs text-emerald-600 mt-1">Visual overview of occupancy across all buildings</p>
                            </div>
                            <div className="p-5 space-y-5">
                                {/* Overall Stats */}
                                {(() => {
                                    const totalUnits = allUnits.length;
                                    const occupiedCount = allUnits.filter(u => u.status === "occupied").length;
                                    const vacantCount = totalUnits - occupiedCount;
                                    const overallRate = totalUnits > 0 ? Math.round((occupiedCount / totalUnits) * 100) : 0;
                                    return (
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
                                    );
                                })()}

                                {/* Per-building breakdown */}
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
                                                {/* Progress Bar */}
                                                <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                                                    <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${rate}%` }}></div>
                                                </div>
                                                <div className="flex justify-between mt-1.5 text-[10px] text-gray-500">
                                                    <span>{bldgOccupied} occupied</span>
                                                    <span>{bldgTotal - bldgOccupied} vacant</span>
                                                    <span>{bldgTotal} total</span>
                                                </div>
                                                {/* Vacant unit list */}
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
                )}

                {/* CHECKLIST TAB */}
                {activeTab === "checklist" && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-xl shadow-sm border border-pink-200 overflow-hidden">
                            <div className="bg-pink-50 px-5 py-4 border-b border-pink-200">
                                <h2 className="text-lg font-bold text-pink-800">📋 Move-in / Move-out Checklist</h2>
                                <p className="text-xs text-pink-600 mt-1">Photographic room inspection with damage tracking</p>
                            </div>
                            <form onSubmit={handleSubmitChecklist} className="p-5 space-y-4">
                                {/* Type */}
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => setChecklistType("move-in")} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition ${checklistType === "move-in" ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600"}`}>🏠 Move-In</button>
                                    <button type="button" onClick={() => setChecklistType("move-out")} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition ${checklistType === "move-out" ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600"}`}>📦 Move-Out</button>
                                </div>

                                {/* Unit Selection */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Select Unit</label>
                                    <select required value={checklistUnit} onChange={(e) => setChecklistUnit(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg">
                                        <option value="" disabled>Choose a unit...</option>
                                        {(checklistType === "move-in" ? allUnits : occupiedUnits).map(u => (
                                            <option key={u.id} value={u.id}>{u.unitNumber} — {u.tenantEmail || "Vacant"} ({getBuildingName(u.buildingId)})</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Rooms */}
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

                                {/* Deduction for move-out */}
                                {checklistType === "move-out" && (
                                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                        <label className="block text-sm font-medium text-red-700 mb-1">Security Deposit Deduction (₹)</label>
                                        <input type="number" min="0" value={checklistDeduction} onChange={(e) => setChecklistDeduction(e.target.value)} className="w-full px-3 py-2 border border-red-300 rounded-lg" placeholder="0 if no deduction" />
                                        <p className="text-[10px] text-red-500 mt-1">Amount to deduct from security deposit for damages</p>
                                    </div>
                                )}

                                {/* Notes */}
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

                        {/* Past Checklists */}
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
                )}

                {/* EXPENSES TAB */}
                {activeTab === "expenses" && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden">
                            <div className="bg-amber-50 px-5 py-4 border-b border-amber-200 flex justify-between items-center">
                                <div>
                                    <h2 className="text-lg font-bold text-amber-800">💰 Expense Tracker</h2>
                                    <p className="text-xs text-amber-600 mt-1">Log maintenance, supplies & other expenses</p>
                                </div>
                                <button onClick={() => { setIsExpenseModalOpen(true); setExpenseDate(new Date().toISOString().split('T')[0]); }} className="text-sm bg-amber-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-amber-700 transition">+ Add</button>
                            </div>
                            <div className="p-4 space-y-4">
                                {/* Summary */}
                                {(() => {
                                    const thisMonth = new Date().toISOString().slice(0, 7);
                                    const monthExpenses = allExpenses.filter(e => (e.date || e.createdAt || "").startsWith(thisMonth));
                                    const monthTotal = monthExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
                                    const allTotal = allExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
                                    return (
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                                                <p className="text-[10px] font-bold text-amber-600 uppercase">This Month</p>
                                                <p className="text-xl font-bold text-amber-800">₹{monthTotal.toLocaleString()}</p>
                                                <p className="text-[10px] text-amber-500">{monthExpenses.length} entries</p>
                                            </div>
                                            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                                                <p className="text-[10px] font-bold text-gray-600 uppercase">All Time</p>
                                                <p className="text-xl font-bold text-gray-800">₹{allTotal.toLocaleString()}</p>
                                                <p className="text-[10px] text-gray-500">{allExpenses.length} entries</p>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Expense List */}
                                <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                                    {allExpenses.length === 0 ? (
                                        <p className="text-sm text-gray-500 text-center py-6">No expenses logged yet.</p>
                                    ) : allExpenses.map(exp => (
                                        <div key={exp.id} className="py-3 flex justify-between items-start">
                                            <div>
                                                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{exp.category}</span>
                                                <p className="font-medium text-gray-900 text-sm mt-1">{exp.description}</p>
                                                <p className="text-[10px] text-gray-500">{exp.buildingName || "General"} · {exp.date || new Date(exp.createdAt).toLocaleDateString()}</p>
                                                {exp.createdBy && <p className="text-[10px] text-gray-400">by {exp.createdBy}</p>}
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="font-bold text-red-700">₹{Number(exp.amount).toLocaleString()}</p>
                                                {exp.receiptUrl && <a href={exp.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:underline">📎 Receipt</a>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* INVENTORY TAB */}
                {activeTab === "inventory" && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-xl shadow-sm border border-cyan-200 overflow-hidden">
                            <div className="bg-cyan-50 px-5 py-4 border-b border-cyan-200 flex justify-between items-center">
                                <div>
                                    <h2 className="text-lg font-bold text-cyan-800">📦 Building Inventory</h2>
                                    <p className="text-xs text-cyan-600 mt-1">Track items, supplies & equipment</p>
                                </div>
                                <button onClick={() => setIsInventoryModalOpen(true)} className="text-sm bg-cyan-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-cyan-700 transition">+ Add Item</button>
                            </div>
                            <div className="p-4 space-y-4">
                                {/* Filter */}
                                <select value={inventoryFilter} onChange={(e) => setInventoryFilter(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                                    <option value="">All Buildings</option>
                                    {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>

                                {/* Inventory List */}
                                <div className="space-y-2">
                                    {(() => {
                                        const filtered = inventoryFilter ? allInventory.filter(i => i.buildingId === inventoryFilter) : allInventory;
                                        if (filtered.length === 0) return <p className="text-sm text-gray-500 text-center py-6">No inventory items yet.</p>;
                                        return filtered.map(item => (
                                            <div key={item.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <h4 className="font-bold text-gray-900 text-sm">{item.name}</h4>
                                                        <p className="text-[10px] text-gray-500">{item.buildingName || "General"}{item.location ? ` · ${item.location}` : ""}</p>
                                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded mt-1 inline-block ${item.condition === "good" ? "bg-green-100 text-green-700" : item.condition === "fair" ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>{item.condition}</span>
                                                        {item.notes && <p className="text-[10px] text-gray-500 mt-1">{item.notes}</p>}
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <button onClick={() => handleUpdateInventoryQty(item.id, Math.max(0, Number(item.quantity) - 1))} className="w-7 h-7 bg-gray-200 rounded-md font-bold text-gray-700 hover:bg-gray-300">−</button>
                                                        <span className="text-lg font-bold text-gray-900 min-w-[30px] text-center">{item.quantity}</span>
                                                        <button onClick={() => handleUpdateInventoryQty(item.id, Number(item.quantity) + 1)} className="w-7 h-7 bg-cyan-100 rounded-md font-bold text-cyan-700 hover:bg-cyan-200">+</button>
                                                    </div>
                                                </div>
                                                <p className="text-[10px] text-gray-400 mt-1">Updated: {new Date(item.updatedAt || item.createdAt).toLocaleDateString()}</p>
                                            </div>
                                        ));
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* TICKET LIST */}
                {activeTab !== "meter" && activeTab !== "collections" && activeTab !== "ledger" && activeTab !== "units" && activeTab !== "occupancy" && activeTab !== "checklist" && activeTab !== "expenses" && activeTab !== "inventory" && (
                <div className="space-y-4">
                    {(activeTab === "active" ? activeTickets : resolvedTickets).length === 0 ? (
                        <div className="bg-white p-8 rounded-xl shadow-sm text-center border border-gray-200 mt-8">
                            <span className="text-4xl mb-3 block">🎉</span>
                            <p className="text-gray-600 font-medium">No tasks in this queue!</p>
                        </div>
                    ) : (
                        (activeTab === "active" ? activeTickets : resolvedTickets).map(ticket => (
                            <div key={ticket.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${ticket.status === 'resolved' ? 'border-green-200' : 'border-orange-200'}`}>

                                {/* Header */}
                                <div className={`px-4 py-3 border-b flex justify-between items-center ${ticket.status === 'resolved' ? 'bg-green-50 border-green-100' : 'bg-orange-50 border-orange-100'}`}>
                                    <div>
                                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{ticket.category}</span>
                                        <h3 className="font-bold text-gray-900 text-lg">Unit {ticket.unitNumber}</h3>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${ticket.status === 'pending' ? 'bg-red-100 text-red-800' :
                                            ticket.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                                                'bg-green-100 text-green-800'
                                        }`}>
                                        {ticket.status.toUpperCase()}
                                    </span>
                                </div>

                                {/* Body */}
                                <div className="p-4 space-y-4">
                                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-sm text-gray-700">
                                        <p className="font-semibold mb-1 text-gray-900">Issue Description:</p>
                                        {ticket.description}
                                    </div>

                                    {ticket.photoUrl && (
                                        <a href={ticket.photoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded-md hover:bg-blue-100 font-medium w-full justify-center border border-blue-200 transition">
                                            📷 View Tenant Photo
                                        </a>
                                    )}

                                    {/* Actions (Only for Active Tickets) */}
                                    {ticket.status !== 'resolved' && (
                                        <div className="pt-2 flex flex-col sm:flex-row gap-3">
                                            {ticket.status === 'pending' && (
                                                <button
                                                    onClick={() => handleMarkInProgress(ticket.id)}
                                                    className="w-full py-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-bold hover:bg-blue-100 transition shadow-sm"
                                                >
                                                    Start Work (In-Progress)
                                                </button>
                                            )}

                                            <button
                                                onClick={() => { setSelectedTicket(ticket); setIsResolveModalOpen(true); }}
                                                className="w-full py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition shadow-sm flex items-center justify-center gap-2"
                                            >
                                                ✅ Mark as Resolved
                                            </button>
                                        </div>
                                    )}

                                    {/* Proof of Resolution (Only for Resolved Tickets) */}
                                    {ticket.status === 'resolved' && ticket.resolutionPhotoUrl && (
                                        <div className="pt-2 border-t border-gray-100 mt-4">
                                            <p className="text-xs font-bold text-gray-500 uppercase mb-2">Resolution Proof</p>
                                            <img src={ticket.resolutionPhotoUrl} alt="Fixed" className="w-full h-48 object-cover rounded-lg border border-gray-200" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
                )}
            </main>

            {/* RESOLVE MODAL */}
            {isResolveModalOpen && selectedTicket && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fade-in-up">
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">Resolve Issue</h2>
                        <p className="text-sm text-gray-500 mb-6">Unit {selectedTicket.unitNumber} • {selectedTicket.category}</p>

                        <form onSubmit={handleResolveSubmit} className="space-y-5">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Upload Proof of Fix (Required) 📸</label>
                                <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:bg-gray-50 transition cursor-pointer relative">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        required
                                        onChange={(e) => setResolutionFile(e.target.files ? e.target.files[0] : null)}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    {resolutionFile ? (
                                        <span className="text-sm font-bold text-green-600">✅ {resolutionFile.name} selected</span>
                                    ) : (
                                        <span className="text-sm text-gray-500 font-medium">Tap to open camera or gallery</span>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Completion Notes (Optional)</label>
                                <textarea
                                    rows={3}
                                    value={resolutionNote}
                                    onChange={(e) => setResolutionNote(e.target.value)}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none resize-none"
                                    placeholder="e.g. Replaced the P-trap under the sink..."
                                ></textarea>
                            </div>

                            <div className="flex flex-col gap-3 mt-8">
                                {isUploading && <UploadProgressBar progress={uploadProgress} />}
                                <button
                                    type="submit"
                                    disabled={isSubmitting || isUploading}
                                    className="w-full py-4 bg-green-600 text-white rounded-xl font-bold text-lg hover:bg-green-700 shadow-md disabled:bg-green-400 transition"
                                >
                                    {isSubmitting ? "Uploading..." : "Submit Resolution"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setIsResolveModalOpen(false); setResolutionFile(null); setResolutionNote(""); }}
                                    disabled={isSubmitting}
                                    className="w-full py-4 text-gray-600 hover:bg-gray-100 rounded-xl font-bold transition"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* TENANT PROFILE MODAL */}
            {isTenantProfileOpen && profileUnit && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center p-4 z-50 overflow-y-auto">
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-md shadow-2xl my-8">
                        <h2 className="text-xl font-bold mb-1">👤 {profileUnit.unitNumber} — Tenant Profile</h2>
                        <p className="text-sm text-gray-500 mb-5">Edit details, manage documents, and add notes.</p>

                        {/* Edit Details */}
                        <form onSubmit={handleSaveTenantProfile} className="space-y-3 mb-5">
                            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label><input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone</label><input type="tel" value={profilePhone} onChange={(e) => setProfilePhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label><input type="email" required value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                            <button type="submit" disabled={isSavingProfile} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:bg-indigo-400">{isSavingProfile ? "Saving..." : "Save Details"}</button>
                        </form>

                        {/* Documents */}
                        <div className="border-t border-gray-200 pt-4 mb-4">
                            <h3 className="text-sm font-bold text-gray-800 mb-2">📄 Documents</h3>
                            {profileUnit.documents && profileUnit.documents.length > 0 ? (
                                <ul className="space-y-1 max-h-28 overflow-y-auto mb-3">
                                    {profileUnit.documents.map((d: any, i: number) => (
                                        <li key={i}><a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">📄 {d.name}</a></li>
                                    ))}
                                </ul>
                            ) : (<p className="text-xs text-gray-400 italic mb-3">No documents.</p>)}
                            <form onSubmit={handleUploadTenantDoc} className="flex gap-2 items-end">
                                <div className="flex-1">
                                    <input type="text" value={profileDocName} onChange={(e) => setProfileDocName(e.target.value)} placeholder="Doc name" required className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs mb-1" />
                                    <input type="file" accept="image/*,.pdf" required onChange={(e) => setProfileDocFile(e.target.files ? e.target.files[0] : null)} className="w-full text-xs text-gray-500" />
                                </div>
                                <button type="submit" disabled={isUploadingDoc} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 disabled:bg-blue-400">{isUploadingDoc ? "..." : "Upload"}</button>
                            </form>
                        </div>

                        {/* Notes */}
                        <div className="border-t border-gray-200 pt-4">
                            <h3 className="text-sm font-bold text-gray-800 mb-2">📝 Notes</h3>
                            <div className="max-h-32 overflow-y-auto space-y-2 mb-3">
                                {profileUnit.notes && profileUnit.notes.length > 0 ? (
                                    profileUnit.notes.map((n: any, i: number) => (
                                        <div key={i} className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs">
                                            <p className="text-gray-800">{n.text}</p>
                                            <p className="text-gray-400 mt-1">{n.author} • {new Date(n.createdAt).toLocaleDateString()}</p>
                                        </div>
                                    ))
                                ) : (<p className="text-xs text-gray-400 italic">No notes yet.</p>)}
                            </div>
                            <div className="flex gap-2">
                                <input type="text" value={profileNote} onChange={(e) => setProfileNote(e.target.value)} placeholder="Add a note..." className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                                <button onClick={handleAddNote} disabled={!profileNote.trim()} className="px-4 py-2 bg-yellow-500 text-white rounded-lg text-sm font-bold hover:bg-yellow-600 disabled:bg-yellow-300">Add</button>
                            </div>
                        </div>

                        <button onClick={() => { setIsTenantProfileOpen(false); setProfileUnit(null); }} className="w-full mt-5 py-3 text-gray-600 hover:bg-gray-100 rounded-xl font-bold transition">Close</button>
                    </div>
                </div>
            )}

            {/* ASSIGN TENANT MODAL */}
            {isAssignModalOpen && assignUnit && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setIsAssignModalOpen(false)}>
                    <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800">Assign Tenant to {assignUnit.unitNumber}</h3>
                        <div className="flex gap-2">
                            <button onClick={() => setAssignMode("new")} className={`flex-1 py-2 rounded-md text-sm font-medium ${assignMode === "new" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>New Tenant</button>
                            <button onClick={() => setAssignMode("existing")} className={`flex-1 py-2 rounded-md text-sm font-medium ${assignMode === "existing" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>Existing Tenant</button>
                        </div>
                        <form onSubmit={handleAssignTenant} className="space-y-3">
                            {assignMode === "new" ? (
                                <>
                                    <input type="text" placeholder="Tenant Email (optional)" value={assignEmail} onChange={(e) => setAssignEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                    <input type="text" placeholder="Tenant Name" value={assignName} onChange={(e) => setAssignName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                    <input type="text" placeholder="Phone Number" value={assignPhone} onChange={(e) => setAssignPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                </>
                            ) : (
                                <select required value={assignExistingUnit} onChange={(e) => setAssignExistingUnit(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                                    <option value="">Select existing tenant...</option>
                                    {occupiedForAssign.map(u => (
                                        <option key={u.id} value={u.id}>{u.unitNumber} — {u.tenantName || u.tenantEmail}</option>
                                    ))}
                                </select>
                            )}
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setIsAssignModalOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                                <button type="submit" className="flex-1 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700">Assign Tenant</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* EDIT UNIT MODAL */}
            {isEditUnitModalOpen && editUnit && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setIsEditUnitModalOpen(false)}>
                    <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800">Edit Unit</h3>
                        <form onSubmit={handleEditUnit} className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Unit Name</label>
                                <input type="text" required value={editUnitNumber} onChange={(e) => setEditUnitNumber(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Base Rent (₹)</label>
                                <input type="number" required value={editBaseRent} onChange={(e) => setEditBaseRent(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setIsEditUnitModalOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                                <button type="submit" className="flex-1 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700">Save Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* UNIT DOCUMENT UPLOAD MODAL */}
            {isUnitDocModalOpen && unitDocUnit && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setIsUnitDocModalOpen(false)}>
                    <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800">Upload Document for {unitDocUnit.unitNumber}</h3>
                        <p className="text-xs text-gray-500">{unitDocUnit.tenantName || unitDocUnit.tenantEmail}</p>
                        <form onSubmit={handleUnitDocUpload} className="space-y-3">
                            <input type="text" required placeholder="Document Name (e.g. Aadhaar, Lease)" value={unitDocName} onChange={(e) => setUnitDocName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            <input type="file" required accept="image/*,.pdf" onChange={(e) => setUnitDocFile(e.target.files ? e.target.files[0] : null)} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700" />
                            {isUploading && <UploadProgressBar progress={uploadProgress} />}
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setIsUnitDocModalOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                                <button type="submit" disabled={isUploadingDoc || isUploading} className="flex-1 py-2 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 disabled:bg-purple-300">{isUploadingDoc ? "Uploading..." : "Upload Document"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ADD CO-TENANT MODAL */}
            {isAddCoTenantOpen && coTenantUnit && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setIsAddCoTenantOpen(false)}>
                    <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800">👥 Add Co-Tenant to {coTenantUnit.unitNumber}</h3>
                        <p className="text-xs text-gray-500">Primary: {coTenantUnit.tenantName || coTenantUnit.tenantEmail}</p>
                        {coTenantUnit.coTenants && coTenantUnit.coTenants.length > 0 && (
                            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                                <p className="text-[10px] font-bold text-indigo-600 uppercase mb-1">Current Co-tenants</p>
                                {coTenantUnit.coTenants.map((ct: any, i: number) => (
                                    <p key={i} className="text-xs text-gray-700">• {ct.name || ct.email} {ct.phone ? `(${ct.phone})` : ""}</p>
                                ))}
                            </div>
                        )}
                        <form onSubmit={handleAddCoTenant} className="space-y-3">
                            <input type="email" required placeholder="Co-tenant Email *" value={coTenantEmail} onChange={(e) => setCoTenantEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            <input type="text" placeholder="Co-tenant Name" value={coTenantName} onChange={(e) => setCoTenantName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            <input type="text" placeholder="Phone Number" value={coTenantPhone} onChange={(e) => setCoTenantPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setIsAddCoTenantOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                                <button type="submit" className="flex-1 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700">Add Co-Tenant</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ADD EXPENSE MODAL */}
            {isExpenseModalOpen && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setIsExpenseModalOpen(false)}>
                    <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800">💰 Log Expense</h3>
                        <form onSubmit={handleAddExpense} className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Amount (₹) *</label>
                                <input type="number" required min="1" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. 500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Category</label>
                                <select value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                                    <option>Maintenance</option>
                                    <option>Plumbing</option>
                                    <option>Electrical</option>
                                    <option>Cleaning</option>
                                    <option>Supplies</option>
                                    <option>Painting</option>
                                    <option>Security</option>
                                    <option>Water</option>
                                    <option>Common Area</option>
                                    <option>Other</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Building</label>
                                <select value={expenseBuilding} onChange={(e) => setExpenseBuilding(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                                    <option value="">General (All Buildings)</option>
                                    {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description *</label>
                                <textarea required value={expenseDesc} onChange={(e) => setExpenseDesc(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="What was the expense for?" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Date</label>
                                <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Receipt Photo (Optional)</label>
                                <input type="file" accept="image/*,.pdf" onChange={(e) => setExpenseReceipt(e.target.files?.[0] || null)} className="w-full text-sm text-gray-500" />
                            </div>
                            {isUploading && <UploadProgressBar progress={uploadProgress} />}
                            <div className="flex gap-2 pt-2">
                                <button type="button" onClick={() => setIsExpenseModalOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                                <button type="submit" disabled={isSubmittingExpense || isUploading} className="flex-1 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:bg-amber-400">{isSubmittingExpense ? "Saving..." : "Log Expense"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ADD INVENTORY MODAL */}
            {isInventoryModalOpen && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setIsInventoryModalOpen(false)}>
                    <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800">📦 Add Inventory Item</h3>
                        <form onSubmit={handleAddInventory} className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Item Name *</label>
                                <input type="text" required value={invItemName} onChange={(e) => setInvItemName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. Water Pump, Fire Extinguisher" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Quantity *</label>
                                <input type="number" required min="0" value={invItemQty} onChange={(e) => setInvItemQty(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. 5" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Building</label>
                                <select value={invItemBuilding} onChange={(e) => setInvItemBuilding(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                                    <option value="">General (Shared)</option>
                                    {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Location / Area</label>
                                <input type="text" value={invItemLocation} onChange={(e) => setInvItemLocation(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. Store room, Terrace" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Condition</label>
                                <select value={invItemCondition} onChange={(e) => setInvItemCondition(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                                    <option value="good">✅ Good</option>
                                    <option value="fair">⚠️ Fair</option>
                                    <option value="poor">❌ Poor / Needs Replacement</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notes</label>
                                <textarea value={invItemNotes} onChange={(e) => setInvItemNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Any details..." />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button type="button" onClick={() => setIsInventoryModalOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                                <button type="submit" disabled={isSubmittingInventory} className="flex-1 py-2 bg-cyan-600 text-white rounded-md text-sm font-medium hover:bg-cyan-700 disabled:bg-cyan-400">{isSubmittingInventory ? "Saving..." : "Add Item"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}