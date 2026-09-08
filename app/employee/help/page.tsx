"use client";

import Link from "next/link";

export default function EmployeeHelpPage() {
    return (
        <div className="min-h-screen bg-gray-100 pb-12">
            <nav className="bg-orange-600 px-4 py-4 flex justify-between items-center text-white shadow-md sticky top-0 z-10">
                <div>
                    <h1 className="text-xl font-bold tracking-tight">Staff Help Center</h1>
                    <p className="text-xs text-orange-200">Business rules & how to use the Staff Portal</p>
                </div>
                <Link href="/employee" className="text-sm bg-orange-700 hover:bg-orange-800 px-3 py-2 rounded-md font-medium transition shadow-sm">
                    ← Back to Portal
                </Link>
            </nav>

            <main className="p-4 max-w-3xl mx-auto mt-4 space-y-6">

                {/* QUICK INDEX */}
                <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-900 px-6 py-4">
                        <h2 className="text-lg font-bold text-white">📇 Quick Index</h2>
                    </div>
                    <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                        {[
                            ["💰", "What the invoice covers", "invoice-covers"],
                            ["📅", "Payment Day", "payment-day"],
                            ["⚡", "Meter Readings", "meter"],
                            ["🧾", "Generating Invoices", "invoices"],
                            ["💵", "Collecting Payments", "collect"],
                            ["🔁", "Partial Payments", "partial"],
                            ["🏦", "Daily Ledger", "ledger"],
                            ["🧹", "Expenses & Fund", "expenses"],
                            ["🏘️", "Units & Tenants", "units"],
                            ["🗑️", "Soft-Delete", "delete"],
                            ["🔒", "Manager-only", "manager"],
                            ["🧭", "Common Scenarios", "scenarios"],
                        ].map(([e, t, id]) => (
                            <a key={id} href={`#${id}`} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 hover:bg-orange-50 border border-gray-200 text-gray-700 hover:text-orange-700 transition">
                                <span className="text-lg">{e}</span>
                                <span className="text-xs font-medium">{t}</span>
                            </a>
                        ))}
                    </div>
                </section>

                {/* WHAT THE INVOICE COVERS */}
                <section id="invoice-covers" className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden scroll-mt-20">
                    <div className="bg-amber-50 px-6 py-4 border-b border-amber-200">
                        <h2 className="text-lg font-bold text-amber-800">💰 1. What the invoice covers</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>Every invoice generated for a billing month carries <strong>two different charges</strong> for <strong>two different periods</strong>:</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                <p className="font-bold text-blue-800">🏠 Rent</p>
                                <p className="text-xs text-blue-700 mt-1">Covers the <strong>upcoming month</strong> — from tenant&apos;s payment day to the same day next month.</p>
                            </div>
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                <p className="font-bold text-yellow-800">⚡ Electricity</p>
                                <p className="text-xs text-yellow-700 mt-1">Covers the <strong>month that just ended</strong> — the units read now were consumed last month.</p>
                            </div>
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700">
                            <p className="font-bold mb-1">Example (invoice dated 8 Sep 2026, tenant&apos;s payment day = 8):</p>
                            <p>🏠 Rent → <strong>8 Sep 2026 – 8 Oct 2026</strong></p>
                            <p>⚡ Electricity → <strong>August 2026</strong></p>
                        </div>
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-800 text-xs">
                            <strong>The app shows both periods</strong> in the Meter tab preview, on every Collections row, and on the Tenant portal.
                        </div>
                    </div>
                </section>

                {/* PAYMENT DAY */}
                <section id="payment-day" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden scroll-mt-20">
                    <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-200">
                        <h2 className="text-lg font-bold text-indigo-800">📅 2. Payment Day & Billing Month</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Payment Day</strong> is stored per-tenant (1–31). Edit from <strong>Tenant Profile → 📅 Payment & Security</strong>.</li>
                            <li>If not set, the app treats it as the <strong>1st of the month</strong>.</li>
                            <li>The <strong>Billing Month</strong> picker in Meter tab decides which month the invoice belongs to.</li>
                        </ul>
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 text-xs">
                            <strong>⚠️ Do NOT back-date</strong> a billing month unless you&apos;re correcting a mistake — it looks like double-billing.
                        </div>
                    </div>
                </section>

                {/* METER READINGS */}
                <section id="meter" className="bg-white rounded-xl shadow-sm border border-purple-200 overflow-hidden scroll-mt-20">
                    <div className="bg-purple-50 px-6 py-4 border-b border-purple-200">
                        <h2 className="text-lg font-bold text-purple-800">⚡ 3. Meter Readings</h2>
                    </div>
                    <div className="p-6 space-y-4 text-sm text-gray-700">
                        <div>
                            <h3 className="font-bold text-gray-800 mb-1">3a. Normal flow</h3>
                            <ol className="list-decimal pl-5 space-y-1">
                                <li>Open <strong>Meter</strong> tab → pick unit.</li>
                                <li>App auto-fills <strong>Previous Reading</strong> from last month.</li>
                                <li>Enter <strong>Current Reading</strong>.</li>
                                <li>Units consumed = current − previous.</li>
                                <li>Electricity = units × rate (per-tenant rate wins).</li>
                            </ol>
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 mb-1">3b. Meter changed / replaced</h3>
                            <p>Turn on <strong>⚠️ Meter was changed</strong>. Enter units consumed directly + the new meter&apos;s starting reading.</p>
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 mb-1">3c. Manual override</h3>
                            <p>If calculated consumption is wrong (shared meter, faulty display), enter <strong>Manual Units Consumed</strong> + a <strong>reason</strong> (stored on the invoice for audit).</p>
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 mb-1">3d. Per-tenant rate</h3>
                            <p>Set from <strong>Tenant Profile → ⚡ Electricity Rate</strong>. Leave empty to use the default. Historical invoices keep their original rate.</p>
                        </div>
                    </div>
                </section>

                {/* GENERATING INVOICES */}
                <section id="invoices" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden scroll-mt-20">
                    <div className="bg-blue-50 px-6 py-4 border-b border-blue-200">
                        <h2 className="text-lg font-bold text-blue-800">🧾 4. Generating an Invoice</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>One invoice per unit per billing month</strong>. If one exists, the app warns before overriding.</li>
                            <li>Invoice ID format: <code className="text-xs bg-gray-100 px-1 rounded">inv_&lt;unitId&gt;_MM_YYYY</code></li>
                            <li>Rent invoiced = unit&apos;s <strong>Base Rent</strong> (edit from Collections tab if needed).</li>
                            <li>After generating, <strong>lastMeterReading</strong> auto-updates so next month works.</li>
                        </ul>
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-800 text-xs">
                            <strong>💡 Carry-forward:</strong> Tenant&apos;s running balance is auto-added/subtracted as a <code>carryForward</code> line.
                        </div>
                    </div>
                </section>

                {/* COLLECTING PAYMENTS */}
                <section id="collect" className="bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden scroll-mt-20">
                    <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-200">
                        <h2 className="text-lg font-bold text-indigo-800">💵 5. Collecting Payments</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>From <strong>Collections</strong> tab, tap <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-bold">✓ Settle</span> on a pending invoice.</p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs border border-gray-200 rounded">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-bold">Mode</th>
                                        <th className="px-3 py-2 text-left font-bold">What to record</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    <tr><td className="px-3 py-2 font-bold">💵 Cash</td><td className="px-3 py-2">Just confirm. Stored as <code>CASH_COLLECTED</code>.</td></tr>
                                    <tr><td className="px-3 py-2 font-bold">📱 UPI</td><td className="px-3 py-2">Enter the UPI transaction ID / reference.</td></tr>
                                    <tr><td className="px-3 py-2 font-bold">🏦 Bank</td><td className="px-3 py-2">Enter the bank UTR / reference.</td></tr>
                                    <tr><td className="px-3 py-2 font-bold">📝 Cheque</td><td className="px-3 py-2">Enter cheque number.</td></tr>
                                </tbody>
                            </table>
                        </div>
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-800 text-xs">
                            The app stores mode + reference as <code>MODE:REFERENCE</code> (e.g. <code>UPI:9812…</code>). This is how the Settled Collections detail view decodes it.
                        </div>
                        <p className="text-xs"><strong>Payment note</strong> — optional free-text (e.g. &quot;partial ₹500 more due next visit&quot;) stored on the invoice.</p>
                    </div>
                </section>

                {/* PARTIAL PAYMENTS */}
                <section id="partial" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden scroll-mt-20">
                    <div className="bg-amber-50 px-6 py-4 border-b border-amber-200">
                        <h2 className="text-lg font-bold text-amber-800">🔁 6. Partial Payments & Balance Roll-over</h2>
                    </div>
                    <div className="p-6 space-y-2 text-sm text-gray-700">
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Enter <strong>Amount Paid</strong> &lt; invoice total → invoice stays <strong>unpaid</strong> with a <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-xs font-bold">Partial</span> chip.</li>
                            <li><code>amountPaid</code> accumulates the received amount.</li>
                            <li>Unpaid balance <strong>rolls forward</strong> into next month&apos;s invoice as <code>carryForward</code>.</li>
                            <li>The Home dashboard&apos;s <strong>⚠️ Previous Month Balance</strong> card lists every tenant still carrying dues.</li>
                        </ul>
                    </div>
                </section>

                {/* DAILY LEDGER */}
                <section id="ledger" className="bg-white rounded-xl shadow-sm border border-teal-200 overflow-hidden scroll-mt-20">
                    <div className="bg-teal-50 px-6 py-4 border-b border-teal-200">
                        <h2 className="text-lg font-bold text-teal-800">🏦 7. Daily Ledger (Inflow / Outflow)</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>The <strong>Daily Ledger</strong> is the source of truth for <strong>cash movement day by day</strong>.</p>
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                            <p className="font-bold text-green-800">📥 Inflow — money received</p>
                            <ul className="list-disc pl-5 text-xs mt-1 space-y-0.5 text-green-800">
                                <li>Against an unpaid invoice? The app <strong>auto-settles</strong> it (<code>DAILY_LEDGER_AUTOSETTLE</code>).</li>
                                <li>No invoice for this unit this month? The app <strong>auto-creates one</strong> and settles it.</li>
                            </ul>
                        </div>
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                            <p className="font-bold text-red-800">📤 Outflow — money spent</p>
                            <ul className="list-disc pl-5 text-xs mt-1 space-y-0.5 text-red-800">
                                <li>Outflow entries are <strong>mirrored to Expenses</strong> — both views stay in sync.</li>
                                <li>Attach a <strong>receipt photo</strong> when you can (Cloudinary upload).</li>
                            </ul>
                        </div>
                    </div>
                </section>

                {/* EXPENSES */}
                <section id="expenses" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden scroll-mt-20">
                    <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-200">
                        <h2 className="text-lg font-bold text-emerald-800">🧹 8. Expenses & Allocated Fund</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Allocated Fund</strong> = money the manager set aside for repairs/supplies. Add from <strong>Expenses tab → + Allocate</strong>.</li>
                            <li>Every expense you <strong>✓ Settle</strong> deducts from the fund.</li>
                            <li>If settled expenses exceed the fund, an <strong>⚠️ Overspent</strong> warning appears.</li>
                            <li>Every expense also appears in <strong>Daily Ledger</strong> as an outflow (mirrored).</li>
                        </ul>
                    </div>
                </section>

                {/* UNITS */}
                <section id="units" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden scroll-mt-20">
                    <div className="bg-blue-50 px-6 py-4 border-b border-blue-200">
                        <h2 className="text-lg font-bold text-blue-800">🏘️ 9. Units & Tenants</h2>
                    </div>
                    <div className="p-6 space-y-4 text-sm text-gray-700">
                        <div>
                            <h3 className="font-bold text-gray-800 mb-1">9a. Assigning a tenant</h3>
                            <p>Only vacant units accept new tenants. Fields: name, phone, email, <strong>payment day</strong>, <strong>security deposit</strong>. The unit becomes <code>occupied</code>.</p>
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 mb-1">9b. Removing a tenant</h3>
                            <p>App warns about the <strong>refund amount</strong>. Move-out checklist deduction is subtracted from the deposit. Tenant record is copied into <code>tenantHistory</code>.</p>
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 mb-1">9c. Transferring a tenant</h3>
                            <p>Move a tenant A → B, optionally generate a <strong>pro-rated final invoice</strong> for the old room. Old unit&apos;s meter reading at transfer date is respected.</p>
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 mb-1">9d. Co-tenants</h3>
                            <p>Multiple people can live in one unit — only the primary&apos;s email logs into the tenant portal. Co-tenants are contacts only.</p>
                        </div>
                    </div>
                </section>

                {/* SOFT DELETE */}
                <section id="delete" className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden scroll-mt-20">
                    <div className="bg-red-50 px-6 py-4 border-b border-red-200">
                        <h2 className="text-lg font-bold text-red-800">🗑️ 10. Deleting Data (Soft Delete)</h2>
                    </div>
                    <div className="p-6 space-y-2 text-sm text-gray-700">
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Expenses & Daily Ledger entries</strong> can be soft-deleted with a <strong>mandatory reason</strong>. Record is flagged (<code>deleted: true</code>, <code>deleteReason</code>, <code>deletedBy</code>, <code>deletedAt</code>).</li>
                            <li>Expense ⇌ ledger are back-linked → deleting one cascades to the other.</li>
                            <li><strong>Invoices cannot be deleted by staff.</strong> Edit them for corrections; escalate to manager if wrong.</li>
                            <li><strong>Allocations</strong> are hard-deleted (reduces the allocated fund).</li>
                        </ul>
                    </div>
                </section>

                {/* MANAGER ONLY */}
                <section id="manager" className="bg-white rounded-xl shadow-sm border border-gray-300 overflow-hidden scroll-mt-20">
                    <div className="bg-gray-100 px-6 py-4 border-b border-gray-300">
                        <h2 className="text-lg font-bold text-gray-800">🔒 11. What Only the Manager Can Do</h2>
                    </div>
                    <div className="p-6 space-y-2 text-sm text-gray-700">
                        <p>You <strong>cannot</strong>:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Approve tenant-submitted payment verifications</li>
                            <li>Approve new tenant applications</li>
                            <li>Broadcast announcements</li>
                            <li>Apply late fees in bulk</li>
                            <li>Bulk-generate invoices for every unit in one click</li>
                            <li>Export financial CSVs</li>
                            <li>Hard-delete invoices</li>
                        </ul>
                        <p className="text-xs text-gray-500 mt-2">Everything else — meter readings, individual invoices, collections, expenses, checklists, maintenance, tenant directory — is yours.</p>
                    </div>
                </section>

                {/* SCENARIOS */}
                <section id="scenarios" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden scroll-mt-20">
                    <div className="bg-gray-900 px-6 py-4">
                        <h2 className="text-lg font-bold text-white">🧭 12. Common Scenarios</h2>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {[
                            {
                                q: "Tenant just paid rent — what do I do?",
                                a: "Open Collections → find the invoice → tap ✓ Settle → pick mode → enter reference (if not cash) → Save.",
                            },
                            {
                                q: "Tenant paid, but there's no invoice yet.",
                                a: "Open Daily Ledger → + Inflow. Pick unit + amount. The app auto-creates the current month's invoice and settles it.",
                            },
                            {
                                q: "It's month-end — how do I bill everyone?",
                                a: "Open Meter tab. Record each reading — the app auto-generates the invoice (rent for upcoming month + electricity for last month). For bulk, ask the manager to use the admin Generate Invoices button.",
                            },
                            {
                                q: "Tenant wants to pay only part of the rent.",
                                a: "Settle with Amount Paid = partial amount. Invoice shows Partial; balance rolls forward to next month.",
                            },
                            {
                                q: "I recorded a wrong reading.",
                                a: "In Collections tap ✏️ Edit on the invoice → correct meter fields → Save. Unit's lastMeterReading also updates.",
                            },
                            {
                                q: "I made a wrong expense entry.",
                                a: "In Expenses (or Daily Ledger) tap 🗑 → give a reason. It's soft-deleted; audit trail preserved.",
                            },
                        ].map((s, i) => (
                            <div key={i} className="p-5">
                                <p className="font-bold text-gray-800 text-sm mb-1">❓ {s.q}</p>
                                <p className="text-sm text-gray-600">→ {s.a}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* GOLDEN RULES */}
                <section className="bg-white rounded-xl shadow-sm border border-red-300 overflow-hidden">
                    <div className="bg-red-600 px-6 py-4">
                        <h2 className="text-lg font-bold text-white">🚨 13. Golden Rules</h2>
                    </div>
                    <div className="p-6 space-y-2 text-sm text-gray-700">
                        <ol className="list-decimal pl-5 space-y-1.5">
                            <li><strong>Never fake a meter reading.</strong> Previous vs current are stored — any discrepancy is auditable.</li>
                            <li><strong>Always include a reason</strong> when overriding units consumed or deleting an entry.</li>
                            <li><strong>Cash collected today must appear in Daily Ledger today</strong> — even if deposited tomorrow.</li>
                            <li><strong>Every rupee out has a receipt.</strong> Upload the photo.</li>
                            <li><strong>The tenant portal is a mirror.</strong> Anything you mark paid, they see. Be accurate; don&apos;t guess.</li>
                        </ol>
                    </div>
                </section>

                <p className="text-center text-xs text-gray-400 pt-2">Last updated 8 September 2026 · If a rule here disagrees with the app, the app is authoritative — please notify the manager.</p>
            </main>
        </div>
    );
}
