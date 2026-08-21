interface TabButtonProps {
    label: string;
    isActive: boolean;
    onClick: () => void;
    activeColor?: string;
}

export function TabButton({ label, isActive, onClick, activeColor = "text-indigo-600" }: TabButtonProps) {
    return (
        <button
            onClick={onClick}
            className={`flex-1 min-w-20 py-2.5 text-xs font-bold rounded-md transition ${isActive ? `bg-white ${activeColor} shadow-sm` : "text-gray-500"}`}
        >
            {label}
        </button>
    );
}
