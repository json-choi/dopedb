// Public-site metrics use a closed vocabulary. No URL, query, identifier,
// referrer, free text, or request header is retained in the dataset.
const sources = ["header", "hero", "download_section", "platform_grid"];
const targets = ["latest_release", "windows_x64_installer", "macos_arm64_dmg", "macos_x64_dmg"];

export function siteAnalyticsPoint(value: unknown): string[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== "event,properties"
    || !row.properties || typeof row.properties !== "object" || Array.isArray(row.properties)) return null;
  const properties = row.properties as Record<string, unknown>;
  const shape = Object.keys(properties).sort().join();
  const oneOf = (key: string, allowed: string[]) => typeof properties[key] === "string"
    && allowed.includes(properties[key] as string);
  if (row.event === "Page Viewed" && shape === "language,page"
    && oneOf("language", ["en", "ko"]) && oneOf("page", ["home", "privacy", "terms"])) {
    return [row.event, properties.page as string, properties.language as string, ""];
  }
  if (row.event === "Download Clicked" && shape === "selection,source,target"
    && oneOf("source", sources) && oneOf("target", targets)
    && oneOf("selection", ["detected", "manual", "fallback"])) {
    return [row.event, properties.source as string, properties.target as string, properties.selection as string];
  }
  if (row.event === "Download Options Opened" && shape === "detected,source"
    && oneOf("source", sources.slice(0, 3)) && oneOf("detected", ["macos", "unsupported"])) {
    return [row.event, properties.source as string, properties.detected as string, ""];
  }
  if (row.event === "Workspace Opened" && shape === "source"
    && oneOf("source", ["header", "hero", "footer"])) {
    return [row.event, properties.source as string, "", ""];
  }
  return null;
}

export function trackSiteEvent(event: string, properties: object) {
  if (typeof navigator === "undefined" || typeof location === "undefined"
    || location.origin !== "https://dopedb.dev" || navigator.doNotTrack === "1"
    || ("globalPrivacyControl" in navigator && navigator.globalPrivacyControl === true)) return;
  const payload = { event, properties };
  if (!siteAnalyticsPoint(payload)) return;
  const body = new Blob([JSON.stringify(payload)], { type: "application/json" });
  try {
    if (navigator.sendBeacon?.("/api/site-events", body)) return;
  } catch { /* A blocked metrics request must not interrupt navigation. */ }
  try {
    void fetch("/api/site-events", { method: "POST", body, keepalive: true,
      credentials: "omit" }).catch(() => undefined);
  } catch { /* Browser privacy controls may disable both transports. */ }
}

/** A strict 1 KiB streaming limit also covers chunked requests. */
export async function readSiteAnalytics(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1_024) return null;
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return siteAnalyticsPoint(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
