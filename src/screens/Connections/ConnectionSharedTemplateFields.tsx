// Presents the shared-template rows of the General tab: transport security the
// template or the provider owns, environment and schema group labels, and this
// member's credential state with its binding command. Values a member binding or
// a provider integration owns are shown read-only rather than edited here.
import { Button } from "../../design-system/components/Button";
import {
  PropertyRow,
  SelectInput,
  TextInput,
} from "../../design-system/components/FormControls";
import { StatusBadge } from "../../design-system/components/Status";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

type Controller = ConnectionEditorController;

export function ConnectionSharedTemplateFields({
  profile,
  workspaceDialog,
  managedActive,
}: {
  profile: Controller["profile"];
  workspaceDialog: Controller["dialogs"]["workspace"];
  /** A provider integration owns this connection's endpoint and TLS. */
  managedActive: boolean;
}) {
  const { t } = useI18n();
  const { form, set, flags } = profile;
  const { isMongo, canEditConnection, sqlSslModes } = flags;

  return (
    <>
      {isMongo ? (
        // MongoDB TLS lives in each member's binding, so the template
        // has no TLS control; show this device's effective state.
        <PropertyRow
          label={t("connections.tls")}
          htmlFor="connection-shared-tls"
        >
          <div className="tw:grid tw:gap-1.5">
            <TextInput
              id="connection-shared-tls"
              density="compact"
              readOnly
              value={
                flags.mongoTlsEnabled
                  ? t("connections.tlsEnabledOnDevice")
                  : t("connections.tlsDisabledOnDevice")
              }
              aria-describedby="connection-shared-tls-description"
            />
            <p
              id="connection-shared-tls-description"
              className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground"
            >
              {t("connections.tlsMemberOwned")}
            </p>
          </div>
        </PropertyRow>
      ) : managedActive ? (
        // The provider integration owns a managed endpoint and its TLS.
        <PropertyRow
          label={t("connections.sslMode")}
          htmlFor="connection-managed-sslmode"
        >
          <TextInput
            id="connection-managed-sslmode"
            density="compact"
            readOnly
            value={form.sslmode}
            aria-describedby="connection-managed-endpoint-note"
          />
        </PropertyRow>
      ) : (
        <PropertyRow
          label={t("connections.sslMode")}
          htmlFor="connection-template-sslmode"
        >
          <SelectInput
            id="connection-template-sslmode"
            density="compact"
            value={form.sslmode}
            disabled={!canEditConnection}
            onChange={(event) => set("sslmode", event.target.value)}
          >
            {sqlSslModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </SelectInput>
        </PropertyRow>
      )}
      <PropertyRow
        label={t("connections.environment")}
        htmlFor="connection-template-env"
      >
        <SelectInput
          id="connection-template-env"
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
        <PropertyRow
          label={t("connections.schemaGroup")}
          htmlFor="connection-template-schema-group"
        >
          <TextInput
            id="connection-template-schema-group"
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
          {/* Only a passed check is success; a saved or managed credential is unverified. */}
          <StatusBadge
            tone={
              profile.verified
                ? "success"
                : form.credentialMode === "managed" || form.secretRef
                  ? "neutral"
                  : "warning"
            }
          >
            {profile.verified
              ? t("connections.credentialVerified")
              : form.credentialMode === "managed"
                ? t("connections.managedWorkspace.status")
                : form.secretRef
                  ? t("connections.credentialSavedOnDevice")
                  : t("providerCredentials.credentialsRequired")}
          </StatusBadge>
          {form.credentialMode === "memberLocal" &&
          form.workspaceAccess !== "view" ? (
            <Button
              size="compact"
              onClick={(event) => {
                workspaceDialog.buttonRef.current = event.currentTarget;
                workspaceDialog.setMode("credentials");
              }}
            >
              {t("workspace.bindCredentialsShort")}
            </Button>
          ) : null}
        </div>
      </PropertyRow>
      <p
        id="connection-managed-endpoint-note"
        className="tw:m-0 tw:border-t tw:border-border-subtle tw:pt-3 tw:text-sm tw:leading-body tw:text-muted-foreground"
      >
        {managedActive
          ? t("connections.managedWorkspace.securityNote")
          : t("workspace.copySecurityNote")}
      </p>
    </>
  );
}
