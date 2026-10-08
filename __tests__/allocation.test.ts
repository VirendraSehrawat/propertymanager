import { describe, it, expect } from "vitest";
import {
    allocatePartialPayment,
    collectedSplit,
    computeCarryForward,
    composeInvoiceTotal,
    carryForwardFromInvoices,
    carryForwardBreakdown,
    carryForwardItems,
    previousMonthLabel,
    stripBillingPeriodSuffix,
    pendingSplit,
} from "@/lib/allocation";

describe("allocatePartialPayment (rent-first)", () => {
    const invoice = {
        totalAmount: 6200,
        baseRent: 5000,
        electricityCharge: 1200,
        amountPaid: 0,
    };

    it("full payment closes the invoice", () => {
        const r = allocatePartialPayment(6200, invoice);
        expect(r.towardRent).toBe(5000);
        expect(r.towardElectricity).toBe(1200);
        expect(r.newAmountPaid).toBe(6200);
        expect(r.newRemaining).toBe(0);
        expect(r.status).toBe("paid");
        expect(r.fullyPaid).toBe(true);
    });

    it("rent-only partial: money under rent stays in rent", () => {
        const r = allocatePartialPayment(3000, invoice);
        expect(r.towardRent).toBe(3000);
        expect(r.towardElectricity).toBe(0);
        expect(r.status).toBe("pending");
    });

    it("elec-only chip when rent already fully paid", () => {
        const r = allocatePartialPayment(1000, { ...invoice, amountPaid: 5000 });
        expect(r.rentDueBefore).toBe(0);
        expect(r.elecDueBefore).toBe(1200);
        expect(r.towardRent).toBe(0);
        expect(r.towardElectricity).toBe(1000);
        expect(r.newAmountPaid).toBe(6000);
        expect(r.status).toBe("pending");
    });

    it("overflow: money above rent spills into electricity", () => {
        const r = allocatePartialPayment(5500, invoice);
        expect(r.towardRent).toBe(5000);
        expect(r.towardElectricity).toBe(500);
    });

    it("clips over-payment to invoice remaining", () => {
        const r = allocatePartialPayment(99999, invoice);
        expect(r.towardRent).toBe(5000);
        expect(r.towardElectricity).toBe(1200);
        expect(r.newAmountPaid).toBe(6200);
        expect(r.fullyPaid).toBe(true);
    });

    it("continuing a partial: previous 3000 rent + new 2000 finishes rent + 0 elec", () => {
        const r = allocatePartialPayment(2000, { ...invoice, amountPaid: 3000 });
        expect(r.rentDueBefore).toBe(2000);
        expect(r.elecDueBefore).toBe(1200);
        expect(r.towardRent).toBe(2000);
        expect(r.towardElectricity).toBe(0);
        expect(r.newAmountPaid).toBe(5000);
        expect(r.status).toBe("pending");
    });

    it("continuing a partial: previous 3000 + new 3200 closes invoice", () => {
        const r = allocatePartialPayment(3200, { ...invoice, amountPaid: 3000 });
        expect(r.towardRent).toBe(2000);
        expect(r.towardElectricity).toBe(1200);
        expect(r.fullyPaid).toBe(true);
    });

    it("zero-due invoice: no allocation", () => {
        const r = allocatePartialPayment(1000, { ...invoice, amountPaid: 6200 });
        expect(r.remaining).toBe(0);
        expect(r.towardRent).toBe(0);
        expect(r.towardElectricity).toBe(0);
    });

    it("negative received is treated as zero", () => {
        const r = allocatePartialPayment(-500, invoice);
        expect(r.towardRent).toBe(0);
        expect(r.towardElectricity).toBe(0);
        expect(r.newAmountPaid).toBe(0);
    });

    it("rent-only invoice (no electricity)", () => {
        const r = allocatePartialPayment(5000, {
            totalAmount: 5000,
            baseRent: 5000,
            electricityCharge: 0,
        });
        expect(r.towardRent).toBe(5000);
        expect(r.towardElectricity).toBe(0);
        expect(r.fullyPaid).toBe(true);
    });

    it("tolerates half-rupee rounding at close", () => {
        const r = allocatePartialPayment(6199.7, invoice);
        // Not clamped up, but fullyPaid tolerance kicks in
        expect(r.fullyPaid).toBe(true);
        expect(r.status).toBe("paid");
    });
});

