"use client";

import { useState, useCallback } from "react";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";

export function useUploadWithProgress() {
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [isUploading, setIsUploading] = useState(false);

    const uploadFile = useCallback(async (path: string, file: File): Promise<string> => {
        setIsUploading(true);
        setUploadProgress(0);
        const fileRef = ref(storage, path);
        const uploadTask = uploadBytesResumable(fileRef, file);

        return new Promise((resolve, reject) => {
            uploadTask.on(
                "state_changed",
                (snapshot) => {
                    const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                    setUploadProgress(progress);
                },
                (error) => {
                    setIsUploading(false);
                    setUploadProgress(0);
                    reject(error);
                },
                async () => {
                    const url = await getDownloadURL(uploadTask.snapshot.ref);
                    setIsUploading(false);
                    setUploadProgress(100);
                    resolve(url);
                }
            );
        });
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
