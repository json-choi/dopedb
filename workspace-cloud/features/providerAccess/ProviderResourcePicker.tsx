"use client";

import { useState } from "react";
import {
  ControlButton,
  ControlField,
  ControlSelect,
} from "../../app/components/Controls";
import { selectableProviderResources } from "./domain";
import type { SharedDatabaseAccessController } from "./useSharedDatabaseAccess";
import { useWorkspaceLocale } from "../../app/components/WorkspaceLocale";
import { workspaceMessages } from "../../lib/workspace-messages";
import {
  localizedIntegrationDisplayName,
  localizedNeonFindingText,
} from "../../lib/workspace-provider-copy";

export function ProviderResourcePicker({
  controller,
}: {
  controller: SharedDatabaseAccessController;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].resourcePicker;
  const common = workspaceMessages[locale].common;
  const steps = [
    copy.steps.account,
    copy.steps.database,
    copy.steps.review,
  ];
  const {
    integrations,
    selectedIntegrationId,
    selection,
    resourceOptions,
    resourcePending,
    mutation,
    selectedIntegration,
    selectedProvider,
    resourceComplete,
    neonEnvironmentClassification,
    neonBootstrap,
    neonPublicAclApproved,
    neonProductionApproved,
    applyNeonBootstrap,
    classifyNeonEnvironment,
    importDiscoveredResource,
    preflightNeonBootstrap,
    resetResources,
    selectResource,
    setSelectedIntegrationId,
    setNeonPublicAclApproved,
    setNeonProductionApproved,
  } = controller;
  const [step, setStep] = useState(1);
  const finalLevel = selectedProvider?.resourceLevels.at(-1);
  const finalResource = finalLevel
    ? resourceOptions[finalLevel.key]?.find(
        (item) => item.value === selection[finalLevel.key],
      )
    : null;
  const isNeon = selectedProvider?.id === "neon";
  const branchLevel = isNeon
    ? selectedProvider.resourceLevels.find((level) => level.kind === "branches")
    : null;
  const selectedBranch = branchLevel
    ? resourceOptions[branchLevel.key]?.find(
        (item) => item.value === selection[branchLevel.key],
      )
    : null;
  const neonEnvironmentReady = !isNeon
    || selectedBranch?.production === true
    || selectedBranch?.production === false
    || neonEnvironmentClassification !== "";
  const neonBootstrapReady = Boolean(
    !isNeon
    || (
      neonBootstrap.report
      && neonBootstrap.receipt
      && neonBootstrap.receiptExpiresAt
      && Date.parse(neonBootstrap.receiptExpiresAt) > Date.now()
    ),
  );
  const targetLabel = selectedProvider
    ? selectedProvider.resourceLevels
      .map((level) => selection[level.key])
      .filter(Boolean)
      .join(" / ")
    : "";

  function chooseIntegration(integrationId: string) {
    setSelectedIntegrationId(integrationId);
    resetResources();
  }

  return (
    <section className="tw:grid tw:border tw:border-border">
      <header className="tw:grid tw:gap-3 tw:border-b tw:border-border tw:bg-surface-inset tw:px-4 tw:py-3">
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-3">
          <div className="tw:grid tw:gap-1">
            <strong className="tw:text-xs tw:text-foreground">
              {copy.title}
            </strong>
            <small className="tw:text-2xs tw:text-muted-foreground">
              {copy.description}
            </small>
          </div>
          <span className="tw:font-mono tw:text-2xs tw:uppercase tw:text-primary">
            {step} / 3
          </span>
        </div>
        <ol
          className="tw:m-0 tw:grid tw:list-none tw:grid-cols-3 tw:gap-px tw:p-0"
          aria-label={copy.progressLabel}
        >
          {steps.map((label, index) => {
            const itemStep = index + 1;
            return (
              <li
                className="tw:grid tw:gap-1 tw:text-2xs tw:text-muted-foreground tw:data-[active=true]:text-foreground tw:data-[complete=true]:text-primary"
                data-active={step === itemStep}
                data-complete={step > itemStep}
                key={label}
              >
                <span className="tw:h-0.5 tw:bg-border tw:data-[active=true]:bg-primary tw:data-[complete=true]:bg-primary" />
                <span className="tw:max-[520px]:sr-only">{label}</span>
              </li>
            );
          })}
        </ol>
      </header>

      {resourcePending
      || mutation.startsWith("import:")
      || mutation.startsWith("neon:") ? (
        <div
          className="tw:h-1 tw:overflow-hidden tw:bg-surface-inset"
          role="progressbar"
          aria-label={
            mutation.startsWith("import:")
              ? copy.registering
              : mutation === "neon:preflight"
                ? copy.neonPreflight
                : mutation === "neon:apply"
                  ? copy.neonApplying
              : copy.resourcesLoading
          }
        >
          <span className="tw:block tw:h-full tw:w-1/2 tw:animate-pulse tw:bg-primary" />
        </div>
      ) : null}

      <div className="tw:grid tw:min-h-[260px] tw:content-start tw:gap-5 tw:p-5">
        {step === 1 ? (
          <>
            <div className="tw:grid tw:gap-1">
              <strong className="tw:text-sm tw:text-foreground">
                {copy.accountQuestion}
              </strong>
              <p className="tw:m-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
                {copy.accountDescription}
              </p>
            </div>
            <ControlField label={copy.cloudAccount}>
              <ControlSelect
                value={selectedIntegrationId}
                onChange={(event) => chooseIntegration(event.target.value)}
              >
                <option value="">{copy.selectAccount}</option>
                {integrations.map((integration) => (
                  <option
                    value={integration.id}
                    key={integration.id}
                    disabled={integration.status !== "active"}
                  >
                    {localizedIntegrationDisplayName(
                      integration.displayName,
                      locale,
                    )}
                    {integration.status === "reconnect_required"
                      ? ` · ${common.reconnectRequired}`
                      : ""}
                  </option>
                ))}
              </ControlSelect>
            </ControlField>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="tw:grid tw:gap-1">
              <strong className="tw:text-sm tw:text-foreground">
                {copy.selectDatabase}
              </strong>
              <p className="tw:m-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
                {copy.selectDatabaseDescription}
              </p>
            </div>
            <div className="tw:grid tw:grid-cols-1 tw:gap-3 tw:md:grid-cols-3">
              {selectedProvider?.resourceLevels.map((level, index) => {
                const isFinalLeaf =
                  index === selectedProvider.resourceLevels.length - 1;
                const options = selectableProviderResources(
                  resourceOptions[level.key] ?? [],
                  isFinalLeaf,
                  selectedProvider.supportedEngines,
                  selectedProvider.id === "neon",
                );
                const previous =
                  index === 0
                  || Boolean(
                    selection[selectedProvider.resourceLevels[index - 1].key],
                  );
                return (
                  <ControlField
                    key={level.key}
                    label={copy.resourceLabels[
                      level.kind as keyof typeof copy.resourceLabels
                    ] ?? level.label}
                  >
                    <ControlSelect
                      value={selection[level.key] ?? ""}
                      onChange={(event) =>
                        void selectResource(index, event.target.value)
                      }
                      disabled={!previous || resourcePending}
                    >
                      <option value="">{copy.select}</option>
                      {options.map((item) => (
                        <option value={item.value} key={item.id}>
                          {item.name}
                          {item.production === true
                            ? ` · ${copy.productionSuffix}`
                            : item.production === "unknown" && isFinalLeaf
                              ? ` · ${copy.environmentRequiredSuffix}`
                            : item.ready === false
                              ? ` · ${copy.notReadySuffix}`
                              : ""}
                        </option>
                      ))}
                    </ControlSelect>
                  </ControlField>
                );
              })}
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="tw:grid tw:gap-1">
              <strong className="tw:text-sm tw:text-foreground">
                {copy.reviewTitle}
              </strong>
              <p className="tw:m-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
                {copy.reviewDescription}
              </p>
            </div>
            <dl className="tw:m-0 tw:grid tw:grid-cols-[130px_minmax(0,1fr)] tw:border-t tw:border-border tw:text-xs tw:max-[520px]:grid-cols-1">
              <dt className="tw:border-b tw:border-border tw:py-2 tw:font-mono tw:text-2xs tw:uppercase tw:text-muted-foreground">
                {copy.authorizedAccount}
              </dt>
              <dd className="tw:m-0 tw:border-b tw:border-border tw:py-2 tw:text-foreground">
                {selectedIntegration
                  ? localizedIntegrationDisplayName(
                      selectedIntegration.displayName,
                      locale,
                    )
                  : null}
              </dd>
              <dt className="tw:border-b tw:border-border tw:py-2 tw:font-mono tw:text-2xs tw:uppercase tw:text-muted-foreground">
                {copy.target}
              </dt>
              <dd className="tw:m-0 tw:border-b tw:border-border tw:py-2 tw:text-foreground">
                {targetLabel}
              </dd>
              <dt className="tw:border-b tw:border-border tw:py-2 tw:font-mono tw:text-2xs tw:uppercase tw:text-muted-foreground">
                {copy.credentials}
              </dt>
              <dd className="tw:m-0 tw:border-b tw:border-border tw:py-2 tw:text-foreground">
                {copy.credentialDescription}
              </dd>
            </dl>
            {(isNeon
              ? neonBootstrap.report?.production === true
                || selectedBranch?.production === true
              : finalResource?.production === true) ? (
              <p className="tw:m-0 tw:border tw:border-danger/40 tw:bg-danger/5 tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-danger">
                {copy.productionNotice}
              </p>
            ) : null}
            {isNeon ? (
              <div className="tw:grid tw:gap-3 tw:border-t tw:border-border tw:pt-4">
                <div className="tw:grid tw:gap-1">
                  <strong className="tw:text-xs tw:text-foreground">
                    {copy.neonTitle}
                  </strong>
                  <p className="tw:m-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
                    {copy.neonDescription}
                  </p>
                </div>

                {selectedBranch?.production === "unknown"
                || selectedBranch?.production === undefined ? (
                  <ControlField label={copy.branchEnvironment}>
                    <ControlSelect
                      value={neonEnvironmentClassification}
                      onChange={(event) => {
                        classifyNeonEnvironment(
                          event.target.value as "" | "development" | "production",
                        );
                      }}
                      disabled={mutation !== ""}
                    >
                      <option value="">{copy.chooseEnvironment}</option>
                      <option value="development">{common.development}</option>
                      <option value="production">{common.production}</option>
                    </ControlSelect>
                  </ControlField>
                ) : (
                  <p
                    className="tw:m-0 tw:border tw:border-border tw:bg-surface-inset tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-muted-foreground tw:data-[production=true]:border-danger/40 tw:data-[production=true]:bg-danger/5 tw:data-[production=true]:text-danger"
                    data-production={selectedBranch.production === true}
                  >
                    {selectedBranch.production === true
                      ? copy.protectedBranch
                      : copy.developmentBranch}
                  </p>
                )}

                {!neonBootstrap.report ? (
                  <div className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:border tw:border-border tw:bg-surface-inset tw:p-3 tw:max-[520px]:grid">
                    <p className="tw:m-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
                      {copy.preflightDescription}
                    </p>
                    <ControlButton
                      tone="primary"
                      onClick={() => void preflightNeonBootstrap()}
                      disabled={!neonEnvironmentReady || mutation !== ""}
                    >
                      {mutation === "neon:preflight" ? copy.checking : copy.preflight}
                    </ControlButton>
                  </div>
                ) : (
                  <>
                    <div
                      className="tw:grid tw:gap-1 tw:border tw:border-border tw:bg-surface-inset tw:p-3 tw:data-[status=blocked]:border-danger/40 tw:data-[status=blocked]:bg-danger/5 tw:data-[status=approvalRequired]:border-warning/40 tw:data-[status=approvalRequired]:bg-warning/10 tw:data-[status=readyToApply]:border-success/40 tw:data-[status=readyToApply]:bg-success/10"
                      data-status={neonBootstrap.report.status}
                    >
                      <strong className="tw:text-xs tw:text-foreground">
                        {neonBootstrap.report.status === "blocked"
                          ? copy.blockedTitle
                          : neonBootstrap.report.status === "approvalRequired"
                            ? copy.approvalTitle
                            : copy.readyTitle}
                      </strong>
                      <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                        {neonBootstrap.report.canRollback
                          ? copy.rollback
                          : copy.noRollback}
                      </small>
                    </div>

                    <ul className="tw:m-0 tw:grid tw:list-none tw:gap-2 tw:p-0">
                      {neonBootstrap.report.findings.map((item, index) => (
                        <li
                          className="tw:grid tw:gap-2 tw:border tw:border-border tw:bg-surface tw:p-3 tw:data-[level=blocker]:border-danger/40 tw:data-[level=change]:border-warning/40 tw:data-[level=verified]:border-success/40"
                          data-level={item.level}
                          key={`${item.code}:${item.target}:${index}`}
                        >
                          <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:max-[520px]:grid">
                            <span className="tw:grid tw:gap-1">
                              <strong className="tw:text-xs tw:text-foreground">
                                {localizedNeonFindingText(
                                  item.code,
                                  "description",
                                  item.description,
                                  locale,
                                )}
                              </strong>
                              <small className="tw:text-2xs tw:text-muted-foreground">
                                {localizedNeonFindingText(
                                  item.code,
                                  "target",
                                  item.target,
                                  locale,
                                )}
                              </small>
                            </span>
                            <code className="tw:text-2xs tw:text-muted-foreground">
                              {item.code}
                            </code>
                          </div>
                          <span className="tw:grid tw:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] tw:items-center tw:gap-2 tw:text-2xs tw:max-[520px]:grid-cols-1">
                            <span className="tw:min-w-0 tw:break-words tw:text-muted-foreground">
                              {localizedNeonFindingText(
                                item.code,
                                "before",
                                item.before,
                                locale,
                              )}
                            </span>
                            <span className="tw:text-primary tw:max-[520px]:hidden" aria-hidden="true">
                              →
                            </span>
                            <span className="tw:min-w-0 tw:break-words tw:text-foreground">
                              {localizedNeonFindingText(
                                item.code,
                                "after",
                                item.after,
                                locale,
                              )}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>

                    {neonBootstrap.report.requiresPublicAclApproval ? (
                      <label className="tw:grid tw:grid-cols-[16px_minmax(0,1fr)] tw:items-start tw:gap-2 tw:border tw:border-warning/40 tw:bg-warning/10 tw:p-3">
                        <input
                          className="tw:mt-0.5 tw:size-4 tw:accent-warning"
                          type="checkbox"
                          checked={neonPublicAclApproved}
                          disabled={mutation !== "" || neonBootstrapReady}
                          onChange={(event) => setNeonPublicAclApproved(event.target.checked)}
                        />
                        <span className="tw:grid tw:gap-1 tw:text-xs tw:text-foreground">
                          <strong>{copy.publicApproval}</strong>
                          <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                            {copy.publicApprovalDescription}
                          </small>
                        </span>
                      </label>
                    ) : null}

                    {neonBootstrap.report.requiresProductionApproval ? (
                      <label className="tw:grid tw:grid-cols-[16px_minmax(0,1fr)] tw:items-start tw:gap-2 tw:border tw:border-danger/40 tw:bg-danger/10 tw:p-3">
                        <input
                          className="tw:mt-0.5 tw:size-4 tw:accent-danger"
                          type="checkbox"
                          checked={neonProductionApproved}
                          disabled={mutation !== "" || neonBootstrapReady}
                          onChange={(event) => setNeonProductionApproved(event.target.checked)}
                        />
                        <span className="tw:grid tw:gap-1 tw:text-xs tw:text-danger">
                          <strong>{copy.productionApproval}</strong>
                          <small className="tw:text-2xs tw:leading-body">
                            {copy.productionApprovalDescription}
                          </small>
                        </span>
                      </label>
                    ) : null}

                    {neonBootstrapReady ? (
                      <p
                        className="tw:m-0 tw:border tw:border-success/40 tw:bg-success/10 tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-success"
                        role="status"
                      >
                        {copy.verified}
                      </p>
                    ) : (
                      <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2">
                        <ControlButton
                          onClick={() => void preflightNeonBootstrap()}
                          disabled={mutation !== ""}
                        >
                          {copy.recheck}
                        </ControlButton>
                        <ControlButton
                          tone="primary"
                          onClick={() => void applyNeonBootstrap()}
                          disabled={
                            mutation !== ""
                            || neonBootstrap.report.status === "blocked"
                            || (
                              neonBootstrap.report.requiresPublicAclApproval
                              && !neonPublicAclApproved
                            )
                            || (
                              neonBootstrap.report.requiresProductionApproval
                              && !neonProductionApproved
                            )
                          }
                        >
                          {mutation === "neon:apply" ? copy.applying : copy.apply}
                        </ControlButton>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:border-t tw:border-border tw:px-5 tw:py-3">
        <ControlButton
          onClick={() => setStep((current) => Math.max(1, current - 1))}
          disabled={step === 1 || mutation !== ""}
        >
          {copy.previous}
        </ControlButton>
        {step < 3 ? (
          <ControlButton
            tone="primary"
            onClick={() => setStep((current) => Math.min(3, current + 1))}
            disabled={
              mutation !== ""
              || (step === 1 && !selectedIntegration)
              || (step === 2 && !resourceComplete)
            }
          >
            {copy.continue}
          </ControlButton>
        ) : (
          <ControlButton
            tone="primary"
            disabled={
              !resourceComplete
              || !neonBootstrapReady
              || mutation !== ""
            }
            onClick={() => void importDiscoveredResource()}
          >
            {mutation.startsWith("import:")
              ? copy.registeringButton
              : copy.createButton}
          </ControlButton>
        )}
      </footer>
    </section>
  );
}
