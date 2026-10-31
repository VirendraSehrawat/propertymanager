"use client";

import type { TodayItem, TodayList } from "@/lib/todayList";
import { paymentReminderText, telLink, whatsAppLink } from "@/lib/contact";
import { billingMonthLabel } from "@/lib/meterRound";
import type { HomeTabNavTarget } from "./HomeTab";

interface TodayCardProps {
    today: TodayList;
    onNavigate: (tab: HomeTabNavTarget) => void;
    /** Opens Collections' Record Payment modal for one invoice. */
    onRecordPayment?: (invoiceId: string) => void;
    /** Units whose tenant got today's automatic payment reminder (§3.4). */
    remindedUnitIds?: ReadonlySet<string>;
    /** Opens 📞 Log follow-up for a unit (§3.5). */
    onLogFollowUp?: (unitId: string, remaining: number) => void;
}

const actionBtn = "text-[11px] font-bold px-2.5 py-1 rounded-md border transition";

/**
 * Home's "Today" list (§3.2 of `docs/EMPLOYEE_WORKFLOW_IMPROVEMENTS.md`):
 * round-wide items first, then unit items grouped by building in walking
 * order. Pure presentation — the list itself comes from `buildTodayList`.
 */
export function TodayCard({ today, onNavigate, onRecordPayment, remindedUnitIds, onLogFollowUp }: TodayCardProps) {
    const renderItem = (item: TodayItem) => {
        if (item.kind === "rent") {
            const reminder = paymentReminderText({
                tenantName: item.tenantName,
                unitNumber: item.unitNumber,
                billingPeriod: item.invoiceCount > 1 ? `${item.billingPeriod} and ${item.invoiceCount - 1} more` : item.billingPeriod,
                remaining: item.remaining,
                paid: item.paid,
            });
            const tel = telLink(item.tenantPhone);
            const wa = whatsAppLink(item.tenantPhone, reminder);
            return (
                <div key={item.key} className="px-4 py-2.5">
                    <div className="flex justify-between items-start gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-gray-900 text-sm">💰 {item.unitNumber}</span>
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${item.daysLate === 0 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                                    {item.daysLate === 0 ? "Due today" : `${item.daysLate}d late`}
                                </span>
                                {item.paid > 0 && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Partial</span>}
                                {item.promiseState && (
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${item.promiseState === "broken" ? "bg-red-600 text-white" : "bg-emerald-100 text-emerald-800"}`}>
                                        {item.promiseState === "broken" ? "Broken promise" : "Promised today"}
                                    </span>
                                )}
                                {item.unitId && remindedUnitIds?.has(item.unitId) && (
                                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-sky-100 text-sky-800" title="Automatic Telegram reminder sent today">🔔 Reminded</span>
                                )}
                            </div>
                            <p className="text-[11px] text-gray-600 truncate">{item.tenantName || "—"} · {item.billingPeriod}{item.invoiceCount > 1 ? ` +${item.invoiceCount - 1} more` : ""}</p>
                            {item.followUpLabel && <p className="text-[10px] text-gray-500">📝 {item.followUpLabel}</p>}
                        </div>
                        <p className="font-bold text-red-700 text-sm shrink-0">₹{item.remaining.toLocaleString()}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {item.corporate || !onRecordPayment ? (
                            <button type="button" onClick={() => onNavigate("collections")} className={`${actionBtn} bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100`}>
                                💳 {item.corporate ? "Corporate → Collections" : "Collections"}
                            </button>
                        ) : (
                            <button type="button" onClick={() => onRecordPayment(item.invoiceId)} className={`${actionBtn} bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100`}>
                                💳 Record payment
                            </button>
                        )}
                        {tel && <a href={tel} className={`${actionBtn} bg-white border-gray-300 text-gray-700 hover:bg-gray-50`}>📞 Call</a>}
                        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className={`${actionBtn} bg-green-50 border-green-200 text-green-700 hover:bg-green-100`}>💬 WhatsApp</a>}
                        {onLogFollowUp && item.unitId && (
                            <button type="button" onClick={() => onLogFollowUp(item.unitId!, item.remaining)} className={`${actionBtn} bg-white border-gray-300 text-gray-700 hover:bg-gray-50`}>📝 Log follow-up</button>
                        )}
                    </div>
                </div>
            );
        }
        if (item.kind === "ticket") {
            return (
                <button key={item.key} type="button" onClick={() => onNavigate("active")} className="w-full text-left px-4 py-2.5 flex justify-between items-center gap-3 hover:bg-orange-50 transition">
                    <div className="min-w-0">
                        <p className="font-bold text-gray-900 text-sm">🔧 {item.unitNumber} <span className="text-[10px] font-medium text-orange-700">open {item.ageDays} days · {item.status}</span></p>
                        <p className="text-[11px] text-gray-600 line-clamp-1">{item.description}</p>
                    </div>
                    <span className="text-[11px] font-bold text-orange-700 shrink-0">Open ticket →</span>
                </button>
            );
        }
        const when = item.daysLeft < 0 ? `ended ${-item.daysLeft}d ago` : item.daysLeft === 0 ? "ends today" : `ends in ${item.daysLeft}d`;
        return (
            <button key={item.key} type="button" onClick={() => onNavigate("checklist")} className="w-full text-left px-4 py-2.5 flex justify-between items-center gap-3 hover:bg-pink-50 transition">
                <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm">📦 {item.unitNumber} <span className="text-[10px] font-medium text-pink-700">lease {when}</span></p>
                    <p className="text-[11px] text-gray-600 truncate">{item.tenantName || "—"} · {new Date(item.leaseEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                <span className="text-[11px] font-bold text-pink-700 shrink-0">📋 Checklist →</span>
            </button>
        );
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border-2 border-indigo-200 overflow-hidden">
            <div className="bg-indigo-50 px-4 py-3 border-b border-indigo-200 flex justify-between items-center">
                <div>
                    <h3 className="text-sm font-bold text-indigo-900">📋 Today</h3>
                    <p className="text-[10px] text-indigo-700 mt-0.5">Rent due, meter round, old tickets and lease ends — by building</p>
                </div>
                <span className="text-xs font-bold bg-indigo-200 text-indigo-900 px-2 py-0.5 rounded-full">{today.count}</span>
            </div>
            {today.count === 0 ? (
                <p className="p-5 text-sm text-gray-500 text-center">🎉 Nothing due today.{today.promisedLater > 0 ? ` (${today.promisedLater} promised to pay later.)` : ""}</p>
            ) : (
                <div className="divide-y divide-gray-100">
                    {today.general.map(g => g.kind === "meterRound" ? (
                        <button key={g.key} type="button" onClick={() => onNavigate("meter")} className="w-full text-left px-4 py-2.5 flex justify-between items-center gap-3 hover:bg-purple-50 transition">
                            <div>
                                <p className="font-bold text-gray-900 text-sm">⚡ Meter round — {billingMonthLabel(g.billingMonth)}</p>
                                <p className="text-[11px] text-gray-600">{g.done} of {g.total} done · {g.pending} to read</p>
                            </div>
                            <span className="text-[11px] font-bold text-purple-700 shrink-0">Continue round →</span>
                        </button>
                    ) : (
                        <button key={g.key} type="button" onClick={() => onNavigate("meter")} className="w-full text-left px-4 py-2.5 flex justify-between items-center gap-3 hover:bg-purple-50 transition">
                            <div>
                                <p className="font-bold text-gray-900 text-sm">📝 {g.count} draft reading{g.count !== 1 ? "s" : ""} saved</p>
                                <p className="text-[11px] text-gray-600">Read but not invoiced yet</p>
                            </div>
                            <span className="text-[11px] font-bold text-purple-700 shrink-0">🧾 Generate {g.count} invoice{g.count !== 1 ? "s" : ""} →</span>
                        </button>
                    ))}
                    {today.promisedLater > 0 && (
                        <p className="px-4 py-1.5 text-[10px] text-emerald-800 bg-emerald-50">🤝 {today.promisedLater} tenant{today.promisedLater !== 1 ? "s" : ""} promised to pay on a later date — not listed today.</p>
                    )}
                    {today.groups.map(group => (
                        <div key={group.buildingName}>
                            <div className="bg-gray-50 px-4 py-1.5 flex justify-between items-center">
                                <span className="text-[11px] font-bold text-gray-700">🏢 {group.buildingName}</span>
                                <span className="text-[10px] text-gray-500">{group.items.length}</span>
                            </div>
                            <div className="divide-y divide-gray-100">{group.items.map(renderItem)}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
