import { NextResponse } from "next/server";
import { buildCloudinarySignature, deriveCloudinaryTarget } from "@/lib/cloudinary";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
    try {
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!cloudName || !apiKey || !apiSecret) {
            return NextResponse.json(
                { error: "Cloudinary environment variables are not configured." },
                { status: 500 }
            );
        }

        const formData = await request.formData();
        const file = formData.get("file");
        const originalPath = String(formData.get("path") || "uploads/file");

        if (!(file instanceof File)) {
            return NextResponse.json({ error: "Missing file in upload request." }, { status: 400 });
        }

        if (file.size <= 0) {
            return NextResponse.json({ error: "Cannot upload an empty file." }, { status: 400 });
        }

        if (file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json(
                { error: "File too large. Max size is 10MB." },
                { status: 413 }
            );
        }

        const { folder, publicId } = deriveCloudinaryTarget(originalPath);
        const timestamp = Math.floor(Date.now() / 1000);

        const signature = buildCloudinarySignature(
            { folder, public_id: publicId, timestamp },
            apiSecret
        );

        const cloudinaryFormData = new FormData();
        cloudinaryFormData.append("file", file);
        cloudinaryFormData.append("api_key", apiKey);
        cloudinaryFormData.append("timestamp", String(timestamp));
        cloudinaryFormData.append("signature", signature);
        cloudinaryFormData.append("folder", folder);
        cloudinaryFormData.append("public_id", publicId);

        const uploadResponse = await fetch(
            `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
            {
                method: "POST",
                body: cloudinaryFormData,
            }
        );

        const uploadPayload = await uploadResponse.json();

        if (!uploadResponse.ok) {
            const cloudinaryError =
                uploadPayload?.error?.message || "Upload failed at Cloudinary.";
            return NextResponse.json({ error: cloudinaryError }, { status: uploadResponse.status });
        }

        return NextResponse.json({
            url: uploadPayload.secure_url,
            publicId: uploadPayload.public_id,
            bytes: uploadPayload.bytes,
            format: uploadPayload.format,
            resourceType: uploadPayload.resource_type,
        });
    } catch (error) {
        console.error("Cloudinary upload route failed:", error);
        return NextResponse.json(
            { error: "Unexpected upload failure." },
            { status: 500 }
        );
    }
}