describe("collectedSplit", () => {
    it("splits amountPaid rent-first", () => {
        const s = collectedSplit({
            status: "pending",
            amountPaid: 5500,
            baseRent: 5000,
            electricityCharge: 1200,
            totalAmount: 6200,
        });
        expect(s.collectedRent).toBe(5000);
        expect(s.collectedElectricity).toBe(500);
        expect(s.collectedTotal).toBe(5500);
    });

    it("legacy paid invoice with amountPaid=0 counts as fully collected", () => {
        const s = collectedSplit({
            status: "paid",
            amountPaid: 0,
            baseRent: 5000,
            electricityCharge: 1200,
            totalAmount: 6200,
        });
        expect(s.collectedTotal).toBe(6200);
        expect(s.collectedRent).toBe(5000);
        expect(s.collectedElectricity).toBe(1200);
    });

    it("pending with no amountPaid = 0 collected", () => {
        const s = collectedSplit({
            status: "pending",
            baseRent: 5000,
            electricityCharge: 1200,
            totalAmount: 6200,
        });
        expect(s.collectedTotal).toBe(0);
    });

    it("amountPaid can never exceed total (clipped)", () => {
        const s = collectedSplit({
            status: "paid",
            amountPaid: 99999,
            baseRent: 5000,
            electricityCharge: 1200,
            totalAmount: 6200,
        });
        expect(s.collectedTotal).toBe(6200);
    });
});

describe("computeCarryForward", () => {
    it("no history → zero carry-forward", () => {
        expect(computeCarryForward(0)).toBe(0);
    });

    it("tenant owes ₹2,500 → +₹2,500 added to next invoice", () => {
        expect(computeCarryForward(-2500)).toBe(2500);
    });

    it("tenant has ₹500 advance → −₹500 reduces next invoice", () => {
        expect(computeCarryForward(500)).toBe(-500);
    });

    it("rounds half-rupees", () => {
        expect(computeCarryForward(-2499.6)).toBe(2500);
    });
});

describe("composeInvoiceTotal", () => {
    it("basic sum", () => {
        const r = composeInvoiceTotal({ baseRent: 5000, electricityCharge: 1200 });
        expect(r.total).toBe(6200);
    });

    it("adds owed carry-forward", () => {
        const r = composeInvoiceTotal({
            baseRent: 5000,
            electricityCharge: 1200,
            carryForward: 2500,
        });
        expect(r.total).toBe(8700);
    });

    it("credit reduces invoice", () => {
        const r = composeInvoiceTotal({
            baseRent: 5000,
            electricityCharge: 1200,
            carryForward: -500,
        });
        expect(r.total).toBe(5700);
    });

    it("huge credit is clamped to zero (excess stays on ledger)", () => {
        const r = composeInvoiceTotal({
            baseRent: 5000,
            electricityCharge: 1200,
            carryForward: -20000,
        });
        expect(r.total).toBe(0);
    });
});

