// Workspace management → Providers. Owns the one browser authorization in flight, the
// credential form that is open, the managed-connection repair a recovery request
// focuses, and the Google Cloud SQL setup that replaces the page while it runs.
// Providers hold accounts only: databases are added in the connection editor and
// listed in Explorer. Provider changes run one at a time, and every saved change
// re-reads the provider projections the page renders.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "../../../components/Icon";
import { Button } from "../../../design-system/components/Button";
import { InlineNotice } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import { useCatalogScope } from "../../../lib/queries";
import { useEventCallback } from "../../../lib/useEventCallback";
import {
  takePendingWorkspaceAdminFocus,
  type WorkspaceAdminPanelProps,
} from "../navigationRequest";
import {
  connectableProvider,
  managedConnectionIds,
  vaultReconnectTarget,
  type ConnectDialogRequest,
} from "./accounts/accountModel";
import NeonConnectDialog from "./accounts/NeonConnectDialog";
import ProviderAccountsView from "./accounts/ProviderAccountsView";
import { providerErrorMessage } from "./accounts/providerErrors";
import { refreshDesktopConnections } from "../desktopConnections";
import { invalidateProviderReads } from "./accounts/providerReads";
import ProviderStatusNotice, { type ProvidersNotice } from "./accounts/ProviderStatusNotice";
import {
  useProviderAuthorization,
  type AuthorizationOutcome,
  type AuthorizationRequest,
} from "./accounts/useProviderAuthorization";
import VaultConnectDialog from "./accounts/VaultConnectDialog";
import type { ManagedConnection } from "./domain";
import NeonBranchManager from "./neonBranches/NeonBranchManager";
import GcpSetupWizard from "./gcp/GcpSetupWizard";
import {
  forgetGcpRepair,
  gcpRepairTarget,
  pendingGcpRepair,
  type GcpRepairTarget,
  type GcpSetupSession,
} from "./gcp/gcpModel";
import { gcpSetupsQuery } from "./gcp/queries";
import { announceManagedConnectionsRepaired } from "./gcp/repairSignal";
import type { GcpSetupSaved } from "./gcp/useGcpSetupWizard";
import { providerAccountsQuery, providerInventoryQuery } from "./queries";

type ActiveGcpSetup = {
  session: GcpSetupSession;
  repair: GcpRepairTarget | null;
  providerName: string;
};

/** The managed connection a recovery request opened this section for, with its repair command. */
function FocusedRepair({
  managed,
  locked,
  repairing,
  onRepair,
  onDismiss,
}: {
  managed: ManagedConnection;
  locked: boolean;
  repairing: boolean;
  onRepair: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <InlineNotice
      tone="warning"
      icon="shield"
      role="status"
      action={(
        <span className="tw:flex tw:flex-wrap tw:gap-2">
          <Button size="compact" variant="primary" disabled={locked} onClick={onRepair}>
            {repairing ? (
              <Icon name="refresh" className="tw:animate-spin tw:motion-reduce:animate-none" />
            ) : (
              <Icon name="shield" />
            )}
            {t(repairing
              ? "workspaceProviderDatabases.repairing"
              : "workspaceProviderDatabases.repair")}
          </Button>
          <Button size="compact" variant="ghost" onClick={onDismiss}>
            {t("common.close")}
          </Button>
        </span>
      )}
    >
      {t(managed.provider === "gcpCloudSql"
        ? "workspaceProviderDatabases.repairDescription"
        : "workspaceProviderDatabases.repairAccountDescription")}
    </InlineNotice>
  );
}

