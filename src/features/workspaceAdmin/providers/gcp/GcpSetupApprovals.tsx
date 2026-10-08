// Approvals for the selected Cloud SQL instance. Only the changes that instance
// needs are shown (environment label, schema delegation, temporary setup roles,
// production and IAM authentication approvals); service accounts, IAM policies
// and database users are generated and verified server-side, never typed here.
import type { ReactNode } from "react";

import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from "../../../../design-system/components/FormControls";
import { InlineNotice, LoadingLabel } from "../../../../design-system/components/Status";
import { useI18n, type I18nKey, type Lang } from "../../../../lib/i18n";
import { databaseEngineLabel } from "../../../connections/domain";
import ExternalGuideButton from "../accounts/ExternalGuideButton";
import type { GcpSetupPermissionRequirement } from "../domain";
import { gcpSchemaRequested } from "./gcpModel";
import type { GcpSetupWizardController } from "./useGcpSetupWizard";

const PERMISSION_PURPOSES: Readonly<Record<string, I18nKey>> = {
  "roles/serviceusage.serviceUsageAdmin": "workspaceProviders.gcpPurposeServiceUsage",
  "roles/iam.workloadIdentityPoolAdmin": "workspaceProviders.gcpPurposeWorkloadIdentity",
  "roles/iam.serviceAccountAdmin": "workspaceProviders.gcpPurposeServiceAccount",
  "roles/resourcemanager.projectIamAdmin": "workspaceProviders.gcpPurposeProjectIam",
  "roles/cloudsql.admin": "workspaceProviders.gcpPurposeCloudSql",
};

const HANGUL = /[가-힣]/;

function ApprovalBlock({
  tone,
  children,
}: {
  tone: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      data-tone={tone}
      className="tw:grid tw:min-w-0 tw:gap-2 tw:border-l-2 tw:border-border-strong tw:pl-3 tw:data-[tone=danger]:border-danger tw:data-[tone=success]:border-success tw:data-[tone=warning]:border-warning"
    >
      {children}
    </div>
  );
}

function BlockTitle({ children }: { children: ReactNode }) {
  return <strong className="tw:text-xs tw:font-semibold tw:text-foreground">{children}</strong>;
}

function BlockText({ indent = false, children }: { indent?: boolean; children: ReactNode }) {
  return (
    <span
      data-indent={indent || undefined}
      className="tw:text-xs tw:leading-body tw:text-muted-foreground tw:data-[indent=true]:pl-6"
    >
      {children}
    </span>
  );
}

function requirementPurpose(
  requirement: GcpSetupPermissionRequirement,
  lang: Lang,
  t: (key: I18nKey) => string,
): string | null {
  const key = PERMISSION_PURPOSES[requirement.role];
  if (key) return t(key);
  return HANGUL.test(requirement.purpose) === (lang === "ko") ? requirement.purpose : null;
}

