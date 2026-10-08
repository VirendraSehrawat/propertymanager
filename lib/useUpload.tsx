"use client";

import { useState, useCallback } from "react";
import { auth } from "@/lib/firebase";

export function useUploadWithProgress() {
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [isUploading, setIsUploading] = useState(false);
    /** Multi-file counter: { current, total }. Zeroed when not batch-uploading. */
    const [uploadCount, setUploadCount] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

    const uploadFile = useCallback(async (path: string, file: File): Promise<string> => {
        setIsUploading(true);
        setUploadProgress(0);
        setUploadProgress(10);

        try {
            const formData = new FormData();
            formData.append("path", path);
            formData.append("file", file);

            const user = auth.currentUser;
            const token = user ? await user.getIdToken() : null;
            const headers: Record<string, string> = {};
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }

            setUploadProgress(40);
            const response = await fetch("/api/uploads/cloudinary", {
                method: "POST",
                headers,
                body: formData,
            });

            setUploadProgress(85);
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload?.error || "Upload failed");
            }

            setUploadProgress(100);
            return payload.url as string;
        } catch (error) {
            setUploadProgress(0);
            throw error;
        } finally {
            setIsUploading(false);
        }
    }, []);

    const resetProgress = useCallback(() => {
        setUploadProgress(0);
        setIsUploading(false);
    }, []);

    /**
     * Upload several files sequentially, reporting aggregate progress, and
     * return a typed attachment list (image/video inferred from MIME type).
     * Used by the maintenance "report issue" flows which accept multiple
     * photos and videos per ticket.
     */
    const uploadFiles = useCallback(
        async (
            pathPrefix: string,
            files: File[],
        ): Promise<{ url: string; type: "image" | "video"; name: string }[]> => {
            const results: { url: string; type: "image" | "video"; name: string }[] = [];
            setUploadCount({ current: 0, total: files.length });
            try {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    setUploadCount({ current: i + 1, total: files.length });
                    const url = await uploadFile(`${pathPrefix}/${Date.now()}_${i}_${file.name}`, file);
                    results.push({
                        url,
                        type: file.type.startsWith("video") ? "video" : "image",
                        name: file.name,
                    });
                }
                return results;
            } finally {
                setUploadCount({ current: 0, total: 0 });
            }
        },
        [uploadFile],
    );

    return { uploadFile, uploadFiles, uploadProgress, uploadCount, isUploading, resetProgress };
}

export function UploadProgressBar({
    progress,
    count,
}: {
    progress: number;
    /** Optional multi-file counter to show "Uploading file 2 of 4". */
    count?: { current: number; total: number };
}) {
    if (progress <= 0) return null;
    const label = count && count.total > 1
        ? `Uploading file ${count.current} of ${count.total}...`
        : "Uploading...";
    return (
        <div className="w-full mt-2">
            <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-500">{label}</span>
                <span className="text-xs font-medium text-blue-600">{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                />
            </div>
        </div>
    );
}
