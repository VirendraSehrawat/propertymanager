"use client";

import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui";
import { NAV_GROUPS, TAB_LABELS, groupOf, type EmployeeTab, type NavGroupId } from "@/lib/employeeNav";

interface EmployeeNavProps {
    activeTab: EmployeeTab;
    onSelect: (tab: EmployeeTab) => void;
    /** Small counts shown on screens and their group (e.g. pending invoices). */
    badges?: Partial<Record<EmployeeTab, number>>;
}

const Badge = ({ n, className = "" }: { n?: number; className?: string }) =>
    n && n > 0 ? <span className={`min-w-4.5 h-4.5 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-4.5 text-center ${className}`}>{n > 99 ? "99+" : n}</span> : null;

/**
 * Bottom navigation for the employee dashboard (§6.1): Home · Collect · Books
 * · Tasks · More, a segmented switch between the screens of the current group
 * (e.g. Collections | Monthly), and a "More" sheet for the less frequent ones.
 */
export function EmployeeSubTabs({ activeTab, onSelect, badges = {} }: EmployeeNavProps) {
    const group = groupOf(activeTab);
    if (group.tabs.length < 2) return null;
    if (group.id === "more") {
        const t = TAB_LABELS[activeTab];
        return <p className="text-xs font-bold text-gray-500 uppercase tracking-wide px-1">☰ More · {t.icon} {t.label}</p>;
    }
    return (
        <div role="tablist" aria-label={group.label} className="flex bg-gray-200 rounded-lg p-1 gap-1">
            {group.tabs.map(tab => {
                const t = TAB_LABELS[tab];
                const active = tab === activeTab;
                return (
                    <button
                        key={tab}
                        role="tab"
                        aria-selected={active}
                        onClick={() => onSelect(tab)}
                        className={`flex-1 min-h-11 rounded-md text-sm font-bold flex items-center justify-center gap-1.5 transition ${active ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:bg-gray-100"}`}
                    >
                        {t.icon} {t.label} <Badge n={badges[tab]} />
                    </button>
                );
            })}
        </div>
    );
}

export function EmployeeBottomNav({ activeTab, onSelect, badges = {} }: EmployeeNavProps) {
    const [isMoreOpen, setIsMoreOpen] = useState(false);
    const current = groupOf(activeTab).id;
    const groupBadge = (id: NavGroupId) =>
        NAV_GROUPS.find(g => g.id === id)!.tabs.reduce((s, t) => s + (badges[t] || 0), 0);
    const more = NAV_GROUPS.find(g => g.id === "more")!;

    return (
        <>
            <nav aria-label="Main" className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]">
                <div className="max-w-2xl mx-auto grid grid-cols-5">
                    {NAV_GROUPS.map(g => {
                        const active = g.id === current;
                        return (
                            <button
                                key={g.id}
                                type="button"
                                aria-current={active ? "page" : undefined}
                                onClick={() => (g.id === "more" ? setIsMoreOpen(true) : onSelect(g.tabs[0]))}
                                className={`relative min-h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${active ? "text-orange-600" : "text-gray-500"}`}
                            >
                                <span className="text-xl leading-none" aria-hidden>{g.icon}</span>
                                {g.label}
                                <Badge n={groupBadge(g.id)} className="absolute top-1 left-1/2 ml-2" />
                            </button>
                        );
                    })}
                </div>
            </nav>
            <Modal isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} bottomSheet>
                <h3 className="text-sm font-bold text-gray-500 uppercase mb-3">More</h3>
                <div className="grid grid-cols-3 gap-2">
                    {more.tabs.map(tab => {
                        const t = TAB_LABELS[tab];
                        return (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => { setIsMoreOpen(false); onSelect(tab); }}
                                className={`relative min-h-18 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold ${tab === activeTab ? "border-orange-400 bg-orange-50 text-orange-700" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                            >
                                <span className="text-2xl" aria-hidden>{t.icon}</span>
                                {t.label}
                                <Badge n={badges[tab]} className="absolute top-1.5 right-1.5" />
                            </button>
                        );
                    })}
                    <Link href="/employee/help" onClick={() => setIsMoreOpen(false)} className="min-h-18 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 flex flex-col items-center justify-center gap-1 text-xs font-bold">
                        <span className="text-2xl" aria-hidden>❓</span>
                        Help
                    </Link>
                </div>
            </Modal>
        </>
    );
}
