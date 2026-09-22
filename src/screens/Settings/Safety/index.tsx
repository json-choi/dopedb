// Per-connection SafetySettings editor. Loads via get_safety, saves via set_safety.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SafetySettings } from "../../../ipc/types";
import { errDetails, errMessage } from "../../../ipc/types";
import InfoTip from "../../../components/InfoTip";
import { useToast } from "../../../components/Toast";
import { Button } from "../../../design-system/components/Button";
import {
  CheckboxField,
  TextInput,
} from "../../../design-system/components/FormControls";
import { SettingsGroup } from "../../../design-system/components/Settings";
import { InlineNotice } from "../../../design-system/components/Status";
import {
  canManageWorkspaceWritePolicy,
  needsLocalSchemaConnection,
  effectiveSafetySettings,
  requestedSafetySettings,
  safetySchemaControlAvailable,
  safetyWriteControlAvailable,
} from "../../../features/safetySettings/policy";
import {
  persistConnectionSafety,
  WorkspaceWritePolicyRollbackError,
} from "../../../features/safetySettings/persistence";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import type { ConnectionProfile } from "../../../features/connections/domain";
import ManagedConnectionRecoveryNotice from "../../../features/connections/ManagedConnectionRecoveryNotice";
import { setWorkspaceConnectionWritePolicy } from "../../../features/workspaces/tauriAdapter";
import MonitoringAccess from "./MonitoringAccess";
import AccessPermissions from "./AccessPermissions";
import { setSafetySettings } from "../../../features/safetySettings/tauriAdapter";
import {
  safetyQueryKeys,
  safetySettingsQuery,
} from "../../../features/safetySettings/queries";
import {
  claimSafetySave,
  ownsSafetySave,
  releaseSafetySave,
  safetySaveInFlight,
  subscribeSafetySaves,
} from "../../../features/safetySettings/saveCoordinator";
import { queryResultPhase } from "../../../lib/queryResultPhase";

const TOGGLES: { key: keyof SafetySettings; label: I18nKey; hint: I18nKey }[] = [
  { key: "autoRunReads", label: "safety.autoRunReads", hint: "safety.autoRunReadsHint" },
  { key: "explainPreview", label: "safety.explainPreview", hint: "safety.explainPreviewHint" },
];

const NUMBERS: { key: keyof SafetySettings; label: I18nKey; hint: I18nKey }[] = [
  { key: "maxRows", label: "safety.maxRows", hint: "safety.maxRowsHint" },
  { key: "execPreviewRowLimit", label: "safety.execPreviewRowLimit", hint: "safety.execPreviewRowLimitHint" },
];

function sameSafetySettings(left: SafetySettings, right: SafetySettings) {
  return left.allowWrites === right.allowWrites
    && left.allowSchemaChanges === right.allowSchemaChanges
    && left.wrapWritesInTx === right.wrapWritesInTx
    && left.explainPreview === right.explainPreview
    && left.autoRunReads === right.autoRunReads
    && left.maxRows === right.maxRows
    && left.execPreviewRowLimit === right.execPreviewRowLimit;
}

type SafetyDraft = Readonly<{
  connectionId: string;
  settings: SafetySettings;
}>;

