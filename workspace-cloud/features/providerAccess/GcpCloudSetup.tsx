"use client";

// OAuth-return setup surface. It exposes only target selection and approvals;
// WIF coordinates, IAM policies, service accounts, and database IAM users are
// generated and verified server-side instead of becoming browser form fields.
import { useEffect, useState } from "react";
import {
  ControlButton,
  ControlField,
  ControlLink,
  ControlSelect,
} from "../../app/components/Controls";
import type { ProviderAccountAccessController } from "./useProviderAccountAccess";
import { useWorkspaceLocale } from "../../app/components/WorkspaceLocale";
import { workspaceMessages } from "../../lib/workspace-messages";

export function GcpCloudSetup({
  controller,
}: {
  controller: ProviderAccountAccessController;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].gcpSetup;
  const common = workspaceMessages[locale].common;
  const permissionPurposes: Record<string, string> = {
    "roles/serviceusage.serviceUsageAdmin": copy.permissionPurposes.serviceUsage,
    "roles/iam.workloadIdentityPoolAdmin": copy.permissionPurposes.workloadIdentity,
    "roles/iam.serviceAccountAdmin": copy.permissionPurposes.serviceAccount,
    "roles/resourcemanager.projectIamAdmin": copy.permissionPurposes.projectIam,
    "roles/cloudsql.admin": copy.permissionPurposes.cloudSql,
  };
  const {
    gcpSetupId,
    gcpSetupInventory,
    gcpSetupInstances,
    selectedGcpProjectId,
    selectedGcpInstanceId,
    gcpEnvironmentClassification,
    gcpProductionApproved,
    gcpRestartApproved,
    gcpPermissionCheck,
    gcpIamRoleGrantApproved,
    gcpSetupError,
    gcpSetupReconnectRequired,
    gcpRecoveryIntent,
    gcpRecoveryTarget,
    gcpRecoveryTargetPending,
    gcpRecoveryTargetMissing,
    mutation,
    error,
    completeGcpSetup,
    reconnectGcpSetup,
    selectGcpInstance,
    selectGcpProject,
    setGcpEnvironmentClassification,
    setGcpIamRoleGrantApproved,
    setGcpProductionApproved,
    setGcpRestartApproved,
  } = controller;
  const configuring = mutation === "gcp:bootstrap";
  const recovering = Boolean(gcpRecoveryIntent) || gcpRecoveryTargetPending;
  const recoveryTargetMissing = gcpRecoveryTargetMissing;
  const [configurationElapsedSeconds, setConfigurationElapsedSeconds] =
    useState(0);
  useEffect(() => {
    if (!configuring) {
      setConfigurationElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setConfigurationElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setConfigurationElapsedSeconds(
        Math.floor((Date.now() - startedAt) / 1_000),
      );
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [configuring]);
  if (!gcpSetupId) return null;

  const selectedInstance = gcpSetupInstances.find(
    (item) => item.id === selectedGcpInstanceId,
  ) ?? null;
  const environmentClassified = Boolean(
    selectedInstance
    && (
      selectedInstance.production !== "unknown"
      || gcpEnvironmentClassification !== ""
    ),
  );
  const effectiveProduction = Boolean(
    selectedInstance
    && (
      selectedInstance.production === true
      || (
        selectedInstance.production === "unknown"
        && gcpEnvironmentClassification === "production"
      )
    ),
  );
  const approvalsComplete = Boolean(
    !recoveryTargetMissing
    && !gcpRecoveryTargetPending
    && selectedInstance
    && selectedInstance.ready
    && environmentClassified
    && (!effectiveProduction || gcpProductionApproved)
    && (selectedInstance.iamAuthenticationEnabled || gcpRestartApproved)
    && gcpPermissionCheck
    && (
      gcpPermissionCheck.missing.length === 0
      || (
        gcpPermissionCheck.canAutoGrant
        && gcpIamRoleGrantApproved
      )
    ),
  );
  const busy = mutation.startsWith("gcp:")
    || mutation === "connect:gcpCloudSql";
  const visibleError = gcpSetupReconnectRequired
    ? ""
    : gcpSetupError || error;

  return (
    <section className="tw:grid tw:gap-4 tw:border-y tw:border-border tw:bg-surface-inset tw:p-4">
      <header className="tw:flex tw:items-start tw:justify-between tw:gap-3">
        <div className="tw:grid tw:gap-1">
          <strong className="tw:text-sm tw:text-foreground">
            {recovering ? copy.repairTitle : copy.title}
          </strong>
          <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
            {gcpSetupReconnectRequired
              ? copy.reconnectDescription
              : gcpRecoveryTarget
                ? copy.repairHeaderDescription
              : gcpSetupInventory
              ? `${gcpSetupInventory.account}${copy.accountDescriptionSuffix}`
              : copy.loadingDescription}
          </small>
        </div>
        <span
          className="tw:whitespace-nowrap tw:text-2xs tw:font-semibold tw:text-success tw:data-[state=expired]:text-danger tw:data-[state=loading]:text-muted-foreground"
          data-state={
            gcpSetupReconnectRequired
              ? "expired"
              : gcpSetupInventory
                ? "ready"
                : "loading"
          }
        >
          {gcpSetupReconnectRequired
            ? copy.oauthExpired
            : gcpSetupInventory
              ? copy.oauthAuthorized
              : copy.checking}
        </span>
      </header>

      <ol className="tw:m-0 tw:grid tw:list-none tw:grid-cols-3 tw:border-y tw:border-border tw:p-0">
        <li className="tw:grid tw:gap-1 tw:border-r tw:border-border tw:px-3 tw:py-2.5">
          <span className="tw:font-mono tw:text-2xs tw:text-success">01 · {copy.complete}</span>
          <strong className="tw:text-xs tw:font-medium tw:text-foreground">
            {copy.authorizeAccount}
          </strong>
        </li>
        <li className="tw:grid tw:gap-1 tw:border-r tw:border-border tw:bg-selection tw:px-3 tw:py-2.5">
          <span className="tw:font-mono tw:text-2xs tw:text-selection-foreground">
            02 · {copy.currentStep}
          </span>
          <strong className="tw:text-xs tw:font-medium tw:text-selection-foreground">
            {copy.chooseTarget}
          </strong>
        </li>
        <li className="tw:grid tw:gap-1 tw:px-3 tw:py-2.5">
          <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
            03 · {copy.waiting}
          </span>
          <strong className="tw:text-xs tw:font-medium tw:text-muted-foreground">
            {recovering ? copy.repairAfterApproval : copy.configureAfterApproval}
          </strong>
        </li>
      </ol>

      {gcpRecoveryTarget ? (
        <div className="tw:grid tw:gap-1 tw:border-y tw:border-primary/30 tw:bg-primary/5 tw:px-3 tw:py-2.5" role="status">
          <strong className="tw:text-xs tw:font-semibold tw:text-foreground">
            {copy.repairPinnedTarget}
          </strong>
          <span className="tw:font-mono tw:text-2xs tw:text-primary">
            {gcpRecoveryTarget.resource.project} / {gcpRecoveryTarget.resource.instance} / {gcpRecoveryTarget.resource.database}
          </span>
          <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
            {copy.repairPinnedDescription}
          </small>
        </div>
      ) : null}

      {recoveryTargetMissing ? (
        <p className="tw:m-0 tw:border tw:border-danger/40 tw:bg-danger/10 tw:p-3 tw:text-2xs tw:leading-body tw:text-danger" role="alert">
          {copy.repairTargetUnavailable}
        </p>
      ) : null}

      {gcpSetupReconnectRequired ? (
        <div
          className="tw:flex tw:flex-col tw:items-stretch tw:gap-3 tw:border tw:border-danger/40 tw:bg-danger/10 tw:p-3 tw:sm:flex-row tw:sm:items-center tw:sm:justify-between"
          role="alert"
        >
          <div className="tw:grid tw:gap-1">
            <strong className="tw:text-xs tw:font-semibold tw:text-danger">
              {copy.expiredTitle}
            </strong>
            <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
              {copy.expiredDescription}
            </small>
          </div>
          <ControlButton
            tone="primary"
            size="field"
            disabled={busy}
            onClick={reconnectGcpSetup}
          >
            {copy.reconnect}
          </ControlButton>
        </div>
      ) : null}

      <div className="tw:grid tw:gap-1">
        <strong className="tw:text-xs tw:font-semibold tw:text-foreground">
          {copy.targetTitle}
        </strong>
        <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
          {copy.targetDescription}
        </small>
      </div>

      <div className="tw:grid tw:grid-cols-1 tw:gap-3 tw:lg:grid-cols-2">
        <ControlField label={copy.project}>
          <ControlSelect
            disabled={!gcpSetupInventory || busy || recovering}
            value={selectedGcpProjectId}
            onChange={(event) => void selectGcpProject(event.target.value)}
          >
            <option value="">{copy.chooseProject}</option>
            {(gcpSetupInventory?.projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.id}
              </option>
            ))}
          </ControlSelect>
        </ControlField>

        <ControlField label={copy.instance}>
          <ControlSelect
            disabled={!selectedGcpProjectId || busy || recovering}
            value={selectedGcpInstanceId}
            onChange={(event) => selectGcpInstance(event.target.value)}
          >
            <option value="">
              {mutation === "gcp:instances"
                ? copy.checkingInstances
                : copy.chooseInstance}
            </option>
            {gcpSetupInstances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name} · {instance.engine} · {instance.region}
              </option>
            ))}
          </ControlSelect>
        </ControlField>
      </div>

      {selectedInstance ? (
        <div className="tw:grid tw:gap-3 tw:border-t tw:border-border tw:pt-3 tw:lg:grid-cols-2 tw:lg:items-start">
          <div className="tw:col-span-full tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-2xs tw:text-muted-foreground">
            <span>{selectedInstance.engine.toUpperCase()}</span>
            <span>·</span>
            <span>{selectedInstance.region}</span>
            <span>·</span>
            <span>{selectedInstance.ready ? copy.running : copy.unavailable}</span>
            <span>·</span>
            <span>
              {selectedInstance.production === true
                ? common.production
                : selectedInstance.production === false
                  ? copy.nonProduction
                  : gcpEnvironmentClassification === "production"
                    ? copy.pendingProduction
                    : gcpEnvironmentClassification === "development"
                      ? copy.pendingDevelopment
                      : copy.classificationRequired}
            </span>
          </div>

          <div className="tw:grid tw:gap-3">
            {selectedInstance.production === "unknown" ? (
              <label className="tw:grid tw:gap-2 tw:border tw:border-warning/40 tw:bg-warning/10 tw:p-3">
                <span className="tw:text-xs tw:font-semibold tw:text-warning">
                  {copy.addClassification}
                </span>
                <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                  {copy.classificationDescriptionBeforeCode}{" "}
                  <code className="tw:mx-1">environment</code>
                  {" "}{copy.classificationDescriptionAfterCode}{" "}
                  <code className="tw:mx-1">cloudsql.instances.update</code>
                  {" "}{copy.permissionRequired}
                </small>
                <ControlSelect
                  disabled={busy}
                  value={gcpEnvironmentClassification}
                  onChange={(event) => {
                    setGcpEnvironmentClassification(
                      event.target.value as "" | "production" | "development",
                    );
                    setGcpProductionApproved(false);
                  }}
                >
                  <option value="">{copy.chooseEnvironment}</option>
                  <option value="production">
                    {copy.productionOption}
                  </option>
                  <option value="development">
                    {copy.developmentOption}
                  </option>
                </ControlSelect>
              </label>
            ) : null}

            <p className="tw:m-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
              {copy.credentialsDescription}
            </p>
          </div>

          <div className="tw:grid tw:gap-3">
            <div className="tw:grid tw:gap-2 tw:border tw:border-border tw:bg-surface tw:p-3">
              <strong className="tw:text-xs tw:font-semibold tw:text-foreground">
                {copy.automaticTitle}
              </strong>
              <ul className="tw:m-0 tw:grid tw:list-none tw:gap-1.5 tw:p-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
                <li>· {copy.automaticLabels}</li>
                <li>· {copy.automaticAccounts}</li>
                <li>· {copy.automaticRotation}</li>
              </ul>
            </div>

            <div
              data-state={
                !gcpPermissionCheck
                  ? "checking"
                  : gcpPermissionCheck.missing.length === 0
                    ? "ready"
                    : "required"
              }
              className="tw:grid tw:gap-2 tw:border tw:border-border tw:bg-surface tw:p-3 tw:data-[state=ready]:border-success/40 tw:data-[state=ready]:bg-success/10 tw:data-[state=required]:border-warning/40 tw:data-[state=required]:bg-warning/10"
            >
              <strong className="tw:text-xs tw:font-semibold tw:text-foreground">
                {!gcpPermissionCheck
                  ? copy.checkingPermissions
                  : gcpPermissionCheck.missing.length === 0
                    ? copy.permissionsReady
                    : locale === "ko"
                      ? `${gcpPermissionCheck.missing.length}${copy.rolesRequiredSuffix}`
                      : `${gcpPermissionCheck.missing.length} ${copy.rolesRequiredSuffix}`}
              </strong>
              {gcpPermissionCheck?.missing.length ? (
                <>
                  <ul className="tw:m-0 tw:grid tw:list-none tw:gap-1.5 tw:p-0">
                    {gcpPermissionCheck.missing.map((requirement) => (
                      <li
                        className="tw:grid tw:gap-0.5 tw:text-2xs tw:leading-body"
                        key={requirement.role}
                      >
                        <span className="tw:font-semibold tw:text-foreground">
                          {requirement.label}
                        </span>
                        <span className="tw:text-muted-foreground">
                          {permissionPurposes[requirement.role] ?? requirement.purpose}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {gcpPermissionCheck.canAutoGrant ? (
                    <label className="tw:grid tw:grid-cols-[16px_minmax(0,1fr)] tw:items-start tw:gap-2 tw:border-t tw:border-warning/30 tw:pt-2">
                      <input
                        className="tw:mt-0.5 tw:size-4 tw:accent-primary"
                        type="checkbox"
                        checked={gcpIamRoleGrantApproved}
                        disabled={busy}
                        onChange={(event) =>
                          setGcpIamRoleGrantApproved(event.target.checked)
                        }
                      />
                      <span className="tw:grid tw:gap-1 tw:text-xs tw:text-foreground">
                        {copy.temporaryGrant}
                        <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                          {copy.temporaryGrantDescription}
                        </small>
                      </span>
                    </label>
                  ) : (
                    <div className="tw:grid tw:gap-2 tw:border-t tw:border-warning/30 tw:pt-2">
                      <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                        {copy.cannotGrant}
                      </small>
                      <ControlLink
                        href={`https://console.cloud.google.com/iam-admin/iam?project=${encodeURIComponent(selectedGcpProjectId)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {copy.openIam}
                      </ControlLink>
                    </div>
                  )}
                </>
              ) : (
                <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                  {gcpPermissionCheck
                    ? copy.permissionsReadyDescription
                    : copy.checkingPermissionsDescription}
                </small>
              )}
            </div>

            {effectiveProduction ? (
              <label className="tw:grid tw:grid-cols-[16px_minmax(0,1fr)] tw:items-start tw:gap-2 tw:border tw:border-danger/40 tw:bg-danger/10 tw:p-3">
                <input
                  className="tw:mt-0.5 tw:size-4 tw:accent-danger"
                  type="checkbox"
                  checked={gcpProductionApproved}
                  disabled={busy}
                  onChange={(event) =>
                    setGcpProductionApproved(event.target.checked)
                  }
                />
                <span className="tw:grid tw:gap-1 tw:text-xs tw:text-danger">
                  {copy.productionApproval}
                  <small className="tw:text-2xs tw:leading-body">
                    {copy.productionApprovalDescription}
                  </small>
                </span>
              </label>
            ) : null}

            {!selectedInstance.iamAuthenticationEnabled ? (
              <label className="tw:grid tw:grid-cols-[16px_minmax(0,1fr)] tw:items-start tw:gap-2 tw:border tw:border-border tw:bg-surface tw:p-3">
                <input
                  className="tw:mt-0.5 tw:size-4 tw:accent-primary"
                  type="checkbox"
                  checked={gcpRestartApproved}
                  disabled={busy}
                  onChange={(event) =>
                    setGcpRestartApproved(event.target.checked)
                  }
                />
                <span className="tw:grid tw:gap-1 tw:text-xs tw:text-foreground">
                  {copy.iamApproval}
                  <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                    {copy.iamApprovalDescription}
                  </small>
                </span>
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="tw:grid tw:gap-3 tw:border-t tw:border-border tw:pt-3">
        {configuring ? (
          <div className="tw:grid tw:gap-2.5 tw:border tw:border-primary/40 tw:bg-primary/10 tw:p-3">
            <div className="tw:flex tw:items-center tw:justify-between tw:gap-3">
              <strong className="tw:text-xs tw:font-semibold tw:text-foreground">
                {copy.configuringTitle}
              </strong>
              <span className="tw:shrink-0 tw:font-mono tw:text-2xs tw:text-primary">
                {configurationElapsedSeconds}{locale === "ko" ? "" : " "}{copy.elapsedSuffix}
              </span>
            </div>
            <div
              className="tw:h-2 tw:overflow-hidden tw:rounded-pill tw:bg-muted"
              role="progressbar"
              aria-label={copy.configuringAria}
              aria-valuetext={`${configurationElapsedSeconds}${locale === "ko" ? "" : " "}${copy.elapsedSuffix}`}
            >
              <span className="tw:block tw:h-full tw:w-full tw:animate-pulse tw:rounded-pill tw:bg-primary/50 tw:motion-reduce:animate-none" />
            </div>
            <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
              {configurationElapsedSeconds < 30
                ? copy.configuringEarly
                : copy.configuringLate}
            </small>
          </div>
        ) : null}
        {visibleError ? (
          <p
            className="tw:m-0 tw:border tw:border-danger/40 tw:bg-danger/10 tw:p-3 tw:text-2xs tw:leading-body tw:text-danger"
            role="alert"
          >
            <strong className="tw:mb-1 tw:block tw:text-xs">
              {copy.failureTitle}
            </strong>
            {visibleError}
          </p>
        ) : null}
        <div className="tw:flex tw:flex-col tw:items-stretch tw:gap-3 tw:sm:flex-row tw:sm:items-center tw:sm:justify-between">
          <small className="tw:max-w-[62ch] tw:text-2xs tw:leading-body tw:text-muted-foreground">
            {recovering ? copy.repairFinalDescription : copy.finalDescription}
          </small>
          <div className="tw:w-full tw:[&>button]:w-full tw:sm:w-auto">
            <ControlButton
              tone="primary"
              size="field"
              disabled={!approvalsComplete || busy}
              onClick={() => void completeGcpSetup()}
            >
              {mutation === "gcp:bootstrap"
                ? copy.configuringButton
                : recovering
                  ? copy.repairConfigure
                  : gcpPermissionCheck?.missing.length
                    ? copy.configureWithGrant
                    : selectedInstance?.production === "unknown"
                      ? copy.configureWithClassification
                      : copy.configure}
            </ControlButton>
          </div>
        </div>
      </div>
    </section>
  );
}
