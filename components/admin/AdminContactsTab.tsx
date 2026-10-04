"use client";

import { useState } from "react";
import { collection, addDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Contact } from "@/types";

interface AdminContactsTabProps {
    contacts: Contact[];
}

export function AdminContactsTab({ contacts }: AdminContactsTabProps) {
    const [contactName, setContactName] = useState("");
    const [contactRole, setContactRole] = useState("Plumber");
    const [contactPhone, setContactPhone] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleAddContact = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!contactName || !contactPhone) return;
        setIsSubmitting(true);
        try {
            await addDoc(collection(db, "contacts"), {
                name: contactName,
                role: contactRole,
                phone: contactPhone,
                createdAt: new Date().toISOString(),
            });
            setContactName("");
            setContactPhone("");
        } catch (error) {
            console.error("Failed to add contact:", error);
            alert("Failed to add contact.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteContact = async (id: string) => {
        if (window.confirm("Remove this contact from the directory?")) {
            await deleteDoc(doc(db, "contacts", id));
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl border border-gray-200">
                <h2 className="text-base font-bold text-gray-900 mb-1">📞 Add Emergency & Vendor Contact</h2>
                <p className="text-xs text-gray-500 mb-4">Contacts are visible to tenants and employees on their emergency directory.</p>

                <form onSubmit={handleAddContact} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Contact Name</label>
                        <input
                            type="text"
                            required
                            placeholder="e.g. Ramesh Kumar"
                            value={contactName}
                            onChange={(e) => setContactName(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Role / Service</label>
                        <select
                            value={contactRole}
                            onChange={(e) => setContactRole(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                        >
                            <option value="Plumber">Plumber</option>
                            <option value="Electrician">Electrician</option>
                            <option value="Carpenter">Carpenter</option>
                            <option value="Security / Guard">Security / Guard</option>
                            <option value="Property Manager">Property Manager</option>
                            <option value="Doctor / Clinic">Doctor / Clinic</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Phone Number</label>
                        <input
                            type="text"
                            required
                            placeholder="+91 9876543210"
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
                        />
                    </div>
                    <div className="flex items-end">
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2.5 rounded-lg transition disabled:opacity-50"
                        >
                            {isSubmitting ? "Adding..." : "+ Save Contact"}
                        </button>
                    </div>
                </form>
            </div>

            {/* Contacts Directory */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {contacts.map(c => (
                    <div key={c.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex justify-between items-center">
                        <div>
                            <span className="text-[10px] font-bold uppercase bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                                {c.role}
                            </span>
                            <h4 className="font-bold text-gray-900 text-sm mt-1">{c.name}</h4>
                            <p className="text-xs text-gray-600 mt-0.5">📞 {c.phone}</p>
                        </div>
                        <button
                            onClick={() => handleDeleteContact(c.id)}
                            className="text-red-400 hover:text-red-600 text-xs font-bold p-1"
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
