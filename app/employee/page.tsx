"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { collection, query, onSnapshot, doc, updateDoc, arrayUnion } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function EmployeeDashboard() {
    const { user, role, loading } = useAuth();
    const router = useRouter();

    const [tickets, setTickets] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState("active");

    // Comment Modal State
    const [isCommentModalOpen, setIsCommentModalOpen] = useState(false);
    const [selectedTicket, setSelectedTicket] = useState<any>(null);
    const [commentText, setCommentText] = useState("");

    // Resolution Modal State
    const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);
    const [resolveFile, setResolveFile] = useState<File | null>(null);
    const [isSubmittingResolve, setIsSubmittingResolve] = useState(false);

    useEffect(() => {
        if (!loading && (!user || role !== "employee")) router.push("/");
    }, [user, role, loading, router]);

    useEffect(() => {
        if (role !== "employee") return;
        const unsub = onSnapshot(collection(db, "maintenance"), (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setTickets(data);
        });
        return () => unsub();
    }, [role]);

    const handleUpdateStatus = async (ticketId: string, newStatus: string) => {
        try { await updateDoc(doc(db, "maintenance", ticketId), { status: newStatus }); }
        catch (error) { console.error("Error updating status", error); }
    };

    const handleAddComment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTicket || !commentText) return;
        try {
            await updateDoc(doc(db, "maintenance", selectedTicket.id), {
                comments: arrayUnion({
                    text: commentText,
                    author: user?.email || "CareTaker",
                    timestamp: new Date().toISOString()
                })
            });
            setCommentText("");
            setIsCommentModalOpen(false);
        } catch (error) {
            console.error("Error adding comment", error);
        }
    };

    const handleResolveTicket = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTicket || !resolveFile) return;
        setIsSubmittingResolve(true);
        try {
            const fileRef = ref(storage, `resolutions/${selectedTicket.id}_${Date.now()}_${resolveFile.name}`);
            await uploadBytes(fileRef, resolveFile);
            const photoUrl = await getDownloadURL(fileRef);

            await updateDoc(doc(db, "maintenance", selectedTicket.id), {
                status: "resolved",
                resolutionPhotoUrl: photoUrl,
                resolvedAt: new Date().toISOString(),
                resolvedBy: user?.email
            });

            setIsResolveModalOpen(false);
            setResolveFile(null);
        } catch (error) {
            alert("Failed to upload resolution photo.");
        } finally {
            setIsSubmittingResolve(false);
        }
    };

    const handleLogout = async () => { await signOut(auth); router.push("/"); };

    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    if (!user || role !== "employee") return null;

    const filteredTickets = tickets.filter(t => activeTab === "active" ? t.status !== "resolved" : t.status === "resolved");

    return (
        <div className="min-h-screen bg-gray-50">
            <nav className="bg-gray-900 px-6 py-4 flex justify-between items-center text-white shadow-md">
                <h1 className="text-xl font-bold">Staff / CareTaker Portal</h1>
                <button onClick={handleLogout} className="text-sm bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded">Logout</button>
            </nav>

            <main className="p-6 max-w-5xl mx-auto mt-4 space-y-6">

                <div className="flex border-b border-gray-200">
                    <button onClick={() => setActiveTab("active")} className={`py-3 px-6 font-medium text-sm ${activeTab === 'active' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Active Work</button>
                    <button onClick={() => setActiveTab("resolved")} className={`py-3 px-6 font-medium text-sm ${activeTab === 'resolved' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Completed Work</button>
                </div>

                <div className="space-y-4">
                    {filteredTickets.length === 0 ? (
                        <p className="text-gray-500 text-center py-8 bg-white rounded-lg border border-gray-200">No {activeTab} work items found.</p>
                    ) : (
                        filteredTickets.map(ticket => (
                            <div key={ticket.id} className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm flex flex-col md:flex-row gap-6">

                                <div className="flex-1">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{ticket.category}</span>
                                            <h3 className="text-xl font-bold text-gray-900">{ticket.unitNumber}</h3>
                                            <p className="text-sm text-gray-600">{ticket.buildingName}</p>
                                        </div>
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${ticket.status === 'pending' ? 'bg-red-100 text-red-800' : ticket.status === 'in-progress' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                                            {ticket.status.toUpperCase()}
                                        </span>
                                    </div>

                                    <div className="bg-gray-50 p-3 rounded text-sm text-gray-800 border border-gray-100 mb-3">
                                        <strong>Issue:</strong> {ticket.description}
                                    </div>

                                    {ticket.photoUrl && (
                                        <a href={ticket.photoUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline mb-2 block">📷 View Tenant's Photo</a>
                                    )}

                                    {/* Comments Display */}
                                    {ticket.comments && ticket.comments.length > 0 && (
                                        <div className="mt-4 space-y-2">
                                            <h4 className="text-xs font-bold text-gray-500 uppercase">Updates:</h4>
                                            {ticket.comments.map((c: any, i: number) => (
                                                <div key={i} className="bg-yellow-50 border border-yellow-100 p-2 rounded text-xs text-gray-700">
                                                    <span className="font-bold">{c.author}:</span> {c.text}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {ticket.status === "resolved" && ticket.resolutionPhotoUrl && (
                                        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                                            <p className="text-xs font-bold text-green-800 mb-1">Work Completed</p>
                                            <a href={ticket.resolutionPhotoUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-green-700 hover:underline">✅ View Completion Photo</a>
                                        </div>
                                    )}
                                </div>

                                {/* Staff Action Buttons */}
                                {ticket.status !== "resolved" && (
                                    <div className="w-full md:w-48 flex flex-col gap-2 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-6">
                                        {ticket.status === 'pending' && (
                                            <button onClick={() => handleUpdateStatus(ticket.id, 'in-progress')} className="w-full py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700">Start Work</button>
                                        )}
                                        <button onClick={() => { setSelectedTicket(ticket); setIsCommentModalOpen(true); }} className="w-full py-2 bg-white border border-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-50">Add Note</button>
                                        <button onClick={() => { setSelectedTicket(ticket); setIsResolveModalOpen(true); }} className="w-full py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 mt-auto">Mark Complete</button>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </main>

            {/* COMMENT MODAL */}
            {isCommentModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
                        <h2 className="text-xl font-bold mb-4">Add Update / Note</h2>
                        <form onSubmit={handleAddComment}>
                            <textarea required rows={3} value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="e.g., Waiting on parts from hardware store..." className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 mb-4"></textarea>
                            <div className="flex justify-end gap-3">
                                <button type="button" onClick={() => setIsCommentModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save Note</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* RESOLVE WITH PHOTO MODAL */}
            {isResolveModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
                        <h2 className="text-xl font-bold mb-2">Complete Work Item</h2>
                        <p className="text-sm text-gray-600 mb-4">Please upload a photo showing the completed repair to notify management.</p>
                        <form onSubmit={handleResolveTicket}>
                            <input type="file" accept="image/*" required onChange={(e) => setResolveFile(e.target.files ? e.target.files[0] : null)} className="w-full mb-6 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-gray-100" />
                            <div className="flex justify-end gap-3">
                                <button type="button" onClick={() => setIsResolveModalOpen(false)} disabled={isSubmittingResolve} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                                <button type="submit" disabled={isSubmittingResolve} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-green-400">
                                    {isSubmittingResolve ? "Uploading..." : "Upload & Complete"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}