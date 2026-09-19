import type { MetadataRoute } from "next";

import { workspaceSiteUrl } from "../lib/workspace-site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    host: workspaceSiteUrl,
  };
}
