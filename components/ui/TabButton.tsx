interface TabButtonProps {
    label: string;
    isActive: boolean;
    onClick: () => void;
    activeColor?: string;
    count?: number;
}

export function TabButton({ label, isActive, onClick, activeColor = "text-indigo-600", count }: TabButtonProps) {
    return (
        <button
            onClick={onClick}
            className={`flex-1 min-w-20 px-3 py-2 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 shrink-0 ${
                isActive ? `bg-white ${activeColor} shadow-sm border border-gray-200` : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
            }`}
        >
            <span>{label}</span>
            {count !== undefined && count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                    isActive ? "bg-indigo-100 text-indigo-800" : "bg-gray-200 text-gray-700"
                }`}>
                    {count}
                </span>
            )}
        </button>
    );
}