export default function GcpSetupApprovals({ wizard }: { wizard: GcpSetupWizardController }) {
  const { lang, t } = useI18n();
  const instance = wizard.instance;
  if (!instance) return null;
  const disabled = wizard.busy || wizard.sessionExpired;
  const permissions = wizard.permissions.data ?? null;
  const schema = {
    database: wizard.schemaDatabase,
    owner: wizard.schemaOwner,
    approved: wizard.schemaApproved,
  };
  const schemaIncomplete = gcpSchemaRequested(schema)
    && !(schema.approved && schema.database.trim() && schema.owner.trim());
  const classification = instance.production === true
    ? t("workspaceProviders.gcpProduction")
    : instance.production === false
      ? t("workspaceProviders.gcpNonProduction")
      : wizard.environment === "production"
        ? t("workspaceProviders.gcpPendingProduction")
        : wizard.environment === "development"
          ? t("workspaceProviders.gcpPendingDevelopment")
          : t("workspaceProviders.gcpClassificationRequired");
  const meta = [
    databaseEngineLabel(instance.engine),
    instance.region,
    t(instance.ready ? "workspaceProviders.gcpRunning" : "workspaceProviders.gcpUnavailable"),
    classification,
  ].filter(Boolean);

  return (
    <div className="tw:grid tw:min-w-0 tw:gap-4 tw:border-t tw:border-border-subtle tw:pt-3">
      <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">{meta.join(" · ")}</p>
      {!instance.ready ? (
        <InlineNotice tone="warning" icon="alert" role="status">
          {t("workspaceProviders.gcpNotReady")}
        </InlineNotice>
      ) : null}
      <div className="tw:grid tw:grid-cols-2 tw:items-start tw:gap-x-6 tw:gap-y-4 tw:@max-[640px]:grid-cols-1">
        <div className="tw:grid tw:min-w-0 tw:gap-4">
          {instance.production === "unknown" ? (
            <ApprovalBlock tone="warning">
              <BlockTitle>{t("workspaceProviders.gcpClassificationTitle")}</BlockTitle>
              <BlockText>{t("workspaceProviders.gcpClassificationDescription")}</BlockText>
              <Field label={t("workspaceProviders.gcpEnvironment")}>
                {(binding) => (
                  <SelectInput
                    {...binding.controlProps()}
                    density="compact"
                    disabled={disabled}
                    value={wizard.environment}
                    onChange={(event) => {
                      const value = event.target.value;
                      wizard.setEnvironment(
                        value === "production" || value === "development" ? value : "",
                      );
                    }}
                  >
                    <option value="">{t("workspaceProviders.gcpChooseEnvironment")}</option>
                    <option value="production">
                      {t("workspaceProviders.gcpEnvironmentProduction")}
                    </option>
                    <option value="development">
                      {t("workspaceProviders.gcpEnvironmentDevelopment")}
                    </option>
                  </SelectInput>
                )}
              </Field>
            </ApprovalBlock>
          ) : null}
          {instance.engine === "postgres" ? (
            <details className="tw:min-w-0">
              <summary className="tw:cursor-pointer tw:text-xs tw:font-semibold tw:text-foreground">
                {t("workspaceProviders.gcpSchemaTitle")}
              </summary>
              <div className="tw:mt-2 tw:grid tw:gap-3">
                <BlockText>{t("workspaceProviders.gcpSchemaDescription")}</BlockText>
                <Field label={t("workspaceProviders.gcpSchemaDatabase")}>
                  {(binding) => (
                    <TextInput
                      {...binding.controlProps()}
                      density="compact"
                      monospace
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={128}
                      disabled={disabled}
                      value={wizard.schemaDatabase}
                      onChange={(event) => wizard.setSchemaDatabase(event.target.value)}
                    />
                  )}
                </Field>
                <Field label={t("workspaceProviders.gcpSchemaOwner")}>
                  {(binding) => (
                    <TextInput
                      {...binding.controlProps()}
                      density="compact"
                      monospace
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={63}
                      disabled={disabled}
                      value={wizard.schemaOwner}
                      onChange={(event) => wizard.setSchemaOwner(event.target.value)}
                    />
                  )}
                </Field>
                <CheckboxField
                  label={t("workspaceProviders.gcpSchemaApproval")}
                  checked={wizard.schemaApproved}
                  disabled={disabled || !wizard.schemaDatabase.trim() || !wizard.schemaOwner.trim()}
                  onChange={(event) => wizard.setSchemaApproved(event.target.checked)}
                />
                {schemaIncomplete ? (
                  <span className="tw:text-xs tw:leading-body tw:text-warning" role="status">
                    {t("workspaceProviders.gcpSchemaIncomplete")}
                  </span>
                ) : null}
              </div>
            </details>
          ) : null}
          <BlockText>{t("workspaceProviders.gcpCredentialsDescription")}</BlockText>
        </div>

        <div className="tw:grid tw:min-w-0 tw:gap-4">
          <div className="tw:grid tw:gap-1">
            <BlockTitle>{t("workspaceProviders.gcpAutomaticTitle")}</BlockTitle>
            <ul className="tw:m-0 tw:grid tw:list-disc tw:gap-1 tw:pl-4 tw:text-xs tw:leading-body tw:text-muted-foreground">
              <li>{t("workspaceProviders.gcpAutomaticLabels")}</li>
              <li>{t("workspaceProviders.gcpAutomaticAccounts")}</li>
              <li>{t("workspaceProviders.gcpAutomaticRotation")}</li>
            </ul>
          </div>

          <ApprovalBlock
            tone={!permissions
              ? wizard.permissions.isError ? "danger" : "neutral"
              : permissions.missing.length === 0 ? "success" : "warning"}
          >
            {!permissions ? (
              wizard.permissions.isError ? (
                <BlockText>{t("workspaceProviders.gcpPermissionsFailed")}</BlockText>
              ) : (
                <>
                  <span className="tw:text-xs">
                    <LoadingLabel>{t("workspaceProviders.gcpCheckingPermissions")}</LoadingLabel>
                  </span>
                  <BlockText>{t("workspaceProviders.gcpCheckingPermissionsDescription")}</BlockText>
                </>
              )
            ) : permissions.missing.length === 0 ? (
              <>
                <BlockTitle>{t("workspaceProviders.gcpPermissionsReady")}</BlockTitle>
                <BlockText>{t("workspaceProviders.gcpPermissionsReadyDescription")}</BlockText>
              </>
            ) : (
              <>
                <BlockTitle>
                  {t("workspaceProviders.gcpRolesRequired", { count: permissions.missing.length })}
                </BlockTitle>
                <ul className="tw:m-0 tw:grid tw:list-none tw:gap-1.5 tw:p-0">
                  {permissions.missing.map((requirement) => {
                    const purpose = requirementPurpose(requirement, lang, t);
                    return (
                      <li key={requirement.role} className="tw:grid tw:gap-0.5 tw:text-xs tw:leading-body">
                        <span className="tw:font-medium tw:text-foreground">{requirement.label}</span>
                        {purpose ? <span className="tw:text-muted-foreground">{purpose}</span> : null}
                      </li>
                    );
                  })}
                </ul>
                {permissions.canAutoGrant ? (
                  <>
                    <CheckboxField
                      label={t("workspaceProviders.gcpTemporaryGrant")}
                      checked={wizard.iamRoleGrantApproved}
                      disabled={disabled}
                      onChange={(event) => wizard.setIamRoleGrantApproved(event.target.checked)}
                    />
                    <BlockText indent>{t("workspaceProviders.gcpTemporaryGrantDescription")}</BlockText>
                  </>
                ) : (
                  <>
                    <BlockText>{t("workspaceProviders.gcpCannotGrant")}</BlockText>
                    <div>
                      <ExternalGuideButton
                        href={`https://console.cloud.google.com/iam-admin/iam?project=${encodeURIComponent(wizard.projectId)}`}
                      >
                        {t("workspaceProviders.gcpOpenIam")}
                      </ExternalGuideButton>
                    </div>
                  </>
                )}
              </>
            )}
          </ApprovalBlock>

          {wizard.effectiveProduction ? (
            <ApprovalBlock tone="danger">
              <CheckboxField
                label={(
                  <span className="tw:font-medium tw:text-danger">
                    {t("workspaceProviders.gcpProductionApproval")}
                  </span>
                )}
                checked={wizard.productionApproved}
                disabled={disabled}
                onChange={(event) => wizard.setProductionApproved(event.target.checked)}
              />
              <BlockText indent>{t("workspaceProviders.gcpProductionApprovalDescription")}</BlockText>
            </ApprovalBlock>
          ) : null}

          {!instance.iamAuthenticationEnabled ? (
            <ApprovalBlock tone="neutral">
              <CheckboxField
                label={t("workspaceProviders.gcpIamApproval")}
                checked={wizard.iamChangeApproved}
                disabled={disabled}
                onChange={(event) => wizard.setIamChangeApproved(event.target.checked)}
              />
              <BlockText indent>{t("workspaceProviders.gcpIamApprovalDescription")}</BlockText>
            </ApprovalBlock>
          ) : null}
        </div>
      </div>
    </div>
  );
}
