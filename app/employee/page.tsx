"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, doc, updateDoc, arrayUnion, query, where, writeBatch, getDocs, addDoc, deleteField } from "firebase/firestore";
import { useUploadWithProgress, UploadProgressBar } from "@/lib/useUpload";
import { mapSnapshot } from "@/lib/firestore";
import type {
    Allocation,
    Building,
    Checklist,
    DailyLedgerEntry,
    Expense,
    InventoryItem,
    Invoice,
    LedgerEntry,
    MaintenanceTicket,
    Unit,
} from "@/types";
import { CollectionsTab, OccupancyTab, LedgerTab, TicketsTab, MeterTab, ExpensesTab, InventoryTab, DailyLedgerTab, MonthlyOverviewTab, MonthCollectionsCard } from "@/components/employee";
import { TabButton } from "@/components/ui";

export default function EmployeeDashboard() {
    const { user, role, loading } = useAuth();
    const router = useRouter();
    const { uploadFile, uploadProgress, isUploading } = useUploadWithProgress();

    const [activeTickets, setActiveTickets] = useState<MaintenanceTicket[]>([]);
    const [resolvedTickets, setResolvedTickets] = useState<MaintenanceTicket[]>([]);
    const [activeTab, setActiveTab] = useState<"home" | "active" | "resolved" | "meter" | "collections" | "ledger" | "daily" | "monthly" | "units" | "occupancy" | "checklist" | "expenses" | "inventory">("home");

    // Meter Reading States
    const [occupiedUnits, setOccupiedUnits] = useState<Unit[]>([]);
    const [electricityRate] = useState(12); // ₹12 per unit consumed

    // Collections States
    const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
    const [isTodayCollectionsOpen, setIsTodayCollectionsOpen] = useState(false);
    const [homeMonth, setHomeMonth] = useState<string>(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });

    // Tenant Profile States
    const [isTenantProfileOpen, setIsTenantProfileOpen] = useState(false);
    const [profileUnit, setProfileUnit] = useState<Unit | null>(null);
    const [profileName, setProfileName] = useState("");
    const [profilePhone, setProfilePhone] = useState("");
    const [profileEmail, setProfileEmail] = useState("");
    const [profileNote, setProfileNote] = useState("");
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileDocName, setProfileDocName] = useState("");
    const [profileDocFile, setProfileDocFile] = useState<File | null>(null);
    const [isUploadingDoc, setIsUploadingDoc] = useState(false);

    // Ledger state
    const [allLedgerEntries, setAllLedgerEntries] = useState<LedgerEntry[]>([]);

    // Unit Management States
    const [allUnits, setAllUnits] = useState<Unit[]>([]);
    const [buildings, setBuildings] = useState<Building[]>([]);
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [assignUnit, setAssignUnit] = useState<Unit | null>(null);
    const [assignEmail, setAssignEmail] = useState("");
    const [assignName, setAssignName] = useState("");
    const [assignPhone, setAssignPhone] = useState("");
    const [assignMode, setAssignMode] = useState<"new" | "existing">("new");
    const [assignExistingUnit, setAssignExistingUnit] = useState("");
    const [assignPaymentDay, setAssignPaymentDay] = useState("");
    const [assignSecurityDeposit, setAssignSecurityDeposit] = useState("");
    const [isEditUnitModalOpen, setIsEditUnitModalOpen] = useState(false);
    const [editUnit, setEditUnit] = useState<Unit | null>(null);
    const [editUnitNumber, setEditUnitNumber] = useState("");
    const [editBaseRent, setEditBaseRent] = useState("");
    const [unitDocUnit, setUnitDocUnit] = useState<Unit | null>(null);
    const [unitDocName, setUnitDocName] = useState("");
    const [unitDocFile, setUnitDocFile] = useState<File | null>(null);
    const [isUnitDocModalOpen, setIsUnitDocModalOpen] = useState(false);
    const [expandedBuildings, setExpandedBuildings] = useState<string[]>([]);

    // Transfer Tenant States
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [transferSourceUnit, setTransferSourceUnit] = useState<Unit | null>(null);
    const [transferDestUnit, setTransferDestUnit] = useState("");
    const [transferDate, setTransferDate] = useState(() => new Date().toISOString().split("T")[0]);
    const [transferInvoiceMode, setTransferInvoiceMode] = useState<"prorate" | "custom" | "none">("prorate");
    const [transferCustomAmount, setTransferCustomAmount] = useState("");
    const [transferCustomNote, setTransferCustomNote] = useState("");
    const [transferLastReading, setTransferLastReading] = useState("");
    const [isTransferring, setIsTransferring] = useState(false);

    // Units Search
    const [unitSearch, setUnitSearch] = useState("");

    // Global Tenant Search
    const [globalSearch, setGlobalSearch] = useState("");
    const [isGlobalSearchFocused, setIsGlobalSearchFocused] = useState(false);

    // Move-in/Move-out Checklist States
    const [checklistType, setChecklistType] = useState<"move-in" | "move-out">("move-in");
    const [checklistUnit, setChecklistUnit] = useState("");
    const [checklistRooms, setChecklistRooms] = useState<{ room: string; condition: string; photo: File | null; photoUrl?: string; damages: string }[]>([{ room: "Living Room", condition: "good", photo: null, damages: "" }]);
    const [checklistNotes, setChecklistNotes] = useState("");
    const [isSubmittingChecklist, setIsSubmittingChecklist] = useState(false);
    const [allChecklists, setAllChecklists] = useState<Checklist[]>([]);
    const [checklistDeduction, setChecklistDeduction] = useState("");

    // Multiple Tenants States
    const [isAddCoTenantOpen, setIsAddCoTenantOpen] = useState(false);
    const [coTenantUnit, setCoTenantUnit] = useState<Unit | null>(null);
    const [coTenantName, setCoTenantName] = useState("");
    const [coTenantPhone, setCoTenantPhone] = useState("");
    const [coTenantEmail, setCoTenantEmail] = useState("");

    // Expense States
    const [allExpenses, setAllExpenses] = useState<Expense[]>([]);

    // Allocation (Fund) States
    const [allAllocations, setAllAllocations] = useState<Allocation[]>([]);

    // Daily Ledger States
    const [dailyLedgerEntries, setDailyLedgerEntries] = useState<DailyLedgerEntry[]>([]);

    // Inventory States
    const [allInventory, setAllInventory] = useState<InventoryItem[]>([]);

    // Report Issue States
    // Comment on ticket States
    // (Ticket state + handlers moved into components/employee/TicketsTab.tsx)

    useEffect(() => {
        if (!loading && (!user || role !== "employee")) {
            router.push("/");
        }
        if (role === "employee") document.title = "Employee Portal | Property Manager";
    }, [user, role, loading, router]);

    useEffect(() => {
        if (role !== "employee") return;

        const unsubTickets = onSnapshot(collection(db, "maintenance"), (snapshot) => {
            const allTickets = mapSnapshot<MaintenanceTicket>(snapshot);

            // Sort newest first
            allTickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            setActiveTickets(allTickets.filter(t => t.status !== "resolved"));
            setResolvedTickets(allTickets.filter(t => t.status === "resolved"));
        });

        const unsubUnits = onSnapshot(query(collection(db, "units"), where("status", "==", "occupied")), (snapshot) => {
            setOccupiedUnits(mapSnapshot<Unit>(snapshot).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })));
        });

        const unsubInvoices = onSnapshot(collection(db, "invoices"), (snapshot) => {
            setAllInvoices(mapSnapshot<Invoice>(snapshot));
        });

        const unsubLedger = onSnapshot(collection(db, "ledger"), (snapshot) => {
            setAllLedgerEntries(mapSnapshot<LedgerEntry>(snapshot).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        });

        const unsubAllUnits = onSnapshot(collection(db, "units"), (snapshot) => {
            setAllUnits(mapSnapshot<Unit>(snapshot).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })));
        });

        const unsubBuildings = onSnapshot(collection(db, "buildings"), (snapshot) => {
            setBuildings(mapSnapshot<Building>(snapshot));
        });

        const unsubChecklists = onSnapshot(collection(db, "checklists"), (snapshot) => {
            setAllChecklists(mapSnapshot<Checklist>(snapshot).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        });

        const unsubExpenses = onSnapshot(collection(db, "expenses"), (snapshot) => {
            setAllExpenses(mapSnapshot<Expense>(snapshot).filter(e => !e.deleted).sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()));
        });

        const unsubInventory = onSnapshot(collection(db, "inventory"), (snapshot) => {
            setAllInventory(mapSnapshot<InventoryItem>(snapshot).sort((a, b) => (a.name || "").localeCompare(b.name || "")));
        });

        const unsubAllocations = onSnapshot(collection(db, "allocations"), (snapshot) => {
            setAllAllocations(mapSnapshot<Allocation>(snapshot).sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()));
        });

        const unsubDailyLedger = onSnapshot(collection(db, "dailyLedger"), (snapshot) => {
            setDailyLedgerEntries(mapSnapshot<DailyLedgerEntry>(snapshot).filter(e => !e.deleted).sort((a, b) => (b.date || "").localeCompare(a.date || "")));
        });

        return () => { unsubTickets(); unsubUnits(); unsubInvoices(); unsubLedger(); unsubAllUnits(); unsubBuildings(); unsubChecklists(); unsubExpenses(); unsubInventory(); unsubAllocations(); unsubDailyLedger(); };
    }, [role]);

    const handleLogout = async () => {
        await signOut(auth);
        router.push("/");
    };

    const openTenantProfile = (unit: Unit) => {
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
                await updateDoc(doc(db, "units", assignUnit.id), {
                    status: "occupied",
                    tenantEmail: assignEmail ? assignEmail.toLowerCase() : "",
                    tenantName: assignName,
                    tenantPhone: assignPhone,
                    moveInDate: new Date().toISOString(),
                    ...(assignPaymentDay ? { paymentDay: Number(assignPaymentDay) } : {}),
                    ...(assignSecurityDeposit ? { securityDeposit: Number(assignSecurityDeposit), securityDepositDate: new Date().toISOString() } : {})
                });
                setIsAssignModalOpen(false); setAssignUnit(null); setAssignEmail(""); setAssignName(""); setAssignPhone(""); setAssignPaymentDay(""); setAssignSecurityDeposit("");
            } catch (error) { console.error(error); alert("Failed to assign tenant."); }
        } else {
            if (!assignExistingUnit) return;
            const source = occupiedForAssign.find(u => u.id === assignExistingUnit);
            if (!source) return;
            try {
                await updateDoc(doc(db, "units", assignUnit.id), { status: "occupied", tenantEmail: source.tenantEmail, tenantName: source.tenantName || "", tenantPhone: source.tenantPhone || "", moveInDate: new Date().toISOString() });
                setIsAssignModalOpen(false); setAssignUnit(null); setAssignExistingUnit("");
            } catch (error) { console.error(error); alert("Failed to assign tenant."); }
        }
    };

    const handleEditUnit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editUnit || !editUnitNumber || !editBaseRent) return;
        try {
            await updateDoc(doc(db, "units", editUnit.id), { unitNumber: editUnitNumber, baseRent: Number(editBaseRent) });

            // Update unit name in active invoices if it changed
            if (editUnitNumber !== editUnit.unitNumber) {
                const activeInvSnap = await getDocs(query(collection(db, "invoices"), where("unitId", "==", editUnit.id), where("status", "in", ["unpaid", "pending"])));
                const batch = writeBatch(db);
                activeInvSnap.docs.forEach(d => batch.update(d.ref, { unitNumber: editUnitNumber }));
                if (activeInvSnap.docs.length > 0) await batch.commit();
            }

            setIsEditUnitModalOpen(false); setEditUnit(null);
        } catch (error) { console.error(error); alert("Failed to update unit."); }
    };

    const handleRemoveTenant = async (unitId: string) => {
        const unit = allUnits.find(u => u.id === unitId);
        const deposit = unit?.securityDeposit ? Number(unit.securityDeposit) : 0;
        const deduction = unit?.lastChecklistDeduction ? Number(unit.lastChecklistDeduction) : 0;
        const refund = Math.max(0, deposit - deduction);

        let msg = "Remove this tenant from the unit?";
        if (deposit > 0) {
            msg = `Remove tenant from ${unit?.unitNumber}?\n\n💰 Security Deposit: ₹${deposit.toLocaleString()}${deduction > 0 ? `\n⚠️ Deduction: ₹${deduction.toLocaleString()}` : ""}\n✅ Refund Due: ₹${refund.toLocaleString()}\n\nMake sure to return the security deposit to the tenant.`;
        }
        if (!window.confirm(msg)) return;
        try {
            // Save tenant history before clearing
            const historyEntry = {
                tenantName: unit?.tenantName || "",
                tenantEmail: unit?.tenantEmail || "",
                tenantPhone: unit?.tenantPhone || "",
                moveInDate: unit?.moveInDate || "",
                moveOutDate: new Date().toISOString(),
                securityDeposit: deposit,
                securityRefund: refund,
                coTenants: unit?.coTenants || []
            };
            await updateDoc(doc(db, "units", unitId), {
                tenantHistory: arrayUnion(historyEntry),
                status: "vacant",
                tenantEmail: "",
                tenantName: "",
                tenantPhone: "",
                moveInDate: "",
                paymentDay: "",
                securityDeposit: "",
                securityDepositDate: "",
                lastChecklistDeduction: "",
                coTenants: []
            });
            if (deposit > 0) {
                alert(`✅ Tenant removed.\n\n💰 Please return ₹${refund.toLocaleString()} security deposit to the tenant.`);
            }
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

    // --- Transfer Tenant Handler ---
    const openTransferModal = (unit: Unit) => {
        setTransferSourceUnit(unit);
        setTransferDestUnit("");
        setTransferDate(new Date().toISOString().split("T")[0]);
        setTransferInvoiceMode("prorate");
        setTransferCustomAmount("");
        setTransferCustomNote("");
        setTransferLastReading(String(unit.lastMeterReading || 0));
        setIsTransferModalOpen(true);
    };

    const handleTransferTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!transferSourceUnit || !transferDestUnit) return;
        const destUnit = allUnits.find(u => u.id === transferDestUnit);
        if (!destUnit) return;
        if (destUnit.status === "occupied") { alert("Destination unit is already occupied."); return; }

        setIsTransferring(true);
        try {
            const batch = writeBatch(db);
            const now = new Date().toISOString();
            const tDate = new Date(transferDate);

            // --- Generate invoice for old unit ---
            if (transferInvoiceMode !== "none") {
                const monthName = tDate.toLocaleString("default", { month: "long", year: "numeric" });
                const invoiceId = `inv_${transferSourceUnit.id}_transfer_${transferDate}`;

                let totalAmount: number;
                let invoiceData: Record<string, unknown> = {
                    unitId: transferSourceUnit.id,
                    unitNumber: transferSourceUnit.unitNumber,
                    tenantEmail: transferSourceUnit.tenantEmail || "",
                    billingPeriod: `${monthName} (Transfer)`,
                    status: "unpaid",
                    transactionId: "",
                    isCustom: true,
                    createdAt: now,
                    manualUnitsReason: `Room transfer on ${transferDate}`,
                };

                if (transferInvoiceMode === "prorate") {
                    // Pro-rate: days in month tenant stayed
                    const daysInMonth = new Date(tDate.getFullYear(), tDate.getMonth() + 1, 0).getDate();
                    const moveIn = transferSourceUnit.moveInDate ? new Date(transferSourceUnit.moveInDate) : new Date(tDate.getFullYear(), tDate.getMonth(), 1);
                    const startOfMonth = new Date(tDate.getFullYear(), tDate.getMonth(), 1);
                    const effectiveStart = moveIn > startOfMonth ? moveIn : startOfMonth;
                    const daysStayed = Math.max(1, Math.ceil((tDate.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)));
                    const proratedRent = Math.round((Number(transferSourceUnit.baseRent || 0) / daysInMonth) * daysStayed);

                    // Electricity: if last reading provided, use difference
                    const prevReading = Number(transferSourceUnit.lastMeterReading || 0);
                    const currReading = transferLastReading ? Number(transferLastReading) : prevReading;
                    const unitsConsumed = Math.max(0, currReading - prevReading);
                    const transferRate = Number(transferSourceUnit.electricityRate) > 0 ? Number(transferSourceUnit.electricityRate) : electricityRate;
                    const elecCharge = unitsConsumed * transferRate;

                    totalAmount = proratedRent + elecCharge;
                    invoiceData = {
                        ...invoiceData,
                        baseRent: proratedRent,
                        previousReading: prevReading,
                        currentReading: currReading,
                        electricityConsumed: unitsConsumed,
                        electricityRate: transferRate,
                        electricityCharge: elecCharge,
                        totalAmount,
                    };
                } else {
                    // Custom amount
                    totalAmount = Number(transferCustomAmount) || 0;
                    invoiceData = {
                        ...invoiceData,
                        baseRent: totalAmount,
                        electricityCharge: 0,
                        electricityConsumed: 0,
                        totalAmount,
                        manualUnitsReason: transferCustomNote || `Custom transfer invoice — ${transferDate}`,
                    };
                }

                batch.set(doc(db, "invoices", invoiceId), invoiceData);
            }

            // --- Add tenant history to source unit ---
            const historyEntry = {
                tenantName: transferSourceUnit.tenantName || "",
                tenantEmail: transferSourceUnit.tenantEmail || "",
                tenantPhone: transferSourceUnit.tenantPhone || "",
                moveInDate: transferSourceUnit.moveInDate || "",
                moveOutDate: now,
                securityDeposit: Number(transferSourceUnit.securityDeposit || 0),
                securityRefund: 0,
                coTenants: transferSourceUnit.coTenants || [],
                note: `Transferred to ${destUnit.unitNumber}`
            };

            // --- Clear source unit ---
            batch.update(doc(db, "units", transferSourceUnit.id), {
                tenantHistory: arrayUnion(historyEntry),
                status: "vacant",
                tenantEmail: "",
                tenantName: "",
                tenantPhone: "",
                moveInDate: "",
                paymentDay: "",
                coTenants: [],
            });

            // --- Assign tenant to destination unit ---
            batch.update(doc(db, "units", transferDestUnit), {
                status: "occupied",
                tenantEmail: transferSourceUnit.tenantEmail || "",
                tenantName: transferSourceUnit.tenantName || "",
                tenantPhone: transferSourceUnit.tenantPhone || "",
                moveInDate: transferDate,
                paymentDay: transferSourceUnit.paymentDay || "",
                securityDeposit: transferSourceUnit.securityDeposit || "",
                securityDepositDate: transferSourceUnit.securityDepositDate || "",
                coTenants: transferSourceUnit.coTenants || [],
            });

            await batch.commit();
            alert(`✅ Tenant transferred from ${transferSourceUnit.unitNumber} → ${destUnit.unitNumber}${transferInvoiceMode !== "none" ? "\n📄 Invoice generated for old unit." : ""}`);
            setIsTransferModalOpen(false);
            setTransferSourceUnit(null);
        } catch (error) {
            console.error(error);
            alert("Failed to transfer tenant.");
        } finally {
            setIsTransferring(false);
        }
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
        if (!coTenantUnit || (!coTenantEmail && !coTenantName && !coTenantPhone)) { alert("Please enter at least a name, email, or phone."); return; }
        try {
            const newCoTenant = { name: coTenantName, phone: coTenantPhone, email: coTenantEmail ? coTenantEmail.toLowerCase() : "", addedAt: new Date().toISOString() };
            await updateDoc(doc(db, "units", coTenantUnit.id), { coTenants: arrayUnion(newCoTenant) });
            setIsAddCoTenantOpen(false); setCoTenantUnit(null); setCoTenantName(""); setCoTenantPhone(""); setCoTenantEmail("");
        } catch (error) { console.error(error); alert("Failed to add co-tenant."); }
    };

    const handleRemoveCoTenant = async (unitId: string, coTenant: { addedAt: string; name?: string; email?: string; phone?: string }) => {
        if (!window.confirm(`Remove co-tenant ${coTenant.name || coTenant.email || coTenant.phone}?`)) return;
        try {
            const unitDoc = allUnits.find(u => u.id === unitId);
            const updatedCoTenants = (unitDoc?.coTenants || []).filter((ct) => ct.addedAt !== coTenant.addedAt);
            await updateDoc(doc(db, "units", unitId), { coTenants: updatedCoTenants });
        } catch (error) { console.error(error); alert("Failed to remove co-tenant."); }
    };

    // --- Inventory Handlers ---
    // (moved into components/employee/InventoryTab.tsx)

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

                {/* GLOBAL TENANT SEARCH */}
                <div className="relative">
                    <input
                        type="text"
                        placeholder="🔍 Quick search tenant by name or phone..."
                        value={globalSearch}
                        onChange={(e) => setGlobalSearch(e.target.value)}
                        onFocus={() => setIsGlobalSearchFocused(true)}
                        onBlur={() => setTimeout(() => setIsGlobalSearchFocused(false), 200)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm shadow-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none bg-white"
                    />
                    {globalSearch.trim() && isGlobalSearchFocused && (() => {
                        const q = globalSearch.toLowerCase().trim();
                        const results = allUnits.filter(u => u.status === "occupied" && ((u.tenantName && u.tenantName.toLowerCase().includes(q)) || (u.tenantPhone && u.tenantPhone.includes(q)) || (u.tenantEmail && u.tenantEmail.toLowerCase().includes(q)) || (u.unitNumber && u.unitNumber.toLowerCase().includes(q))));
                        return results.length > 0 ? (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-40 max-h-64 overflow-y-auto">
                                {results.map(u => (
                                    <button key={u.id} onClick={() => { openTenantProfile(u); setGlobalSearch(""); }} className="w-full px-4 py-3 flex justify-between items-center hover:bg-orange-50 border-b border-gray-100 last:border-0 text-left">
                                        <div>
                                            <p className="font-bold text-gray-900 text-sm">{u.tenantName || u.tenantEmail || "—"}</p>
                                            <p className="text-[10px] text-gray-500">{u.unitNumber} {u.tenantPhone ? `· ${u.tenantPhone}` : ""}</p>
                                        </div>
                                        <span className="text-xs text-orange-600 font-medium">View →</span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-40 p-4 text-center">
                                <p className="text-sm text-gray-500">No tenants found for &quot;{globalSearch}&quot;</p>
                            </div>
                        );
                    })()}
                </div>

                {/* TABS */}
                {(() => {
                    const pendingCount = allInvoices.filter(inv => inv.status === "unpaid" || inv.status === "pending").length;
                    const currentMonthLabel = new Date().toLocaleString("default", { month: "long", year: "numeric" });
                    const unitsNeedingMeter = occupiedUnits.filter(u => !allInvoices.some(inv => inv.unitId === u.id && inv.billingPeriod === currentMonthLabel)).length;
                    const thisMonthExpenses = allExpenses.filter(exp => { const d = new Date(exp.date || exp.createdAt); const now = new Date(); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
                    return (
                    <div className="flex flex-wrap bg-gray-200 rounded-lg p-1 shadow-inner gap-1">
                        <TabButton label="🏠 Home" isActive={activeTab === "home"} onClick={() => setActiveTab("home")} activeColor="text-gray-800" />
                        <TabButton label={`Collections${pendingCount > 0 ? ` (${pendingCount})` : ""}`} isActive={activeTab === "collections"} onClick={() => setActiveTab("collections")} activeColor="text-indigo-600" />
                        <TabButton label={`Tasks (${activeTickets.length})`} isActive={activeTab === "active"} onClick={() => setActiveTab("active")} activeColor="text-orange-600" />
                        <TabButton label={`Meter${unitsNeedingMeter > 0 ? ` (${unitsNeedingMeter})` : ""}`} isActive={activeTab === "meter"} onClick={() => setActiveTab("meter")} activeColor="text-purple-600" />
                        <TabButton label={`Done (${resolvedTickets.length})`} isActive={activeTab === "resolved"} onClick={() => setActiveTab("resolved")} activeColor="text-green-600" />
                        <TabButton label="Ledger" isActive={activeTab === "ledger"} onClick={() => setActiveTab("ledger")} activeColor="text-teal-600" />
                        <TabButton label="📓 Daily" isActive={activeTab === "daily"} onClick={() => setActiveTab("daily")} activeColor="text-teal-700" />
                        <TabButton label="🏘 Monthly" isActive={activeTab === "monthly"} onClick={() => setActiveTab("monthly")} activeColor="text-emerald-700" />
                        <TabButton label="Units" isActive={activeTab === "units"} onClick={() => setActiveTab("units")} activeColor="text-blue-600" />
                        <TabButton label="📊 Occupancy" isActive={activeTab === "occupancy"} onClick={() => setActiveTab("occupancy")} activeColor="text-emerald-600" />
                        <TabButton label="📋 Checklist" isActive={activeTab === "checklist"} onClick={() => setActiveTab("checklist")} activeColor="text-pink-600" />
                        <TabButton label={`💰 Expenses${thisMonthExpenses > 0 ? ` (${thisMonthExpenses})` : ""}`} isActive={activeTab === "expenses"} onClick={() => setActiveTab("expenses")} activeColor="text-amber-600" />
                        <TabButton label="📦 Inventory" isActive={activeTab === "inventory"} onClick={() => setActiveTab("inventory")} activeColor="text-cyan-600" />
                    </div>
                    );
                })()}

                {/* HOME / DAILY SUMMARY TAB */}
                {activeTab === "home" && (() => {
                    const pendingInvoices = allInvoices.filter(inv => inv.status === "unpaid" || inv.status === "pending");
                    const totalPendingAmount = pendingInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);

                    // Overdue: billing period is a past month
                    const now = new Date();
                    const overdueInvoices = pendingInvoices.filter(inv => {
                        if (!inv.billingPeriod) return false;
                        const periodDate = new Date(inv.billingPeriod);
                        return periodDate.getFullYear() < now.getFullYear() || (periodDate.getFullYear() === now.getFullYear() && periodDate.getMonth() < now.getMonth());
                    });

                    // Units without invoices for current month
                    const currentMonthName = now.toLocaleString("default", { month: "long", year: "numeric" });
                    const unitsWithInvoice = new Set(allInvoices.filter(inv => inv.billingPeriod === currentMonthName).map(inv => inv.unitId));
                    const unitsPendingMeter = occupiedUnits.filter(u => !unitsWithInvoice.has(u.id));

                    // Today's collections
                    const today = now.toISOString().split("T")[0];
                    const todayCollections = allInvoices.filter(inv => inv.status === "paid" && inv.paidAt && inv.paidAt.startsWith(today));
                    const todayCollectedAmount = todayCollections.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);

                    return (
                        <div className="space-y-4">
                            {/* Greeting */}
                            <div className="bg-linear-to-r from-orange-500 to-amber-500 rounded-xl p-5 text-white shadow-md">
                                <h2 className="text-lg font-bold">👋 Good {now.getHours() < 12 ? "Morning" : now.getHours() < 17 ? "Afternoon" : "Evening"}!</h2>
                                <p className="text-sm text-orange-100 mt-1">{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                            </div>

                            {/* Key Metrics */}
                            <div className="grid grid-cols-2 gap-3">
                                <button onClick={() => setActiveTab("collections")} className="bg-white border border-red-200 rounded-xl p-4 text-left hover:shadow-md transition">
                                    <p className="text-[10px] font-bold text-red-600 uppercase">Pending Collections</p>
                                    <p className="text-2xl font-bold text-red-800 mt-1">₹{totalPendingAmount.toLocaleString()}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">{pendingInvoices.length} invoices</p>
                                </button>
                                <button type="button" onClick={() => setIsTodayCollectionsOpen(true)} disabled={todayCollections.length === 0} className="bg-white border border-green-200 rounded-xl p-4 text-left hover:shadow-md transition disabled:cursor-default disabled:hover:shadow-none">
                                    <p className="text-[10px] font-bold text-green-600 uppercase">Collected Today</p>
                                    <p className="text-2xl font-bold text-green-800 mt-1">₹{todayCollectedAmount.toLocaleString()}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">{todayCollections.length} payments{todayCollections.length > 0 ? " · tap to view" : ""}</p>
                                </button>
                                <button onClick={() => setActiveTab("active")} className="bg-white border border-orange-200 rounded-xl p-4 text-left hover:shadow-md transition">
                                    <p className="text-[10px] font-bold text-orange-600 uppercase">Active Tasks</p>
                                    <p className="text-2xl font-bold text-orange-800 mt-1">{activeTickets.length}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">maintenance tickets</p>
                                </button>
                                <button onClick={() => setActiveTab("units")} className="bg-white border border-blue-200 rounded-xl p-4 text-left hover:shadow-md transition">
                                    <p className="text-[10px] font-bold text-blue-600 uppercase">Occupancy</p>
                                    <p className="text-2xl font-bold text-blue-800 mt-1">{occupiedUnits.length}/{allUnits.length}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">{vacantUnits.length} vacant</p>
                                </button>
                            </div>

                            {/* MONTHLY COLLECTIONS & PENDING (picker) */}
                            <MonthCollectionsCard
                                homeMonth={homeMonth}
                                setHomeMonth={setHomeMonth}
                                allInvoices={allInvoices}
                            />

                            {/* PREVIOUS MONTH BALANCE — tenants with unpaid/partial for month PRIOR to selected */}
                            {(() => {
                                const [yr, mo] = homeMonth.split("-").map(Number);
                                const prev = new Date(yr, mo - 2, 1); // one month before selected
                                const prevLabel = prev.toLocaleString("default", { month: "long", year: "numeric" });
                                const isSameBillingPeriod = (bp: string | undefined) => {
                                    if (!bp) return false;
                                    const base = bp.replace(/\s*\(.+\)\s*$/, "").trim();
                                    return base === prevLabel;
                                };
                                const outstanding = allInvoices
                                    .filter(inv => isSameBillingPeriod(inv.billingPeriod))
                                    .map(inv => {
                                        const total = Number(inv.totalAmount || 0);
                                        const paid = Number(inv.amountPaid || 0);
                                        const remaining = Math.max(0, total - paid);
                                        return { inv, total, paid, remaining, isPartial: paid > 0 && paid < total, isUnpaid: paid <= 0 && remaining > 0 };
                                    })
                                    .filter(x => x.remaining > 0)
                                    .sort((a, b) => String(a.inv.unitNumber || "").localeCompare(String(b.inv.unitNumber || ""), undefined, { numeric: true, sensitivity: "base" }));
                                const totalOutstanding = outstanding.reduce((s, x) => s + x.remaining, 0);
                                if (outstanding.length === 0) return null;
                                return (
                                    <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden">
                                        <div className="bg-amber-50 px-4 py-3 border-b border-amber-200 flex justify-between items-center">
                                            <div>
                                                <h3 className="text-sm font-bold text-amber-800">⚠️ Previous Month Balance — {prevLabel}</h3>
                                                <p className="text-[10px] text-amber-600 mt-0.5">{outstanding.length} tenant{outstanding.length !== 1 ? "s" : ""} carrying dues</p>
                                            </div>
                                            <span className="text-base font-bold text-amber-800">₹{totalOutstanding.toLocaleString()}</span>
                                        </div>
                                        <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                                            {outstanding.map(({ inv, total, paid, remaining, isPartial }) => {
                                                const rent = Number(inv.baseRent || 0);
                                                const elec = Number(inv.electricityCharge || 0);
                                                const rRent = Math.max(0, rent - Math.min(paid, rent));
                                                const rElec = Math.max(0, elec - Math.max(0, paid - rent));
                                                const u = occupiedUnits.find(x => x.id === inv.unitId);
                                                return (
                                                    <button key={inv.id} onClick={() => { if (u) openTenantProfile(u); }} disabled={!u} className="w-full text-left px-4 py-3 hover:bg-amber-50 transition disabled:cursor-default flex justify-between items-start gap-3">
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="font-bold text-gray-900 text-sm">{inv.unitNumber}</span>
                                                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${isPartial ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{isPartial ? "Partial" : "Unpaid"}</span>
                                                            </div>
                                                            <p className="text-[11px] text-gray-600 mt-0.5 truncate">{inv.tenantEmail || "—"}</p>
                                                            <p className="text-[10px] text-gray-500 mt-0.5">🏠 Rent ₹{rRent.toLocaleString()} · ⚡ Elec ₹{rElec.toLocaleString()}</p>
                                                            {isPartial && <p className="text-[10px] text-amber-700 mt-0.5">Paid ₹{paid.toLocaleString()} of ₹{total.toLocaleString()}</p>}
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <p className="font-bold text-amber-800 text-base">₹{remaining.toLocaleString()}</p>
                                                            <p className="text-[10px] text-gray-400">due</p>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <button onClick={() => setActiveTab("collections")} className="w-full text-center text-xs font-bold text-amber-700 py-2 bg-amber-100 hover:bg-amber-200 transition border-t border-amber-200">
                                            Open Collections →
                                        </button>
                                    </div>
                                );
                            })()}

                            {/* Quick Actions */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                                <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">Quick Actions</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    <button onClick={() => setActiveTab("collections")} className="flex flex-col items-center gap-1 py-3 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition">
                                        <span className="text-xl">💰</span>
                                        <span className="text-[10px] font-bold text-indigo-700">Collect Rent</span>
                                    </button>
                                    <button onClick={() => setActiveTab("meter")} className="flex flex-col items-center gap-1 py-3 bg-purple-50 rounded-lg hover:bg-purple-100 transition">
                                        <span className="text-xl">⚡</span>
                                        <span className="text-[10px] font-bold text-purple-700">Record Meter</span>
                                    </button>
                                    <button onClick={() => { setActiveTab("active"); }} className="flex flex-col items-center gap-1 py-3 bg-red-50 rounded-lg hover:bg-red-100 transition">
                                        <span className="text-xl">🚨</span>
                                        <span className="text-[10px] font-bold text-red-700">Report Issue</span>
                                    </button>
                                    <button onClick={() => setActiveTab("expenses")} className="flex flex-col items-center gap-1 py-3 bg-amber-50 rounded-lg hover:bg-amber-100 transition">
                                        <span className="text-xl">🧾</span>
                                        <span className="text-[10px] font-bold text-amber-700">Add Expense</span>
                                    </button>
                                    <button onClick={() => setActiveTab("checklist")} className="flex flex-col items-center gap-1 py-3 bg-pink-50 rounded-lg hover:bg-pink-100 transition">
                                        <span className="text-xl">📋</span>
                                        <span className="text-[10px] font-bold text-pink-700">Checklist</span>
                                    </button>
                                    <button onClick={() => setActiveTab("units")} className="flex flex-col items-center gap-1 py-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition">
                                        <span className="text-xl">🏠</span>
                                        <span className="text-[10px] font-bold text-blue-700">View Units</span>
                                    </button>
                                </div>
                            </div>

                            {/* Overdue Invoices Alert */}
                            {overdueInvoices.length > 0 && (
                                <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
                                    <div className="bg-red-100 px-4 py-2.5 border-b border-red-200 flex justify-between items-center">
                                        <h3 className="text-sm font-bold text-red-800">⚠️ Overdue Invoices</h3>
                                        <span className="text-xs font-bold bg-red-200 text-red-800 px-2 py-0.5 rounded-full">{overdueInvoices.length}</span>
                                    </div>
                                    <div className="divide-y divide-red-100 max-h-48 overflow-y-auto">
                                        {overdueInvoices.map(inv => (
                                            <div key={inv.id} className="px-4 py-2.5 flex justify-between items-center">
                                                <div>
                                                    <p className="font-bold text-gray-900 text-sm">{inv.unitNumber}</p>
                                                    <p className="text-[10px] text-gray-500">{inv.billingPeriod}</p>
                                                </div>
                                                <p className="font-bold text-red-700 text-sm">₹{Number(inv.totalAmount || 0).toLocaleString()}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={() => setActiveTab("collections")} className="w-full text-center text-xs font-bold text-red-700 py-2 bg-red-100 hover:bg-red-200 transition border-t border-red-200">
                                        View All Collections →
                                    </button>
                                </div>
                            )}

                            {/* Meters Pending for Current Month */}
                            {unitsPendingMeter.length > 0 && (
                                <div className="bg-purple-50 border border-purple-200 rounded-xl overflow-hidden">
                                    <div className="bg-purple-100 px-4 py-2.5 border-b border-purple-200 flex justify-between items-center">
                                        <h3 className="text-sm font-bold text-purple-800">⚡ Meters Pending — {currentMonthName}</h3>
                                        <span className="text-xs font-bold bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full">{unitsPendingMeter.length}</span>
                                    </div>
                                    <div className="divide-y divide-purple-100 max-h-48 overflow-y-auto">
                                        {unitsPendingMeter.map(u => (
                                            <div key={u.id} className="px-4 py-2.5 flex justify-between items-center">
                                                <div>
                                                    <p className="font-bold text-gray-900 text-sm">{u.unitNumber}</p>
                                                    <p className="text-[10px] text-gray-500">{u.tenantName || u.tenantEmail || "—"}</p>
                                                </div>
                                                <p className="text-xs text-purple-600">Last: {u.lastMeterReading || 0}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={() => setActiveTab("meter")} className="w-full text-center text-xs font-bold text-purple-700 py-2 bg-purple-100 hover:bg-purple-200 transition border-t border-purple-200">
                                        Record Meter Readings →
                                    </button>
                                </div>
                            )}

                            {/* Active Tasks Preview */}
                            {activeTickets.length > 0 && (
                                <div className="bg-orange-50 border border-orange-200 rounded-xl overflow-hidden">
                                    <div className="bg-orange-100 px-4 py-2.5 border-b border-orange-200 flex justify-between items-center">
                                        <h3 className="text-sm font-bold text-orange-800">🔧 Active Tasks</h3>
                                        <span className="text-xs font-bold bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">{activeTickets.length}</span>
                                    </div>
                                    <div className="divide-y divide-orange-100 max-h-48 overflow-y-auto">
                                        {activeTickets.slice(0, 5).map(t => (
                                            <div key={t.id} className="px-4 py-2.5 flex justify-between items-center">
                                                <div>
                                                    <p className="font-bold text-gray-900 text-sm">{t.unitNumber}</p>
                                                    <p className="text-[10px] text-gray-500 line-clamp-1">{t.description}</p>
                                                </div>
                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.status === "in-progress" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>{t.status}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={() => setActiveTab("active")} className="w-full text-center text-xs font-bold text-orange-700 py-2 bg-orange-100 hover:bg-orange-200 transition border-t border-orange-200">
                                        View All Tasks →
                                    </button>
                                </div>
                            )}

                            {/* Recent Activity Feed */}
                            {(() => {
                                const activities: { icon: string; text: string; time: number }[] = [];
                                allLedgerEntries.slice(0, 20).forEach(e => activities.push({ icon: "💵", text: `Payment ₹${e.amountPaid} from ${e.unitNumber || "tenant"}`, time: new Date(e.createdAt).getTime() }));
                                resolvedTickets.slice(0, 10).forEach(t => activities.push({ icon: "✅", text: `Task resolved: ${t.unitNumber} - ${(t.description || "").slice(0, 30)}`, time: new Date(t.resolvedAt || t.createdAt).getTime() }));
                                allExpenses.slice(0, 10).forEach(ex => activities.push({ icon: "🧾", text: `Expense: ${ex.description || ex.category || "item"} ₹${ex.amount}`, time: new Date(ex.date || ex.createdAt).getTime() }));
                                activities.sort((a, b) => b.time - a.time);
                                const recent = activities.slice(0, 10);
                                if (recent.length === 0) return null;
                                return (
                                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                                            <h3 className="text-sm font-bold text-gray-800">🕐 Recent Activity</h3>
                                            <span className="text-[10px] text-gray-400">Last {recent.length} actions</span>
                                        </div>
                                        <div className="divide-y divide-gray-100 max-h-56 overflow-y-auto">
                                            {recent.map((a, i) => (
                                                <div key={i} className="px-4 py-2.5 flex items-center gap-2">
                                                    <span className="text-base">{a.icon}</span>
                                                    <p className="text-xs text-gray-700 flex-1 line-clamp-1">{a.text}</p>
                                                    <span className="text-[10px] text-gray-400 whitespace-nowrap">{new Date(a.time).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    );
                })()}

                {/* COLLECTIONS TAB */}
                {activeTab === "collections" && (
                    <CollectionsTab allInvoices={allInvoices} occupiedUnits={occupiedUnits} electricityRate={electricityRate} openTenantProfile={openTenantProfile} allLedgerEntries={allLedgerEntries} />
                )}

                {/* METER READING TAB */}
                {activeTab === "meter" && (
                    <MeterTab occupiedUnits={occupiedUnits} allLedgerEntries={allLedgerEntries} electricityRate={electricityRate} />
                )}

                {/* LEDGER TAB */}
                {activeTab === "ledger" && (
                    <LedgerTab allLedgerEntries={allLedgerEntries} occupiedUnits={occupiedUnits} />
                )}

                {/* DAILY LEDGER TAB */}
                {activeTab === "daily" && (
                    <DailyLedgerTab entries={dailyLedgerEntries} buildings={buildings} allUnits={allUnits} allInvoices={allInvoices} currentUserEmail={user?.email || ""} />
                )}

                {/* MONTHLY OVERVIEW TAB */}
                {activeTab === "monthly" && (
                    <MonthlyOverviewTab allUnits={allUnits} buildings={buildings} allInvoices={allInvoices} />
                )}

                {/* UNITS TAB */}
                {activeTab === "units" && (
                    <div className="space-y-3">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="bg-blue-50 px-5 py-4 border-b border-blue-200">
                                <h2 className="text-lg font-bold text-blue-800">🏠 Buildings & Units</h2>
                                <p className="text-xs text-blue-600 mt-1">{vacantUnits.length} vacant · {occupiedForAssign.length} occupied · {buildings.length} buildings</p>
                            </div>
                            <div className="px-4 pt-4">
                                <input type="text" placeholder="🔍 Search by tenant name or phone..." value={unitSearch} onChange={(e) => setUnitSearch(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none" />
                            </div>
                            <div className="p-4 space-y-2">
                                {(() => {
                                    const searchLower = unitSearch.toLowerCase().trim();
                                    const filteredBuildings = buildings.filter(bldg => {
                                        if (!searchLower) return true;
                                        const bldgUnits = allUnits.filter(u => u.buildingId === bldg.id);
                                        return bldgUnits.some(u => (u.tenantName && u.tenantName.toLowerCase().includes(searchLower)) || (u.tenantPhone && u.tenantPhone.includes(searchLower)) || (u.unitNumber && u.unitNumber.toLowerCase().includes(searchLower)));
                                    });
                                    return filteredBuildings.length === 0 ? (
                                        <p className="text-sm text-gray-500 text-center py-8">{searchLower ? "No matching tenants found." : "No buildings found."}</p>
                                    ) : (
                                        filteredBuildings.map(bldg => {
                                            let bldgUnits = allUnits.filter(u => u.buildingId === bldg.id);
                                            if (searchLower) {
                                                bldgUnits = bldgUnits.filter(u => (u.tenantName && u.tenantName.toLowerCase().includes(searchLower)) || (u.tenantPhone && u.tenantPhone.includes(searchLower)) || (u.unitNumber && u.unitNumber.toLowerCase().includes(searchLower)));
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
                                                                                    {/* Co-tenants display */}
                                                                                    {unit.coTenants && unit.coTenants.length > 0 && (
                                                                                        <div className="mt-1 pl-2 border-l-2 border-indigo-200">
                                                                                            <p className="text-[10px] font-bold text-indigo-600 uppercase">Co-tenants ({unit.coTenants.length})</p>
                                                                                            {unit.coTenants.map((ct, i: number) => (
                                                                                                <div key={i} className="flex items-center gap-2.5 mt-1">
                                                                                                    <span className="text-[10px] text-gray-600">👤 {ct.name || ct.email || "—"}{ct.phone && !ct.email ? ` · 📞 ${ct.phone}` : ""}{ct.email ? ` · ${ct.email}` : ""}</span>
                                                                                                    <button onClick={() => handleRemoveCoTenant(unit.id, ct)} className="text-[10px] text-red-400 hover:text-red-600 ml-1">✕</button>
                                                                                                </div>
                                                                                            ))}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex flex-col gap-3 shrink-0">
                                                                            <button onClick={() => { setEditUnit(unit); setEditUnitNumber(unit.unitNumber); setEditBaseRent(String(unit.baseRent || 8000)); setIsEditUnitModalOpen(true); }} className="text-xs text-blue-600 hover:underline">✏️ Edit</button>
                                                                            {unit.status === "vacant" ? (
                                                                                <button onClick={() => { setAssignUnit(unit); setAssignMode("new"); setAssignEmail(""); setAssignName(""); setAssignPhone(""); setAssignExistingUnit(""); setIsAssignModalOpen(true); }} className="text-xs bg-green-600 text-white px-2 py-1 rounded-md font-medium hover:bg-green-700">+ Assign</button>
                                                                            ) : (
                                                                                <>
                                                                                    <button onClick={() => handleRemoveTenant(unit.id)} className="text-xs text-red-500 hover:underline">Remove</button>
                                                                                    <button onClick={() => openTransferModal(unit)} className="text-xs text-orange-600 hover:underline">🔄 Transfer</button>
                                                                                    <button onClick={() => { setUnitDocUnit(unit); setUnitDocName(""); setUnitDocFile(null); setIsUnitDocModalOpen(true); }} className="text-xs text-purple-600 hover:underline">📄 Doc</button>
                                                                                    <button onClick={() => { setCoTenantUnit(unit); setCoTenantName(""); setCoTenantPhone(""); setCoTenantEmail(""); setIsAddCoTenantOpen(true); }} className="text-xs text-indigo-600 hover:underline">👥 Add</button>
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
                                                                                        {h.coTenants?.length > 0 && <span> · 👥 {h.coTenants.length} co-tenant(s)</span>}
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
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                )}

                {/* OCCUPANCY DASHBOARD TAB */}
                {activeTab === "occupancy" && (
                    <OccupancyTab allUnits={allUnits} buildings={buildings} />
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
                    <ExpensesTab allExpenses={allExpenses} allAllocations={allAllocations} buildings={buildings} userEmail={user?.email || ""} />
                )}

                {/* INVENTORY TAB */}
                {activeTab === "inventory" && (
                    <InventoryTab allInventory={allInventory} buildings={buildings} />
                )}

                {/* TICKET LIST */}
                {(activeTab === "active" || activeTab === "resolved") && (
                    <TicketsTab
                        tickets={activeTab === "active" ? activeTickets : resolvedTickets}
                        isResolved={activeTab === "resolved"}
                        allUnits={allUnits}
                        buildings={buildings}
                        userEmail={user?.email || ""}
                    />
                )}
            </main>

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

                        {/* Payment Day & Security Deposit */}
                        <div className="border-t border-gray-200 pt-4 mb-4">
                            <h3 className="text-sm font-bold text-gray-800 mb-2">📅 Payment & Security</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Payment Day</label>
                                    <div className="flex gap-1">
                                        <input type="number" min="1" max="31" defaultValue={profileUnit.paymentDay || ""} id="profilePaymentDay" className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm" placeholder="1-31" />
                                        <button type="button" onClick={async () => { const val = (document.getElementById('profilePaymentDay') as HTMLInputElement).value; if (val) { await updateDoc(doc(db, "units", profileUnit.id), { paymentDay: Number(val) }); alert("Payment day saved!"); } }} className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs font-bold hover:bg-indigo-200">✓</button>
                                    </div>
                                    {profileUnit.paymentDay && <p className="text-[10px] text-indigo-600 mt-0.5">Current: {profileUnit.paymentDay}th of every month</p>}
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Security Deposit</label>
                                    <div className="flex gap-1">
                                        <input type="number" min="0" defaultValue={profileUnit.securityDeposit || ""} id="profileSecurityDeposit" className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm" placeholder="₹" />
                                        <button type="button" onClick={async () => { const val = (document.getElementById('profileSecurityDeposit') as HTMLInputElement).value; if (val) { await updateDoc(doc(db, "units", profileUnit.id), { securityDeposit: Number(val), securityDepositDate: profileUnit.securityDepositDate || new Date().toISOString() }); alert("Security deposit saved!"); } }} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-bold hover:bg-green-200">✓</button>
                                    </div>
                                    {profileUnit.securityDeposit && <p className="text-[10px] text-green-600 mt-0.5">₹{Number(profileUnit.securityDeposit).toLocaleString()} {profileUnit.securityDepositDate ? `(${new Date(profileUnit.securityDepositDate).toLocaleDateString()})` : ""}</p>}
                                </div>
                            </div>
                            {/* Per-tenant Electricity Rate */}
                            <div className="mt-3">
                                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">⚡ Electricity Rate (₹ per unit)</label>
                                <div className="flex gap-1">
                                    <input type="number" min="0" step="0.01" defaultValue={profileUnit.electricityRate ?? ""} id="profileElectricityRate" className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm" placeholder={`Default ₹${electricityRate}/unit`} />
                                    <button type="button" onClick={async () => {
                                        const raw = (document.getElementById('profileElectricityRate') as HTMLInputElement).value;
                                        try {
                                            if (raw === "" || raw === null) {
                                                await updateDoc(doc(db, "units", profileUnit.id), { electricityRate: deleteField() });
                                                setProfileUnit({ ...profileUnit, electricityRate: undefined });
                                                alert(`Custom rate cleared. Using default ₹${electricityRate}/unit.`);
                                            } else {
                                                const val = Number(raw);
                                                if (!(val > 0)) { alert("Enter a positive rate, or leave empty to use default."); return; }
                                                await updateDoc(doc(db, "units", profileUnit.id), { electricityRate: val });
                                                setProfileUnit({ ...profileUnit, electricityRate: val });
                                                alert(`Electricity rate saved: ₹${val}/unit`);
                                            }
                                        } catch (err) { console.error(err); alert("Failed to save rate."); }
                                    }} className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-bold hover:bg-purple-200">✓</button>
                                </div>
                                <p className="text-[10px] text-purple-600 mt-0.5">
                                    {Number(profileUnit.electricityRate) > 0
                                        ? `Custom: ₹${Number(profileUnit.electricityRate)}/unit — applied to future meter invoices for this tenant.`
                                        : `Using default ₹${electricityRate}/unit. Set a value here to override for this tenant.`}
                                </p>
                            </div>
                        </div>

                        {/* Documents */}
                        <div className="border-t border-gray-200 pt-4 mb-4">
                            <h3 className="text-sm font-bold text-gray-800 mb-2">📄 Documents</h3>
                            {profileUnit.documents && profileUnit.documents.length > 0 ? (
                                <ul className="space-y-1 max-h-28 overflow-y-auto mb-3">
                                    {profileUnit.documents.map((d, i: number) => (
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
                                    profileUnit.notes.map((n, i: number) => (
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

            {/* TODAY'S COLLECTIONS MODAL */}
            {isTodayCollectionsOpen && (() => {
                const today = new Date().toISOString().split("T")[0];
                const todays = allInvoices
                    .filter(inv => inv.status === "paid" && inv.paidAt && inv.paidAt.startsWith(today))
                    .slice()
                    .sort((a, b) => String(b.paidAt || "").localeCompare(String(a.paidAt || "")));
                const total = todays.reduce((s, inv) => s + Number(inv.totalAmount || 0), 0);
                const decodeMode = (txn: string) => {
                    if (!txn) return { mode: "—", ref: "" };
                    if (txn === "CASH_COLLECTED") return { mode: "CASH", ref: "" };
                    if (txn === "DAILY_LEDGER_AUTOSETTLE") return { mode: "LEDGER", ref: "" };
                    if (txn.includes(":")) { const [m, ...rest] = txn.split(":"); return { mode: m, ref: rest.join(":") }; }
                    return { mode: "OTHER", ref: txn };
                };
                return (
                    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center p-4 z-50 overflow-y-auto" onClick={() => setIsTodayCollectionsOpen(false)}>
                        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg shadow-2xl my-8 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            <div className="bg-green-50 px-5 py-4 border-b border-green-200 flex justify-between items-center">
                                <div>
                                    <h2 className="text-lg font-bold text-green-800">💵 Collected Today</h2>
                                    <p className="text-xs text-green-600 mt-0.5">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {todays.length} payment{todays.length !== 1 ? "s" : ""} · ₹{total.toLocaleString()}</p>
                                </div>
                                <button onClick={() => setIsTodayCollectionsOpen(false)} className="text-2xl text-gray-400 hover:text-gray-700">×</button>
                            </div>
                            <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-100">
                                {todays.length === 0 ? (
                                    <p className="text-sm text-gray-500 text-center py-10">No collections today yet.</p>
                                ) : todays.map(inv => {
                                    const { mode, ref } = decodeMode(inv.transactionId || "");
                                    return (
                                        <div key={inv.id} className="px-5 py-3 hover:bg-gray-50">
                                            <div className="flex justify-between items-start gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-bold text-gray-900 text-sm">{inv.unitNumber}</span>
                                                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-green-100 text-green-700">PAID</span>
                                                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{mode}</span>
                                                    </div>
                                                    <p className="text-xs text-gray-600 mt-0.5 truncate">{inv.tenantEmail || "—"}</p>
                                                    <p className="text-[10px] text-gray-500 mt-0.5">{inv.billingPeriod}</p>
                                                    <p className="text-[10px] text-gray-500 mt-0.5">📅 {inv.paidAt ? new Date(inv.paidAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</p>
                                                    {ref && <p className="text-[10px] text-gray-500 mt-0.5">🔖 {ref}</p>}
                                                    {inv.paymentNote && <p className="text-[10px] text-gray-500 mt-0.5">📝 {inv.paymentNote}</p>}
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="font-bold text-green-700 text-base">₹{Number(inv.totalAmount || 0).toLocaleString()}</p>
                                                    {(inv.baseRent > 0 || (inv.electricityCharge || 0) > 0) && (
                                                        <p className="text-[10px] text-gray-500 mt-0.5">Rent ₹{Number(inv.baseRent || 0).toLocaleString()} · Elec ₹{Number(inv.electricityCharge || 0).toLocaleString()}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="px-5 py-3 border-t border-gray-200 flex justify-between items-center bg-gray-50">
                                <span className="text-sm font-bold text-gray-700">Total</span>
                                <span className="text-lg font-bold text-green-700">₹{total.toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                );
            })()}

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
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">Payment Day (1-31)</label>
                                            <input type="number" min="1" max="31" placeholder="e.g. 5" value={assignPaymentDay} onChange={(e) => setAssignPaymentDay(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">Security Deposit (₹)</label>
                                            <input type="number" min="0" placeholder="e.g. 10000" value={assignSecurityDeposit} onChange={(e) => setAssignSecurityDeposit(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                        </div>
                                    </div>
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
                                {coTenantUnit.coTenants.map((ct, i: number) => (
                                    <p key={i} className="text-xs text-gray-700">• {ct.name || ct.email} {ct.phone ? `(${ct.phone})` : ""}</p>
                                ))}
                            </div>
                        )}
                        <form onSubmit={handleAddCoTenant} className="space-y-3">
                            <input type="text" placeholder="Co-tenant Email (optional)" value={coTenantEmail} onChange={(e) => setCoTenantEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
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

            {/* TRANSFER TENANT MODAL */}
            {isTransferModalOpen && transferSourceUnit && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setIsTransferModalOpen(false)}>
                    <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800">🔄 Transfer Tenant</h3>
                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-xs text-orange-800">
                            <p><strong>From:</strong> {transferSourceUnit.unitNumber}</p>
                            <p><strong>Tenant:</strong> {transferSourceUnit.tenantName || transferSourceUnit.tenantEmail || "—"}</p>
                        </div>
                        <form onSubmit={handleTransferTenant} className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Destination Unit *</label>
                                <select required value={transferDestUnit} onChange={(e) => setTransferDestUnit(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                                    <option value="" disabled>Choose a vacant unit...</option>
                                    {allUnits.filter(u => u.status === "vacant" && u.id !== transferSourceUnit.id).map(u => (
                                        <option key={u.id} value={u.id}>{u.unitNumber} (Rent: ₹{u.baseRent || 0})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Transfer Date</label>
                                <input type="date" required value={transferDate} onChange={(e) => setTransferDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>

                            {/* Invoice Mode */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Invoice for Old Unit</label>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="radio" name="transferInvMode" checked={transferInvoiceMode === "prorate"} onChange={() => setTransferInvoiceMode("prorate")} className="accent-orange-600" />
                                        <span className="text-sm">📊 Auto Pro-rate (days stayed + electricity)</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="radio" name="transferInvMode" checked={transferInvoiceMode === "custom"} onChange={() => setTransferInvoiceMode("custom")} className="accent-orange-600" />
                                        <span className="text-sm">✍️ Custom Amount (no meter)</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="radio" name="transferInvMode" checked={transferInvoiceMode === "none"} onChange={() => setTransferInvoiceMode("none")} className="accent-orange-600" />
                                        <span className="text-sm">🚫 No invoice (handle separately)</span>
                                    </label>
                                </div>
                            </div>

                            {/* Pro-rate: show meter reading field */}
                            {transferInvoiceMode === "prorate" && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                                    <p className="text-xs text-blue-700 font-medium">Electricity reading at transfer</p>
                                    <div>
                                        <label className="block text-[10px] text-gray-500 mb-0.5">Previous: {transferSourceUnit.lastMeterReading || 0}</label>
                                        <input type="number" min="0" placeholder="Current meter reading" value={transferLastReading} onChange={(e) => setTransferLastReading(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                                    </div>
                                    <p className="text-[10px] text-blue-600">Leave same as previous if meter not applicable.</p>
                                </div>
                            )}

                            {/* Custom amount fields */}
                            {transferInvoiceMode === "custom" && (
                                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Amount (₹) *</label>
                                        <input type="number" required min="0" value={transferCustomAmount} onChange={(e) => setTransferCustomAmount(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. 5000" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Note / Reason</label>
                                        <input type="text" value={transferCustomNote} onChange={(e) => setTransferCustomNote(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="e.g. Partial month, no electricity" />
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-2 pt-2">
                                <button type="button" onClick={() => setIsTransferModalOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                                <button type="submit" disabled={isTransferring} className="flex-1 py-2 bg-orange-600 text-white rounded-md text-sm font-medium hover:bg-orange-700 disabled:bg-orange-400">{isTransferring ? "Transferring..." : "Transfer Tenant"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}




        </div>
    );
}