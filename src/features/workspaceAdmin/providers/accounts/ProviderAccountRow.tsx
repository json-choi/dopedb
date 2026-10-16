// One provider row of the Connect accounts list: what the provider issues, the
// connect command, a Cloud SQL setup that is ready to continue, and every account
// already connected through it with its reconnect and disconnect commands.
import ConfirmButton from "../../../../components/ConfirmButton";
import EngineMark from "../../../../components/EngineMark";
import { Icon } from "../../../../components/Icon";
import { Button } from "../../../../design-system/components/Button";
import { SettingsRow } from "../../../../design-system/components/SettingsList";
import {
  LoadingLabel,
  StatusBadge,
} from "../../../../design-system/components/Status";
import { useI18n, type I18nKey, type Lang } from "../../../../lib/i18n";
import type { Integration, ManagedConnection } from "../domain";
import type { GcpSetupSession } from "../gcp/gcpModel";
import {
  hasBroadNeonKey,
  integrationNeedsReconnect,
  managedDatabaseCount,
  neonProjectCount,
  type ConnectableProvider,
  type ProviderAccountGroup,
} from "./accountModel";
import type { DisconnectFailure } from "./providerErrors";

const PROVIDER_NOTES: Record<ConnectableProvider, I18nKey> = {
  planetScale: "workspaceProviders.notePlanetScale",
  gcpCloudSql: "workspaceProviders.noteGcpCloudSql",
  neon: "workspaceProviders.noteNeon",
  vault: "workspaceProviders.noteVault",
};

type MarkedEngine = "postgres" | "mysql";

function formatTime(value: string, lang: Lang, withDate: boolean): string | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", withDate
    ? { dateStyle: "medium", timeStyle: "short" }
    : { timeStyle: "short" }).format(new Date(time));
}

