"use client";

// Connection tasks share navigation while controllers retain separate state.
import { useEffect, useState } from "react";
import { ControlButton } from "../components/Controls";
import { SharedDatabasePanel } from "./SharedDatabasePanel";
import { GcpCloudSetup } from "../../features/providerAccess/GcpCloudSetup";
import { ProviderIntegrationList } from "../../features/providerAccess/ProviderIntegrationList";
import { useProviderAccountAccess } from "../../features/providerAccess/useProviderAccountAccess";
import { workspaceMessages } from "../../lib/workspace-messages";
import { useWorkspaceLocale } from "../components/WorkspaceLocale";

function CloudAccountPanel({
  workspaceId,
  gcpSetupId = null,
  onBusyChange,
}: {
  workspaceId: string;
  gcpSetupId?: string | null;
  onBusyChange?: (busy: boolean) => void;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].cloudAccounts;
  const controller = useProviderAccountAccess(workspaceId, gcpSetupId);
  const configuringGcp = Boolean(controller.gcpSetupId);
  useEffect(() => {
    onBusyChange?.(Boolean(controller.mutation));
  }, [controller.mutation, onBusyChange]);

  return (
    <section className="tw:grid tw:gap-5 tw:p-6 tw:max-[640px]:p-4">
      {controller.loading ? (
        <p className="tw:m-0 tw:border-y tw:border-border tw:py-5 tw:text-2xs tw:text-muted-foreground">
          {copy.loading}
        </p>
      ) : configuringGcp ? (
        <GcpCloudSetup controller={controller} />
      ) : (
        <ProviderIntegrationList controller={controller} />
      )}

      {!configuringGcp && controller.error ? (
        <p
          className="tw:m-0 tw:border tw:border-danger/40 tw:bg-danger/5 tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-danger"
          role="alert"
        >
          {controller.error}
        </p>
      ) : null}
    </section>
  );
}

export function ProviderWorkspacePanel({
  workspaceId, gcpSetupId, initialIntegrationId, initialConnectionId,
}: {
  workspaceId: string;
  gcpSetupId: string | null;
  initialIntegrationId: string | null;
  initialConnectionId: string | null;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale];
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"connect" | "databases">(
    !gcpSetupId && (initialIntegrationId || initialConnectionId) ? "databases" : "connect",
  );
  return (
    <div className="tw:min-w-0">
      {!gcpSetupId ? (
        <nav className="tw:flex tw:flex-wrap tw:gap-2 tw:border-b tw:border-border tw:px-6 tw:py-3 tw:max-[640px]:px-4"
          aria-label={copy.settings.areas.providers.label}>
          <ControlButton disabled={busy} aria-pressed={view === "connect"} onClick={() => setView("connect")}>
            {copy.providerList.connectTitle}
          </ControlButton>
          <ControlButton disabled={busy} aria-pressed={view === "databases"} onClick={() => setView("databases")}>
            {copy.sharedDatabases.title}
          </ControlButton>
        </nav>
      ) : null}
      {view === "connect" || gcpSetupId ? (
        <CloudAccountPanel workspaceId={workspaceId} gcpSetupId={gcpSetupId} onBusyChange={setBusy} />
      ) : (
        <SharedDatabasePanel workspaceId={workspaceId}
          initialIntegrationId={initialIntegrationId} initialConnectionId={initialConnectionId}
          onBusyChange={setBusy} onConnectAccount={() => setView("connect")} />
      )}
    </div>
  );
}
