"use client";

import { useState } from "react";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AppUser } from "@/types";

interface AdminUsersTabProps {
    users: AppUser[];
    currentUserId?: string;
}

export function AdminUsersTab({ users, currentUserId }: AdminUsersTabProps) {
    const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

    const handleRoleChange = async (userId: string, newRole: "admin" | "employee" | "tenant") => {
        setUpdatingUserId(userId);
        try {
            await updateDoc(doc(db, "users", userId), { role: newRole });
        } catch (error) {
            console.error("Failed to update role:", error);
            alert("Failed to update role.");
        } finally {
            setUpdatingUserId(null);
        }
    };

    const handleDeleteUser = async (userId: string, email?: string) => {
        if (!window.confirm(`Delete user account ${email || userId}? This cannot be undone.`)) return;
        try {
            await deleteDoc(doc(db, "users", userId));
        } catch (error) {
            console.error("Failed to delete user:", error);
            alert("Failed to delete user.");
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200">
                <h2 className="text-lg font-bold text-gray-900">👥 User Accounts & Access Control</h2>
                <p className="text-xs text-gray-500 mt-0.5">{users.length} registered profiles with role-based permissions</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-gray-600">
                        <thead className="bg-gray-50 text-gray-500 uppercase font-bold border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3">User / Email</th>
                                <th className="px-4 py-3">Phone</th>
                                <th className="px-4 py-3">Current Role</th>
                                <th className="px-4 py-3">Change Role</th>
                                <th className="px-4 py-3 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {users.map(u => (
                                <tr key={u.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <p className="font-bold text-gray-900">{u.name || "—"}</p>
                                        <p className="text-[11px] text-gray-500">{u.email || u.id}</p>
                                    </td>
                                    <td className="px-4 py-3 text-gray-500">{u.phone || "—"}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                            u.role === "admin"
                                                ? "bg-purple-100 text-purple-800"
                                                : u.role === "employee"
                                                ? "bg-blue-100 text-blue-800"
                                                : "bg-emerald-100 text-emerald-800"
                                        }`}>
                                            {u.role || "tenant"}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <select
                                            disabled={updatingUserId === u.id || u.id === currentUserId}
                                            value={u.role || "tenant"}
                                            onChange={(e) => handleRoleChange(u.id, e.target.value as "admin" | "employee" | "tenant")}
                                            className="px-2 py-1 border border-gray-300 rounded text-xs outline-none bg-white focus:border-blue-500 disabled:opacity-50"
                                        >
                                            <option value="tenant">Tenant</option>
                                            <option value="employee">Employee</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        {u.id !== currentUserId && (
                                            <button
                                                onClick={() => handleDeleteUser(u.id, u.email)}
                                                className="text-red-400 hover:text-red-600 font-bold"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
