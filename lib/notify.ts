/**
 * Fire-and-forget client-side helpers that POST to the notification
 * dispatchers. They never throw — logging failures to console only —
 * because notification delivery must not roll back the business write
 * (invoice creation, ledger settle, etc.) that just committed.
 */

export async function notifyInvoiceCreated(invoiceId: string): Promise<void> {
    try {
        await fetch("/api/notifications/invoice-created", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ invoiceId }),
            keepalive: true,
        });
    } catch (e) {
        console.warn("[notify] invoice-created failed", e);
    }
}

export interface PaymentNotify {
    invoiceId: string;
    amount: number;
    fully: boolean;
    mode?: string;
    reference?: string;
    ledgerId?: string;
}

export async function notifyPaymentRecorded(payload: PaymentNotify): Promise<void> {
    try {
        await fetch("/api/notifications/payment-recorded", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true,
        });
    } catch (e) {
        console.warn("[notify] payment-recorded failed", e);
    }
}
