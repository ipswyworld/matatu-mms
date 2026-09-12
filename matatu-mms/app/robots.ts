import type { MetadataRoute } from "next";

// Internal county staff tool. No public value in being indexed, and being
// findable via search is its own minor exposure for a government back
// office — matches the noindex robots metadata already set in layout.tsx.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
