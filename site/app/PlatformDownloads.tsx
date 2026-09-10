"use client";

// Platform downloads progressively enhance stable latest-release links. Browser
// hints may identify Windows and a Mac CPU, but an unknown Mac architecture is
// never guessed: that path moves the visitor to the explicit build chooser.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUpRight, Download, MonitorDown } from "lucide-react";
import { MarketingButton } from "./MarketingButton";
import {
  TrackedLink,
  type DownloadTarget,
  type TrackedLinkTrackingProps,
} from "./TrackedLink";
import {
  downloadUrls,
  releasesUrl,
  type HomeCopy,
} from "./homeContent";

type DownloadCopy = HomeCopy["download"];
type RecommendationSource = "header" | "hero" | "download_section";
type UserAgentData = {
  platform?: string;
  getHighEntropyValues?: (
    hints: string[],
  ) => Promise<{ architecture?: string; bitness?: string }>;
};

type DownloadRecommendation =
  | {
      kind: "download";
      platform: "unknown" | "windows" | "macos-arm64" | "macos-x64";
      href: string;
      target: DownloadTarget;
      selection: "detected" | "fallback";
    }
  | {
      kind: "options";
      platform: "macos" | "unsupported";
      href: "#download-options";
    };

const fallbackRecommendation: DownloadRecommendation = {
  kind: "download",
  platform: "unknown",
  href: releasesUrl,
  target: "latest_release",
  selection: "fallback",
};

let recommendationPromise: Promise<DownloadRecommendation> | undefined;

function architectureFamily(value: string): "arm64" | "x64" | undefined {
  const normalized = value.toLowerCase();
  if (/arm|aarch64/.test(normalized)) return "arm64";
  if (/x86|amd64|x64/.test(normalized)) return "x64";
  return undefined;
}

async function detectDownloadRecommendation(): Promise<DownloadRecommendation> {
  const browserNavigator = navigator as Navigator & {
    userAgentData?: UserAgentData;
  };
  const userAgentData = browserNavigator.userAgentData;
  const userAgent = browserNavigator.userAgent;
  const platform = `${userAgentData?.platform ?? ""} ${browserNavigator.platform}`;
  const isTouchIpad =
    browserNavigator.platform === "MacIntel" && browserNavigator.maxTouchPoints > 1;

  if (/iphone|ipad|ipod|android/i.test(userAgent) || isTouchIpad) {
    return { kind: "options", platform: "unsupported", href: "#download-options" };
  }
  if (/windows/i.test(`${platform} ${userAgent}`)) {
    return {
      kind: "download",
      platform: "windows",
      href: downloadUrls.windows,
      target: "windows_x64_installer",
      selection: "detected",
    };
  }
  if (/mac/i.test(`${platform} ${userAgent}`)) {
    let architecture = architectureFamily(
      `${browserNavigator.platform} ${userAgent.match(/arm64|aarch64|x86_64|amd64/)?.[0] ?? ""}`,
    );

    if (!architecture && userAgentData?.getHighEntropyValues) {
      try {
        const hints = await userAgentData.getHighEntropyValues([
          "architecture",
          "bitness",
        ]);
        architecture = architectureFamily(
          `${hints.architecture ?? ""} ${hints.bitness ?? ""}`,
        );
      } catch {
        // Privacy-restricted browsers intentionally fall through to explicit choice.
      }
    }

    if (architecture === "arm64") {
      return {
        kind: "download",
        platform: "macos-arm64",
        href: downloadUrls.macApple,
        target: "macos_arm64_dmg",
        selection: "detected",
      };
    }
    if (architecture === "x64") {
      return {
        kind: "download",
        platform: "macos-x64",
        href: downloadUrls.macIntel,
        target: "macos_x64_dmg",
        selection: "detected",
      };
    }
    return { kind: "options", platform: "macos", href: "#download-options" };
  }
  return { kind: "options", platform: "unsupported", href: "#download-options" };
}

function recommendation(): Promise<DownloadRecommendation> {
  recommendationPromise ??= detectDownloadRecommendation().catch(
    () => fallbackRecommendation,
  );
  return recommendationPromise;
}

function useDownloadRecommendation(): DownloadRecommendation {
  const [current, setCurrent] = useState(fallbackRecommendation);

  useEffect(() => {
    let active = true;
    void recommendation().then((detected) => {
      if (active) setCurrent(detected);
    });
    return () => {
      active = false;
    };
  }, []);

  return current;
}

function recommendationLabel(
  current: DownloadRecommendation,
  copy: DownloadCopy,
  fallbackLabel: string,
): string {
  switch (current.platform) {
    case "windows":
      return copy.downloadWindows;
    case "macos-arm64":
      return copy.downloadMacApple;
    case "macos-x64":
      return copy.downloadMacIntel;
    case "macos":
      return copy.chooseMac;
    case "unsupported":
      return copy.chooseDesktop;
    default:
      return fallbackLabel;
  }
}

