// Third step of the add-database flow: what will be registered (authorized account,
// pinned target, credential policy), the name shown in the workspace, Neon
// preparation when the provider needs it, and the explicit production approval.
import {
  CheckboxField,
  Field,
  TextInput,
} from "../../../../design-system/components/FormControls";
import { EnvironmentKindSelect } from "../../../../components/EnvironmentKindSelect";
import { InlineNotice } from "../../../../design-system/components/Status";
import { useI18n } from "../../../../lib/i18n";
import NeonBootstrapPanel from "./NeonBootstrapPanel";
import type { ManagedDatabaseImport } from "./useManagedDatabaseImport";
import { ReviewItem, ReviewList } from "./WizardFrame";

export default function ImportReviewStep({
  flow,
  accountName,
}: {
  flow: ManagedDatabaseImport;
  accountName: string;
}) {
  const { t } = useI18n();
  const { discovery, busy } = flow;

  return (
    <div className="tw:grid tw:min-w-0 tw:gap-4">
      <ReviewList>
        <ReviewItem term={t("workspaceProviderDatabases.reviewAccount")}>{accountName}</ReviewItem>
        <ReviewItem term={t("workspaceProviderDatabases.reviewTarget")} monospace>
          {discovery.targetPath}
        </ReviewItem>
        <ReviewItem term={t("workspaceProviderDatabases.reviewCredentials")}>
          {t("workspaceProviderDatabases.credentialDescription")}
        </ReviewItem>
      </ReviewList>

      <div className="tw:max-w-[480px]">
        <Field
          label={t("workspaceProviderDatabases.nameLabel")}
          validation={flow.nameIssue ? { tone: "danger", message: t(flow.nameIssue) } : undefined}
        >
          {(binding) => (
            <TextInput
              {...binding.controlProps()}
              density="compact"
              value={flow.name}
              maxLength={120}
              disabled={busy}
              onChange={(event) => flow.setName(event.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="tw:grid tw:max-w-[320px] tw:gap-1.5">
        <EnvironmentKindSelect
          label={t("connections.environment")}
          emptyLabel={flow.environment === null ? t("workspaceProviderDatabases.chooseEnvironment") : undefined}
          value={flow.environment}
          allowed={flow.environmentLocked ? ["production"] : undefined}
          disabled={busy || flow.neon.verified}
          onChange={flow.chooseEnvironment}
        />
        {flow.environmentLocked ? (
          <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
            {t("workspaceProviderDatabases.environmentLockedProduction")}
          </p>
        ) : null}
      </div>

      {discovery.isNeon ? <NeonBootstrapPanel flow={flow} /> : null}

      {flow.isProduction ? (
        <div className="tw:grid tw:min-w-0 tw:gap-2">
          <InlineNotice tone="danger" icon="alert">
            {t("workspaceProviderDatabases.productionNotice")}
          </InlineNotice>
          <CheckboxField
            checked={flow.productionApproved}
            disabled={busy}
            onChange={(event) => flow.setProductionApproved(event.target.checked)}
            label={t("workspaceProviderDatabases.productionApproval")}
          />
        </div>
      ) : null}
    </div>
  );
}
