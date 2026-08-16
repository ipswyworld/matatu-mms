import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageProvider";

// Set NEXT_PUBLIC_SITE_URL once this deploys to a real domain — canonical
// URLs and Open Graph images resolve against it.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Matatu Management System | Nairobi City County Government",
    template: "%s | Matatu Management System",
  },
  description: "Fleet registration, live GPS telemetry, seat booking, fare compliance and enforcement for Nairobi County's matatu sector.",
};

const governmentOfficeSchema = {
  "@context": "https://schema.org",
  "@type": "GovernmentOffice",
  name: "Nairobi City County Transport Department",
  alternateName: "Matatu Management System",
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
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
