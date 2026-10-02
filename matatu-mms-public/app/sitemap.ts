import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Only the genuinely public, content-stable pages — not booking/tracking
// screens, which are behind auth and change per-user, and not the two
// token-carrying pages already excluded in robots.ts.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    { path: "/", priority: 1, changeFrequency: "daily" as const },
    { path: "/faq", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/compliance-notice", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/contact", priority: 0.5, changeFrequency: "monthly" as const },
    { path: "/pay-fine", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/operator-onboarding", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/register", priority: 0.6, changeFrequency: "monthly" as const },
  ];

  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));
}
