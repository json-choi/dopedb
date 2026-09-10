"use client";

import Link from "next/link";
import { useId } from "react";
import { DopeDBMarkGraphic } from "../../../src/design-system/components/DopeDBMarkGraphic";
import { localizedWorkspacePath } from "../../lib/workspace-locale";
import { workspaceMessages } from "../../lib/workspace-messages";
import { useWorkspaceLocale } from "./WorkspaceLocale";

export function Brand({
  destination = "workspace",
  tone = "default",
}: {
  destination?: "marketing" | "workspace";
  tone?: "default" | "inverse";
}) {
  const instanceId = useId();
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].brand;
  const href = destination === "marketing"
    ? `https://dopedb.dev${locale === "ko" ? "/ko" : ""}`
    : localizedWorkspacePath("/settings", locale);
  return (
    <Link
      className="tw:group tw:relative tw:z-[2] tw:inline-flex tw:items-center tw:gap-2.5 tw:font-semibold tw:tracking-[-0.025em] tw:data-[tone=inverse]:text-chrome-foreground"
      data-tone={tone}
      href={href}
      aria-label={destination === "marketing" ? copy.marketingHome : copy.home}
    >
      <DopeDBMarkGraphic
        instanceId={instanceId}
        className="tw:size-7 tw:text-primary tw:group-data-[tone=inverse]:text-signal"
      />
      <span className="tw:text-[16px]">DopeDB</span>
      <small className="tw:ml-1 tw:border-l tw:border-border tw:pl-3 tw:font-mono tw:text-2xs tw:font-medium tw:tracking-[0.09em] tw:text-muted-foreground tw:uppercase tw:group-data-[tone=inverse]:border-chrome-border tw:group-data-[tone=inverse]:text-chrome-muted">
        Workspace
      </small>
    </Link>
  );
}