describe("carryForwardFromInvoices", () => {
    it("sums remaining on unpaid + pending invoices", () => {
        const cf = carryForwardFromInvoices([
            { id: "a", status: "unpaid", totalAmount: 5000, amountPaid: 0 },
            { id: "b", status: "pending", totalAmount: 3000, amountPaid: 1000 },
        ]);
        expect(cf).toBe(7000);
    });

    it("ignores paid and written-off invoices", () => {
        const cf = carryForwardFromInvoices([
            { id: "a", status: "paid", totalAmount: 5000, amountPaid: 5000 },
            { id: "b", status: "written-off", totalAmount: 4000, amountPaid: 0 },
            { id: "c", status: "unpaid", totalAmount: 2000, amountPaid: 0 },
        ]);
        expect(cf).toBe(2000);
    });

    it("excludes the invoice being generated / edited", () => {
        const cf = carryForwardFromInvoices(
            [
                { id: "self", status: "unpaid", totalAmount: 10000, amountPaid: 0 },
                { id: "old", status: "unpaid", totalAmount: 2988, amountPaid: 0 },
            ],
            { excludeInvoiceId: "self" },
        );
        expect(cf).toBe(2988);
    });

    it("SA-406 regression: prior partial 2988 rolls forward exactly once", () => {
        // Reproduces the reported bug scenario.
        // A prior electricity invoice of 2988 was fully unpaid, and this
        // month's rent+elec invoice should show carryForward = 2988 only
        // (not 2988 + 2988).
        const cf = carryForwardFromInvoices(
            [
                { id: "prior", status: "unpaid", totalAmount: 2988, amountPaid: 0 },
                { id: "current", status: "unpaid", totalAmount: 10488, amountPaid: 0 },
            ],
            { excludeInvoiceId: "current" },
        );
        expect(cf).toBe(2988);
        const composed = composeInvoiceTotal({ baseRent: 7500, electricityCharge: 2988, carryForward: cf });
        expect(composed.total).toBe(7500 + 2988 + 2988); // owed = current rent+elec + prior 2988
    });

    it("returns 0 when nothing is outstanding", () => {
        expect(carryForwardFromInvoices([])).toBe(0);
        expect(
            carryForwardFromInvoices([{ id: "a", status: "paid", totalAmount: 5000, amountPaid: 5000 }]),
        ).toBe(0);
    });

    it("clamps per-invoice due at zero (overpaid rows contribute nothing)", () => {
        const cf = carryForwardFromInvoices([
            { id: "a", status: "unpaid", totalAmount: 5000, amountPaid: 6000 },
        ]);
        expect(cf).toBe(0);
    });

    it("SA-206 regression: does NOT compound when multiple months are unpaid", () => {
        // Each monthly invoice already rolls the previous balance into its own
        // `totalAmount`. Summing `totalAmount` across open invoices would count
        // the oldest dues once per later month (the 9,372 → 22,188 bug). Using
        // each invoice's OWN charges counts every month exactly once.
        //
        // Chain for one tenant (rent 9000 + elec 372 = 9372/month):
        //   Aug: own 9372, total 9372              (unpaid)
        //   Sep: own 9372, total 18744 (incl. Aug) (unpaid)
        //   Oct: being generated now
        const tenantInvoices = [
            { id: "aug", status: "unpaid", billingPeriod: "August 2026", baseRent: 9000, electricityCharge: 372, totalAmount: 9372, amountPaid: 0 },
            { id: "sep", status: "unpaid", billingPeriod: "September 2026", baseRent: 9000, electricityCharge: 372, totalAmount: 18744, amountPaid: 0 },
        ];
        const cf = carryForwardFromInvoices(tenantInvoices, {
            excludeInvoiceId: "oct",
            excludeBillingPeriod: "October 2026",
        });
        // Two unpaid months × 9,372 own charges = 18,744 — NOT 9372 + 18744.
        expect(cf).toBe(18744);

        const composed = composeInvoiceTotal({ baseRent: 9000, electricityCharge: 372, carryForward: cf });
        // Oct own 9,372 + 2 prior months 18,744 = 28,116 (three unpaid months).
        expect(composed.total).toBe(28116);
    });

    it("SA-206 regression: single prior unpaid month rolls forward once (9,372 not 22,188)", () => {
        const cf = carryForwardFromInvoices(
            [
                { id: "prev", status: "unpaid", billingPeriod: "September 2026", baseRent: 9000, electricityCharge: 372, totalAmount: 9372, amountPaid: 0 },
            ],
            { excludeInvoiceId: "curr", excludeBillingPeriod: "October 2026" },
        );
        expect(cf).toBe(9372);
        const composed = composeInvoiceTotal({ baseRent: 9000, electricityCharge: 372, carryForward: cf });
        expect(composed.total).toBe(18744); // this month + one unpaid month — never 22,188
    });

    it("carry-forward respects partial payments on a prior month's own charges", () => {
        const cf = carryForwardFromInvoices(
            [
                { id: "prev", status: "pending", billingPeriod: "September 2026", baseRent: 9000, electricityCharge: 372, totalAmount: 9372, amountPaid: 4000 },
            ],
            { excludeInvoiceId: "curr", excludeBillingPeriod: "October 2026" },
        );
        expect(cf).toBe(5372); // 9372 own − 4000 paid
    });

    it("excludes same-month invoices when excludeBillingPeriod is supplied", () => {
        // Simulates October 2026: the current month's own unpaid invoice should
        // NOT count as carry forward for another October 2026 invoice.
        const cf = carryForwardFromInvoices(
            [
                { id: "curr", status: "unpaid", totalAmount: 10000, amountPaid: 0, billingPeriod: "October 2026" },
                { id: "prev", status: "unpaid", totalAmount: 3000, amountPaid: 500, billingPeriod: "September 2026" },
            ],
            { excludeInvoiceId: "curr", excludeBillingPeriod: "October 2026" },
        );
        // Only the September invoice's outstanding balance should carry forward.
        expect(cf).toBe(2500);
    });

    it("does not exclude previous-month invoices when excludeBillingPeriod is set", () => {
        const cf = carryForwardFromInvoices(
            [
                { id: "a", status: "unpaid", totalAmount: 2000, amountPaid: 0, billingPeriod: "August 2026" },
                { id: "b", status: "pending", totalAmount: 1500, amountPaid: 500, billingPeriod: "September 2026" },
            ],
            { excludeBillingPeriod: "October 2026" },
        );
        // Both previous months carry forward — October is excluded but nothing belongs to October.
        expect(cf).toBe(3000);
    });
});

