import type { MetadataRoute } from "next";

/**
 * Web app manifest (§7.2): lets staff install the app on their phone's home
 * screen. Opens straight into the staff dashboard.
 */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Property Manager — Staff",
        short_name: "Staff Portal",
        description: "Collect rent, take meter readings and keep the daily books.",
        start_url: "/employee",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f3f4f6",
        theme_color: "#ea580c",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    };
}
