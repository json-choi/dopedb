// The website's public wire contract must never admit customer identifiers or
// arbitrary properties, even when a client skips the tracking component.
import { expect, vi } from "vitest";
import { readSiteAnalytics, siteAnalyticsPoint, trackSiteEvent } from "../../site/lib/analytics";

export async function assertSiteAnalyticsContract() {
  const payload = { event: "Page Viewed", properties: { page: "home", language: "ko" } };
  const request = (body: string) => new Request("https://dopedb.dev/api/site-events", {
    method: "POST", headers: { "content-type": "application/json" }, body,
  });
  expect(await readSiteAnalytics(request(JSON.stringify(payload))))
    .toEqual(["Page Viewed", "home", "ko", ""]);
  for (const value of [
    { ...payload, identifier: "unexpected" },
    { ...payload, properties: { ...payload.properties, query: "unexpected" } },
    { ...payload, properties: { page: "/customer-path", language: "ko" } },
    { event: "Unknown", properties: {} },
  ]) expect(siteAnalyticsPoint(value)).toBeNull();
  expect(await readSiteAnalytics(request(" ".repeat(1_025) + JSON.stringify(payload)))).toBeNull();
  expect(await readSiteAnalytics(request("{"))).toBeNull();
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  const beacon = vi.fn().mockImplementation(() => { throw new Error("Blocked"); });
  try {
    vi.stubGlobal("location", { origin: "https://dopedb.dev" });
    vi.stubGlobal("navigator", { doNotTrack: "1", sendBeacon: beacon });
    vi.stubGlobal("fetch", fetchMock);
    trackSiteEvent(payload.event, payload.properties);
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { globalPrivacyControl: true, sendBeacon: beacon });
    trackSiteEvent(payload.event, payload.properties);
    expect(beacon).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    expect(() => trackSiteEvent(payload.event, payload.properties)).not.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.stubGlobal("location", { origin: "http://localhost:8787" });
    trackSiteEvent(payload.event, payload.properties);
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
}