function ConnectedAccountItem({
  integration,
  managedConnections,
  inventoryFailed,
  canReconnect,
  locked,
  disconnecting,
  failure,
  onReconnect,
  onDisconnect,
}: {
  integration: Integration;
  managedConnections: ManagedConnection[] | null;
  inventoryFailed: boolean;
  canReconnect: boolean;
  locked: boolean;
  disconnecting: boolean;
  failure: DisconnectFailure | null;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const { lang, t } = useI18n();
  const projects = neonProjectCount(integration.displayName);
  const name = projects === null
    ? integration.displayName
    : t("workspaceProviders.neonProjectsName", { count: projects });
  const reconnectRequired = integrationNeedsReconnect(integration);
  const databaseCount = managedDatabaseCount(managedConnections, integration.id);
  const checkedAt = formatTime(integration.updatedAt, lang, true);
  const meta = [
    databaseCount !== null
      ? t("workspaceProviders.accountDatabases", { count: databaseCount })
      : inventoryFailed
        ? t("workspaceProviders.accountDatabasesUnavailable")
        : null,
    checkedAt ? t("workspaceProviders.accountLastChecked", { time: checkedAt }) : null,
  ].filter((part): part is string => part !== null);

  return (
    <li className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-start tw:gap-x-3 tw:gap-y-1 tw:py-2">
      <div className="tw:grid tw:min-w-0 tw:gap-0.5">
        <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
          <span className="tw:min-w-0 tw:truncate tw:text-ui tw:font-medium tw:text-foreground" title={name}>
            {name}
          </span>
          <StatusBadge tone={reconnectRequired ? "danger" : "success"} density="compact">
            {t(reconnectRequired
              ? "workspaceProviders.accountReconnectRequired"
              : "workspaceProviders.accountActive")}
          </StatusBadge>
        </span>
        {meta.length > 0 ? (
          <span className="tw:text-xs tw:text-muted-foreground">{meta.join(" · ")}</span>
        ) : null}
        {reconnectRequired ? (
          <span className="tw:text-xs tw:leading-body tw:text-danger">
            {t("workspaceProviders.accountReconnectNeeded")}
          </span>
        ) : null}
        {hasBroadNeonKey(integration) ? (
          <span className="tw:text-xs tw:leading-body tw:text-warning">
            {t("workspaceProviders.accountBroadKey")}
          </span>
        ) : null}
        {disconnecting ? (
          <span className="tw:text-xs">
            <LoadingLabel>{t("workspaceProviders.disconnecting")}</LoadingLabel>
          </span>
        ) : null}
        {failure && !disconnecting ? (
          <span
            className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2 tw:text-xs tw:leading-body tw:text-danger"
            role="alert"
          >
            <span className="tw:min-w-0">{failure.message}</span>
            {failure.retryable ? (
              <Button size="compact" disabled={locked} onClick={onDisconnect}>
                {t("workspaceAdmin.retry")}
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="tw:flex tw:items-center tw:gap-1">
        {canReconnect ? (
          <Button
            size="compact"
            variant="ghost"
            iconOnly
            title={t("workspaceProviders.reconnectAccount", { name })}
            disabled={locked}
            onClick={onReconnect}
          >
            <Icon name="refresh" />
          </Button>
        ) : null}
        <ConfirmButton
          iconOnly
          size="compact"
          variant="ghost"
          tone="danger"
          label={t("workspaceProviders.disconnectAccount", { name })}
          confirmLabel={t("workspaceProviders.disconnectConfirm", { name })}
          disabled={locked}
          onConfirm={onDisconnect}
        >
          <Icon name="trash" />
        </ConfirmButton>
      </div>
    </li>
  );
}

export default function ProviderAccountRow({
  group,
  managedConnections,
  inventoryFailed,
  locked,
  disconnectingId,
  failure,
  readyGcpSetup,
  onConnect,
  onReconnect,
  onDisconnect,
  onContinueGcpSetup,
}: {
  group: ProviderAccountGroup;
  managedConnections: ManagedConnection[] | null;
  inventoryFailed: boolean;
  locked: boolean;
  disconnectingId: string | null;
  failure: { integrationId: string; failure: DisconnectFailure } | null;
  readyGcpSetup: GcpSetupSession | null;
  onConnect: () => void;
  onReconnect: (integration: Integration) => void;
  onDisconnect: (integration: Integration) => void;
  onContinueGcpSetup: (setup: GcpSetupSession) => void;
}) {
  const { lang, t } = useI18n();
  const name = group.provider?.name ?? group.id;
  const engines = (group.provider?.supportedEngines ?? []).filter(
    (engine): engine is MarkedEngine => engine === "postgres" || engine === "mysql",
  );
  const leaseSeconds = group.provider?.leaseSeconds ?? null;
  const meta = [
    group.integrations.length > 0
      ? t("workspaceProviders.connectedCount", { count: group.integrations.length })
      : t("workspaceProviders.notConnected"),
    leaseSeconds !== null && leaseSeconds > 0
      ? t("workspaceProviders.leaseLimit", { minutes: Math.max(1, Math.round(leaseSeconds / 60)) })
      : null,
  ].filter((part): part is string => part !== null);
  const setupExpiresAt = readyGcpSetup ? formatTime(readyGcpSetup.expiresAt, lang, false) : null;

  return (
    <SettingsRow
      identity={(
        <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
          <strong className="tw:min-w-0 tw:truncate tw:text-ui tw:font-semibold tw:text-foreground">
            {name}
          </strong>
          {engines.length > 0 ? (
            <span className="tw:flex tw:shrink-0 tw:items-center tw:gap-1">
              {engines.map((engine) => <EngineMark key={engine} engine={engine} size="tree" />)}
            </span>
          ) : null}
        </span>
      )}
      details={(
        <span className="tw:grid tw:min-w-0 tw:gap-0.5">
          <span className="tw:text-xs tw:leading-body tw:text-muted-foreground">
            {group.connectable
              ? t(PROVIDER_NOTES[group.connectable])
              : t("workspaceProviders.providerUnavailable")}
          </span>
          <span className="tw:text-xs tw:text-muted-foreground">{meta.join(" · ")}</span>
        </span>
      )}
      actions={group.connectable ? (
        <Button
          size="compact"
          disabled={locked}
          aria-label={t(group.integrations.length > 0
            ? "workspaceProviders.addProviderAccount"
            : "workspaceProviders.connectProviderAccount", { provider: name })}
          onClick={onConnect}
        >
          {t(group.integrations.length > 0
            ? "workspaceProviders.addAccount"
            : "workspaceProviders.connect")}
        </Button>
      ) : undefined}
    >
      {readyGcpSetup || group.integrations.length > 0 ? (
        <div className="tw:grid tw:min-w-0 tw:gap-1">
          {readyGcpSetup ? (
            <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-t tw:border-border-subtle tw:pt-2">
              <span className="tw:min-w-0 tw:text-xs tw:leading-body tw:text-foreground">
                {t("workspaceProviders.gcpSetupReady", {
                  account: readyGcpSetup.account,
                  time: setupExpiresAt ?? readyGcpSetup.expiresAt,
                })}
              </span>
              <Button
                size="compact"
                disabled={locked}
                onClick={() => onContinueGcpSetup(readyGcpSetup)}
              >
                {t("workspaceProviders.gcpSetupContinue")}
              </Button>
            </div>
          ) : null}
          {group.integrations.length > 0 ? (
            <ul className="tw:m-0 tw:grid tw:list-none tw:divide-y tw:divide-border-subtle tw:border-t tw:border-border-subtle tw:p-0">
              {group.integrations.map((integration) => (
                <ConnectedAccountItem
                  key={integration.id}
                  integration={integration}
                  managedConnections={managedConnections}
                  inventoryFailed={inventoryFailed}
                  canReconnect={group.connectable !== null}
                  locked={locked}
                  disconnecting={disconnectingId === integration.id}
                  failure={failure?.integrationId === integration.id ? failure.failure : null}
                  onReconnect={() => onReconnect(integration)}
                  onDisconnect={() => onDisconnect(integration)}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SettingsRow>
  );
}
