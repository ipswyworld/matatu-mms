import type { MetadataRoute } from "next";

// SUPERADMIN-only console, reachable at its own public URL with no
// network-layer isolation on this deployment (see MULTI_STAKEHOLDER_REVIEW.md,
// Cross-Cutting Theme #3). The session check is the real access control;
// this just makes sure nothing points a crawler or a search result at it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
