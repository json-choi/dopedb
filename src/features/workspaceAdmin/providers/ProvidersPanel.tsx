// Settings → Workspace → Providers. Owns the section's view switch, the one browser
// authorization in flight, the credential form that is open, and the Google Cloud
// SQL setup that replaces both views while it runs. Provider changes run one at a
// time: switching views locks while any provider request is running, and every
// saved change re-reads the provider projections the views render.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { SegmentedControl } from "../../../design-system/components/SegmentedControl";
import { useI18n } from "../../../lib/i18n";
import { useCatalogScope } from "../../../lib/queries";
import { useEventCallback } from "../../../lib/useEventCallback";
import {
  takePendingConnectionFocus,
  type WorkspaceAdminPanelProps,
} from "../navigationRequest";
import {
  connectableProvider,
  managedConnectionIds,
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
import SharedDatabasesView from "./databases/SharedDatabasesView";
import type { ManagedConnection } from "./domain";
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

type ProvidersView = "accounts" | "databases";

type ActiveGcpSetup = {
  session: GcpSetupSession;
  repair: GcpRepairTarget | null;
  providerName: string;
};

export default function ProvidersPanel({ scope }: WorkspaceAdminPanelProps) {
  const { lang, t } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  // A recovery request from outside Settings reveals its database exactly once.
  const [initialFocus] = useState(() => takePendingConnectionFocus());
  const [view, setView] = useState<ProvidersView>(initialFocus ? "databases" : "accounts");
  const [focusConnectionId, setFocusConnectionId] = useState<string | null>(initialFocus);
  const [accountsBusy, setAccountsBusy] = useState(false);
  const [databasesBusy, setDatabasesBusy] = useState(false);
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
  const busy = accountsBusy || databasesBusy || wizardBusy || authorization.busy;

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
    // The databases view locks its own commands while its changes run.
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
      setView("accounts");
      setDialog({ provider: connectable, providerName, mode: "reconnect" });
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
      setFocusConnectionId(saved.repair.connectionId);
      setView("databases");
      return;
    }
    setNotice({ kind: "connected", providerName: setup.providerName });
  }

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
        <SegmentedControl
          value={view}
          label={t("workspaceProviders.views")}
          disabled={busy}
          options={[
            { value: "accounts", label: t("workspaceProviders.viewAccounts") },
            { value: "databases", label: t("workspaceProviders.viewDatabases") },
          ]}
          onChange={(next) => {
            if (!busy) setView(next);
          }}
        />
      </div>
      <ProviderStatusNotice
        status={authorization.status}
        notice={notice}
        databasesVisible={view === "databases"}
        onCheckNow={authorization.checkNow}
        onCancel={authorization.cancel}
        onStart={startAuthorization}
        onDismissNotice={() => setNotice(null)}
        onOpenDatabases={() => {
          if (busy) return;
          setNotice(null);
          setView("databases");
        }}
      />
      {view === "accounts" ? (
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
      ) : (
        <SharedDatabasesView
          scope={scope}
          onConnectAccount={() => {
            if (!busy) setView("accounts");
          }}
          onRepair={(managed) => void repair(managed)}
          repairingConnectionId={authorization.repairingConnectionId}
          focusConnectionId={focusConnectionId}
          onBusyChange={setDatabasesBusy}
        />
      )}
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
          onCancel={() => setDialog(null)}
          onConnected={() => handleConnected(dialog)}
        />
      ) : null}
    </div>
  );
}