function recommendationStatus(
  current: DownloadRecommendation,
  copy: DownloadCopy,
): string {
  switch (current.platform) {
    case "windows":
      return copy.detectedWindows;
    case "macos-arm64":
      return copy.detectedMacApple;
    case "macos-x64":
      return copy.detectedMacIntel;
    case "macos":
      return copy.detectedMacUnknown;
    case "unsupported":
      return copy.detectedUnsupported;
    default:
      return copy.detectionPending;
  }
}

function downloadTracking(
  current: DownloadRecommendation,
  source: RecommendationSource,
): TrackedLinkTrackingProps {
  if (current.kind === "options") {
    return {
      event: "Download Options Opened",
      properties: { source, detected: current.platform },
    };
  }
  return {
    event: "Download Clicked",
    properties: {
      source,
      target: current.target,
      selection: current.selection,
    },
  };
}

export function RecommendedMarketingDownload({
  copy,
  fallbackLabel,
  source,
}: {
  copy: DownloadCopy;
  fallbackLabel: string;
  source: Exclude<RecommendationSource, "header">;
}) {
  const current = useDownloadRecommendation();
  const label = recommendationLabel(current, copy, fallbackLabel);
  const tracking = downloadTracking(current, source);

  return (
    <MarketingButton
      {...tracking}
      aria-label={label}
      data-download-recommendation={current.platform}
      href={current.href}
      variant="primary"
    >
      <Download size={16} />
      {label}
    </MarketingButton>
  );
}

export function RecommendedHeaderDownload({
  copy,
  fallbackLabel,
}: {
  copy: DownloadCopy;
  fallbackLabel: string;
}) {
  const current = useDownloadRecommendation();
  const label = recommendationLabel(current, copy, fallbackLabel);
  const tracking = downloadTracking(current, "header");

  return (
    <TrackedLink
      {...tracking}
      aria-label={label}
      className="tw:flex tw:min-h-11 tw:items-center tw:gap-2 tw:text-[12px] tw:font-medium tw:text-signal tw:hover:text-signal-strong"
      data-download-recommendation={current.platform}
      href={current.href}
      title={label}
    >
      {fallbackLabel}
      <ArrowUpRight size={13} />
    </TrackedLink>
  );
}

export function PlatformDownloadOptions({ copy }: { copy: DownloadCopy }) {
  const current = useDownloadRecommendation();
  const recommendedTarget = current.kind === "download" ? current.target : undefined;
  const platforms = [
    {
      href: downloadUrls.windows,
      label: copy.windows,
      target: "windows_x64_installer",
    },
    {
      href: downloadUrls.macApple,
      label: copy.macApple,
      target: "macos_arm64_dmg",
    },
    {
      href: downloadUrls.macIntel,
      label: copy.macIntel,
      target: "macos_x64_dmg",
    },
  ] as const;

  return (
    <div
      className="tw:mt-5 tw:scroll-mt-24"
      data-download-recommendation={current.platform}
      id="download-options"
    >
      <p
        className="tw:mb-3 tw:flex tw:min-h-5 tw:items-center tw:gap-2 tw:font-mono tw:text-[10px] tw:leading-relaxed tw:font-medium tw:tracking-[0.06em] tw:text-cream-muted tw:uppercase"
        role="status"
        aria-live="polite"
      >
        <MonitorDown className="tw:shrink-0 tw:text-signal" size={14} />
        {recommendationStatus(current, copy)}
      </p>
      <div className="tw:grid tw:grid-cols-3 tw:gap-px tw:bg-hairline tw:max-[620px]:grid-cols-1">
        {platforms.map((platform) => {
          const recommended = recommendedTarget === platform.target;
          return (
            <TrackedLink
              className="tw:flex tw:min-h-[76px] tw:items-center tw:justify-between tw:gap-3 tw:bg-night-raised tw:px-4 tw:font-mono tw:text-[10px] tw:font-medium tw:leading-relaxed tw:tracking-[0.06em] tw:text-cream-muted tw:uppercase tw:transition-colors tw:hover:bg-night-soft tw:hover:text-cream tw:data-[recommended=true]:bg-signal/10 tw:data-[recommended=true]:text-cream tw:data-[recommended=true]:outline tw:data-[recommended=true]:-outline-offset-1 tw:data-[recommended=true]:outline-signal/60"
              data-recommended={recommended || undefined}
              event="Download Clicked"
              href={platform.href}
              key={platform.target}
              properties={{
                source: "platform_grid",
                target: platform.target,
                selection: "manual",
              }}
            >
              <span>{platform.label}</span>
              <span className="tw:flex tw:shrink-0 tw:items-center tw:gap-2">
                {recommended ? (
                  <span className="tw:text-[8px] tw:tracking-[0.08em] tw:text-signal">
                    {copy.recommended}
                  </span>
                ) : null}
                <ArrowDown className="tw:text-signal" size={14} />
              </span>
            </TrackedLink>
          );
        })}
      </div>
    </div>
  );
}
