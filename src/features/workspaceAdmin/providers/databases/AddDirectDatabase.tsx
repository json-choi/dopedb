// Inline three-step flow that registers one PostgreSQL or MySQL server as a shared
// workspace database whose members each receive their own DopeDB-created account.
// useDirectDatabaseSetup owns state and commands; this component lays out the steps
// inside the shared WizardFrame and maps the flow's closed failure to localized copy.
import { Icon } from "../../../../components/Icon";
import { Button } from "../../../../design-system/components/Button";
import { InlineNotice } from "../../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../../lib/i18n";
import { DIRECT_FAILURE_KEYS } from "../../../directAccess/messages";
import type { WorkspaceAdminScope } from "../../domain";
import DirectCredentialStep from "./DirectCredentialStep";
import DirectEndpointStep from "./DirectEndpointStep";
import DirectScopeStep from "./DirectScopeStep";
import {
  useDirectDatabaseSetup,
  type DirectFlowError,
  type RegisteredDirect,
} from "./useDirectDatabaseSetup";
import WizardFrame from "./WizardFrame";

const STEPS: readonly Readonly<{ label: I18nKey; question: I18nKey; description: I18nKey }>[] = [
  {
    label: "directAccess.add.stepEndpoint",
    question: "directAccess.add.endpointQuestion",
    description: "directAccess.add.endpointDescription",
  },
  {
    label: "directAccess.add.stepCredential",
    question: "directAccess.add.credentialQuestion",
    description: "directAccess.add.credentialDescription",
  },
  {
    label: "directAccess.add.stepScope",
    question: "directAccess.add.scopeQuestion",
    description: "directAccess.add.scopeDescription",
  },
];

function errorKey(error: DirectFlowError): I18nKey {
  if (error.code) return DIRECT_FAILURE_KEYS[error.code];
  return error.kind === "probe"
    ? "directAccess.add.probeError"
    : "directAccess.add.registerError";
}

export default function AddDirectDatabase({
  scope,
  onCancel,
  onRegistered,
  onBusyChange,
}: {
  scope: WorkspaceAdminScope;
  onCancel: () => void;
  onRegistered: (database: RegisteredDirect) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const flow = useDirectDatabaseSetup({ scope, onRegistered, onBusyChange });
  const { step, busy } = flow;
  const current = STEPS[step - 1];
  const progress: I18nKey | null = flow.registering
    ? "directAccess.add.registering"
    : flow.probing
      ? "directAccess.add.checking"
      : null;

  return (
    <WizardFrame
      title={t("directAccess.add.title")}
      description={t("directAccess.add.description")}
      stepsLabel={t("directAccess.add.stepsLabel")}
      stepProgress={t("workspaceProviderDatabases.stepProgress", {
        current: step,
        total: STEPS.length,
      })}
      stepLabels={STEPS.map((item) => t(item.label))}
      step={step}
      question={t(current.question)}
      questionDescription={t(current.description)}
      progressLabel={progress ? t(progress) : null}
      busy={busy}
      onCancel={onCancel}
      error={flow.error ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          {t(errorKey(flow.error))}
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
          {step === 3 ? (
            <Button
              size="compact"
              variant="primary"
              disabled={busy || !flow.canCreate}
              onClick={() => void flow.create()}
            >
              {t(flow.registering
                ? "workspaceProviderDatabases.creating"
                : "workspaceProviderDatabases.create")}
            </Button>
          ) : step === 2 && !flow.usable ? (
            <Button
              size="compact"
              variant="primary"
              disabled={busy || !flow.credentialValid}
              onClick={flow.check}
            >
              {t("directAccess.add.check")}
            </Button>
          ) : (
            <Button
              size="compact"
              variant="primary"
              disabled={busy || !flow.canContinue}
              onClick={flow.next}
            >
              {t("workspaceProviderDatabases.continue")}
            </Button>
          )}
        </>
      )}
    >
      {step === 1 ? (
        <DirectEndpointStep flow={flow} />
      ) : step === 2 ? (
        <DirectCredentialStep flow={flow} />
      ) : (
        <DirectScopeStep flow={flow} />
      )}
    </WizardFrame>
  );
}
