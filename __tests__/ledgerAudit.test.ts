import { describe, it, expect } from "vitest";
import { computeLedgerDrift, type AuditInvoice, type AuditLedgerRow } from "@/lib/ledgerAudit";

describe("computeLedgerDrift", () => {
    it("reports no drift when ledger sums match invoice amountPaid", () => {
        const invoices: AuditInvoice[] = [
            { id: "i1", unitNumber: "101", billingPeriod: "September 2026", status: "paid", amountPaid: 6000 },
            { id: "i2", unitNumber: "102", billingPeriod: "September 2026", status: "pending", amountPaid: 2000 },
        ];
        const ledger: AuditLedgerRow[] = [
            { invoiceId: "i1", amountPaid: 4000 },
            { invoiceId: "i1", amountPaid: 2000 },
            { invoiceId: "i2", amountPaid: 2000 },
        ];
        const report = computeLedgerDrift(invoices, ledger);
        expect(report.balanced).toBe(true);
        expect(report.drift).toHaveLength(0);
        expect(report.invoicesScanned).toBe(2);
        expect(report.ledgerRowsScanned).toBe(3);
    });

    it("flags an invoice whose amountPaid exceeds its ledger sum", () => {
        const invoices: AuditInvoice[] = [
            { id: "i1", unitNumber: "101", billingPeriod: "Sep", status: "paid", amountPaid: 6000 },
        ];
        const ledger: AuditLedgerRow[] = [{ invoiceId: "i1", amountPaid: 4000 }];
        const report = computeLedgerDrift(invoices, ledger);
        expect(report.balanced).toBe(false);
        expect(report.drift).toHaveLength(1);
        expect(report.drift[0]).toMatchObject({ invoiceId: "i1", diff: 2000, ledgerSum: 4000 });
        expect(report.invoiceOverLedger).toBe(1);
        expect(report.ledgerOverInvoice).toBe(0);
    });

    it("flags an invoice whose ledger sum exceeds its amountPaid (negative diff)", () => {
        const invoices: AuditInvoice[] = [
            { id: "i1", unitNumber: "101", billingPeriod: "Sep", status: "pending", amountPaid: 1000 },
        ];
        const ledger: AuditLedgerRow[] = [{ invoiceId: "i1", amountPaid: 3000 }];
        const report = computeLedgerDrift(invoices, ledger);
        expect(report.drift[0].diff).toBe(-2000);
        expect(report.ledgerOverInvoice).toBe(1);
    });

    it("skips soft-deleted ledger rows and invoices", () => {
        const invoices: AuditInvoice[] = [
            { id: "i1", unitNumber: "101", billingPeriod: "Sep", status: "paid", amountPaid: 2000 },
            { id: "i2", unitNumber: "102", billingPeriod: "Sep", status: "paid", amountPaid: 9999, deleted: true },
        ];
        const ledger: AuditLedgerRow[] = [
            { invoiceId: "i1", amountPaid: 2000 },
            { invoiceId: "i1", amountPaid: 500, deleted: true }, // ignored
        ];
        const report = computeLedgerDrift(invoices, ledger);
        expect(report.invoicesScanned).toBe(1);
        expect(report.ledgerRowsScanned).toBe(1);
        expect(report.balanced).toBe(true);
    });

    it("ignores credit rows that have no invoiceId", () => {
        const invoices: AuditInvoice[] = [
            { id: "i1", unitNumber: "101", billingPeriod: "Sep", status: "paid", amountPaid: 2000 },
        ];
        const ledger: AuditLedgerRow[] = [
            { invoiceId: "i1", amountPaid: 2000 },
            { invoiceId: "", amountPaid: 500 },        // advance/credit
            { amountPaid: 300 },                         // no invoiceId at all
        ];
        const report = computeLedgerDrift(invoices, ledger);
        expect(report.balanced).toBe(true);
        expect(report.ledgerRowsScanned).toBe(1);
    });

    it("honours the tolerance for sub-rupee rounding drift", () => {
        const invoices: AuditInvoice[] = [
            { id: "i1", unitNumber: "101", billingPeriod: "Sep", status: "paid", amountPaid: 2000 },
        ];
        // 0.5 under — within default tolerance of 1.
        const ledger: AuditLedgerRow[] = [{ invoiceId: "i1", amountPaid: 1999.5 }];
        expect(computeLedgerDrift(invoices, ledger, 1).balanced).toBe(true);
        // With zero tolerance the rounded values match too (both round to 2000).
        expect(computeLedgerDrift(invoices, ledger, 0).balanced).toBe(true);
    });

    it("sorts drift worst-first by absolute difference", () => {
        const invoices: AuditInvoice[] = [
            { id: "small", unitNumber: "A", billingPeriod: "Sep", status: "paid", amountPaid: 100 },
            { id: "big", unitNumber: "B", billingPeriod: "Sep", status: "paid", amountPaid: 5000 },
        ];
        const ledger: AuditLedgerRow[] = [
            { invoiceId: "small", amountPaid: 0 },
            { invoiceId: "big", amountPaid: 0 },
        ];
        const report = computeLedgerDrift(invoices, ledger);
        expect(report.drift.map(d => d.invoiceId)).toEqual(["big", "small"]);
    });
});
