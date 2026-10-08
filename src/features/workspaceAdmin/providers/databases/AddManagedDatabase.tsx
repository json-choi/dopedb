// Inline three-step flow that registers one provider database as a shared workspace
// connection. useManagedDatabaseImport owns state and commands; this component lays
// out the step list, the account step, the flow's error and the footer with cancel,
// back and the flow's single primary action.
import { useEffect, useId, useRef } from "react";
import { Icon } from "../../../../components/Icon";
import { Button } from "../../../../design-system/components/Button";
import { Field, SelectInput } from "../../../../design-system/components/FormControls";
import { ProgressBar } from "../../../../design-system/components/Progress";
import { InlineNotice } from "../../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../../lib/i18n";
import type { WorkspaceAdminScope } from "../../domain";
import type { Integration, Provider } from "../domain";
import ImportReviewStep from "./ImportReviewStep";
import ResourceTargetStep from "./ResourceTargetStep";
import { integrationDisplayName } from "./serverMessages";
import {
  useManagedDatabaseImport,
  type ImportedDatabase,
  type ManagedDatabaseImport,
  type WizardMutation,
  type WizardStep,
} from "./useManagedDatabaseImport";

const STEPS: readonly Readonly<{
  step: WizardStep;
  label: I18nKey;
  question: I18nKey;
  description: I18nKey;
}>[] = [
  {
    step: 1,
    label: "workspaceProviderDatabases.stepAccount",
    question: "workspaceProviderDatabases.accountQuestion",
    description: "workspaceProviderDatabases.accountDescription",
  },
  {
    step: 2,
    label: "workspaceProviderDatabases.stepTarget",
    question: "workspaceProviderDatabases.targetQuestion",
    description: "workspaceProviderDatabases.targetDescription",
  },
  {
    step: 3,
    label: "workspaceProviderDatabases.stepReview",
    question: "workspaceProviderDatabases.reviewTitle",
    description: "workspaceProviderDatabases.reviewDescription",
  },
];

const PROGRESS_LABELS: Record<WizardMutation, I18nKey> = {
  claim: "workspaceProviderDatabases.verifyingSelection",
  import: "workspaceProviderDatabases.importProgress",
  neonPreflight: "workspaceProviderDatabases.preflightProgress",
  neonApply: "workspaceProviderDatabases.applyProgress",
};

