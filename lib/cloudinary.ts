import crypto from "crypto";

const SAFE_SEGMENT_RE = /[^a-zA-Z0-9_-]/g;
const SAFE_PATH_RE = /[^a-zA-Z0-9/_-]/g;

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, "");

function sanitizeSegment(segment: string): string {
    return segment.replace(SAFE_SEGMENT_RE, "_").replace(/_+/g, "_");
}

function stripFileExtension(name: string): string {
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(0, i) : name;
}

export function deriveCloudinaryTarget(path: string) {
    const normalized = trimSlashes(path || "uploads/file");
    const rawSegments = normalized.split("/").filter(Boolean);

    const rawFilePart = rawSegments.pop() || "file";
    const folderSegments = rawSegments.map((segment) =>
        segment.replace(SAFE_PATH_RE, "_").replace(/_+/g, "_")
    );

    const folder = folderSegments.length ? folderSegments.join("/") : "property-manager";
    const publicId = sanitizeSegment(stripFileExtension(rawFilePart));

    return { folder, publicId };
}

export function buildCloudinarySignature(
    params: Record<string, string | number>,
    apiSecret: string
): string {
    const toSign = Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");

    return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}
