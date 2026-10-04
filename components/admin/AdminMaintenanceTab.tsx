"use client";

import { useState } from "react";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { MaintenanceTicket } from "@/types";

interface AdminMaintenanceTabProps {
    tickets: MaintenanceTicket[];
    currentUserEmail: string;
}

export function AdminMaintenanceTab({ tickets, currentUserEmail }: AdminMaintenanceTabProps) {
    const [selectedTicket, setSelectedTicket] = useState<MaintenanceTicket | null>(null);
    const [commentText, setCommentText] = useState("");
    const [isSubmittingComment, setIsSubmittingComment] = useState(false);

    const handleUpdateStatus = async (ticketId: string, newStatus: "pending" | "in-progress" | "resolved") => {
        try {
            await updateDoc(doc(db, "maintenance", ticketId), { status: newStatus });
        } catch (error) {
            console.error("Failed to update ticket status:", error);
            alert("Failed to update status.");
        }
    };

    const handleAddComment = async (ticketId: string) => {
        if (!commentText.trim()) return;
        setIsSubmittingComment(true);
        try {
            await updateDoc(doc(db, "maintenance", ticketId), {
                comments: arrayUnion({
                    author: currentUserEmail || "Admin",
                    text: commentText.trim(),
                    timestamp: new Date().toISOString(),
                })
            });
            setCommentText("");
        } catch (error) {
            console.error("Failed to add comment:", error);
            alert("Failed to add comment.");
        } finally {
            setIsSubmittingComment(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200">
                <h2 className="text-lg font-bold text-gray-900">🛠️ Maintenance & Repair Requests</h2>
                <p className="text-xs text-gray-500 mt-0.5">{tickets.length} total tickets reported by tenants and staff</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {tickets.map(ticket => (
                    <div key={ticket.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col justify-between">
                        <div>
                            <div className="flex justify-between items-start">
                                <div>
                                    <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                                        {ticket.category}
                                    </span>
                                    <h3 className="font-bold text-gray-900 text-base mt-1.5">{ticket.buildingName} · Unit {ticket.unitNumber}</h3>
                                </div>
                                <select
                                    value={ticket.status}
                                    onChange={(e) => handleUpdateStatus(ticket.id, e.target.value as "pending" | "in-progress" | "resolved")}
                                    className={`text-xs font-bold px-2.5 py-1 rounded-lg outline-none border ${
                                        ticket.status === "resolved"
                                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                            : ticket.status === "in-progress"
                                            ? "bg-amber-50 text-amber-800 border-amber-200"
                                            : "bg-rose-50 text-rose-800 border-rose-200"
                                    }`}
                                >
                                    <option value="pending">Pending</option>
                                    <option value="in-progress">In Progress</option>
                                    <option value="resolved">Resolved</option>
                                </select>
                            </div>

                            <p className="text-xs text-gray-700 mt-3 bg-gray-50 p-3 rounded-lg border border-gray-100">
                                {ticket.description}
                            </p>

                            {ticket.photoUrl && (
                                <div className="mt-3">
                                    <a href={ticket.photoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline font-bold flex items-center gap-1">
                                        📷 View Attached Photo
                                    </a>
                                </div>
                            )}

                            {ticket.comments && ticket.comments.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                                    <p className="text-[10px] font-bold text-gray-500 uppercase">Updates & Comments ({ticket.comments.length})</p>
                                    {ticket.comments.map((c, idx) => (
                                        <div key={idx} className="text-[11px] bg-gray-50 p-2 rounded border border-gray-100">
                                            <p className="font-bold text-gray-800">{c.author}: <span className="font-normal text-gray-600">{c.text}</span></p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="mt-4 pt-3 border-t border-gray-100">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Add comment / progress note..."
                                    value={selectedTicket?.id === ticket.id ? commentText : ""}
                                    onFocus={() => setSelectedTicket(ticket)}
                                    onChange={(e) => setCommentText(e.target.value)}
                                    className="flex-1 px-3 py-1.5 text-xs border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                                />
                                <button
                                    onClick={() => handleAddComment(ticket.id)}
                                    disabled={isSubmittingComment || !commentText.trim() || selectedTicket?.id !== ticket.id}
                                    className="bg-gray-900 hover:bg-black text-white text-xs font-bold px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                                >
                                    Post
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
