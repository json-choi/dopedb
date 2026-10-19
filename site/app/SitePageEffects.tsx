"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function SitePageEffects() {
  const pathname = usePathname();
  const queryLanguage = useSearchParams().get("lang");
  useEffect(() => {
    const language = pathname === "/ko" || pathname.startsWith("/ko/") || queryLanguage === "ko" ? "ko" : "en";
    // Next preserves the root layout during client navigation; keep the document
    // language aligned with the visible page.
    document.documentElement.lang = language;
  }, [pathname, queryLanguage]);
  return null;
}