export default function ProvidersPanel({ scope }: WorkspaceAdminPanelProps) {
  const { lang, t } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  // A recovery request from outside the dialog focuses its managed connection once.
  const [initialFocus] = useState(() => takePendingWorkspaceAdminFocus());
  const [focusConnectionId, setFocusConnectionId] = useState<string | null>(
    initialFocus?.connectionId ?? null,
  );
  const inventory = useQuery(providerInventoryQuery(scope));
  const [accountsBusy, setAccountsBusy] = useState(false);
  const [wizardBusy, setWizardBusy] = useState(false);
  const [dialog, setDialog] = useState<ConnectDialogRequest | null>(null);
  const [notice, setNotice] = useState<ProvidersNotice | null>(null);
  const [gcpSetup, setGcpSetup] = useState<ActiveGcpSetup | null>(null);

  const authorization = useProviderAuthorization(scope, (outcome: AuthorizationOutcome) => {
    if (outcome.provider === "planetScale") {
      setNotice({ kind: "connected", providerName: outcome.providerName });
      void invalidateProviderReads(queryClient, scope);
      return;
    }
    setNotice(null);
    setGcpSetup({
      session: outcome.setup,
      repair: outcome.repair,
      providerName: outcome.providerName,
    });
  });
  const busy = accountsBusy || wizardBusy || authorization.busy;

  function startAuthorization(request: AuthorizationRequest) {
    if (busy) return;
    setNotice(null);
    void authorization.start(request);
  }

  function openDialog(request: ConnectDialogRequest) {
    if (busy) return;
    setNotice(null);
    setDialog(request);
  }

  const repair = useEventCallback(async (managed: ManagedConnection) => {
    if (accountsBusy || wizardBusy || authorization.busy) return;
    setNotice(null);
    let providerName: string;
    let connectable: ReturnType<typeof connectableProvider>;
    try {
      const snapshot = await queryClient.ensureQueryData(providerAccountsQuery(scope));
      const provider = snapshot.providers.find((item) => item.id === managed.provider);
      providerName = provider?.name ?? managed.provider;
      connectable = provider ? connectableProvider(provider) : null;
    } catch (error) {
      setNotice({
        kind: "error",
        message: providerErrorMessage(error, { lang, t }, "workspaceProviders.loadFailed"),
      });
      return;
    }
    if (!connectable) {
      setNotice({ kind: "error", message: t("workspaceProviders.repairProviderUnavailable") });
      return;
    }
    if (connectable === "neon" || connectable === "vault") {
      setDialog({
        provider: connectable,
        providerName,
        mode: "reconnect",
        integrationId: managed.integrationId,
      });
      return;
    }
    if (connectable === "planetScale") {
      void authorization.start({ provider: connectable, providerName, repair: null });
      return;
    }
    const target = gcpRepairTarget(managed);
    if (!target) {
      setNotice({ kind: "error", message: t("workspaceProviders.gcpRepairTargetUnavailable") });
      return;
    }
    void authorization.start({ provider: "gcpCloudSql", providerName, repair: target });
  });

  function continueGcpSetup(session: GcpSetupSession, providerName: string) {
    if (busy) return;
    setNotice(null);
    setGcpSetup({ session, repair: pendingGcpRepair(scope), providerName });
  }

  function handleConnected(request: ConnectDialogRequest) {
    setDialog(null);
    setNotice({ kind: "connected", providerName: request.providerName });
    void invalidateProviderReads(queryClient, scope);
    if (request.mode !== "reconnect") return;
    // A reconnected account restores the databases it serves. Refresh Desktop's
    // copies and clear their recovery state exactly as a Cloud SQL repair does.
    const managed = queryClient.getQueryData(providerInventoryQuery(scope).queryKey)
      ?.managedConnections;
    const affected = request.integrationId
      ? managedConnectionIds(managed, request.integrationId)
      : (managed ?? [])
          .filter((item) => item.provider === request.provider)
          .map((item) => item.connectionId);
    if (affected.length > 0 || managed === undefined) {
      void refreshDesktopConnections(queryClient, catalogScope.key, affected)
        .catch(() => undefined)
        .finally(() => announceManagedConnectionsRepaired(affected));
    }
  }

  function handleGcpSaved(saved: GcpSetupSaved) {
    const setup = gcpSetup;
    if (!setup) return;
    const managed = queryClient.getQueryData(providerInventoryQuery(scope).queryKey)
      ?.managedConnections;
    const affected = saved.repair
      ? [
          saved.repair.connectionId,
          ...managedConnectionIds(managed, saved.repair.integrationId),
        ]
      : managedConnectionIds(managed, saved.integrationId);
    forgetGcpRepair();
    setGcpSetup(null);
    // The saved setup is consumed; never offer to continue it while the list re-reads.
    queryClient.setQueryData(
      gcpSetupsQuery(scope).queryKey,
      (current) => current?.filter((item) => item.id !== setup.session.id),
    );
    void invalidateProviderReads(queryClient, scope);
    if (affected.length > 0 || managed === undefined) {
      // Background and best effort: the integration is already saved, and the
      // next workspace refresh converges Desktop's connections if this pull fails.
      void refreshDesktopConnections(queryClient, catalogScope.key, affected)
        .catch(() => undefined)
        .finally(() => {
          if (saved.repair) announceManagedConnectionsRepaired(affected);
        });
    }
    if (saved.repair) {
      setNotice({ kind: "repaired" });
      setFocusConnectionId(null);
      return;
    }
    setNotice({ kind: "connected", providerName: setup.providerName });
  }

  const focusedRepair = focusConnectionId
    ? inventory.data?.managedConnections?.find((item) => item.connectionId === focusConnectionId) ?? null
    : null;

  if (gcpSetup) {
    return (
      <div className="tw:w-full tw:max-w-[880px] tw:min-w-0 tw:p-4 tw:@max-[700px]:p-0">
        <GcpSetupWizard
          key={gcpSetup.session.id}
          scope={scope}
          session={gcpSetup.session}
          repair={gcpSetup.repair}
          onCancel={() => setGcpSetup(null)}
          onReconnect={() => {
            const { repair: target, providerName } = gcpSetup;
            setGcpSetup(null);
            void authorization.start({ provider: "gcpCloudSql", providerName, repair: target });
          }}
          onSaved={handleGcpSaved}
          onBusyChange={setWizardBusy}
        />
      </div>
    );
  }

  return (
    <div className="tw:grid tw:w-full tw:max-w-[880px] tw:min-w-0 tw:content-start tw:gap-4 tw:p-4 tw:@max-[700px]:p-0">
      <div className="tw:grid tw:min-w-0 tw:gap-3">
        <p className="tw:m-0 tw:text-ui tw:leading-body tw:text-muted-foreground">
          {t("workspaceProviders.description")}
        </p>
      </div>
      <ProviderStatusNotice
        status={authorization.status}
        notice={notice}
        onCheckNow={authorization.checkNow}
        onCancel={authorization.cancel}
        onStart={startAuthorization}
        onDismissNotice={() => setNotice(null)}
      />
      {focusedRepair ? (
        <FocusedRepair
          managed={focusedRepair}
          locked={busy}
          repairing={authorization.repairingConnectionId === focusedRepair.connectionId}
          onRepair={() => void repair(focusedRepair)}
          onDismiss={() => setFocusConnectionId(null)}
        />
      ) : null}
      <ProviderAccountsView
        scope={scope}
        locked={busy || authorization.inFlight}
        authorizationInFlight={authorization.inFlight}
        onStartAuthorization={startAuthorization}
        onOpenDialog={openDialog}
        onRepair={(managed) => void repair(managed)}
        onContinueGcpSetup={continueGcpSetup}
        onBusyChange={setAccountsBusy}
      />
      {inventory.data ? (
        <NeonBranchManager
          scope={scope}
          integrations={inventory.data.integrations}
          managedConnections={inventory.data.managedConnections ?? []}
        />
      ) : null}
      {dialog?.provider === "neon" ? (
        <NeonConnectDialog
          scope={scope}
          mode={dialog.mode}
          onCancel={() => setDialog(null)}
          onConnected={() => handleConnected(dialog)}
        />
      ) : null}
      {dialog?.provider === "vault" ? (
        <VaultConnectDialog
          scope={scope}
          mode={dialog.mode}
          reconnectTarget={dialog.mode === "reconnect"
            ? vaultReconnectTarget(
                queryClient.getQueryData(providerInventoryQuery(scope).queryKey)
                  ?.managedConnections,
                dialog.integrationId,
              )
            : null}
          onCancel={() => setDialog(null)}
          onConnected={() => handleConnected(dialog)}
        />
      ) : null}
    </div>
  );
}
