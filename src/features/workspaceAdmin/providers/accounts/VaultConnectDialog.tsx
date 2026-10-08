// Connects an approved Vault Database Secrets broker with an AppRole. The Role ID
// and Secret ID live only in this dialog's state, are sent once to the workspace
// service (which verifies them and stores them sealed server-side), and are
// cleared on success or cancel. Desktop later receives only short-lived database
// credentials for the exact TLS-verified target entered here.
import { useId, useState } from "react";

import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from "../../../../design-system/components/FormControls";
import { InlineNotice } from "../../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../../lib/i18n";
import { databaseEngineLabel } from "../../../connections/domain";
import type { WorkspaceAdminScope } from "../../domain";
import { runWorkspaceAdmin, WorkspaceAdminRequestError } from "../../requests";
import {
  emptyVault,
  vaultConfigurationRequest,
  type VaultConfiguration,
} from "../domain";
import {
  vaultEngineChange,
  vaultFormIssues,
  type VaultFieldIssue,
} from "./accountModel";
import ExternalGuideButton from "./ExternalGuideButton";
import ProviderConnectDialogFrame from "./ProviderConnectDialogFrame";
import { providerErrorMessage } from "./providerErrors";

const VAULT_DATABASE_SECRETS_GUIDE = "https://developer.hashicorp.com/vault/docs/secrets/databases";

type VaultTextFieldName = Exclude<keyof VaultConfiguration, "engine" | "sslmode" | "production">;

type VaultTextFieldSpec = {
  name: VaultTextFieldName;
  label: I18nKey;
  placeholder?: I18nKey;
  secret?: boolean;
  monospace?: boolean;
  invalid?: I18nKey;
};

const BROKER_FIELDS: readonly VaultTextFieldSpec[] = [
  { name: "namespace", label: "workspaceProviders.vaultNamespace", placeholder: "workspaceProviders.optional" },
  { name: "authMount", label: "workspaceProviders.vaultAuthMount", monospace: true },
  { name: "databaseMount", label: "workspaceProviders.vaultDatabaseMount", monospace: true },
  {
    name: "databaseConnection",
    label: "workspaceProviders.vaultDatabaseConnection",
    placeholder: "workspaceProviders.vaultDatabaseConnectionPlaceholder",
    monospace: true,
  },
  { name: "roleId", label: "workspaceProviders.vaultRoleId", secret: true },
  { name: "secretId", label: "workspaceProviders.vaultSecretId", secret: true },
  {
    name: "readRole",
    label: "workspaceProviders.vaultReadRole",
    placeholder: "workspaceProviders.vaultReadRolePlaceholder",
    monospace: true,
  },
  {
    name: "writeRole",
    label: "workspaceProviders.vaultWriteRole",
    placeholder: "workspaceProviders.optional",
    monospace: true,
  },
];

const TARGET_FIELDS: readonly VaultTextFieldSpec[] = [
  {
    name: "host",
    label: "workspaceProviders.vaultHost",
    placeholder: "workspaceProviders.vaultHostPlaceholder",
    monospace: true,
  },
  {
    name: "port",
    label: "workspaceProviders.vaultPort",
    monospace: true,
    invalid: "workspaceProviders.vaultPortInvalid",
  },
  { name: "database", label: "workspaceProviders.vaultDatabase", monospace: true },
];

