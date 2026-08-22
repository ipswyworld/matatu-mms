import type { Metadata } from "next";
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
