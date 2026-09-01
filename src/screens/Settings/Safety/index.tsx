// Per-connection SafetySettings editor. Loads via get_safety, saves via set_safety.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SafetySettings } from "../../../ipc/types";
import { errMessage } from "../../../ipc/types";
import InfoTip from "../../../components/InfoTip";
import { useToast } from "../../../components/Toast";
import { Button } from "../../../design-system/components/Button";
import { SegmentedControl } from "../../../design-system/components/SegmentedControl";
import {
  CheckboxField,
  TextInput,
} from "../../../design-system/components/FormControls";
import { SettingsGroup } from "../../../design-system/components/Settings";
import {
  InlineNotice,
  StatusBadge,
} from "../../../design-system/components/Status";
import {
  canManageWorkspaceWritePolicy,
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
import { setWorkspaceConnectionWritePolicy } from "../../../features/workspaces/tauriAdapter";
import MonitoringAccess from "./MonitoringAccess";
import { setSafetySettings } from "../../../features/safetySettings/tauriAdapter";
import {
  safetyQueryKeys,
  safetySettingsQuery,
} from "../../../features/safetySettings/queries";
import { queryResultPhase } from "../../../lib/queryResultPhase";

const TOGGLES: { key: keyof SafetySettings; label: I18nKey; hint: I18nKey }[] = [
  { key: "autoRunReads", label: "safety.autoRunReads", hint: "safety.autoRunReadsHint" },
  { key: "explainPreview", label: "safety.explainPreview", hint: "safety.explainPreviewHint" },
];

type DatabaseAccessLevel = "read" | "write" | "schema";

function databaseAccessLevel(settings: SafetySettings): DatabaseAccessLevel {
  if (settings.allowSchemaChanges) return "schema";
  if (settings.allowWrites) return "write";
  return "read";
}

const NUMBERS: { key: keyof SafetySettings; label: I18nKey; hint: I18nKey }[] = [
  { key: "maxRows", label: "safety.maxRows", hint: "safety.maxRowsHint" },
  { key: "execPreviewRowLimit", label: "safety.execPreviewRowLimit", hint: "safety.execPreviewRowLimitHint" },
];

function sameSafetySettings(left: SafetySettings, right: SafetySettings) {
  return left.requireApproval === right.requireApproval
    && left.allowWrites === right.allowWrites
    && left.allowSchemaChanges === right.allowSchemaChanges
    && left.wrapWritesInTx === right.wrapWritesInTx
    && left.explainPreview === right.explainPreview
    && left.autoRunReads === right.autoRunReads
    && left.maxRows === right.maxRows
    && left.execPreviewRowLimit === right.execPreviewRowLimit;
}

export default function Safety({
  connection,
  onConnectionUpdated,
  onSaved,
}: {
  connection: ConnectionProfile;
  onConnectionUpdated: (connection: ConnectionProfile) => void;
  onSaved: (connectionId: string, settings: SafetySettings) => void;
}) {
  const { t } = useI18n();
  const connectionId = connection.id;
  const workspaceManaged = connection.credentialMode !== "local";
  const workspacePolicyEditable = canManageWorkspaceWritePolicy(connection);
  const writeControlAvailable = safetyWriteControlAvailable(connection);
  const schemaControlAvailable = safetySchemaControlAvailable(connection);
  const memberLocalReadOnly = connection.credentialMode === "memberLocal";
  const [settings, setSettings] = useState<SafetySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  const safetyQuery = useQuery(safetySettingsQuery(connectionId));
  const safetyPhase = queryResultPhase(safetyQuery.data, safetyQuery.error);

  useEffect(() => {
    setSettings(
      safetyQuery.data
        ? effectiveSafetySettings(connection, safetyQuery.data)
        : null,
    );
  }, [connection, safetyQuery.data]);

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
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }

  async function save() {
    if (!settings || !hasUnsavedChanges) return;
    const requested = requestedSafetySettings(connection, settings);
    const localPolicyChange =
      connection.credentialMode === "local" &&
      connection.workspaceAccess === "local" &&
      connection.allowWrites !== requested.allowWrites;
    setBusy(true);
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
      setSettings(persisted);
      queryClient.setQueryData(safetyQueryKeys.detail(connectionId), persisted);
      onSaved(connectionId, persisted);
      toast(t("safety.saved"));
    } catch (e) {
      let message = errMessage(e);
      if (e instanceof WorkspaceWritePolicyRollbackError) {
        onConnectionUpdated(e.connection);
        message = t("safety.workspacePolicyRollbackFailed", {
          error: errMessage(e.rollbackError),
        });
      }
      try {
        setSettings(await queryClient.fetchQuery({
          ...safetySettingsQuery(connectionId),
          staleTime: 0,
        }));
      } catch {
        setSettings({
          ...requested,
          allowWrites: false,
          allowSchemaChanges: false,
        });
      }
      setSaveError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  const effectiveAllowWrites =
    settings.allowWrites && writeControlAvailable;
  const effectiveAllowSchemaChanges =
    settings.allowSchemaChanges && effectiveAllowWrites && schemaControlAvailable;
  const accessLevel = databaseAccessLevel({
    ...settings,
    allowWrites: effectiveAllowWrites,
    allowSchemaChanges: effectiveAllowSchemaChanges,
  });

  const schemaUnavailableHint: I18nKey | null = schemaControlAvailable
    ? null
    : memberLocalReadOnly
      ? "safety.memberLocalSchemaUnavailable"
      : connection.credentialMode === "managed" && connection.workspaceAccess !== "manage"
        ? "safety.schemaRequiresManage"
        : connection.credentialMode === "managed"
          ? "safety.schemaProviderUnavailable"
          : "safety.mutationsEngineUnavailable";

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
      {saveError ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          {saveError}
        </InlineNotice>
      ) : null}
      <div className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:max-[860px]:flex-col tw:max-[860px]:items-start">
        <div className="tw:inline-flex tw:items-center tw:gap-2 tw:max-[640px]:flex-col tw:max-[640px]:items-start">
          <h2>{t("safety.title")}</h2>
          <InfoTip label={t("safety.body")} />
        </div>
        <StatusBadge
          tone={effectiveAllowSchemaChanges ? "danger" : effectiveAllowWrites ? "warning" : "success"}
        >
          {effectiveAllowSchemaChanges
            ? t("safety.modeSchemaChanges")
            : workspaceManaged
              ? effectiveAllowWrites
                ? t("safety.modeWorkspaceWrites")
                : t("safety.modeSharedReadOnly")
              : effectiveAllowWrites
                ? t("safety.modeWrites")
                : t("safety.modeReadOnly")}
        </StatusBadge>
      </div>

      <div className="tw:grid tw:grid-cols-[minmax(0,1.2fr)_minmax(264px,0.8fr)] tw:gap-4 tw:max-[1180px]:grid-cols-2 tw:max-[860px]:grid-cols-1">
        <SettingsGroup title={t("safety.guardrails")}>
          <div className="tw:grid tw:gap-2 tw:pb-3">
            <div className="tw:flex tw:items-center tw:gap-2">
              <strong className="tw:text-sm">{t("safety.accessLevel")}</strong>
              <InfoTip label={t("safety.accessLevelHint")} />
            </div>
            <SegmentedControl
              value={accessLevel}
              label={t("safety.accessLevel")}
              disabled={busy}
              options={[
                { value: "read", label: t("safety.accessRead") },
                {
                  value: "write",
                  label: t("safety.accessWrite"),
                  disabled: !writeControlAvailable,
                },
                {
                  value: "schema",
                  label: t("safety.accessSchema"),
                  disabled: !schemaControlAvailable,
                },
              ]}
              onChange={(level) => {
                setSettings((current) => current ? {
                  ...current,
                  allowWrites: level !== "read",
                  allowSchemaChanges: level === "schema",
                } : current);
              }}
            />
            <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
              {t(
                memberLocalReadOnly
                  ? "safety.memberLocalReadOnlyHint"
                  : workspacePolicyEditable
                    ? "safety.sharedWritesManagerHint"
                    : workspaceManaged
                      ? "safety.sharedWritesHint"
                      : "safety.accessLevelHint",
              )}
            </p>
            {schemaUnavailableHint ? (
              <InlineNotice tone="warning" icon="info" role="status">
                {t(schemaUnavailableHint)}
              </InlineNotice>
            ) : null}
          </div>
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
              className="tw:grid tw:min-h-control-lg tw:grid-cols-[minmax(0,1fr)_120px_20px] tw:items-center tw:gap-2 tw:border-t tw:border-border-subtle tw:py-2 tw:first-of-type:border-t-0 tw:max-[640px]:grid-cols-1"
            >
              <span className="tw:text-sm tw:text-muted-foreground">
                {t(n.label)}
              </span>
              <TextInput
                density="compact"
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

      <div className="tw:flex tw:items-center tw:gap-3 tw:max-[640px]:flex-col tw:max-[640px]:items-stretch tw:max-[640px]:[&>button]:w-full">
        <Button
          variant="primary"
          disabled={busy || !hasUnsavedChanges}
          onClick={save}
        >
          {busy ? t("safety.applying") : t("safety.apply")}
        </Button>
        <span
          aria-live="polite"
          className="tw:text-xs tw:leading-body tw:text-muted-foreground tw:data-[pending=true]:font-semibold tw:data-[pending=true]:text-warning"
          data-pending={hasUnsavedChanges}
        >
          {hasUnsavedChanges
            ? t("safety.unsavedChanges")
            : schemaUnavailableHint
              ? t("safety.appliedWithSchemaUnavailable")
              : t("safety.noUnsavedChanges")}
        </span>
      </div>

      {connection.engine !== "bigquery" ? (
        <MonitoringAccess connectionId={connectionId} />
      ) : null}
    </div>
  );
}
