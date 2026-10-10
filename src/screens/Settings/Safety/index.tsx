// Per-connection SafetySettings editor. Loads via get_safety, saves via set_safety.
// One Apply persists the cumulative read → DML → DDL gates and limits. A manager's
// Apply changes the team write ceiling only when Data changes was toggled in that
// edit. Unapplied edits survive navigation and failed saves, limits validate on
// blur and Apply, and every hint is an accessible description of its control.
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SafetySettings } from "../../../ipc/types";
import { errDetails } from "../../../ipc/types";
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
import {
  rememberSafetyDraft,
  restoreSafetyDraft,
} from "../../../features/safetySettings/draftStore";

const TOGGLES: { key: "autoRunReads" | "explainPreview"; label: I18nKey; hint: I18nKey }[] = [
  { key: "autoRunReads", label: "safety.autoRunReads", hint: "safety.autoRunReadsHint" },
  { key: "explainPreview", label: "safety.explainPreview", hint: "safety.explainPreviewHint" },
];

type LimitKey = "maxRows" | "execPreviewRowLimit";

const NUMBERS: {
  key: LimitKey;
  label: I18nKey;
  hint: I18nKey;
  invalid: I18nKey;
  min: number;
  max: number;
}[] = [
  { key: "maxRows", label: "safety.maxRows", hint: "safety.maxRowsHint", invalid: "safety.maxRowsInvalid", min: 1, max: 100_000 },
  { key: "execPreviewRowLimit", label: "safety.execPreviewRowLimit", hint: "safety.execPreviewRowLimitHint", invalid: "safety.execPreviewRowLimitInvalid", min: 0, max: 1_000_000 },
];

/** A whole number inside the backend-enforced bounds, or `null`. */
function parseLimit(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function limitText(settings: SafetySettings): Record<LimitKey, string> {
  return {
    maxRows: String(settings.maxRows),
    execPreviewRowLimit: String(settings.execPreviewRowLimit),
  };
}

/** Translate a Safety save failure; backend text is never shown. */
function saveErrorKey(kind: string | null, message: string): I18nKey {
  if (kind === "network" || kind === "timeout") return "safety.saveFailedNetwork";
  if (kind === "blocked" && /changed before|authority changed/i.test(message)) {
    return "safety.saveFailedChanged";
  }
  if (kind === "blocked" || kind === "safety") return "safety.saveFailedDenied";
  return "safety.saveFailed";
}

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
  numbers: Readonly<Record<LimitKey, string>>;
  /** Limits the user left with an invalid value (shown after blur or Apply). */
  invalid: ReadonlySet<LimitKey>;
  /** The edit was kept from an earlier visit to this screen. */
  restored: boolean;
}>;

