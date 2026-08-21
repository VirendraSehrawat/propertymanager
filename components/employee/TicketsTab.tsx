"use client";

import { useState } from "react";
import Image from "next/image";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Modal } from "@/components/ui";
import { useUploadWithProgress, UploadProgressBar } from "@/lib/useUpload";
import type { MaintenanceTicket, Unit, Building } from "@/types";

interface TicketsTabProps {
    tickets: MaintenanceTicket[];
    isResolved: boolean;
    allUnits: Unit[];
    buildings: Building[];
    userEmail: string;
}

export function TicketsTab({ tickets, isResolved, allUnits, buildings, userEmail }: TicketsTabProps) {
    const { uploadFile, uploadProgress, isUploading } = useUploadWithProgress();

    // Resolve modal
    const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);
    const [selectedTicket, setSelectedTicket] = useState<MaintenanceTicket | null>(null);
    const [resolutionNote, setResolutionNote] = useState("");
    const [resolutionFile, setResolutionFile] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Report issue modal
    const [isReportOpen, setIsReportOpen] = useState(false);
    const [reportUnit, setReportUnit] = useState("");
    const [reportCategory, setReportCategory] = useState("Maintenance");
    const [reportDesc, setReportDesc] = useState("");
    const [reportFile, setReportFile] = useState<File | null>(null);
    const [isSubmittingReport, setIsSubmittingReport] = useState(false);

    // Comment
    const [commentTicketId, setCommentTicketId] = useState("");
    const [commentText, setCommentText] = useState("");
    const [isAddingComment, setIsAddingComment] = useState(false);

    const getBuildingName = (buildingId: string) => buildings.find(b => b.id === buildingId)?.name || "Unknown";

    const handleMarkInProgress = async (ticketId: string) => {
        try {
            await updateDoc(doc(db, "maintenance", ticketId), {
                status: "in-progress",
                comments: arrayUnion({ author: "Maintenance Staff", text: "Staff has acknowledged the issue and is working on it.", timestamp: new Date().toISOString() }),
            });
        } catch (error) { console.error("Failed to update status:", error); alert("Could not update ticket."); }
    };

    const handleResolveSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTicket || !resolutionFile) return;
        setIsSubmitting(true);
        try {
            const ts = new Date().getTime();
            const photoUrl = await uploadFile(`maintenance_resolutions/${selectedTicket.id}/${ts}_${resolutionFile.name}`, resolutionFile);
            await updateDoc(doc(db, "maintenance", selectedTicket.id), {
                status: "resolved", resolutionPhotoUrl: photoUrl,
                comments: arrayUnion({ author: "Maintenance Staff", text: resolutionNote || "Issue has been resolved.", timestamp: new Date().toISOString() }),
            });
            setIsResolveModalOpen(false); setSelectedTicket(null); setResolutionNote(""); setResolutionFile(null);
        } catch (error) { console.error(error); alert("Failed to submit resolution."); } finally { setIsSubmitting(false); }
    };

    const handleReportIssue = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!reportDesc) return;
        setIsSubmittingReport(true);
        try {
            let photoUrl = "";
            if (reportFile) {
                const ts = new Date().getTime();
                photoUrl = await uploadFile(`maintenance/staff_${ts}_${reportFile.name}`, reportFile);
            }
            const unit = allUnits.find(u => u.id === reportUnit);
            const { addDoc, collection } = await import("firebase/firestore");
            await addDoc(collection(db, "maintenance"), {
                tenantEmail: "", reportedBy: userEmail || "Staff",
                unitId: reportUnit || "", unitNumber: unit?.unitNumber || "Common Area",
                buildingName: unit ? getBuildingName(unit.buildingId) : "General",
                category: reportCategory, description: reportDesc, photoUrl,
                status: "pending", comments: [], createdAt: new Date().toISOString(),
            });
            setIsReportOpen(false);
            setReportUnit(""); setReportCategory("Maintenance"); setReportDesc(""); setReportFile(null);
            alert("Issue reported successfully!");
        } catch (error) { console.error(error); alert("Failed to report issue."); } finally { setIsSubmittingReport(false); }
    };

    const handleAddComment = async (ticketId: string) => {
        if (!commentText.trim()) return;
        setIsAddingComment(true);
        try {
            await updateDoc(doc(db, "maintenance", ticketId), {
                comments: arrayUnion({ author: userEmail || "Staff", text: commentText.trim(), timestamp: new Date().toISOString() }),
            });
            setCommentText(""); setCommentTicketId("");
        } catch (error) { console.error(error); alert("Failed to add comment."); } finally { setIsAddingComment(false); }
    };

    const handleChangeTicketStatus = async (ticketId: string, newStatus: string) => {
        try {
            await updateDoc(doc(db, "maintenance", ticketId), {
                status: newStatus,
                comments: arrayUnion({ author: userEmail || "Staff", text: `Status changed to ${newStatus.toUpperCase()}`, timestamp: new Date().toISOString() }),
            });
        } catch (error) { console.error(error); alert("Failed to update status."); }
    };

    return (
        <div className="space-y-4">
            {!isResolved && (
                <button onClick={() => setIsReportOpen(true)} className="w-full py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition shadow-sm text-sm flex items-center justify-center gap-2">
                    🚨 Report New Issue
                </button>
            )}

            {tickets.length === 0 ? (
                <div className="bg-white p-8 rounded-xl shadow-sm text-center border border-gray-200 mt-8">
                    <span className="text-4xl mb-3 block">🎉</span>
                    <p className="text-gray-600 font-medium">No tasks in this queue!</p>
                </div>
            ) : (
                tickets.map(ticket => (
                    <div key={ticket.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${ticket.status === "resolved" ? "border-green-200" : "border-orange-200"}`}>
                        <div className={`px-4 py-3 border-b flex justify-between items-center ${ticket.status === "resolved" ? "bg-green-50 border-green-100" : "bg-orange-50 border-orange-100"}`}>
                            <div>
                                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{ticket.category}</span>
                                <h3 className="font-bold text-gray-900 text-lg">{ticket.unitNumber === "Common Area" ? "Common Area" : `Unit ${ticket.unitNumber}`}</h3>
                                {ticket.reportedBy && <p className="text-[10px] text-gray-500">Reported by: {ticket.reportedBy}</p>}
                            </div>
                            {ticket.status !== "resolved" ? (
                                <select value={ticket.status} onChange={(e) => handleChangeTicketStatus(ticket.id, e.target.value)} className={`px-2 py-1 rounded-full text-xs font-bold border-0 cursor-pointer ${ticket.status === "pending" ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"}`}>
                                    <option value="pending">PENDING</option>
                                    <option value="in-progress">IN-PROGRESS</option>
                                    <option value="resolved">RESOLVED</option>
                                </select>
                            ) : (
                                <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800">RESOLVED</span>
                            )}
                        </div>

                        <div className="p-4 space-y-4">
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-sm text-gray-700">
                                <p className="font-semibold mb-1 text-gray-900">Issue Description:</p>
                                {ticket.description}
                            </div>

                            {ticket.photoUrl && (
                                <a href={ticket.photoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded-md hover:bg-blue-100 font-medium w-full justify-center border border-blue-200 transition">
                                    📷 View Photo
                                </a>
                            )}

                            {ticket.status !== "resolved" && (
                                <div className="pt-2 flex flex-col sm:flex-row gap-3">
                                    {ticket.status === "pending" && (
                                        <button onClick={() => handleMarkInProgress(ticket.id)} className="w-full py-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-bold hover:bg-blue-100 transition shadow-sm">
                                            Start Work (In-Progress)
                                        </button>
                                    )}
                                    <button onClick={() => { setSelectedTicket(ticket); setIsResolveModalOpen(true); }} className="w-full py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition shadow-sm flex items-center justify-center gap-2">
                                        ✅ Mark as Resolved
                                    </button>
                                </div>
                            )}

                            {ticket.status === "resolved" && ticket.resolutionPhotoUrl && (
                                <div className="pt-2 border-t border-gray-100 mt-4">
                                    <p className="text-xs font-bold text-gray-500 uppercase mb-2">Resolution Proof</p>
                                    <Image src={ticket.resolutionPhotoUrl} alt="Fixed" width={400} height={192} className="w-full h-48 object-cover rounded-lg border border-gray-200" unoptimized />
                                </div>
                            )}

                            {/* Comments */}
                            <div className="border-t border-gray-100 pt-3 mt-2">
                                <p className="text-xs font-bold text-gray-500 uppercase mb-2">💬 Comments ({ticket.comments?.length || 0})</p>
                                {ticket.comments && ticket.comments.length > 0 && (
                                    <div className="space-y-2 max-h-40 overflow-y-auto mb-3">
                                        {ticket.comments.map((c, i) => (
                                            <div key={i} className="bg-gray-50 border border-gray-100 rounded p-2 text-xs">
                                                <p className="text-gray-800">{c.text}</p>
                                                <p className="text-gray-400 mt-0.5">{c.author} · {new Date(c.timestamp).toLocaleString()}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={commentTicketId === ticket.id ? commentText : ""}
                                        onFocus={() => setCommentTicketId(ticket.id)}
                                        onChange={(e) => { setCommentTicketId(ticket.id); setCommentText(e.target.value); }}
                                        placeholder="Add a comment..."
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    />
                                    <button
                                        onClick={() => handleAddComment(ticket.id)}
                                        disabled={isAddingComment || commentTicketId !== ticket.id || !commentText.trim()}
                                        className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-bold hover:bg-orange-600 disabled:bg-orange-300 transition"
                                    >
                                        {isAddingComment && commentTicketId === ticket.id ? "..." : "Post"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))
            )}

            {/* Resolve Modal */}
            <Modal isOpen={isResolveModalOpen && !!selectedTicket} onClose={() => { setIsResolveModalOpen(false); setResolutionFile(null); setResolutionNote(""); }} bottomSheet>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Resolve Issue</h2>
                <p className="text-sm text-gray-500 mb-6">Unit {selectedTicket?.unitNumber} • {selectedTicket?.category}</p>
                <form onSubmit={handleResolveSubmit} className="space-y-5">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Upload Proof of Fix (Required) 📸</label>
                        <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:bg-gray-50 transition cursor-pointer relative">
                            <input type="file" accept="image/*" required onChange={(e) => setResolutionFile(e.target.files?.[0] || null)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                            {resolutionFile ? (
                                <span className="text-sm font-bold text-green-600">✅ {resolutionFile.name} selected</span>
                            ) : (
                                <span className="text-sm text-gray-500 font-medium">Tap to open camera or gallery</span>
                            )}
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Completion Notes (Optional)</label>
                        <textarea rows={3} value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none resize-none" placeholder="e.g. Replaced the P-trap under the sink..." />
                    </div>
                    <div className="flex flex-col gap-3 mt-8">
                        {isUploading && <UploadProgressBar progress={uploadProgress} />}
                        <button type="submit" disabled={isSubmitting || isUploading} className="w-full py-4 bg-green-600 text-white rounded-xl font-bold text-lg hover:bg-green-700 shadow-md disabled:bg-green-400 transition">
                            {isSubmitting ? "Uploading..." : "Submit Resolution"}
                        </button>
                        <button type="button" onClick={() => { setIsResolveModalOpen(false); setResolutionFile(null); setResolutionNote(""); }} disabled={isSubmitting} className="w-full py-4 text-gray-600 hover:bg-gray-100 rounded-xl font-bold transition">
                            Cancel
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Report Issue Modal */}
            <Modal isOpen={isReportOpen} onClose={() => setIsReportOpen(false)} bottomSheet>
                <h3 className="text-lg font-bold text-gray-800">🚨 Report an Issue</h3>
                <p className="text-xs text-gray-500 mt-1 mb-4">Report a problem with a unit or common area.</p>
                <form onSubmit={handleReportIssue} className="space-y-3">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Unit / Location</label>
                        <select value={reportUnit} onChange={(e) => setReportUnit(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            <option value="">Common Area / General</option>
                            {allUnits.map(u => <option key={u.id} value={u.id}>{u.unitNumber} — {u.tenantName || u.tenantEmail || "Vacant"}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Category</label>
                        <select value={reportCategory} onChange={(e) => setReportCategory(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            {["Maintenance", "Plumbing", "Electrical", "Cleaning", "Security", "Structural", "Pest Control", "Water Supply", "Common Area", "Other"].map(c => <option key={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description *</label>
                        <textarea required rows={3} value={reportDesc} onChange={(e) => setReportDesc(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Describe the issue in detail..." />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Photo (Optional)</label>
                        <input type="file" accept="image/*" onChange={(e) => setReportFile(e.target.files?.[0] || null)} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-red-50 file:text-red-700" />
                    </div>
                    {isUploading && <UploadProgressBar progress={uploadProgress} />}
                    <div className="flex gap-2 pt-2">
                        <button type="button" onClick={() => setIsReportOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md text-sm text-gray-600">Cancel</button>
                        <button type="submit" disabled={isSubmittingReport || isUploading} className="flex-1 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:bg-red-400">{isSubmittingReport ? "Submitting..." : "Report Issue"}</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
