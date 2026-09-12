import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Citizen-facing — wants to be found ("Nairobi matatu fine payment",
// "book a matatu seat"). Excludes the API surface and the two pages that
// carry a one-time token in the URL (a search engine caching or
// prefetching either would be a real leak, not just noise).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/reset-password", "/guardian-approve"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
