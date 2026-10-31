/**
 * Unit tests for lib/invoiceSearch.ts — Collections search by unit, email,
 * tenant name and phone (looked up from the unit).
 */

import { describe, it, expect } from "vitest";
import { invoiceContact, matchesInvoiceSearch, unitsById } from "@/lib/invoiceSearch";

const units = unitsById([
    { id: "u1", tenantEmail: "ravi@x.com", tenantName: "Ravi Kumar", tenantPhone: "+91 98765-43210" },
    { id: "u2", tenantEmail: "new@x.com", tenantName: "Neha Singh", tenantPhone: "9123456789" },
]);
const inv = { unitId: "u1", unitNumber: "101", tenantEmail: "ravi@x.com", billingPeriod: "October 2026", transactionId: "UPI:4XX8291" };
// Old tenant's invoice on a unit that now has a new occupant.
const oldInv = { unitId: "u2", unitNumber: "102", tenantEmail: "old@x.com" };

describe("invoiceContact", () => {
    it("returns the unit's name and phone only while the unit is still the invoice tenant's", () => {
        expect(invoiceContact(inv, units)).toEqual({ tenantName: "Ravi Kumar", tenantPhone: "+91 98765-43210" });
        expect(invoiceContact(oldInv, units)).toEqual({});
        expect(invoiceContact({ unitId: "gone" }, units)).toEqual({});
    });
});

describe("matchesInvoiceSearch", () => {
    it("matches everything on an empty query", () => {
        expect(matchesInvoiceSearch(inv, "  ", units)).toBe(true);
    });

    it("matches unit number, email and tenant name, case-insensitively", () => {
        expect(matchesInvoiceSearch(inv, "101", units)).toBe(true);
        expect(matchesInvoiceSearch(inv, "RAVI@", units)).toBe(true);
        expect(matchesInvoiceSearch(inv, "kumar", units)).toBe(true);
        expect(matchesInvoiceSearch(inv, "neha", units)).toBe(false);
    });

    it("matches phone numbers regardless of formatting or country code", () => {
        for (const q of ["9876543210", "98765 43210", "+919876543210", "09876543210", "43210"]) {
            expect(matchesInvoiceSearch(inv, q, units)).toBe(true);
        }
        expect(matchesInvoiceSearch(inv, "11111", units)).toBe(false);
    });

    it("does not match a new occupant's name or phone on an old tenant's invoice", () => {
        expect(matchesInvoiceSearch(oldInv, "neha", units)).toBe(false);
        expect(matchesInvoiceSearch(oldInv, "9123456789", units)).toBe(false);
        expect(matchesInvoiceSearch(oldInv, "old@", units)).toBe(true);
    });

    it("matches extra fields such as the payment reference", () => {
        expect(matchesInvoiceSearch(inv, "4xx8291", units)).toBe(false);
        expect(matchesInvoiceSearch(inv, "4xx8291", units, [inv.billingPeriod, inv.transactionId])).toBe(true);
    });
});
