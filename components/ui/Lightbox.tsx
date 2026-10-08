"use client";

import { useEffect, useCallback } from "react";
import Image from "next/image";

export interface LightboxItem {
    url: string;
    type: "image" | "video";
    name?: string;
}

interface LightboxProps {
    items: LightboxItem[];
    /** Index of the currently shown item, or null when closed. */
    index: number | null;
    onClose: () => void;
    onIndexChange: (next: number) => void;
}

/**
 * Full-screen media viewer with keyboard + on-screen navigation.
 *
 * Supports images (zoomable via browser) and inline video playback. Used by
 * the maintenance ticket attachment gallery. Controlled component — the
 * parent owns the open index so it can be reused across multiple galleries.
 */
export function Lightbox({ items, index, onClose, onIndexChange }: LightboxProps) {
    const isOpen = index !== null && index >= 0 && index < items.length;

    const goPrev = useCallback(() => {
        if (index === null) return;
        onIndexChange((index - 1 + items.length) % items.length);
    }, [index, items.length, onIndexChange]);

    const goNext = useCallback(() => {
        if (index === null) return;
        onIndexChange((index + 1) % items.length);
    }, [index, items.length, onIndexChange]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowLeft") goPrev();
            else if (e.key === "ArrowRight") goNext();
        };
        window.addEventListener("keydown", onKey);
        // Prevent background scroll while open.
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [isOpen, onClose, goPrev, goNext]);

    if (!isOpen || index === null) return null;
    const item = items[index];
    const hasMany = items.length > 1;

    return (
        <div
            className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            {/* Close */}
            <button
                onClick={onClose}
                aria-label="Close"
                className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white text-2xl hover:bg-white/20 transition"
            >
                ✕
            </button>

            {/* Counter */}
            {hasMany && (
                <span className="absolute top-5 left-1/2 -translate-x-1/2 text-white/80 text-sm font-medium">
                    {index + 1} / {items.length}
                </span>
            )}

            {/* Prev */}
            {hasMany && (
                <button
                    onClick={(e) => { e.stopPropagation(); goPrev(); }}
                    aria-label="Previous"
                    className="absolute left-2 sm:left-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 text-white text-2xl hover:bg-white/20 transition"
                >
                    ‹
                </button>
            )}

            {/* Media */}
            <div
                className="max-w-[92vw] max-h-[88vh] flex flex-col items-center"
                onClick={(e) => e.stopPropagation()}
            >
                {item.type === "video" ? (
                    <video
                        src={item.url}
                        controls
                        autoPlay
                        className="max-w-[92vw] max-h-[82vh] rounded-lg bg-black"
                    />
                ) : (
                    <Image
                        src={item.url}
                        alt={item.name || "attachment"}
                        width={1600}
                        height={1200}
                        className="max-w-[92vw] max-h-[82vh] w-auto h-auto object-contain rounded-lg"
                        unoptimized
                    />
                )}
                {item.name && (
                    <p className="text-white/70 text-xs mt-3 truncate max-w-[90vw]">{item.name}</p>
                )}
            </div>

            {/* Next */}
            {hasMany && (
                <button
                    onClick={(e) => { e.stopPropagation(); goNext(); }}
                    aria-label="Next"
                    className="absolute right-2 sm:right-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 text-white text-2xl hover:bg-white/20 transition"
                >
                    ›
                </button>
            )}
        </div>
    );
}
