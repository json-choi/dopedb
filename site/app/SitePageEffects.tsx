"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackSiteEvent } from "../lib/analytics";

export function SitePageEffects() {
  const pathname = usePathname();
  const queryLanguage = useSearchParams().get("lang");
  useEffect(() => {
    const language = pathname === "/ko" || pathname.startsWith("/ko/") || queryLanguage === "ko" ? "ko" : "en";
    // Next preserves the root layout during client navigation; keep the document
    // language and the closed page-count language aligned with the visible page.
    document.documentElement.lang = language;
    const path = pathname.replace(/^\/ko(?=\/|$)/, "") || "/";
    const page = path === "/" ? "home" : path === "/privacy" ? "privacy" : path === "/terms" ? "terms" : null;
    if (page) trackSiteEvent("Page Viewed", {
      page, language,
    });
  }, [pathname, queryLanguage]);
  return null;
}
