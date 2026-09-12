import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ops Console | Nairobi Matatu MMS",
  description: "Superadmin-only infrastructure and access-control console for the Nairobi City County Matatu Management System.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Matatu Ops",
  },
  // Reachable at its own public URL with no network-layer isolation on
  // this deployment (see MULTI_STAKEHOLDER_REVIEW.md, Cross-Cutting Theme
  // #3) — the SUPERADMIN-only session check is the real access control,
  // but there is no reason to also make this findable via search or a
  // link preview. See app/robots.ts for the crawler-facing version.
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0F5132",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}
