"use client";

import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Application } from "@/types";

interface AdminApplicationsTabProps {
    applications: Application[];
}

export function AdminApplicationsTab({ applications }: AdminApplicationsTabProps) {
    const handleAction = async (appId: string, status: "approved" | "rejected") => {
        try {
            await updateDoc(doc(db, "applications", appId), { status });
        } catch (error) {
            console.error("Failed to update application:", error);
            alert("Failed to update application.");
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200">
                <h2 className="text-lg font-bold text-gray-900">📝 Rental Applications</h2>
                <p className="text-xs text-gray-500 mt-0.5">{applications.length} pending applicant submissions awaiting review</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {applications.length === 0 ? (
                    <div className="col-span-2 bg-white rounded-xl p-8 text-center text-gray-400 border border-gray-200">
                        No pending applications.
                    </div>
                ) : (
                    applications.map(app => (
                        <div key={app.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h3 className="font-bold text-gray-900 text-base">{app.tenantEmail}</h3>
                                        <p className="text-xs text-gray-500 mt-0.5">Applied for Unit {app.unitNumber}</p>
                                    </div>
                                    <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                                        Pending Review
                                    </span>
                                </div>

                                <div className="mt-4 space-y-1 text-xs text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">
                                    <p><span className="font-semibold text-gray-500">Security Deposit:</span> ₹{Number(app.securityDeposit || 0).toLocaleString()}</p>
                                    <p><span className="font-semibold text-gray-500">Transaction ID:</span> {app.transactionId || "—"}</p>
                                    <p><span className="font-semibold text-gray-500">Applied At:</span> {new Date(app.createdAt).toLocaleDateString()}</p>
                                </div>

                                <div className="flex gap-3 mt-3">
                                    {app.idProofUrl && (
                                        <a href={app.idProofUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline font-semibold">
                                            📄 ID Proof
                                        </a>
                                    )}
                                    {app.paymentProofUrl && (
                                        <a href={app.paymentProofUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline font-semibold">
                                            💳 Payment Proof
                                        </a>
                                    )}
                                </div>
                            </div>

                            <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end gap-2">
                                <button
                                    onClick={() => handleAction(app.id, "rejected")}
                                    className="bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold px-3 py-1.5 rounded-lg transition"
                                >
                                    Reject
                                </button>
                                <button
                                    onClick={() => handleAction(app.id, "approved")}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-1.5 rounded-lg transition"
                                >
                                    Approve & Assign
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
