"use client";

import Link from "next/link";

export default function EmployeeHelpPage() {
    return (
        <div className="min-h-screen bg-gray-100 pb-12">
            <nav className="bg-orange-600 px-4 py-4 flex justify-between items-center text-white shadow-md sticky top-0 z-10">
                <div>
                    <h1 className="text-xl font-bold tracking-tight">Staff Help Center</h1>
                    <p className="text-xs text-orange-200">How to use the Staff Portal</p>
                </div>
                <Link href="/employee" className="text-sm bg-orange-700 hover:bg-orange-800 px-3 py-2 rounded-md font-medium transition shadow-sm">
                    ← Back to Portal
                </Link>
            </nav>

            <main className="p-4 max-w-3xl mx-auto mt-4 space-y-6">

                {/* GETTING STARTED */}
                <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-orange-50 px-6 py-4 border-b border-orange-200">
                        <h2 className="text-lg font-bold text-orange-800">🚀 Getting Started</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>Welcome to the <strong>Staff Portal</strong>. You can manage maintenance tasks, record meter readings, collect payments, and view tenant ledgers.</p>
                        <p>Use the <strong>tab bar</strong> at the top to switch between sections:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Collections</strong> — View and settle pending invoices</li>
                            <li><strong>Tasks</strong> — Handle maintenance requests from tenants</li>
                            <li><strong>Meter</strong> — Record electricity meter readings and generate invoices</li>
                            <li><strong>Done</strong> — View resolved maintenance tickets</li>
                            <li><strong>Ledger</strong> — View tenant payment history and balances</li>
                        </ul>
                    </div>
                </section>

                {/* COLLECTIONS */}
                <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-200">
                        <h2 className="text-lg font-bold text-indigo-800">💰 Collections Tab</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>This tab shows all <strong>pending and unpaid invoices</strong> across all tenants.</p>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                            <h3 className="font-bold text-gray-800">How to settle an invoice:</h3>
                            <ol className="list-decimal pl-5 space-y-1">
                                <li>Filter by billing period using the dropdown at the top</li>
                                <li>Find the tenant&apos;s invoice in the list</li>
                                <li>Click the <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-bold">✓ Settle</span> button</li>
                                <li>Confirm the settlement — this marks the invoice as <strong>paid</strong> and creates a ledger entry</li>
                            </ol>
                        </div>
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-800 text-xs">
                            <strong>💡 Tip:</strong> Use the summary cards at the top to quickly see total pending rent and electricity amounts.
                        </div>
                    </div>
                </section>

                {/* MAINTENANCE TASKS */}
                <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-orange-50 px-6 py-4 border-b border-orange-200">
                        <h2 className="text-lg font-bold text-orange-800">🔧 Maintenance Tasks</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>Tenants submit maintenance requests which appear in the <strong>Tasks</strong> tab.</p>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                            <h3 className="font-bold text-gray-800">Workflow:</h3>
                            <ol className="list-decimal pl-5 space-y-1">
                                <li><strong>New request arrives</strong> — Status is &quot;PENDING&quot;</li>
                                <li>Click <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">Mark In-Progress</span> to acknowledge</li>
                                <li>Visit the unit, fix the issue</li>
                                <li>Upload a <strong>photo proof</strong> of the fix</li>
                                <li>Add a <strong>comment</strong> describing what was done</li>
                                <li>Click <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-bold">Mark Resolved</span> to close the ticket</li>
                            </ol>
                        </div>
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-800 text-xs">
                            <strong>📸 Photo proof:</strong> Always upload a resolution photo. This helps the admin verify the work was completed and protects against disputes.
                        </div>
                    </div>
                </section>

                {/* METER READING */}
                <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-purple-50 px-6 py-4 border-b border-purple-200">
                        <h2 className="text-lg font-bold text-purple-800">⚡ Meter Reading & Invoice Generation</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>Use the <strong>Meter</strong> tab to record electricity readings and auto-generate invoices.</p>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                            <h3 className="font-bold text-gray-800">Steps:</h3>
                            <ol className="list-decimal pl-5 space-y-1">
                                <li>Select the <strong>unit</strong> from the dropdown (shows last reading)</li>
                                <li>Select the <strong>billing month</strong></li>
                                <li>Enter the <strong>current meter reading</strong></li>
                                <li>Review the <strong>live preview</strong> showing rent + electricity breakdown</li>
                                <li>Click <strong>Generate Invoice</strong></li>
                            </ol>
                        </div>
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-800 text-xs">
                            <strong>⚠️ Override warning:</strong> If an invoice already exists for that unit and month, you&apos;ll be asked to confirm before overriding it.
                        </div>
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-800 text-xs">
                            <strong>💡 Carry-forward:</strong> The system automatically checks the tenant&apos;s ledger balance. If they overpaid or underpaid previously, the difference is added to the new invoice.
                        </div>
                    </div>
                </section>

                {/* LEDGER */}
                <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-teal-50 px-6 py-4 border-b border-teal-200">
                        <h2 className="text-lg font-bold text-teal-800">📒 Tenant Ledger</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>The <strong>Ledger</strong> tab shows the complete payment history for all tenants.</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Summary view</strong> — Shows each tenant with their running balance (Credit or Due)</li>
                            <li><strong>Detail view</strong> — Click on a tenant to see all individual payments with dates, amounts, and running balance</li>
                            <li>Use the <strong>dropdown filter</strong> to quickly find a specific tenant</li>
                        </ul>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
                            <strong>Balance meanings:</strong><br />
                            <span className="text-green-700 font-bold">₹X CR</span> = Tenant has credit (overpaid)<br />
                            <span className="text-red-700 font-bold">₹X DUE</span> = Tenant owes money (underpaid)
                        </div>
                    </div>
                </section>

                {/* TENANT PROFILE */}
                <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                        <h2 className="text-lg font-bold text-gray-800">👤 Tenant Profiles</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>In the <strong>Collections</strong> tab, click <strong>&quot;View Profile →&quot;</strong> next to a tenant to open their profile.</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Edit details</strong> — Update tenant name, phone, email</li>
                            <li><strong>Documents</strong> — Upload ID proofs, agreements (tagged as &quot;Staff&quot;)</li>
                            <li><strong>Notes</strong> — Add internal notes about the tenant (tagged as &quot;Staff&quot;)</li>
                        </ul>
                    </div>
                </section>

                {/* FAQ */}
                <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-900 px-6 py-4">
                        <h2 className="text-lg font-bold text-white">❓ Frequently Asked Questions</h2>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {[
                            { q: "What if I enter the wrong meter reading?", a: "You can generate the invoice again for the same month — the system will ask if you want to override it." },
                            { q: "Can I settle an invoice without the tenant paying online?", a: "Yes! Use the Settle button in the Collections tab for cash payments. It will be recorded as 'CASH_COLLECTED'." },
                            { q: "What happens if a tenant pays less than the invoice?", a: "The difference is tracked in the ledger as 'Due' and will be carried forward to the next invoice automatically." },
                            { q: "Can I see which invoices I settled vs admin?", a: "Yes — ledger entries include who settled them (employee or admin)." },
                            { q: "How do I contact the admin?", a: "Please contact the property manager directly for any issues you cannot resolve through the portal." },
                        ].map((faq, i) => (
                            <div key={i} className="p-5">
                                <p className="font-bold text-gray-800 text-sm mb-1">{faq.q}</p>
                                <p className="text-sm text-gray-600">{faq.a}</p>
                            </div>
                        ))}
                    </div>
                </section>
            </main>
        </div>
    );
}
