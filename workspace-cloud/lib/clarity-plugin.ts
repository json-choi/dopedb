import Clarity from "@microsoft/clarity";
import type { WebAnalyticsPlugin } from "./web-analytics";

// The npm wrapper exposes events/consent; the upstream runtime also exposes stop.
type ClarityWindow = Window & { clarity?: ((command: string) => void) & { q?: unknown[] } };

export function clarityPlugin(projectId: string): WebAnalyticsPlugin {
  let started = false;
  let initialized = false;
  return {
    name: "clarity",
    start() {
      if (started) return;
      if (!/^[a-z0-9]+$/.test(projectId)) throw new Error("Invalid Clarity project ID");
      if (initialized) (window as ClarityWindow).clarity?.("start");
      else Clarity.init(projectId);
      initialized = true;
      started = true;
      Clarity.consentV2({ ad_Storage: "denied", analytics_Storage: "granted" });
    },
    track(event) {
      if (!started) return;
      Clarity.setTag("page", event.page);
      Clarity.setTag("language", event.language);
      Clarity.event(event.name);
    },
    stop() {
      if (!started) return;
      started = false;
      const runtime = (window as ClarityWindow).clarity;
      if (runtime?.q) runtime.q.length = 0;
      Clarity.consentV2({ ad_Storage: "denied", analytics_Storage: "denied" });
      runtime?.("stop");
    },
  };
}
