import type { Metadata } from "next";
// Self-hosted via Fontsource (Google's own open license) rather than a
// request to Google's font CDN — kept consistent with the other two apps.
import "@fontsource-variable/google-sans/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ops Console | Nairobi Matatu MMS",
  description: "Superadmin-only infrastructure and access-control console for the Nairobi City County Matatu Management System.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}
