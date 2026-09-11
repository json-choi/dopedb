// The website's public wire contract must never admit customer identifiers or
// arbitrary properties, even when a client skips the tracking component.
import { expect, vi } from "vitest";
import { readSiteAnalytics, siteAnalyticsPoint, trackSiteEvent } from "../../site/lib/analytics";
import { createWebAnalytics, webAnalyticsPage, type WebAnalyticsEvent } from "./web-analytics";

export async function assertSiteAnalyticsContract() {
  const webEvent: WebAnalyticsEvent = {
    version: 1, name: "workspace_page_viewed", page: "settings", language: "ko",
  };
  const healthy = { name: "test", start: vi.fn(), track: vi.fn(), stop: vi.fn() };
  const failing = {
    name: "failed", start: vi.fn().mockRejectedValue(new Error("Offline")),
    track: vi.fn(), stop: vi.fn().mockRejectedValue(new Error("Offline")),
  };
  const web = createWebAnalytics([failing, healthy]);
  web.track(webEvent);
  expect(healthy.track).not.toHaveBeenCalled();
  await web.start();
  await web.start();
  expect(healthy.start).toHaveBeenCalledOnce();
  web.track({ ...webEvent, query: "private" } as WebAnalyticsEvent);
  expect(healthy.track).not.toHaveBeenCalled();
  web.track(webEvent);
  expect(healthy.track).toHaveBeenCalledExactlyOnceWith(webEvent);
  expect(failing.track).not.toHaveBeenCalled();
  web.stop();
  web.track(webEvent);
  expect(healthy.track).toHaveBeenCalledOnce();
  expect(healthy.stop).toHaveBeenCalledOnce();
  for (const path of ["/settings", "/ko/settings"]) {
    expect(webAnalyticsPage(new URL(path, "https://app.dopedb.dev"))).toBe("settings");
  }
  for (const path of ["/auth/sign-in", "/analyses/private", "/accept-invitation/private",
    "/settings?workspace=private", "/settings#private", "/ko/settings?token=private"]) {
    expect(webAnalyticsPage(new URL(path, "https://app.dopedb.dev"))).toBeNull();
  }
  let completeStart!: () => void;
  const delayed = { name: "delayed", start: () => new Promise<void>((resolve) => { completeStart = resolve; }), track: vi.fn(), stop: vi.fn() };
  const cancelled = createWebAnalytics([delayed]);
  const starting = cancelled.start();
  await Promise.resolve();
  cancelled.stop();
  completeStart();
  await starting;
  cancelled.track(webEvent);
  expect(delayed.track).not.toHaveBeenCalled();
  expect(delayed.stop).toHaveBeenCalled();
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
