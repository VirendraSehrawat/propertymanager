"use client";

import { useState } from "react";
import { collection, addDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Announcement } from "@/types";

interface AdminAnnouncementsTabProps {
    announcements: Announcement[];
    currentUserEmail: string;
}

export function AdminAnnouncementsTab({ announcements, currentUserEmail }: AdminAnnouncementsTabProps) {
    const [noticeTitle, setNoticeTitle] = useState("");
    const [noticeMessage, setNoticeMessage] = useState("");
    const [noticeTarget, setNoticeTarget] = useState("all");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleBroadcastNotice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!noticeTitle || !noticeMessage) return;
        setIsSubmitting(true);
        try {
            await addDoc(collection(db, "announcements"), {
                title: noticeTitle,
                message: noticeMessage,
                target: noticeTarget,
                author: currentUserEmail || "Admin",
                createdAt: new Date().toISOString(),
            });
            setNoticeTitle("");
            setNoticeMessage("");
            setNoticeTarget("all");
        } catch (error) {
            console.error("Failed to broadcast notice:", error);
            alert("Failed to broadcast notice.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteNotice = async (id: string) => {
        if (window.confirm("Remove this announcement from tenant boards?")) {
            await deleteDoc(doc(db, "announcements", id));
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl border border-gray-200">
                <h2 className="text-base font-bold text-gray-900 mb-1">📢 Broadcast Announcement to Tenants</h2>
                <p className="text-xs text-gray-500 mb-4">Post important building notices, maintenance alerts, or rent reminders to tenant portals.</p>

                <form onSubmit={handleBroadcastNotice} className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-gray-700 mb-1">Notice Title</label>
                            <input
                                type="text"
                                required
                                placeholder="e.g. Water Tank Cleaning on Sunday"
                                value={noticeTitle}
                                onChange={(e) => setNoticeTitle(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">Audience</label>
                            <select
                                value={noticeTarget}
                                onChange={(e) => setNoticeTarget(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                            >
                                <option value="all">All Tenants (Global)</option>
                                <option value="building_1">Sunrise Residency</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Notice Message</label>
                        <textarea
                            required
                            rows={3}
                            placeholder="Write message details for tenants..."
                            value={noticeMessage}
                            onChange={(e) => setNoticeMessage(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500 resize-none"
                        />
                    </div>
                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 py-2 rounded-lg transition disabled:opacity-50"
                        >
                            {isSubmitting ? "Publishing..." : "Broadcast Notice"}
                        </button>
                    </div>
                </form>
            </div>

            {/* Previous Announcements */}
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-gray-800">History of Published Notices</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {announcements.map(ann => (
                        <div key={ann.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-start">
                                    <h4 className="font-bold text-gray-900 text-sm">{ann.title}</h4>
                                    <button
                                        onClick={() => handleDeleteNotice(ann.id)}
                                        className="text-red-400 hover:text-red-600 text-xs font-bold"
                                    >
                                        ✕
                                    </button>
                                </div>
                                <p className="text-xs text-gray-600 mt-2 bg-gray-50 p-2.5 rounded-lg">{ann.message}</p>
                            </div>
                            <div className="mt-3 pt-2 border-t border-gray-100 flex justify-between text-[10px] text-gray-400">
                                <span>Target: {ann.target}</span>
                                <span>{new Date(ann.createdAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