describe("carryForwardBreakdown", () => {
    it("returns one entry per contributing unpaid/pending invoice", () => {
        const rows = carryForwardBreakdown([
            { id: "a", status: "unpaid", totalAmount: 5000, amountPaid: 0, billingPeriod: "September 2026" },
            { id: "b", status: "pending", totalAmount: 3000, amountPaid: 1000, billingPeriod: "August 2026" },
        ]);
        expect(rows).toEqual([
            { invoiceId: "b", billingPeriod: "August 2026", amount: 2000 },
            { invoiceId: "a", billingPeriod: "September 2026", amount: 5000 },
        ]);
    });

    it("sorts oldest-first by billing period", () => {
        const rows = carryForwardBreakdown([
            { id: "a", status: "unpaid", totalAmount: 1000, amountPaid: 0, billingPeriod: "December 2026" },
            { id: "b", status: "unpaid", totalAmount: 1000, amountPaid: 0, billingPeriod: "January 2026" },
        ]);
        expect(rows.map((r) => r.billingPeriod)).toEqual(["January 2026", "December 2026"]);
    });

    it("skips paid, written-off, zero-due and excluded invoices", () => {
        const rows = carryForwardBreakdown(
            [
                { id: "self", status: "unpaid", totalAmount: 10000, amountPaid: 0, billingPeriod: "October 2026" },
                { id: "paid", status: "paid", totalAmount: 5000, amountPaid: 5000, billingPeriod: "September 2026" },
                { id: "wo", status: "written-off", totalAmount: 4000, amountPaid: 0, billingPeriod: "August 2026" },
                { id: "over", status: "unpaid", totalAmount: 1000, amountPaid: 2000, billingPeriod: "July 2026" },
                { id: "due", status: "unpaid", totalAmount: 2988, amountPaid: 0, billingPeriod: "June 2026" },
            ],
            { excludeInvoiceId: "self", excludeBillingPeriod: "October 2026" },
        );
        expect(rows).toEqual([
            { invoiceId: "due", billingPeriod: "June 2026", amount: 2988 },
        ]);
    });

    it("falls back to a label when billingPeriod is missing", () => {
        const rows = carryForwardBreakdown([
            { id: "a", status: "unpaid", totalAmount: 1000, amountPaid: 0 },
        ]);
        expect(rows[0].billingPeriod).toBe("Previous period");
    });

    it("returns an empty array when nothing is outstanding", () => {
        expect(carryForwardBreakdown([])).toEqual([]);
    });

    it("breakdown sum matches carryForwardFromInvoices", () => {
        const invoices = [
            { id: "a", status: "unpaid" as const, totalAmount: 5000, amountPaid: 0, billingPeriod: "September 2026" },
            { id: "b", status: "pending" as const, totalAmount: 3000, amountPaid: 1000, billingPeriod: "August 2026" },
        ];
        const total = carryForwardBreakdown(invoices).reduce((s, r) => s + r.amount, 0);
        expect(total).toBe(carryForwardFromInvoices(invoices));
    });
});

