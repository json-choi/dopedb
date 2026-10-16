// Third step of the add-database flow: what will be registered (authorized account,
// pinned target, credential policy), the name shown in the workspace, Neon
// preparation when the provider needs it, and the explicit production approval.
import type { ReactNode } from "react";
import {
  CheckboxField,
  Field,
  TextInput,
} from "../../../../design-system/components/FormControls";
import { InlineNotice } from "../../../../design-system/components/Status";
import { useI18n } from "../../../../lib/i18n";
import NeonBootstrapPanel from "./NeonBootstrapPanel";
import type { ManagedDatabaseImport } from "./useManagedDatabaseImport";

function ReviewItem({
  term,
  monospace = false,
  children,
}: {
  term: string;
  monospace?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="tw:border-b tw:border-border-subtle tw:py-2 tw:pr-3 tw:text-muted-foreground tw:@max-[520px]:border-b-0 tw:@max-[520px]:pb-0">
        {term}
      </dt>
      <dd
        data-monospace={monospace}
        className="tw:m-0 tw:min-w-0 tw:border-b tw:border-border-subtle tw:py-2 tw:text-foreground tw:[overflow-wrap:anywhere] tw:data-[monospace=true]:font-mono"
      >
        {children}
      </dd>
    </>
  );
}

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
      <dl className="tw:m-0 tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,160px)_minmax(0,1fr)] tw:border-t tw:border-border-subtle tw:text-sm tw:@max-[520px]:grid-cols-1">
        <ReviewItem term={t("workspaceProviderDatabases.reviewAccount")}>{accountName}</ReviewItem>
        <ReviewItem term={t("workspaceProviderDatabases.reviewTarget")} monospace>
          {discovery.targetPath}
        </ReviewItem>
        <ReviewItem term={t("workspaceProviderDatabases.reviewCredentials")}>
          {t("workspaceProviderDatabases.credentialDescription")}
        </ReviewItem>
      </dl>

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
