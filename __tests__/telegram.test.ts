import { describe, it, expect } from "vitest";
import { esc } from "@/lib/telegram/esc";

describe("telegram esc", () => {
    it("escapes the three HTML metacharacters", () => {
        expect(esc("<b>hi</b> & <i>ok</i>")).toBe("&lt;b&gt;hi&lt;/b&gt; &amp; &lt;i&gt;ok&lt;/i&gt;");
    });
    it("passes through safe strings unchanged", () => {
        expect(esc("Namaste Virendra")).toBe("Namaste Virendra");
        expect(esc(1234)).toBe("1234");
    });
    it("handles null / undefined as empty string", () => {
        expect(esc(null)).toBe("");
        expect(esc(undefined)).toBe("");
    });
    it("does NOT escape single or double quotes (safe outside attributes)", () => {
        expect(esc(`It's "fine"`)).toBe(`It's "fine"`);
    });
});
