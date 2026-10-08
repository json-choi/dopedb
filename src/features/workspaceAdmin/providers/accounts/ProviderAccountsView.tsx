// Connect accounts view. Reads the provider accounts first and the managed
// database inventory after them, so an inventory failure only removes database
// counts and never hides an account. Disconnect is the one change owned here;
// browser authorizations, credential forms and Cloud SQL repairs are routed to
// the panel, which serializes them with this view's work.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import Skeleton from "../../../../components/Skeleton";
import { Button } from "../../../../design-system/components/Button";
import {
  SettingsList,
  SettingsSectionHeader,
} from "../../../../design-system/components/SettingsList";
import { InlineNotice } from "../../../../design-system/components/Status";
import { useI18n } from "../../../../lib/i18n";
import { useCatalogScope } from "../../../../lib/queries";
import type { WorkspaceAdminScope } from "../../domain";
import { runWorkspaceAdmin, workspaceAdminErrorMessage } from "../../requests";
import type { Integration, ManagedConnection, Provider } from "../domain";
import type { GcpSetupSession } from "../gcp/gcpModel";
import { gcpSetupsQuery } from "../gcp/queries";
import { providerAccountsQuery, providerInventoryQuery } from "../queries";
import {
  connectableProvider,
  managedConnectionIds,
  providerAccountGroups,
  type ConnectDialogRequest,
  type ProviderAccountGroup,
} from "./accountModel";
import ProviderAccountRow from "./ProviderAccountRow";
import { disconnectFailure, type DisconnectFailure } from "./providerErrors";
import { refreshDesktopConnections } from "../../desktopConnections";
import { invalidateProviderReads } from "./providerReads";
import type { AuthorizationRequest } from "./useProviderAuthorization";