function freshDraft(connectionId: string, settings: SafetySettings): SafetyDraft {
  return {
    connectionId,
    settings,
    numbers: limitText(settings),
    invalid: new Set(),
    restored: false,
  };
}

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
  const descriptionId = useId();
  const limitInputs = useRef<Partial<Record<LimitKey, HTMLInputElement | null>>>({});
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

  // Reconcile the draft with the persisted value without discarding edits: an
  // unapplied edit of this connection survives refetches, and one left behind on
  // an earlier visit is restored and labeled instead of silently dropped.
  useEffect(() => {
    if (!safetyQuery.data) {
      setDraft(null);
      return;
    }
    const persisted = effectiveSafetySettings(connection, safetyQuery.data);
    setDraft((current) => {
      if (current?.connectionId === connectionId) {
        const edited = !sameSafetySettings(current.settings, persisted)
          || NUMBERS.some(({ key }) => current.numbers[key].trim() !== String(persisted[key]));
        return edited ? current : freshDraft(connectionId, persisted);
      }
      const remembered = restoreSafetyDraft(connectionId);
      if (remembered && !sameSafetySettings(remembered.settings, persisted)) {
        return {
          connectionId,
          settings: remembered.settings,
          numbers: remembered.numbers,
          invalid: new Set(),
          restored: true,
        };
      }
      return freshDraft(connectionId, persisted);
    });
  }, [connection, connectionId, safetyQuery.data]);

  // Keep only an unapplied edit so leaving this screen never loses it.
  useEffect(() => {
    if (!draft || !safetyQuery.data || draft.connectionId !== connectionId) return;
    const persisted = effectiveSafetySettings(connection, safetyQuery.data);
    const edited = !sameSafetySettings(draft.settings, persisted)
      || NUMBERS.some(({ key }) => draft.numbers[key].trim() !== String(persisted[key]));
    rememberSafetyDraft(
      connectionId,
      edited ? { settings: draft.settings, numbers: draft.numbers } : null,
    );
  }, [connection, connectionId, draft, safetyQuery.data]);

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
          {t("safety.loadFailed")}
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
  const numbers = draft?.numbers ?? limitText(settings);
  const invalidLimits = draft?.invalid ?? new Set<LimitKey>();
  const hasUnsavedChanges = persistedSettings !== null
    && (!sameSafetySettings(settings, persistedSettings)
      || NUMBERS.some(({ key }) => numbers[key].trim() !== String(persistedSettings[key])));
  // Only these gates end Agent and Shell sessions when applied (`set_safety`).
  const permissionsChanged = persistedSettings !== null
    && (settings.allowWrites !== persistedSettings.allowWrites
      || settings.allowSchemaChanges !== persistedSettings.allowSchemaChanges);

  function clearSaveError() {
    setSaveError((current) => (
      current?.connectionId === connectionId ? null : current
    ));
  }

  function set<K extends keyof SafetySettings>(key: K, value: SafetySettings[K]) {
    clearSaveError();
    setDraft((current) => (
      current?.connectionId === connectionId
        ? { ...current, settings: { ...current.settings, [key]: value } }
        : current
    ));
  }

  /** Keep the raw text while typing; a valid value updates the draft at once. */
  function editLimit(key: LimitKey, raw: string) {
    clearSaveError();
    const spec = NUMBERS.find((item) => item.key === key)!;
    const value = parseLimit(raw, spec.min, spec.max);
    setDraft((current) => {
      if (current?.connectionId !== connectionId) return current;
      const invalid = new Set(current.invalid);
      if (value !== null) invalid.delete(key);
      return {
        ...current,
        numbers: { ...current.numbers, [key]: raw },
        invalid,
        settings: value === null ? current.settings : { ...current.settings, [key]: value },
      };
    });
  }

  /** Validate on blur: normalize a valid value, flag an invalid one. */
  function validateLimit(key: LimitKey) {
    const spec = NUMBERS.find((item) => item.key === key)!;
    setDraft((current) => {
      if (current?.connectionId !== connectionId) return current;
      const value = parseLimit(current.numbers[key], spec.min, spec.max);
      const invalid = new Set(current.invalid);
      if (value === null) invalid.add(key);
      else invalid.delete(key);
      return {
        ...current,
        invalid,
        numbers: value === null ? current.numbers : { ...current.numbers, [key]: String(value) },
      };
    });
  }

  function discard() {
    if (!persistedSettings) return;
    clearSaveError();
    rememberSafetyDraft(connectionId, null);
    setDraft(freshDraft(connectionId, persistedSettings));
  }

  async function save() {
    if (!settings || !hasUnsavedChanges) return;
    const invalid = NUMBERS.filter(({ key, min, max }) => parseLimit(numbers[key], min, max) === null);
    if (invalid.length > 0) {
      setDraft((current) => current?.connectionId === connectionId
        ? { ...current, invalid: new Set(invalid.map(({ key }) => key)) }
        : current);
      limitInputs.current[invalid[0].key]?.focus();
      return;
    }
    const requestToken = claimSafetySave(connectionId);
    if (!requestToken) return;
    const writesChanged = persistedSettings !== null
      && settings.allowWrites !== persistedSettings.allowWrites;
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
        { writesChanged },
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
      rememberSafetyDraft(connectionId, null);
      if (requestIsCurrent()) {
        setDraft(freshDraft(connectionId, persisted));
        toast(t("safety.saved"));
      }
    } catch (e) {
      const details = errDetails(e);
      let message = t(saveErrorKey(details.kind, details.message));
      if (e instanceof WorkspaceWritePolicyRollbackError) {
        onConnectionUpdated(e.connection);
        message = t("safety.workspacePolicyRollbackFailed");
      }
      // Refresh what was actually persisted (a partial save may have narrowed
      // the device gate) but keep the user's edit so Apply can be retried.
      try {
        const recovered = await queryClient.fetchQuery({
          ...safetySettingsQuery(connectionId),
          staleTime: 0,
        });
        queryClient.setQueryData(safetyQueryKeys.detail(connectionId), recovered);
      } catch {
        // The stale-error notice offers its own retry.
      }
      if (requestIsCurrent()) {
        setSaveError({ connectionId, kind: details.kind, message });
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
        clearSaveError();
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
          {t("safety.refreshFailed")}
        </InlineNotice>
      ) : null}
      {saveError?.connectionId === connectionId && saveError.kind === "managedConnectionRecoveryRequired" ? (
        <ManagedConnectionRecoveryNotice connection={connection} />
      ) : saveError?.connectionId === connectionId ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          {saveError.message}
        </InlineNotice>
      ) : null}
      {draft?.restored && hasUnsavedChanges ? (
        <InlineNotice
          tone="warning"
          icon="info"
          role="status"
          action={(
            <Button size="compact" disabled={busy} onClick={discard}>
              {t("safety.discardChanges")}
            </Button>
          )}
        >
          {t("safety.draftRestored")}
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
                checked={settings[item.key]}
                disabled={busy}
                onChange={(e) => set(item.key, e.target.checked)}
                label={<strong>{t(item.label)}</strong>}
                aria-describedby={`${descriptionId}-${item.key}`}
              />
              <InfoTip label={t(item.hint)} />
              <span id={`${descriptionId}-${item.key}`} className="tw:sr-only">
                {t(item.hint)}
              </span>
            </div>
          ))}
        </SettingsGroup>

        <SettingsGroup title={t("safety.limits")}>
          {NUMBERS.map((n) => {
            const invalid = invalidLimits.has(n.key);
            return (
              <div
                key={n.key}
                className="tw:grid tw:min-h-control-lg tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_120px_20px] tw:items-center tw:gap-x-2 tw:gap-y-1 tw:border-t tw:border-border-subtle tw:py-2 tw:first-of-type:border-t-0 tw:@max-[400px]:grid-cols-[minmax(0,1fr)_20px] tw:@max-[400px]:[&>label]:col-span-2"
              >
                <label
                  htmlFor={`${descriptionId}-${n.key}-input`}
                  className="tw:text-sm tw:text-muted-foreground"
                >
                  {t(n.label)}
                </label>
                <TextInput
                  id={`${descriptionId}-${n.key}-input`}
                  ref={(node) => {
                    limitInputs.current[n.key] = node;
                  }}
                  density="compact"
                  disabled={busy}
                  inputMode="numeric"
                  value={numbers[n.key]}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid
                    ? `${descriptionId}-${n.key}-error ${descriptionId}-${n.key}-hint`
                    : `${descriptionId}-${n.key}-hint`}
                  onChange={(e) => editLimit(n.key, e.target.value)}
                  onBlur={() => validateLimit(n.key)}
                />
                <InfoTip label={t(n.hint)} />
                <span id={`${descriptionId}-${n.key}-hint`} className="tw:sr-only">
                  {t(n.hint)}
                </span>
                {invalid ? (
                  <span
                    id={`${descriptionId}-${n.key}-error`}
                    role="alert"
                    className="tw:col-span-full tw:text-xs tw:text-danger"
                  >
                    {t(n.invalid)}
                  </span>
                ) : null}
              </div>
            );
          })}
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
          aria-describedby={permissionsChanged ? `${descriptionId}-sessions` : undefined}
        >
          {busy ? t("safety.applying") : t("safety.apply")}
        </Button>
        {hasUnsavedChanges && !draft?.restored ? (
          <Button size="compact" disabled={busy} onClick={discard}>
            {t("safety.discardChanges")}
          </Button>
        ) : null}
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
        {permissionsChanged ? (
          <span
            id={`${descriptionId}-sessions`}
            className="tw:basis-full tw:text-xs tw:leading-body tw:text-muted-foreground"
          >
            {t("safety.applyEndsSessions")}
          </span>
        ) : null}
      </div>

      {connection.engine !== "bigquery" ? (
        <MonitoringAccess
          connectionId={connectionId}
          writesEnabled={persistedSettings?.allowWrites === true}
        />
      ) : null}
    </div>
  );
}
