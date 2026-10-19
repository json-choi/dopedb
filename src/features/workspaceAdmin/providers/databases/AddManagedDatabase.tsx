// Inline three-step flow that registers one provider database as a shared workspace
// connection. useManagedDatabaseImport owns state and commands; this component lays
// out the step list, the account step and the flow's actions inside the shared
// WizardFrame.
import { Icon } from "../../../../components/Icon";
import { Button } from "../../../../design-system/components/Button";
import { Field, SelectInput } from "../../../../design-system/components/FormControls";
import { InlineNotice } from "../../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../../lib/i18n";
import type { WorkspaceAdminScope } from "../../domain";
import type { Integration, Provider } from "../domain";
import ImportReviewStep from "./ImportReviewStep";
import ResourceTargetStep from "./ResourceTargetStep";
import WizardFrame from "./WizardFrame";
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

  return (
    <WizardFrame
      title={t("workspaceProviderDatabases.wizardTitle")}
      description={t("workspaceProviderDatabases.wizardDescription")}
      stepsLabel={t("workspaceProviderDatabases.stepsLabel")}
      stepProgress={t("workspaceProviderDatabases.stepProgress", {
        current: step,
        total: STEPS.length,
      })}
      stepLabels={STEPS.map((item) => t(item.label))}
      step={step}
      question={t(current.question)}
      questionDescription={t(current.description)}
      progressLabel={mutation ? t(PROGRESS_LABELS[mutation]) : null}
      busy={busy}
      onCancel={onCancel}
      error={error ? (
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
      actions={(
        <>
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
        </>
      )}
    >
      {step === 1 ? (
        <AccountStep flow={flow} integrations={integrations} onConnectAccount={onConnectAccount} />
      ) : step === 2 ? (
        <ResourceTargetStep flow={flow} onConnectAccount={onConnectAccount} />
      ) : (
        <ImportReviewStep flow={flow} accountName={accountName} />
      )}
    </WizardFrame>
  );
}
