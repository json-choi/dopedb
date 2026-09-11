// Browser analytics contract and fan-out. Plugins receive reviewed enums only;
// operational errors, arbitrary properties and customer identifiers are excluded.
export type WebAnalyticsEvent = Readonly<{
  version: 1;
  name: "workspace_page_viewed";
  page: "settings";
  language: "en" | "ko";
}>;

export interface WebAnalyticsPlugin {
  readonly name: string;
  start(): void | Promise<void>;
  track(event: WebAnalyticsEvent): void | Promise<void>;
  stop(): void | Promise<void>;
}

export function webAnalyticsPage(url: URL): "settings" | null {
  if (url.search || url.hash) return null;
  return url.pathname === "/settings" || url.pathname === "/ko/settings"
    ? "settings" : null;
}

export function validWebAnalyticsEvent(value: unknown): value is WebAnalyticsEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return event.version === 1 && event.name === "workspace_page_viewed"
    && event.page === "settings" && (event.language === "en" || event.language === "ko")
    && Object.keys(value).sort().join(",") === "language,name,page,version";
}

export function createWebAnalytics(plugins: readonly WebAnalyticsPlugin[]) {
  let active = false;
  let generation = 0;
  let pendingStart: Promise<void> | null = null;
  let pendingStop: Promise<unknown> = Promise.resolve();
  const ready = new Set<WebAnalyticsPlugin>();
  const safely = async (action: () => void | Promise<void>) => {
    try { await action(); return true; } catch { return false; }
  };
  return {
    async start() {
      if (active) return pendingStart;
      active = true;
      const current = ++generation;
      const previous = pendingStart;
      const stopped = pendingStop;
      const run = async () => {
        if (previous) await previous;
        await stopped;
        if (current !== generation || !active) return;
        await Promise.all(plugins.map(async (plugin) => {
          const started = await safely(() => plugin.start());
          if (current !== generation || !active) {
            await safely(() => plugin.stop());
          } else if (started) ready.add(plugin);
        }));
      };
      pendingStart = run();
      await pendingStart;
    },
    track(event: WebAnalyticsEvent) {
      if (!active || !validWebAnalyticsEvent(event)) return;
      const safeEvent = Object.freeze({ ...event });
      for (const plugin of ready) void safely(() => plugin.track(safeEvent));
    },
    stop() {
      active = false;
      generation++;
      ready.clear();
      pendingStop = Promise.all([pendingStop, ...plugins.map((plugin) => safely(() => plugin.stop()))]);
      return pendingStop;
    },
  };
}