export default function Safety({
  connection,
  onConnectionUpdated,
  onSaved,
  onOpenAdminConnection,
}: {
  connection: ConnectionProfile;
  onConnectionUpdated: (connection: ConnectionProfile) => void;
  onSaved: (connectionId: string, settings: SafetySettings) => void;
  onOpenAdminConnection: () => void;
}) {
  const { t } = useI18n();
  const connectionId = connection.id;
  const workspaceManaged = connection.credentialMode !== "local";
  const workspacePolicyEditable = canManageWorkspaceWritePolicy(connection);
  const writeControlAvailable = safetyWriteControlAvailable(connection);
  const schemaControlAvailable = safetySchemaControlAvailable(connection);
  const memberLocalReadOnly = connection.credentialMode === "memberLocal";
  const [draft, setDraft] = useState<SafetyDraft | null>(null);
  const [saveError, setSaveError] = useState<{
    connectionId: string; kind: string | null; message: string;
  } | null>(null);
  const mountedRef = useRef(false);
  const viewRef = useRef({ connectionId, generation: 0 });
  if (viewRef.current.connectionId !== connectionId) {
    viewRef.current = {
      connectionId,
      generation: viewRef.current.generation + 1,
    };
  }
  const settings = draft?.connectionId === connectionId ? draft.settings : null;
  const busy = useSyncExternalStore(
    subscribeSafetySaves,
    () => safetySaveInFlight(connectionId),
    () => false,
  );
  const localSchemaRequired = needsLocalSchemaConnection(connection);
  const toast = useToast();
  const queryClient = useQueryClient();
  const safetyQuery = useQuery(safetySettingsQuery(connectionId));
  const safetyPhase = queryResultPhase(safetyQuery.data, safetyQuery.error);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setDraft(safetyQuery.data ? {
      connectionId,
      settings: effectiveSafetySettings(connection, safetyQuery.data),
    } : null);
  }, [connection, connectionId, safetyQuery.data]);

  if (!settings) {
    if (safetyPhase === "coldError" && safetyQuery.error) {
      return (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={(
            <Button size="compact" onClick={() => void safetyQuery.refetch()}>
              {t("app.retry")}
            </Button>
          )}
        >
          {t("safety.loadFailed", { error: errMessage(safetyQuery.error) })}
        </InlineNotice>
      );
    }
    return (
      <div role="status" className="tw:p-4 tw:text-muted-foreground">
        {t("safety.loading")}
      </div>
    );
  }

  const persistedSettings = safetyQuery.data
    ? effectiveSafetySettings(connection, safetyQuery.data)
    : null;
  const hasUnsavedChanges = persistedSettings !== null
    && !sameSafetySettings(settings, persistedSettings);

  function set<K extends keyof SafetySettings>(key: K, value: SafetySettings[K]) {
    setSaveError((current) => (
      current?.connectionId === connectionId ? null : current
    ));
    setDraft((current) => (
      current?.connectionId === connectionId
        ? { ...current, settings: { ...current.settings, [key]: value } }
        : current
    ));
  }

  async function save() {
    if (!settings || !hasUnsavedChanges) return;
    const requestToken = claimSafetySave(connectionId);
    if (!requestToken) return;
    const requestGeneration = viewRef.current.generation;
    const requestIsCurrent = () => (
      mountedRef.current
      && viewRef.current.connectionId === connectionId
      && viewRef.current.generation === requestGeneration
      && ownsSafetySave(connectionId, requestToken)
    );
    const requested = requestedSafetySettings(connection, settings);
    const localPolicyChange =
      connection.credentialMode === "local" &&
      connection.workspaceAccess === "local" &&
      connection.allowWrites !== requested.allowWrites;
    setSaveError(null);
    try {
      let persistedConnection = await persistConnectionSafety(
        connection,
        requested,
        {
          setDeviceSafety: setSafetySettings,
          setWorkspaceWritePolicy: setWorkspaceConnectionWritePolicy,
        },
      );
      if (localPolicyChange) {
        persistedConnection = {
          ...persistedConnection,
          allowWrites: requested.allowWrites,
        };
      }
      if (persistedConnection !== connection) {
        onConnectionUpdated(persistedConnection);
      }
      const persisted = await queryClient.fetchQuery({
        ...safetySettingsQuery(connectionId),
        staleTime: 0,
      });
      queryClient.setQueryData(safetyQueryKeys.detail(connectionId), persisted);
      onSaved(connectionId, persisted);
      if (requestIsCurrent()) {
        setDraft({ connectionId, settings: persisted });
        toast(t("safety.saved"));
      }
    } catch (e) {
      let message = errMessage(e);
      if (e instanceof WorkspaceWritePolicyRollbackError) {
        onConnectionUpdated(e.connection);
        message = t("safety.workspacePolicyRollbackFailed", {
          error: errMessage(e.rollbackError),
        });
      }
      let recovered: SafetySettings;
      try {
        recovered = await queryClient.fetchQuery({
          ...safetySettingsQuery(connectionId),
          staleTime: 0,
        });
      } catch {
        recovered = {
          ...requested,
          allowWrites: false,
          allowSchemaChanges: false,
        };
      }
      if (requestIsCurrent()) {
        setDraft({ connectionId, settings: recovered });
        setSaveError({ connectionId, kind: errDetails(e).kind, message });
        toast(message, "error");
      }
    } finally {
      releaseSafetySave(connectionId, requestToken);
    }
  }

  const effectiveAllowWrites =
    settings.allowWrites && writeControlAvailable;
  const effectiveAllowSchemaChanges =
    settings.allowSchemaChanges && effectiveAllowWrites && schemaControlAvailable;

  const schemaUnavailableHint: I18nKey | null = schemaControlAvailable
    ? null
    : memberLocalReadOnly
      ? "safety.memberLocalSchemaUnavailable"
      : connection.credentialMode === "managed" && connection.workspaceAccess !== "manage"
        ? "safety.schemaRequiresManage"
        : connection.credentialMode === "managed"
          ? connection.provider === "gcpCloudSql" && connection.engine === "postgres"
            ? "safety.schemaPreparationRequired"
            : "safety.schemaProviderUnavailable"
          : "safety.mutationsEngineUnavailable";

  const accessPermissions = [
    {
      key: "read",
      label: "safety.accessRead" as const,
      hint: "safety.accessReadHint" as const,
      checked: true,
      disabled: true,
      onChange: undefined,
    },
    {
      key: "write",
      label: "safety.accessWrite" as const,
      hint: "safety.accessWriteHint" as const,
      checked: effectiveAllowWrites,
      disabled: busy || !writeControlAvailable,
      onChange: (checked: boolean) => {
        setSaveError((current) => (
          current?.connectionId === connectionId ? null : current
        ));
        setDraft((current) => current?.connectionId === connectionId ? {
          ...current,
          settings: {
            ...current.settings,
            allowWrites: checked,
            allowSchemaChanges: checked && current.settings.allowSchemaChanges,
          },
        } : current);
      },
    },
    {
      key: "schema",
      label: "safety.accessSchema" as const,
      hint: "safety.accessSchemaHint" as const,
      checked: effectiveAllowSchemaChanges,
      disabled: busy || !schemaControlAvailable || !effectiveAllowWrites,
      onChange: (checked: boolean) => set("allowSchemaChanges", checked),
    },
  ];

  return (
    <div className="tw:flex tw:w-full tw:max-w-[880px] tw:flex-col tw:gap-4 tw:max-[640px]:max-w-none">
      {safetyPhase === "staleError" && safetyQuery.error ? (
        <InlineNotice
          tone="warning"
          icon="alert"
          role="status"
          action={(
            <Button size="compact" onClick={() => void safetyQuery.refetch()}>
              {t("app.retry")}
            </Button>
          )}
        >
          {t("safety.refreshFailed", { error: errMessage(safetyQuery.error) })}
        </InlineNotice>
      ) : null}
      {saveError?.connectionId === connectionId && saveError.kind === "managedConnectionRecoveryRequired" ? (
        <ManagedConnectionRecoveryNotice connection={connection} />
      ) : saveError?.connectionId === connectionId ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          {saveError.message}
        </InlineNotice>
      ) : null}
      <div className="tw:grid tw:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] tw:gap-4 tw:@max-[760px]:grid-cols-1">
        <SettingsGroup title={t("safety.guardrails")}>
          <AccessPermissions
            permissions={accessPermissions}
            hint={memberLocalReadOnly ? "safety.memberLocalReadOnlyHint"
              : workspacePolicyEditable ? "safety.sharedWritesManagerHint"
              : workspaceManaged ? "safety.sharedWritesHint" : "safety.accessLevelHint"}
            unavailableHint={schemaUnavailableHint}
            localSchemaRequired={localSchemaRequired}
            onOpenAdminConnection={onOpenAdminConnection}
            busy={busy}
          />
          {TOGGLES.map((item) => (
            <div
              key={item.key}
              className="tw:grid tw:min-h-control-lg tw:grid-cols-[minmax(0,1fr)_20px] tw:items-center tw:gap-2 tw:border-t tw:border-border-subtle tw:py-2 tw:first-of-type:border-t-0"
            >
              <CheckboxField
                checked={settings[item.key] as boolean}
                disabled={busy}
                onChange={(e) => set(item.key, e.target.checked as never)}
                label={<strong>{t(item.label)}</strong>}
              />
              <InfoTip label={t(item.hint)} />
            </div>
          ))}
        </SettingsGroup>

        <SettingsGroup title={t("safety.limits")}>
          {NUMBERS.map((n) => (
            <label
              key={n.key}
              className="tw:grid tw:min-h-control-lg tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_120px_20px] tw:items-center tw:gap-2 tw:border-t tw:border-border-subtle tw:py-2 tw:first-of-type:border-t-0 tw:@max-[400px]:grid-cols-[minmax(0,1fr)_20px] tw:@max-[400px]:[&>span]:col-span-2"
            >
              <span className="tw:text-sm tw:text-muted-foreground">
                {t(n.label)}
              </span>
              <TextInput
                density="compact"
                disabled={busy}
                type="number"
                min={n.key === "maxRows" ? 1 : 0}
                step={1}
                value={settings[n.key] as number}
                onChange={(e) => {
                  // Clamp to backend-enforced bounds; guard NaN from an empty field.
                  const raw = Math.floor(Number(e.target.value));
                  const v =
                    n.key === "maxRows"
                      ? Math.min(100000, Math.max(1, raw || 1))
                      : Math.min(1000000, Math.max(0, raw || 0));
                  set(n.key, v as never);
                }}
              />
              <InfoTip label={t(n.hint)} />
            </label>
          ))}
        </SettingsGroup>
      </div>

      <div className="ds-control-row tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-3 tw:[--ds-row-control-size:var(--ds-control-md)]">
        <Button
          size="compact"
          variant="primary"
          aria-busy={busy || undefined}
          disabled={busy || !hasUnsavedChanges}
          disabledBehavior="focusable"
          onClick={save}
        >
          {busy ? t("safety.applying") : t("safety.apply")}
        </Button>
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="tw:text-xs tw:leading-body tw:text-muted-foreground tw:data-[pending=true]:font-semibold tw:data-[pending=true]:text-warning"
          data-pending={busy || hasUnsavedChanges}
        >
          {busy
            ? t("safety.applying")
            : saveError?.connectionId === connectionId
              ? null
            : hasUnsavedChanges
            ? t("safety.unsavedChanges")
            : schemaUnavailableHint && !localSchemaRequired
              ? t(
                  effectiveAllowWrites
                    ? "safety.appliedWithSchemaUnavailable"
                    : "safety.appliedReadOnlyWithSchemaUnavailable",
                )
              : t("safety.noUnsavedChanges")}
        </span>
      </div>

      {connection.engine !== "bigquery" ? (
        <MonitoringAccess connectionId={connectionId} />
      ) : null}
    </div>
  );
}