describe("stripBillingPeriodSuffix", () => {
    it("removes a parenthetical suffix and trims", () => {
        expect(stripBillingPeriodSuffix("October 2026 (relabelled)")).toBe("October 2026");
        expect(stripBillingPeriodSuffix("September 2026  ")).toBe("September 2026");
    });

    it("returns empty string for undefined / empty", () => {
        expect(stripBillingPeriodSuffix(undefined)).toBe("");
        expect(stripBillingPeriodSuffix("")).toBe("");
    });
});

describe("previousMonthLabel", () => {
    it("returns the immediately preceding month", () => {
        expect(previousMonthLabel("October 2026")).toBe("September 2026");
        expect(previousMonthLabel("September 2026")).toBe("August 2026");
    });

    it("rolls back across a year boundary", () => {
        expect(previousMonthLabel("January 2026")).toBe("December 2025");
    });

    it("ignores a human-readable suffix on the anchor", () => {
        expect(previousMonthLabel("October 2026 (relabelled)")).toBe("September 2026");
    });

    it("returns empty string for non-month anchors (all / overdue / junk)", () => {
        expect(previousMonthLabel("all")).toBe("");
        expect(previousMonthLabel("overdue")).toBe("");
        expect(previousMonthLabel(undefined)).toBe("");
        expect(previousMonthLabel("")).toBe("");
    });
});

