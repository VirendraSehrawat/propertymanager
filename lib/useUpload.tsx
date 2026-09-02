"use client";

import { useState, useCallback } from "react";

export function useUploadWithProgress() {
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [isUploading, setIsUploading] = useState(false);

    const uploadFile = useCallback(async (path: string, file: File): Promise<string> => {
        setIsUploading(true);
        setUploadProgress(0);
        setUploadProgress(10);

        try {
            const formData = new FormData();
            formData.append("path", path);
            formData.append("file", file);

            setUploadProgress(40);
            const response = await fetch("/api/uploads/cloudinary", {
                method: "POST",
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

    return { uploadFile, uploadProgress, isUploading, resetProgress };
}

export function UploadProgressBar({ progress }: { progress: number }) {
    if (progress <= 0) return null;
    return (
        <div className="w-full mt-2">
            <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-500">Uploading...</span>
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
