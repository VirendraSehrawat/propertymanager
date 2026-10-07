import { afterEach } from "vitest";

// jsdom-only setup. The default test environment is `node` (for the Firestore
// emulator suites); component tests opt into jsdom via a
// `// @vitest-environment jsdom` docblock. Guard every DOM access so this file
// is a no-op under node.
if (typeof document !== "undefined") {
    // Extends `expect` with jest-dom matchers (toBeInTheDocument, etc.).
    await import("@testing-library/jest-dom/vitest");
    const { cleanup } = await import("@testing-library/react");
    afterEach(() => cleanup());
}
