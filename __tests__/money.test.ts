import { describe, it, expect } from "vitest";
import {
    toNumber,
    toAmount,
    roundRupees,
    roundPaise,
    formatRupees,
} from "@/lib/money";

describe("toNumber", () => {
    it("coerces numeric strings", () => {
        expect(toNumber("1234")).toBe(1234);
        expect(toNumber("12.5")).toBe(12.5);
    });
    it("returns 0 for non-finite / junk input", () => {
        expect(toNumber(undefined)).toBe(0);
        expect(toNumber(null)).toBe(0);
        expect(toNumber("abc")).toBe(0);
        expect(toNumber(NaN)).toBe(0);
        expect(toNumber(Infinity)).toBe(0);
    });
});

describe("toAmount", () => {
    it("clamps negatives to zero", () => {
        expect(toAmount(-500)).toBe(0);
        expect(toAmount("-10")).toBe(0);
        expect(toAmount(250)).toBe(250);
    });
});

describe("roundRupees", () => {
    it("half-up rounds and normalizes -0", () => {
        expect(roundRupees(12.4)).toBe(12);
        expect(roundRupees(12.5)).toBe(13);
        expect(Object.is(roundRupees(-0.2), 0)).toBe(true);
    });
});

describe("roundPaise", () => {
    it("avoids binary float drift", () => {
        expect(roundPaise(0.1 + 0.2)).toBe(0.3);
        expect(roundPaise(1.005)).toBe(1.01); // EPSILON guard tips the tie up
    });
});

describe("formatRupees", () => {
    it("formats with Indian grouping and rupee sign", () => {
        expect(formatRupees(123456)).toBe("\u20B91,23,456");
        expect(formatRupees(0)).toBe("\u20B90");
    });
    it("supports two decimals", () => {
        expect(formatRupees(1234.5, { withDecimals: true })).toBe("\u20B91,234.50");
    });
    it("treats junk as zero", () => {
        expect(formatRupees(undefined)).toBe("\u20B90");
    });
});