describe("carryForwardItems (previous-month-only regression)", () => {
    const TENANT = "tenant@example.com";
    // A tenant with open balances across Aug, Sep and the current Oct invoice.
    const pool = [
        { id: "aug", tenantEmail: TENANT, status: "unpaid", billingPeriod: "August 2026", baseRent: 5000, electricityCharge: 500, totalAmount: 5500, amountPaid: 0 },
        { id: "sep", tenantEmail: TENANT, status: "pending", billingPeriod: "September 2026", baseRent: 5000, electricityCharge: 800, totalAmount: 5800, amountPaid: 800 },
        { id: "oct", tenantEmail: TENANT, status: "unpaid", billingPeriod: "October 2026", baseRent: 5000, electricityCharge: 600, totalAmount: 5600, amountPaid: 0 },
        // A different tenant — must never leak into results.
        { id: "other", tenantEmail: "someone@else.com", status: "unpaid", billingPeriod: "September 2026", baseRent: 9000, electricityCharge: 0, totalAmount: 9000, amountPaid: 0 },
    ];

    it("October anchor → only September carries forward (October itself excluded)", () => {
        const items = carryForwardItems(pool, { tenantEmail: TENANT, anchorMonth: "October 2026" });
        expect(items.map(i => i.id)).toEqual(["sep"]);
        // Sep: 5800 total − 800 paid = 5000 due.
        expect(items[0].totalDue).toBe(5000);
    });

    it("September anchor → only August carries forward", () => {
        const items = carryForwardItems(pool, { tenantEmail: TENANT, anchorMonth: "September 2026" });
        expect(items.map(i => i.id)).toEqual(["aug"]);
        expect(items[0].totalDue).toBe(5500);
    });

    it("never includes the anchor (current) month's own invoice", () => {
        const items = carryForwardItems(pool, { tenantEmail: TENANT, anchorMonth: "October 2026" });
        expect(items.some(i => i.id === "oct")).toBe(false);
    });

    it("August anchor → no carry forward (nothing open in July)", () => {
        const items = carryForwardItems(pool, { tenantEmail: TENANT, anchorMonth: "August 2026" });
        expect(items).toEqual([]);
    });

    it("scopes strictly to the given tenant", () => {
        const items = carryForwardItems(pool, { tenantEmail: TENANT, anchorMonth: "October 2026" });
        expect(items.every(i => i.id !== "other")).toBe(true);
    });

    it("tolerates a relabelled suffix on both anchor and invoice periods", () => {
        const relabelled = [
            { id: "sep", tenantEmail: TENANT, status: "unpaid", billingPeriod: "September 2026 (relabelled)", baseRent: 5000, electricityCharge: 0, totalAmount: 5000, amountPaid: 0 },
        ];
        const items = carryForwardItems(relabelled, { tenantEmail: TENANT, anchorMonth: "October 2026 (corrected)" });
        expect(items.map(i => i.id)).toEqual(["sep"]);
    });

    it("excludes a specific invoice id when requested", () => {
        const items = carryForwardItems(pool, { tenantEmail: TENANT, excludeInvoiceId: "sep", anchorMonth: "October 2026" });
        expect(items).toEqual([]);
    });

    it("drops fully-paid previous-month invoices (nothing due)", () => {
        const paidSep = [
            { id: "sep", tenantEmail: TENANT, status: "unpaid", billingPeriod: "September 2026", baseRent: 5000, electricityCharge: 0, totalAmount: 5000, amountPaid: 5000 },
        ];
        const items = carryForwardItems(paidSep, { tenantEmail: TENANT, anchorMonth: "October 2026" });
        expect(items).toEqual([]);
    });

    it("ignores paid / written-off statuses", () => {
        const mixed = [
            { id: "sep-paid", tenantEmail: TENANT, status: "paid", billingPeriod: "September 2026", baseRent: 5000, electricityCharge: 0, totalAmount: 5000, amountPaid: 5000 },
            { id: "sep-wo", tenantEmail: TENANT, status: "written-off", billingPeriod: "September 2026", baseRent: 5000, electricityCharge: 0, totalAmount: 5000, amountPaid: 0 },
            { id: "sep-open", tenantEmail: TENANT, status: "unpaid", billingPeriod: "September 2026", baseRent: 2000, electricityCharge: 0, totalAmount: 2000, amountPaid: 0 },
        ];
        const items = carryForwardItems(mixed, { tenantEmail: TENANT, anchorMonth: "October 2026" });
        expect(items.map(i => i.id)).toEqual(["sep-open"]);
    });

    it("surfaces per-charge dues (rent vs electricity) for a partial payment", () => {
        // Sep paid 800 which (by this helper's simple model) offsets both buckets.
        const items = carryForwardItems(pool, { tenantEmail: TENANT, anchorMonth: "October 2026" });
        const sep = items.find(i => i.id === "sep")!;
        expect(sep.rentDue).toBe(4200);   // 5000 − 800
        expect(sep.elecDue).toBe(0);      // 800 − 800
        expect(sep.totalDue).toBe(5000);  // 5800 − 800
    });

    describe("pseudo-filter fallback (all / overdue)", () => {
        it("'all' → every open invoice across months (current month included)", () => {
            const items = carryForwardItems(pool, { tenantEmail: TENANT, anchorMonth: "all" });
            expect(items.map(i => i.id).sort()).toEqual(["aug", "oct", "sep"]);
        });

        it("'overdue' → same open set (non-month anchors are not subtracted)", () => {
            const items = carryForwardItems(pool, { tenantEmail: TENANT, anchorMonth: "overdue" });
            expect(items.map(i => i.id).sort()).toEqual(["aug", "oct", "sep"]);
        });

        it("undefined anchor → every open invoice for the tenant", () => {
            const items = carryForwardItems(pool, { tenantEmail: TENANT });
            expect(items.map(i => i.id).sort()).toEqual(["aug", "oct", "sep"]);
        });
    });
});

