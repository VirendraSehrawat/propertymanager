"use client";

import Link from "next/link";

export default function TenantHelpPage() {
    return (
        <div className="min-h-screen bg-gray-50 pb-12">
            <nav className="bg-blue-600 px-6 py-4 flex justify-between items-center text-white shadow-md">
                <h1 className="text-xl font-bold">Help & Guide</h1>
                <Link href="/tenant" className="text-sm bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded transition">
                    ← Back to Portal
                </Link>
            </nav>

            <main className="p-6 max-w-3xl mx-auto mt-4 space-y-6">

                {/* GETTING STARTED */}
                <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-blue-50 px-6 py-4 border-b border-blue-200">
                        <h2 className="text-lg font-bold text-blue-800">🏠 Getting Started</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>Welcome to the <strong>Tenant Portal</strong>! Here you can view your unit info, pay invoices, track payments, and request maintenance.</p>
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-800 text-xs">
                            <strong>First time?</strong> If you don&apos;t have a unit assigned yet, you&apos;ll see available units to apply for. Once approved by the admin, you&apos;ll see your dashboard.
                        </div>
                    </div>
                </section>

                {/* APPLYING FOR A UNIT */}
                <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-200">
                        <h2 className="text-lg font-bold text-indigo-800">📋 Applying for a Unit</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>If you&apos;re new and haven&apos;t been assigned a unit:</p>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                            <ol className="list-decimal pl-5 space-y-1">
                                <li>Browse <strong>available units</strong> grouped by building</li>
                                <li>Click <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">Apply Now</span> on the unit you want</li>
                                <li>Upload your <strong>ID proof</strong> (Aadhaar, PAN, etc.) — this is required</li>
                                <li>Optionally upload the <strong>security deposit receipt</strong> and transaction ID</li>
                                <li>Submit the application</li>
                                <li>Wait for the admin to <strong>approve</strong> your application</li>
                            </ol>
                        </div>
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-800 text-xs">
                            <strong>💡 Tip:</strong> You can submit the application without the deposit receipt and upload it later using the &quot;Add Deposit Receipt&quot; button.
                        </div>
                    </div>
                </section>

                {/* PAYING INVOICES */}
                <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-green-50 px-6 py-4 border-b border-green-200">
                        <h2 className="text-lg font-bold text-green-800">💸 Paying Your Invoices</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>When the property manager generates your monthly invoice, it appears in the <strong>My Invoices</strong> section.</p>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                            <h3 className="font-bold text-gray-800">How to pay:</h3>
                            <ol className="list-decimal pl-5 space-y-1">
                                <li>Find the <strong>unpaid invoice</strong> and click <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">Pay ₹X Now</span></li>
                                <li>The payment modal shows a <strong>UPI QR code</strong> — scan it with GPay, PhonePe, or Paytm</li>
                                <li>On mobile, tap <strong>&quot;Open UPI App to Pay&quot;</strong> to pay directly</li>
                                <li>After payment, enter the <strong>amount you paid</strong> (leave blank for exact amount)</li>
                                <li>Enter the <strong>12-digit UTR / Transaction ID</strong> from your UPI app</li>
                                <li>Upload a <strong>screenshot</strong> of the completed payment</li>
                                <li>Click <strong>Submit for Verification</strong></li>
                            </ol>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                                <p className="text-xs font-bold text-red-700 uppercase">Unpaid</p>
                                <p className="text-xs text-red-600 mt-1">Invoice generated, payment pending from you</p>
                            </div>
                            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-center">
                                <p className="text-xs font-bold text-orange-700 uppercase">Verification Pending</p>
                                <p className="text-xs text-orange-600 mt-1">You&apos;ve paid, admin is verifying</p>
                            </div>
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                                <p className="text-xs font-bold text-green-700 uppercase">Paid ✅</p>
                                <p className="text-xs text-green-600 mt-1">Payment verified by admin</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* PARTIAL PAYMENTS */}
                <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-yellow-50 px-6 py-4 border-b border-yellow-200">
                        <h2 className="text-lg font-bold text-yellow-800">💡 Partial & Advance Payments</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>You can pay <strong>more or less</strong> than the invoice amount:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Partial payment</strong> — Pay less than the invoice. The remaining amount will be carried forward and added to your next invoice.</li>
                            <li><strong>Advance payment</strong> — Pay more than the invoice. The extra amount will be credited and deducted from your next invoice.</li>
                        </ul>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
                            The system shows you a <strong>real-time preview</strong> of what happens when you enter a different amount in the payment modal.
                        </div>
                    </div>
                </section>

                {/* PAYMENT LEDGER */}
                <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-teal-50 px-6 py-4 border-b border-teal-200">
                        <h2 className="text-lg font-bold text-teal-800">📒 Payment Ledger</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>The <strong>Payment Ledger</strong> section below your invoices shows your complete payment history.</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Current Balance</strong> — Shows if you have a credit or amount due</li>
                            <li><strong>History table</strong> — Each row shows the date, billing period, invoice amount, what you paid, and running balance</li>
                        </ul>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
                            <span className="text-green-700 font-bold">+₹X</span> = You have credit (overpaid)<br />
                            <span className="text-red-700 font-bold">-₹X</span> = You owe this amount (will be in next invoice)
                        </div>
                    </div>
                </section>

                {/* MAINTENANCE */}
                <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-orange-50 px-6 py-4 border-b border-orange-200">
                        <h2 className="text-lg font-bold text-orange-800">🔧 Requesting Maintenance</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>If something in your unit needs repair:</p>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                            <ol className="list-decimal pl-5 space-y-1">
                                <li>Click the <strong>&quot;Request Maintenance&quot;</strong> button</li>
                                <li>Select a <strong>category</strong> (Plumbing, Electrical, Appliance, etc.)</li>
                                <li>Describe the <strong>issue</strong> in detail</li>
                                <li>Optionally upload a <strong>photo</strong> of the problem</li>
                                <li>Submit the ticket</li>
                            </ol>
                        </div>
                        <p>Track your requests in the <strong>Maintenance Requests</strong> section. Each ticket shows its current status:</p>
                        <div className="grid grid-cols-3 gap-2 mt-2">
                            <div className="bg-red-50 border border-red-200 rounded p-2 text-center">
                                <p className="text-[10px] font-bold text-red-700">PENDING</p>
                                <p className="text-[10px] text-gray-500">Submitted</p>
                            </div>
                            <div className="bg-blue-50 border border-blue-200 rounded p-2 text-center">
                                <p className="text-[10px] font-bold text-blue-700">IN-PROGRESS</p>
                                <p className="text-[10px] text-gray-500">Staff working on it</p>
                            </div>
                            <div className="bg-green-50 border border-green-200 rounded p-2 text-center">
                                <p className="text-[10px] font-bold text-green-700">RESOLVED</p>
                                <p className="text-[10px] text-gray-500">Fixed!</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* NOTICE BOARD */}
                <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-yellow-50 px-6 py-4 border-b border-yellow-200">
                        <h2 className="text-lg font-bold text-yellow-800">📢 Notice Board</h2>
                    </div>
                    <div className="p-6 space-y-3 text-sm text-gray-700">
                        <p>Important announcements from the property manager appear at the top of your dashboard.</p>
                        <p>You&apos;ll see notices meant for <strong>all buildings</strong> as well as notices specific to <strong>your building</strong>.</p>
                    </div>
                </section>

                {/* INVOICE BREAKDOWN */}
                <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                        <h2 className="text-lg font-bold text-gray-800">🧾 Understanding Your Invoice</h2>
                    </div>
                    <div className="p-6 text-sm text-gray-700">
                        <p className="mb-3">Each monthly invoice contains:</p>
                        <div className="bg-gray-50 border border-gray-100 p-4 rounded-lg space-y-2 font-mono text-xs">
                            <div className="flex justify-between"><span>Base Rent</span><span>₹ X,XXX</span></div>
                            <div className="flex justify-between"><span>Electricity (Y units × ₹Z/unit)</span><span>+ ₹ X,XXX</span></div>
                            <div className="flex justify-between text-red-600"><span>Previous Due (if any)</span><span>+ ₹ XXX</span></div>
                            <div className="flex justify-between text-green-600"><span>Credit Applied (if any)</span><span>- ₹ XXX</span></div>
                            <div className="border-t border-gray-300 pt-2 flex justify-between font-bold text-gray-900"><span>Total Due</span><span>₹ X,XXX</span></div>
                        </div>
                        <p className="mt-3 text-xs text-gray-500">Ad-hoc charges (like late fees or custom bills) appear separately.</p>
                    </div>
                </section>

                {/* FAQ */}
                <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-900 px-6 py-4">
                        <h2 className="text-lg font-bold text-white">❓ Frequently Asked Questions</h2>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {[
                            { q: "Where do I find my UPI QR code for payment?", a: "Click the 'Pay' button on any unpaid invoice. The QR code and UPI ID will be shown in the payment modal." },
                            { q: "What is UTR / Transaction ID?", a: "After making a UPI payment, your UPI app shows a 12-digit reference number (UTR). You need to enter this for verification." },
                            { q: "Why is my payment showing 'Verification Pending'?", a: "After you submit payment proof, the admin needs to verify your transaction ID and screenshot before marking it as paid." },
                            { q: "Can I pay a different amount than what's on the invoice?", a: "Yes! Enter a custom amount in the payment modal. If you pay less, the balance carries to next month. If you pay more, you get a credit." },
                            { q: "What if I paid but forgot to upload the screenshot?", a: "Contact the property staff directly. They can settle the invoice from their end once they verify the payment." },
                            { q: "How do I know if my maintenance request was addressed?", a: "Check the Maintenance Requests section. Resolved tickets show a green 'RESOLVED' status." },
                            { q: "Can I apply for a different unit after being assigned?", a: "Contact the property manager to discuss transferring to a different unit." },
                        ].map((faq, i) => (
                            <div key={i} className="p-5">
                                <p className="font-bold text-gray-800 text-sm mb-1">{faq.q}</p>
                                <p className="text-sm text-gray-600">{faq.a}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* CONTACT */}
                <section className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
                    <p className="text-sm text-blue-800 font-medium">Still need help? Contact your property manager or maintenance staff directly.</p>
                </section>
            </main>
        </div>
    );
}