export default function ProviderAccountsView({
  scope,
  locked,
  authorizationInFlight,
  onStartAuthorization,
  onOpenDialog,
  onRepair,
  onContinueGcpSetup,
  onBusyChange,
}: {
  scope: WorkspaceAdminScope;
  /** Another provider change is running or a browser authorization is open. */
  locked: boolean;
  authorizationInFlight: boolean;
  onStartAuthorization: (request: AuthorizationRequest) => void;
  onOpenDialog: (request: ConnectDialogRequest) => void;
  onRepair: (managed: ManagedConnection) => void;
  onContinueGcpSetup: (setup: GcpSetupSession, providerName: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { lang, t } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const accounts = useQuery(providerAccountsQuery(scope));
  const inventory = useQuery({ ...providerInventoryQuery(scope), enabled: accounts.isSuccess });
  const gcpConnectable = accounts.data?.providers.some(
    (provider) => connectableProvider(provider) === "gcpCloudSql",
  ) ?? false;
  const setups = useQuery({
    ...gcpSetupsQuery(scope),
    enabled: gcpConnectable && !authorizationInFlight,
  });
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    integrationId: string;
    failure: DisconnectFailure;
  } | null>(null);
  const busy = disconnectingId !== null;
  const rowLocked = locked || busy;

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const managedConnections = inventory.data?.managedConnections ?? null;
  const groups = accounts.data
    ? providerAccountGroups(accounts.data.providers, accounts.data.integrations)
    : [];
  const readyGcpSetup = !authorizationInFlight ? setups.data?.[0] ?? null : null;
  const orphanFailure = failure && !accounts.data?.integrations.some(
    (integration) => integration.id === failure.integrationId,
  ) ? failure.failure : null;

  function connect(group: ProviderAccountGroup) {
    const provider = group.provider;
    if (rowLocked || !provider || !group.connectable) return;
    setFailure(null);
    if (group.connectable === "neon" || group.connectable === "vault") {
      onOpenDialog({ provider: group.connectable, providerName: provider.name, mode: "connect" });
      return;
    }
    onStartAuthorization({ provider: group.connectable, providerName: provider.name, repair: null });
  }

  async function reconnect(integration: Integration, provider: Provider | null) {
    const connectable = provider ? connectableProvider(provider) : null;
    if (rowLocked || !provider || !connectable) return;
    setFailure(null);
    if (connectable === "neon" || connectable === "vault") {
      onOpenDialog({ provider: connectable, providerName: provider.name, mode: "reconnect" });
      return;
    }
    if (connectable === "gcpCloudSql") {
      // A Cloud SQL account is repaired with its existing project and instance
      // pinned, so the managed inventory must be known before re-authorizing.
      let inventoryRows = managedConnections;
      if (!inventoryRows) {
        inventoryRows = await queryClient.fetchQuery(providerInventoryQuery(scope))
          .then((snapshot) => snapshot.managedConnections, () => null);
      }
      if (!inventoryRows) {
        setFailure({
          integrationId: integration.id,
          failure: {
            message: t("workspaceProviders.gcpRepairInventoryUnavailable"),
            retryable: false,
            refresh: false,
          },
        });
        return;
      }
      const managed = inventoryRows.find((item) => item.integrationId === integration.id);
      if (managed) {
        onRepair(managed);
        return;
      }
    }
    onStartAuthorization({ provider: connectable, providerName: provider.name, repair: null });
  }

  async function disconnect(integration: Integration) {
    if (rowLocked) return;
    // Unknown when the inventory could not be read: refresh conservatively then.
    const affectedConnections = managedConnections
      ? managedConnectionIds(managedConnections, integration.id)
      : null;
    setDisconnectingId(integration.id);
    setFailure(null);
    try {
      await runWorkspaceAdmin(scope.accountId, {
        kind: "disconnectProviderIntegration",
        workspaceId: scope.workspaceId,
        integrationId: integration.id,
      });
      await invalidateProviderReads(queryClient, scope);
      if (affectedConnections === null || affectedConnections.length > 0) {
        // Its databases now use member-local credentials; Desktop must re-read
        // them. Best effort in the background: the disconnect already succeeded.
        void refreshDesktopConnections(queryClient, catalogScope.key, affectedConnections ?? [])
          .catch(() => undefined);
      }
    } catch (error) {
      const result = disconnectFailure(error, { lang, t });
      setFailure({ integrationId: integration.id, failure: result });
      if (result.refresh) await invalidateProviderReads(queryClient, scope);
    } finally {
      setDisconnectingId(null);
    }
  }

  const accountsError = accounts.isError ? (
    <InlineNotice
      tone="danger"
      icon="alert"
      role="alert"
      action={(
        <Button
          size="compact"
          disabled={accounts.isFetching}
          onClick={() => void accounts.refetch()}
        >
          {t("workspaceAdmin.retry")}
        </Button>
      )}
    >
      {workspaceAdminErrorMessage(accounts.error, { lang, t }, "workspaceProviders.loadFailed")}
    </InlineNotice>
  ) : null;

  let content = null;
  if (!accounts.data) {
    // A failed first read shows only its error; a failed re-read keeps the last list.
    content = accounts.isError ? null : <Skeleton lines={4} />;
  } else if (groups.length === 0) {
    content = (
      <p className="tw:m-0 tw:py-4 tw:text-ui tw:text-muted-foreground">
        {t("workspaceProviders.unavailable")}
      </p>
    );
  } else {
    content = (
      <SettingsList>
        {groups.map((group) => (
          <ProviderAccountRow
            key={group.id}
            group={group}
            managedConnections={managedConnections}
            inventoryFailed={inventory.isError}
            locked={rowLocked}
            disconnectingId={disconnectingId}
            failure={failure}
            readyGcpSetup={group.connectable === "gcpCloudSql" ? readyGcpSetup : null}
            onConnect={() => connect(group)}
            onReconnect={(integration) => void reconnect(integration, group.provider)}
            onDisconnect={(integration) => void disconnect(integration)}
            onContinueGcpSetup={(setup) => onContinueGcpSetup(
              setup,
              group.provider?.name ?? group.id,
            )}
          />
        ))}
      </SettingsList>
    );
  }

  return (
    <section className="tw:grid tw:min-w-0 tw:gap-2">
      <SettingsSectionHeader title={t("workspaceProviders.accountsTitle")} />
      <p className="tw:m-0 tw:text-ui tw:leading-body tw:text-muted-foreground">
        {t("workspaceProviders.accountsDescription")}
      </p>
      {accountsError}
      {content}
      {inventory.isError ? (
        <InlineNotice
          tone="warning"
          icon="alert"
          action={(
            <Button
              size="compact"
              disabled={inventory.isFetching}
              onClick={() => void inventory.refetch()}
            >
              {t("workspaceAdmin.retry")}
            </Button>
          )}
        >
          {t("workspaceProviders.inventoryFailed")}
        </InlineNotice>
      ) : null}
      {orphanFailure ? (
        <InlineNotice tone="warning" icon="alert" role="status">
          {orphanFailure.message}
        </InlineNotice>
      ) : null}
    </section>
  );
}