describe("pendingSplit (rent-first outstanding)", () => {
    const invoice = {
        status: "pending",
        totalAmount: 6200,
        baseRent: 5000,
        electricityCharge: 1200,
        amountPaid: 0,
    };

    it("fully unpaid invoice → rent + elec are fully pending", () => {
        const p = pendingSplit({ ...invoice, status: "unpaid" });
        expect(p.pendingRent).toBe(5000);
        expect(p.pendingElectricity).toBe(1200);
        expect(p.pendingTotal).toBe(6200);
    });

    it("partial under rent → only rent pending shrinks; electricity still fully due", () => {
        const p = pendingSplit({ ...invoice, amountPaid: 3000 });
        expect(p.pendingRent).toBe(2000);
        expect(p.pendingElectricity).toBe(1200);
        expect(p.pendingTotal).toBe(3200);
    });

    it("partial that exactly covers rent → only electricity pending", () => {
        const p = pendingSplit({ ...invoice, amountPaid: 5000 });
        expect(p.pendingRent).toBe(0);
        expect(p.pendingElectricity).toBe(1200);
        expect(p.pendingTotal).toBe(1200);
    });

    it("partial overflowing into electricity → shrinks both buckets", () => {
        const p = pendingSplit({ ...invoice, amountPaid: 5500 });
        expect(p.pendingRent).toBe(0);
        expect(p.pendingElectricity).toBe(700);
        expect(p.pendingTotal).toBe(700);
    });

    it("paid status → nothing pending", () => {
        expect(
            pendingSplit({ ...invoice, status: "paid", amountPaid: 6200 }).pendingTotal,
        ).toBe(0);
    });

    it("written-off status → nothing pending (excluded from collections)", () => {
        expect(
            pendingSplit({ ...invoice, status: "written-off", amountPaid: 0 }).pendingTotal,
        ).toBe(0);
    });

    it("collectedSplit + pendingSplit always sum to totalAmount for open invoices", () => {
        const inv = { ...invoice, amountPaid: 4200 };
        const c = collectedSplit(inv);
        const p = pendingSplit(inv);
        expect(c.collectedTotal + p.pendingTotal).toBe(inv.totalAmount);
    });
});

describe("employee page — pending totals include partial payments", () => {
    // Simulates the three fixed call sites: HomeTab "Pending Collections",
    // CollectionsTab "Pending Rent / Electricity", CollectionsTab "Overdue".
    const invoices = [
        // Fully unpaid rent+elec
        { id: "a", status: "unpaid", totalAmount: 6200, baseRent: 5000, electricityCharge: 1200, amountPaid: 0 },
        // Partial: ₹3000 already collected (rent-first → 3000 rent, 0 elec)
        { id: "b", status: "pending", totalAmount: 6200, baseRent: 5000, electricityCharge: 1200, amountPaid: 3000 },
        // Partial: rent fully paid, elec half paid (5000 + 600)
        { id: "c", status: "pending", totalAmount: 6200, baseRent: 5000, electricityCharge: 1200, amountPaid: 5600 },
        // Paid — must NOT contribute
        { id: "d", status: "paid", totalAmount: 6200, baseRent: 5000, electricityCharge: 1200, amountPaid: 6200 },
    ];

    it("total pending amount = Σ (total − paid) across open invoices", () => {
        const total = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingTotal, 0);
        // a: 6200 due, b: 3200 due, c: 600 due, d: 0
        expect(total).toBe(6200 + 3200 + 600);
    });

    it("pending rent tile uses rent-first split (partials shrink rent bucket)", () => {
        const totalRent = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingRent, 0);
        // a: 5000, b: 2000 (5000−3000), c: 0, d: 0
        expect(totalRent).toBe(5000 + 2000);
    });

    it("pending electricity tile only fills after rent (partials shrink elec bucket)", () => {
        const totalElec = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingElectricity, 0);
        // a: 1200, b: 1200 (rent not fully covered → elec fully due), c: 600, d: 0
        expect(totalElec).toBe(1200 + 1200 + 600);
    });

    it("rent + elec pending tiles reconcile to the pending-collections KPI", () => {
        const rent = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingRent, 0);
        const elec = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingElectricity, 0);
        const total = invoices.reduce((s, inv) => s + pendingSplit(inv).pendingTotal, 0);
        expect(rent + elec).toBe(total);
    });
});