function AccountStep({
  flow,
  integrations,
  onConnectAccount,
}: {
  flow: ManagedDatabaseImport;
  integrations: readonly Integration[];
  onConnectAccount: () => void;
}) {
  const { t } = useI18n();
  const { discovery, busy } = flow;

  return (
    <div className="tw:grid tw:min-w-0 tw:gap-3">
      <div className="tw:max-w-[480px]">
        <Field label={t("workspaceProviderDatabases.accountLabel")}>
          <SelectInput
            density="compact"
            value={discovery.integrationId}
            disabled={busy}
            onChange={(event) => flow.chooseIntegration(event.target.value)}
          >
            <option value="">{t("workspaceProviderDatabases.selectAccount")}</option>
            {integrations.map((integration) => (
              <option
                key={integration.id}
                value={integration.id}
                disabled={integration.status !== "active"}
              >
                {integration.status === "active"
                  ? integrationDisplayName(integration.displayName, t)
                  : `${integrationDisplayName(integration.displayName, t)} · ${t("workspaceProviderDatabases.reconnectSuffix")}`}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      {discovery.integration && !discovery.integrationReady ? (
        <InlineNotice
          tone="warning"
          icon="alert"
          action={
            <Button size="compact" onClick={onConnectAccount}>
              {t("workspaceProviderDatabases.goToAccounts")}
            </Button>
          }
        >
          {t("workspaceProviderDatabases.accountReconnect")}
        </InlineNotice>
      ) : null}
      {discovery.integrationReady && !discovery.levels ? (
        <InlineNotice tone="warning" icon="alert">
          {t("workspaceProviderDatabases.unsupportedProvider")}
        </InlineNotice>
      ) : null}
    </div>
  );
}

export default function AddManagedDatabase({
  scope,
  providers,
  integrations,
  onCancel,
  onImported,
  onAlreadyShared,
  onConnectAccount,
  onBusyChange,
}: {
  scope: WorkspaceAdminScope;
  providers: readonly Provider[];
  integrations: readonly Integration[];
  onCancel: () => void;
  onImported: (database: ImportedDatabase) => void;
  onAlreadyShared: () => void;
  onConnectAccount: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const flow = useManagedDatabaseImport({
    scope,
    providers,
    integrations,
    onImported,
    onAlreadyShared,
    onBusyChange,
  });
  const { step, discovery, busy, mutation, error } = flow;
  const current = STEPS[step - 1];
  const accountName = discovery.integration
    ? integrationDisplayName(discovery.integration.displayName, t)
    : "";
  // The Neon panel owns the next action until its receipt exists.
  const createIsPrimary = !discovery.isNeon || flow.neon.verified;

  // Each step announces itself; the first focus also brings the flow into view.
  useEffect(() => {
    stepHeading.current?.focus();
  }, [step]);

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy}
      data-primary-flow
      className="tw:grid tw:min-w-0 tw:rounded-sm tw:border tw:border-border-subtle"
    >
      <header className="tw:grid tw:min-w-0 tw:gap-3 tw:border-b tw:border-border-subtle tw:px-4 tw:py-3">
        <div className="tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-3">
          <div className="tw:grid tw:min-w-0 tw:gap-0.5">
            <h4 id={titleId} className="tw:m-0 tw:text-ui tw:font-semibold tw:text-foreground">
              {t("workspaceProviderDatabases.wizardTitle")}
            </h4>
            <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
              {t("workspaceProviderDatabases.wizardDescription")}
            </p>
          </div>
          <span className="tw:shrink-0 tw:text-xs tw:tabular-nums tw:text-muted-foreground">
            {t("workspaceProviderDatabases.stepProgress", { current: step, total: STEPS.length })}
          </span>
        </div>
        <ol
          aria-label={t("workspaceProviderDatabases.stepsLabel")}
          className="tw:m-0 tw:grid tw:list-none tw:grid-cols-3 tw:gap-2 tw:p-0"
        >
          {STEPS.map((item) => {
            const state = item.step < step ? "done" : item.step === step ? "current" : "upcoming";
            return (
              <li
                key={item.step}
                data-state={state}
                aria-current={state === "current" ? "step" : undefined}
                className="tw:grid tw:min-w-0 tw:gap-1.5 tw:text-xs tw:text-muted-foreground tw:data-[state=current]:font-medium tw:data-[state=current]:text-foreground tw:data-[state=done]:text-foreground"
              >
                <span
                  aria-hidden="true"
                  data-state={state}
                  className="tw:h-0.5 tw:rounded-full tw:bg-border-subtle tw:data-[state=current]:bg-primary tw:data-[state=done]:bg-muted-foreground"
                />
                <span className="tw:truncate">{t(item.label)}</span>
              </li>
            );
          })}
        </ol>
      </header>

      <div className="tw:h-0.5">
        {mutation ? (
          <ProgressBar value={null} density="compact" label={t(PROGRESS_LABELS[mutation])} />
        ) : null}
      </div>

      <div className="tw:grid tw:min-w-0 tw:content-start tw:gap-4 tw:p-4">
        <div className="tw:grid tw:min-w-0 tw:gap-1">
          <h5
            ref={stepHeading}
            tabIndex={-1}
            className="tw:m-0 tw:text-ui tw:font-semibold tw:text-foreground tw:outline-none"
          >
            {t(current.question)}
          </h5>
          <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t(current.description)}
          </p>
        </div>

        {step === 1 ? (
          <AccountStep flow={flow} integrations={integrations} onConnectAccount={onConnectAccount} />
        ) : step === 2 ? (
          <ResourceTargetStep flow={flow} onConnectAccount={onConnectAccount} />
        ) : (
          <ImportReviewStep flow={flow} accountName={accountName} />
        )}

        {error ? (
          <InlineNotice
            tone="danger"
            icon="alert"
            role="alert"
            action={error.reconnect ? (
              <Button size="compact" onClick={onConnectAccount}>
                {t("workspaceProviderDatabases.goToAccounts")}
              </Button>
            ) : undefined}
          >
            {error.message}
          </InlineNotice>
        ) : null}
      </div>

      <footer className="ds-control-row tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-t tw:border-border-subtle tw:px-4 tw:py-3">
        <Button size="compact" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          {step > 1 ? (
            <Button size="compact" disabled={busy} onClick={flow.back}>
              <Icon name="arrowLeft" />
              {t("workspaceProviderDatabases.back")}
            </Button>
          ) : null}
          {step < 3 ? (
            <Button
              size="compact"
              variant="primary"
              disabled={busy || !flow.canContinue}
              onClick={flow.next}
            >
              {t("workspaceProviderDatabases.continue")}
            </Button>
          ) : (
            <Button
              size="compact"
              variant={createIsPrimary ? "primary" : "default"}
              disabled={busy || !flow.canCreate}
              onClick={() => void flow.create()}
            >
              {t(mutation === "claim"
                ? "workspaceProviderDatabases.verifyingSelection"
                : mutation === "import"
                  ? "workspaceProviderDatabases.creating"
                  : "workspaceProviderDatabases.create")}
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}
