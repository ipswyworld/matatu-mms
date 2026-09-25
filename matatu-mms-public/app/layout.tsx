import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageProvider";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import MaintenanceBanner from "@/components/MaintenanceBanner";

// Set NEXT_PUBLIC_SITE_URL once this deploys to a real domain — canonical
// URLs and Open Graph images resolve against it.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Mji-Move | Nairobi City County Government",
    template: "%s | Mji-Move",
  },
  description: "Fleet registration, live GPS telemetry, seat booking, fare compliance and enforcement for Nairobi County's matatu sector.",
  // Installable on a phone (Readiness List §11) — lower friction than an
  // app-store download, and works better on the lower-end Android devices
  // common among this user base.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Nairobi Matatu",
  },
};

// Separate export per Next 14: viewport and themeColor moved out of
// metadata, and leaving them there logs a warning without taking effect.
export const viewport: Viewport = {
  themeColor: "#0F5132",
  width: "device-width",
  initialScale: 1,
  // Not locked: pinch-zoom is an accessibility requirement (WCAG 1.4.4),
  // and disabling it is a common and avoidable failure in mobile web apps.
  maximumScale: 5,
};

const governmentOfficeSchema = {
  "@context": "https://schema.org",
  "@type": "GovernmentOffice",
  name: "Nairobi City County Transport Department",
  alternateName: "Mji-Move",
  url: SITE_URL,
  logo: `${SITE_URL}/nairobi-crest.jpg`,
  telephone: "+254-20-222-4411",
  email: "transport@nairobi.go.ke",
  address: {
    "@type": "PostalAddress",
    streetAddress: "City Hall, Nairobi CBD",
    addressLocality: "Nairobi",
    addressCountry: "KE",
  },
  areaServed: {
    "@type": "AdministrativeArea",
    name: "Nairobi City County",
  },
  parentOrganization: {
    "@type": "GovernmentOrganization",
    name: "Nairobi City County Government",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(governmentOfficeSchema) }}
        />
      </head>
      <body className="min-h-screen">
        <MaintenanceBanner />
        <LanguageProvider>{children}</LanguageProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
