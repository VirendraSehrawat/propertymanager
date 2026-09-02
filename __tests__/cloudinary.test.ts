import { describe, expect, it } from "vitest";
import { buildCloudinarySignature, deriveCloudinaryTarget } from "@/lib/cloudinary";

describe("deriveCloudinaryTarget", () => {
    it("splits folder and publicId from an app path", () => {
        const result = deriveCloudinaryTarget("maintenance/u_123/169300_report.png");
        expect(result.folder).toBe("maintenance/u_123");
        expect(result.publicId).toBe("169300_report");
    });

    it("falls back to default folder when path has no directory", () => {
        const result = deriveCloudinaryTarget("photo.jpg");
        expect(result.folder).toBe("property-manager");
        expect(result.publicId).toBe("photo");
    });

    it("sanitizes unsafe characters", () => {
        const result = deriveCloudinaryTarget("tenant docs/u 1/@id proof!.pdf");
        expect(result.folder).toBe("tenant_docs/u_1");
        expect(result.publicId).toBe("_id_proof_");
    });
});

describe("buildCloudinarySignature", () => {
    it("generates deterministic SHA1 signature from sorted params", () => {
        const signature = buildCloudinarySignature(
            {
                folder: "maintenance/u_123",
                public_id: "169300_report",
                timestamp: 1725264000,
            },
            "test_secret"
        );

        expect(signature).toBe("036f6dedfef6e376751433fad1d711e63bdb7f1f");
    });
});
