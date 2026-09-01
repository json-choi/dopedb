// Presents the General connection properties from narrow profile, driver, and
// workspace-dialog view models without owning runtime queries or mutations.
import { Icon } from "../../components/Icon";
import InfoTip from "../../components/InfoTip";
import { useEffect, useRef } from "react";
import { Button } from "../../design-system/components/Button";
import {
  CheckboxField,
  FieldValidationMessage,
  InlineSelect,
  PropertyRow,
  SelectInput,
  TextInput,
} from "../../design-system/components/FormControls";
import { StatusBadge } from "../../design-system/components/Status";
import type { ConnectionInputMode } from "../../features/connections/connectionEditorModel";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";
import { ConnectionBigQueryFields } from "./ConnectionBigQueryFields";
import { ManagedWorkspaceConnectionField } from "./ManagedWorkspaceConnectionField";

type Controller = ConnectionEditorController;

export function ConnectionGeneralTab({
  profile,
  sources,
  drivers,
  workspaceDialog,
  managedConnection,
  busy,
}: {
  profile: Controller["profile"];
  sources: Controller["catalog"]["sources"];
  drivers: Controller["catalog"]["drivers"];
  workspaceDialog: Controller["dialogs"]["workspace"];
  managedConnection: Controller["commands"]["managedConnection"];
  busy: boolean;
}) {
  const { t } = useI18n();
  const databaseInputRef = useRef<HTMLInputElement>(null);
  const {
    form,
    set,
    flags,
    credentials,
    url,
    options,
    databaseDiscovery,
    validation,
  } = profile;
  const {
    isSharedTemplate,
    isSqlite,
    isMongo,
    isBigQuery,
    canEditConnection,
    canDiscoverDatabases,
    srv,
    sqlSslModes,
  } = flags;

  useEffect(() => {
    if (databaseDiscovery.databases.length === 0) return;
    const input = databaseInputRef.current;
    input?.focus();
    try {
      input?.showPicker?.();
    } catch {
      // Some WebViews require a direct user gesture; focus still exposes the list.
    }
  }, [databaseDiscovery.databases]);

  return (
    <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[840px] tw:gap-4">
      <section className="tw:grid tw:gap-1.5">
        <div className="tw:flex tw:min-h-control-md tw:flex-wrap tw:items-center tw:gap-x-6 tw:gap-y-1 tw:text-sm tw:text-foreground">
          {profile.identity.isNew && !isSharedTemplate ? (
            <label className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1.5">
              <span>{t("connections.engine")}:</span>
              <InlineSelect
                value={form.engine}
                aria-label={t("connections.engine")}
                disabled={busy}
                onChange={(event) => {
                  const source = sources.available.find(
                    (candidate) => candidate.engine === event.target.value,
                  );
                  if (source) sources.selectAddSource(source);
                }}
              >
                {sources.available.map((source) => (
                  <option key={source.engine} value={source.engine}>
                    {source.label}
                  </option>
                ))}
              </InlineSelect>
            </label>
          ) : null}

          {!isSharedTemplate && !isBigQuery ? (
            <label className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1.5">
              <span>{t("connections.connectionType")}:</span>
              <InlineSelect
                value={url.mode}
                aria-label={t("connections.connectionType")}
                disabled={busy}
                onChange={(event) =>
                  url.selectMode(event.target.value as ConnectionInputMode)
                }
              >
                <option value="default">
                  {t("connections.connectionTypeDefault")}
                </option>
                <option value="urlOnly">
                  {t("connections.connectionTypeUrlOnly")}
                </option>
              </InlineSelect>
            </label>
          ) : null}

          <label className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1.5">
            <span>{t("connections.driver")}:</span>
            <InlineSelect
              id="connection-driver"
              title={t("connections.driverHint")}
              value={form.driverId ?? ""}
              aria-invalid={validation.driver?.tone === "danger" || undefined}
              onChange={(event) =>
                set("driverId", event.target.value || null)
              }
              disabled={
                !canEditConnection ||
                drivers.pending ||
                drivers.compatible.length === 0
              }
            >
              <option value="">{t("connections.driverAutomatic")}</option>
              {drivers.compatible.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} {driver.version}
                </option>
              ))}
            </InlineSelect>
          </label>

          {drivers.active?.installMode === "managed" &&
          drivers.active.installState === "available" ? (
            <Button
              size="compact"
              disabled={drivers.installingId !== null}
              onClick={() => void drivers.download(drivers.active!)}
            >
              <Icon name="download" />
              {drivers.installingId === drivers.active.id
                ? t("connections.driverDownloading")
                : t("connections.driverDownload")}
            </Button>
          ) : null}
        </div>
        {validation.driver ? (
          <FieldValidationMessage validation={validation.driver} />
        ) : null}
      </section>

      {!isSharedTemplate && !isBigQuery && url.mode === "urlOnly" ? (
        <section className="tw:grid tw:gap-2">
          <PropertyRow
            label={t("connections.connectionUrl")}
            htmlFor="connection-url"
            validation={validation.connectionUrl}
          >
            <TextInput
              id="connection-url"
              density="compact"
              value={url.draft}
              aria-invalid={
                validation.connectionUrl?.tone === "danger" || undefined
              }
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => url.edit(event.target.value)}
              onBlur={(event) => url.normalize(event.target.value)}
            />
          </PropertyRow>
          <p className="tw:m-0 tw:pl-[112px] tw:text-xs tw:text-muted-foreground tw:@max-[560px]:pl-0">
            {t("connections.connectionUrlOverrides")}
          </p>
        </section>
      ) : isSqlite ? (
        <section className="tw:grid tw:gap-3">
          <PropertyRow
            label={t("connections.databaseFile")}
            htmlFor="connection-database"
            validation={validation.database}
          >
            <div className="tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2">
              <TextInput
                ref={databaseInputRef}
                id="connection-database"
                density="compact"
                value={form.database}
                list={
                  canDiscoverDatabases &&
                  databaseDiscovery.databases.length > 0
                    ? "connection-database-options"
                    : undefined
                }
                aria-invalid={
                  validation.database?.tone === "danger" || undefined
                }
                onChange={(event) => set("database", event.target.value)}
                placeholder="/path/to/app.db"
              />
              <Button
                size="compact"
                onClick={() => void options.pickDatabaseFile()}
              >
                {t("connections.browse")}
              </Button>
            </div>
          </PropertyRow>
        </section>
      ) : isBigQuery ? (
        <ConnectionBigQueryFields profile={profile} drivers={drivers} />
      ) : (
        <section className="tw:grid tw:gap-3">
          {managedConnection.active ? (
            <ManagedWorkspaceConnectionField
              recovery={managedConnection}
              busy={busy}
            />
          ) : (
            <PropertyRow
              label={t("connections.host")}
              htmlFor="connection-host"
            >
              <div className="tw:grid tw:grid-cols-[minmax(0,1fr)_auto_112px] tw:items-start tw:gap-3 tw:@max-[560px]:grid-cols-1 tw:@max-[560px]:gap-1.5">
                <div className="tw:grid tw:gap-1.5">
                  <TextInput
                    id="connection-host"
                    density="compact"
                    value={form.host}
                    disabled={!canEditConnection}
                    aria-invalid={
                      validation.host?.tone === "danger" || undefined
                    }
                    onChange={(event) => set("host", event.target.value)}
                  />
                  {validation.host ? (
                    <FieldValidationMessage validation={validation.host} />
                  ) : null}
                </div>
                <label
                  htmlFor="connection-port"
                  className="tw:inline-flex tw:min-h-control-md tw:items-center tw:text-sm tw:text-foreground tw:@max-[560px]:min-h-0"
                >
                  {t("connections.port")}
                </label>
                <div className="tw:grid tw:gap-1.5">
                  <TextInput
                    id="connection-port"
                    density="compact"
                    type="number"
                    value={profile.port.draft}
                    min={1}
                    max={65_535}
                    aria-invalid={
                      validation.port?.tone === "danger" || undefined
                    }
                    disabled={!canEditConnection || (isMongo && srv)}
                    onChange={(event) => profile.port.setDraft(event.target.value)}
                  />
                  {validation.port ? (
                    <FieldValidationMessage validation={validation.port} />
                  ) : null}
                </div>
              </div>
            </PropertyRow>
          )}

          {isMongo && !isSharedTemplate ? (
            <PropertyRow label={t("connections.srv")}>
              <CheckboxField
                label={t("connections.srv")}
                checked={srv}
                onChange={(event) => options.setSrv(event.target.checked)}
              />
            </PropertyRow>
          ) : null}

          {isSharedTemplate ? (
            <>
              <PropertyRow label={t("connections.sslMode")}>
                <SelectInput
                  density="compact"
                  value={form.sslmode}
                  disabled={!canEditConnection}
                  onChange={(event) => set("sslmode", event.target.value)}
                >
                  {(isMongo ? ["disable", "require"] : sqlSslModes).map(
                    (mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ),
                  )}
                </SelectInput>
              </PropertyRow>
              <PropertyRow label={t("connections.environment")}>
                <SelectInput
                  density="compact"
                  value={form.env ?? ""}
                  disabled={!canEditConnection}
                  onChange={(event) =>
                    set("env", event.target.value || null)
                  }
                >
                  <option value="">{t("common.none")}</option>
                  <option value="dev">dev</option>
                  <option value="staging">staging</option>
                  <option value="prod">prod</option>
                </SelectInput>
              </PropertyRow>
              {!isMongo ? (
                <PropertyRow label={t("connections.schemaGroup")}>
                  <TextInput
                    density="compact"
                    value={form.schemaGroup ?? ""}
                    disabled={!canEditConnection}
                    onChange={(event) =>
                      set("schemaGroup", event.target.value.trim() || null)
                    }
                    placeholder={t("connections.schemaGroupPlaceholder")}
                  />
                </PropertyRow>
              ) : null}
              <PropertyRow label={t("workspace.bindCredentialsShort")}>
                <div className="tw:flex tw:min-h-control-md tw:flex-wrap tw:items-center tw:gap-2">
                  <StatusBadge
                    tone={
                      form.credentialMode === "managed" || form.secretRef
                        ? "success"
                        : "warning"
                    }
                  >
                    {form.credentialMode === "managed" || form.secretRef
                      ? t("providerCredentials.ready")
                      : t("providerCredentials.credentialsRequired")}
                  </StatusBadge>
                  {form.credentialMode === "memberLocal" &&
                  form.workspaceAccess !== "view" ? (
                    <Button
                      size="compact"
                      onClick={() => workspaceDialog.setMode("credentials")}
                    >
                      {t("workspace.bindCredentialsShort")}
                    </Button>
                  ) : null}
                </div>
              </PropertyRow>
              <p className="tw:m-0 tw:border-t tw:border-border-subtle tw:pt-3 tw:text-sm tw:leading-body tw:text-muted-foreground">
                {managedConnection.active
                  ? t("connections.managedWorkspace.securityNote")
                  : t("workspace.copySecurityNote")}
              </p>
            </>
          ) : (
            <>
              <PropertyRow label={t("connections.user")}>
                <TextInput
                  id="connection-username"
                  density="compact"
                  aria-label={t("connections.user")}
                  value={form.username}
                  onChange={(event) => set("username", event.target.value)}
                />
              </PropertyRow>

              <PropertyRow label={t("connections.password")}>
                <TextInput
                  id="connection-password"
                  density="compact"
                  type="password"
                  aria-label={t("connections.password")}
                  value={credentials.password}
                  onChange={(event) =>
                    credentials.setPassword(event.target.value)
                  }
                  placeholder={
                    form.secretRef
                      ? `•••••• (${t("connections.passwordStoredExisting")})`
                      : t("connections.passwordStored")
                  }
                />
              </PropertyRow>
            </>
          )}

          <PropertyRow
            label={t("connections.database")}
            htmlFor="connection-database"
            validation={validation.database}
            hint={
              isMongo ? (
                <InfoTip label={t("connections.databaseRequiredHint")} />
              ) : null
            }
          >
            <div className="tw:grid tw:gap-1.5">
              <TextInput
                ref={databaseInputRef}
                id="connection-database"
                density="compact"
                value={form.database}
                list={
                  canDiscoverDatabases &&
                  databaseDiscovery.databases.length > 0
                    ? "connection-database-options"
                    : undefined
                }
                disabled={!canEditConnection}
                required={isMongo}
                aria-invalid={
                  validation.database?.tone === "danger" || undefined
                }
                onChange={(event) => set("database", event.target.value)}
                onFocus={() => void databaseDiscovery.discover()}
              />
              {canDiscoverDatabases &&
              databaseDiscovery.databases.length > 0 ? (
                <datalist id="connection-database-options">
                  {databaseDiscovery.databases.map((database) => (
                    <option key={database} value={database}>
                      {database}
                    </option>
                  ))}
                </datalist>
              ) : null}
            </div>
          </PropertyRow>
        </section>
      )}
    </div>
  );
}