export default function VaultConnectDialog({
  scope,
  mode,
  onCancel,
  onConnected,
}: {
  scope: WorkspaceAdminScope;
  mode: "connect" | "reconnect";
  onCancel: () => void;
  onConnected: () => void;
}) {
  const { lang, t } = useI18n();
  const titleId = useId();
  const [form, setForm] = useState<VaultConfiguration>(emptyVault);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = vaultFormIssues(form);
  const showIssues = attempted && !submitting;

  function issueMessage(issue: VaultFieldIssue | undefined, invalid: I18nKey) {
    if (!showIssues || !issue) return undefined;
    return {
      tone: "danger" as const,
      message: t(issue === "required" ? "workspaceProviders.fieldRequired" : invalid),
    };
  }

  function update(name: VaultTextFieldName, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit() {
    setAttempted(true);
    if (Object.keys(issues).length > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await runWorkspaceAdmin(scope.accountId, {
        kind: "connectVault",
        workspaceId: scope.workspaceId,
        configuration: vaultConfigurationRequest(form),
      });
      setForm(emptyVault);
      onConnected();
    } catch (cause) {
      setError(cause instanceof WorkspaceAdminRequestError && cause.status === 429
        ? t("workspaceProviders.serverVaultRateLimited")
        : providerErrorMessage(cause, { lang, t }, "workspaceProviders.vaultConnectFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function cancel() {
    if (submitting) return;
    setForm(emptyVault);
    onCancel();
  }

  function textField(spec: VaultTextFieldSpec) {
    return (
      <Field
        key={spec.name}
        label={t(spec.label)}
        validation={issueMessage(issues[spec.name], spec.invalid ?? "workspaceProviders.fieldInvalid")}
      >
        {(binding) => (
          <TextInput
            {...binding.controlProps()}
            type={spec.secret ? "password" : "text"}
            inputMode={spec.name === "port" ? "numeric" : undefined}
            autoComplete="off"
            spellCheck={false}
            monospace={spec.monospace}
            disabled={submitting}
            placeholder={spec.placeholder ? t(spec.placeholder) : undefined}
            value={form[spec.name]}
            onChange={(event) => update(spec.name, event.target.value)}
          />
        )}
      </Field>
    );
  }

  return (
    <ProviderConnectDialogFrame
      titleId={titleId}
      title={t(mode === "reconnect"
        ? "workspaceProviders.vaultReconnectTitle"
        : "workspaceProviders.vaultTitle")}
      submitLabel={t("workspaceProviders.verifyConnect")}
      submitting={submitting}
      onCancel={cancel}
      onSubmit={() => void submit()}
    >
      <div className="tw:grid tw:gap-2">
        <p className="tw:m-0 tw:text-ui tw:leading-body tw:text-foreground">
          {t("workspaceProviders.vaultIntro")}
        </p>
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("workspaceProviders.vaultSecretStorage")}
        </p>
        <div>
          <ExternalGuideButton href={VAULT_DATABASE_SECRETS_GUIDE}>
            {t("workspaceProviders.vaultGuideOpen")}
          </ExternalGuideButton>
        </div>
      </div>
      <InlineNotice tone="warning" icon="alert">
        {t("workspaceProviders.vaultCaution")}
      </InlineNotice>
      <section className="tw:grid tw:min-w-0 tw:gap-3" aria-labelledby={`${titleId}-broker`}>
        <h3 id={`${titleId}-broker`}>{t("workspaceProviders.vaultBrokerTitle")}</h3>
        <Field
          label={t("workspaceProviders.vaultAddress")}
          validation={issueMessage(issues.address, "workspaceProviders.vaultAddressInvalid")}
        >
          {(binding) => (
            <TextInput
              {...binding.controlProps()}
              type="url"
              autoComplete="off"
              spellCheck={false}
              monospace
              data-modal-initial-focus
              disabled={submitting}
              placeholder={t("workspaceProviders.vaultAddressPlaceholder")}
              value={form.address}
              onChange={(event) => update("address", event.target.value)}
            />
          )}
        </Field>
        <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[520px]:grid-cols-1">
          {BROKER_FIELDS.map(textField)}
        </div>
      </section>
      <section
        className="tw:grid tw:min-w-0 tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-4"
        aria-labelledby={`${titleId}-target`}
      >
        <div className="tw:grid tw:gap-1">
          <h3 id={`${titleId}-target`}>{t("workspaceProviders.vaultTargetTitle")}</h3>
          <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
            {t("workspaceProviders.vaultTargetDescription")}
          </p>
        </div>
        <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[520px]:grid-cols-1">
          <Field label={t("workspaceProviders.vaultEngine")}>
            {(binding) => (
              <SelectInput
                {...binding.controlProps()}
                disabled={submitting}
                value={form.engine}
                onChange={(event) => setForm((current) => vaultEngineChange(
                  current,
                  event.target.value === "mysql" ? "mysql" : "postgres",
                ))}
              >
                <option value="postgres">{databaseEngineLabel("postgres")}</option>
                <option value="mysql">{databaseEngineLabel("mysql")}</option>
              </SelectInput>
            )}
          </Field>
          {TARGET_FIELDS.map(textField)}
        </div>
        <div className="tw:grid tw:gap-1">
          <CheckboxField
            label={t("workspaceProviders.vaultProduction")}
            checked={form.production}
            disabled={submitting}
            onChange={(event) => {
              const production = event.target.checked;
              setForm((current) => ({ ...current, production }));
            }}
          />
          <p className="tw:m-0 tw:pl-6 tw:text-xs tw:leading-body tw:text-muted-foreground">
            {t("workspaceProviders.vaultProductionDescription")}
          </p>
        </div>
      </section>
      {error ? (
        <p className="tw:m-0 tw:text-ui tw:leading-body tw:text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </ProviderConnectDialogFrame>
  );
}
