"use client";

// One browser owner for consent and optional analytics plugins. No event backlog
// is retained before consent, and SDK loading never blocks the workspace UI.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createWebAnalytics, webAnalyticsPage, type WebAnalyticsEvent, type WebAnalyticsPlugin } from "../../lib/web-analytics";
import { ControlButton } from "./Controls";
import { useWorkspaceLocale } from "./WorkspaceLocale";

const consentKey = "dopedb.workspace-web-analytics.v1";
const AnalyticsContext = createContext<(event: WebAnalyticsEvent) => void>(() => {});
export const useWebAnalytics = () => useContext(AnalyticsContext);

export function WorkspaceWebAnalytics({ children, projectId }: {
  children: ReactNode;
  projectId: string;
}) {
  const loadPlugins = useCallback(async () => {
    const { clarityPlugin } = await import("../../lib/clarity-plugin");
    return [clarityPlugin(projectId)];
  }, [projectId]);
  return <WebAnalyticsProvider enabled={/^[a-z0-9]+$/.test(projectId)} loadPlugins={loadPlugins}>
    {children}
  </WebAnalyticsProvider>;
}

export function WebAnalyticsProvider({ children, enabled, loadPlugins }: {
  children: ReactNode;
  enabled: boolean;
  loadPlugins: () => Promise<readonly WebAnalyticsPlugin[]>;
}) {
  const locale = useWorkspaceLocale();
  const pathname = usePathname();
  const client = useRef<ReturnType<typeof createWebAnalytics> | null>(null);
  const usedDocument = useRef(false);
  const [consent, setConsent] = useState<string | null>(null);
  const [eligible, setEligible] = useState(false);
  useEffect(() => {
    const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
    const allowed = enabled && location.protocol === "https:"
      && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
      && privacy.doNotTrack !== "1" && !privacy.globalPrivacyControl
      && webAnalyticsPage(new URL(location.href)) !== null;
    setEligible(allowed);
    let saved: string | null = null;
    try { saved = localStorage.getItem(consentKey); } catch { /* Remain opted out. */ }
    setConsent(saved);
    if (!allowed || saved !== "granted" || usedDocument.current) return;
    let disposed = false;
    void loadPlugins().then(async (plugins) => {
      if (disposed) return;
      usedDocument.current = true;
      const instance = createWebAnalytics(plugins);
      client.current = instance;
      await instance.start();
      if (!disposed) instance.track({ version: 1, name: "workspace_page_viewed", page: "settings", language: locale });
    }).catch(() => {});
    const revoke = () => {
      disposed = true;
      client.current?.stop();
      client.current = null;
    };
    const storage = (event: StorageEvent) => {
      if (event.key === consentKey || event.key === null) {
        revoke();
        location.reload();
      }
    };
    // Stop before the router changes a URL: an effect cleanup alone happens after
    // the next page can render. Do not resume within this document after navigation.
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    const push: History["pushState"] = function (this: History, ...args) {
      revoke();
      return pushState.apply(this, args);
    };
    const replace: History["replaceState"] = function (this: History, ...args) {
      revoke();
      return replaceState.apply(this, args);
    };
    history.pushState = push;
    history.replaceState = replace;
    window.addEventListener("storage", storage);
    window.addEventListener("pagehide", revoke);
    window.addEventListener("popstate", revoke);
    return () => {
      revoke();
      if (history.pushState === push) history.pushState = pushState;
      if (history.replaceState === replace) history.replaceState = replaceState;
      window.removeEventListener("storage", storage);
      window.removeEventListener("pagehide", revoke);
      window.removeEventListener("popstate", revoke);
    };
  }, [enabled, loadPlugins, pathname, locale]);

  function choose(value: "granted" | "denied") {
    client.current?.stop();
    client.current = null;
    try {
      localStorage.setItem(consentKey, value);
      location.reload();
    } catch { setConsent("denied"); }
  }
  const ko = locale === "ko";
  return (
    <AnalyticsContext.Provider value={(event) => client.current?.track(event)}>
      {children}
      {eligible && (
        <aside aria-label={ko ? "사용 분석 설정" : "Usage analytics settings"}
          className="tw:fixed tw:bottom-4 tw:right-4 tw:z-50 tw:max-w-sm tw:rounded-control tw:border tw:border-border tw:bg-surface tw:p-4 tw:text-xs tw:text-foreground">
          {consent !== "granted" && consent !== "denied" ? <>
            <p>{ko
              ? "사용성 개선을 위해 Microsoft Clarity가 마스킹된 화면과 클릭·스크롤을 수집하도록 허용할까요? 광고용 쿠키는 사용하지 않습니다."
              : "Allow Microsoft Clarity to collect masked page recordings, clicks and scrolling to improve usability? Advertising cookies stay disabled."}</p>
            <a href="https://privacy.microsoft.com/privacystatement" target="_blank" rel="noreferrer">{ko ? "Microsoft 개인정보처리방침" : "Microsoft privacy statement"}</a>
            <div className="tw:mt-3 tw:flex tw:flex-wrap tw:gap-2">
              <ControlButton onClick={() => choose("denied")}>{ko ? "거부" : "Decline"}</ControlButton>
              <ControlButton onClick={() => choose("granted")}>{ko ? "허용" : "Allow"}</ControlButton>
            </div>
          </> : <ControlButton onClick={() => choose(consent === "granted" ? "denied" : "granted")}>
            {consent === "granted" ? (ko ? "사용 분석 끄기" : "Turn off usage analytics") : (ko ? "사용 분석 허용" : "Allow usage analytics")}
          </ControlButton>}
        </aside>
      )}
    </AnalyticsContext.Provider>
  );
}
