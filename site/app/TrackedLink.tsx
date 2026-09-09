"use client";

// Public-site tracking accepts only the reviewed CTA names and property pairs;
// links without an analytics event remain ordinary anchors.
import { trackSiteEvent } from "../lib/analytics";
import type { AnchorHTMLAttributes, ReactNode } from "react";

export type DownloadSource =
  | "header"
  | "hero"
  | "download_section"
  | "platform_grid";

export type DownloadTarget =
  | "latest_release"
  | "windows_x64_installer"
  | "macos_arm64_dmg"
  | "macos_x64_dmg";

type DownloadTrackingProperties = {
  source: DownloadSource;
  target: DownloadTarget;
  selection: "detected" | "manual" | "fallback";
};

export type TrackedLinkTrackingProps =
  | { event?: never; properties?: never }
  | {
      event: "Download Clicked";
      properties: DownloadTrackingProperties;
    }
  | {
      event: "Download Options Opened";
      properties: {
        source: Exclude<DownloadSource, "platform_grid">;
        detected: "macos" | "unsupported";
      };
    }
  | {
      event: "Workspace Opened";
      properties: { source: "header" | "hero" | "footer" };
    };

export type TrackedLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
} & TrackedLinkTrackingProps;

export function TrackedLink({
  children,
  event,
  properties,
  onClick,
  ...props
}: TrackedLinkProps) {
  return (
    <a
      {...props}
      onClick={(clickEvent) => {
        if (event) {
          trackSiteEvent(event, properties);
        }
        onClick?.(clickEvent);
      }}
    >
      {children}
    </a>
  );
}
