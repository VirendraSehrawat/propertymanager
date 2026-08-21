"use client";

import { ReactNode, useEffect } from "react";

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: ReactNode;
    className?: string;
    /** Use bottom-sheet style on mobile */
    bottomSheet?: boolean;
}

export function Modal({ isOpen, onClose, children, className = "max-w-md", bottomSheet }: ModalProps) {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        }
        return () => {
            document.body.style.overflow = "";
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div
            className={`fixed inset-0 bg-black/50 flex ${bottomSheet ? "items-end sm:items-center" : "items-center"} justify-center p-4 z-50 overflow-y-auto`}
            onClick={onClose}
        >
            <div
                className={`bg-white ${bottomSheet ? "rounded-t-2xl sm:rounded-2xl" : "rounded-xl"} p-6 w-full ${className} shadow-2xl`}
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
}
