interface StatCardProps {
    label: string;
    value: string | number;
    bgColor?: string;
    borderColor?: string;
    labelColor?: string;
    valueColor?: string;
    subtitle?: string;
}

export function StatCard({
    label,
    value,
    bgColor = "bg-gray-50",
    borderColor = "border-gray-200",
    labelColor = "text-gray-600",
    valueColor = "text-gray-800",
    subtitle,
}: StatCardProps) {
    return (
        <div className={`${bgColor} border ${borderColor} rounded-xl p-3 text-center`}>
            <p className={`text-[10px] font-bold ${labelColor} uppercase`}>{label}</p>
            <p className={`text-xl font-bold ${valueColor} mt-1`}>{value}</p>
            {subtitle && <p className="text-[10px] text-gray-500">{subtitle}</p>}
        </div>
    );
}
