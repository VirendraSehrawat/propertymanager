/**
 * Unit tests for lib/contact.ts — tel / WhatsApp links and the payment
 * reminder text used by the Monthly overview row actions.
 */

import { describe, it, expect } from "vitest";
import { normalizePhone, paymentReminderText, telLink, whatsAppLink } from "@/lib/contact";

describe("normalizePhone", () => {
    it("adds the country code to local numbers and strips formatting", () => {
        expect(normalizePhone("98765 43210")).toBe("919876543210");
        expect(normalizePhone("098765-43210")).toBe("919876543210");
        expect(normalizePhone("+91 98765 43210")).toBe("919876543210");
    });

    it("returns empty for missing or too-short numbers", () => {
        expect(normalizePhone(undefined)).toBe("");
        expect(normalizePhone("12345")).toBe("");
    });
});

describe("links", () => {
    it("builds tel: and wa.me links, or empty without a number", () => {
        expect(telLink("9876543210")).toBe("tel:+919876543210");
        expect(whatsAppLink("9876543210", "Hi & bye")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye");
        expect(telLink("")).toBe("");
        expect(whatsAppLink(undefined, "x")).toBe("");
    });
});

describe("paymentReminderText", () => {
    it("quotes the remaining balance and thanks for what was already paid", () => {
        const text = paymentReminderText({ tenantName: "Asha Rao", unitNumber: "101", billingPeriod: "October 2026", remaining: 3000, paid: 7000 });
        expect(text).toContain("Hi Asha,");
        expect(text).toContain("₹3,000 is still due for 101 — October 2026");
        expect(text).toContain("₹7,000 received");
    });

    it("leaves out the name and the paid note when not known", () => {
        const text = paymentReminderText({ unitNumber: "101", billingPeriod: "October 2026", remaining: 5500 });
        expect(text.startsWith("Hi, a reminder that ₹5,500")).toBe(true);
        expect(text).not.toContain("received");
    });
});
