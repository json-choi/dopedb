// Neon connects with an API key rather than a browser sign-in. The key lives only
// in this dialog's state, is sent once to the workspace service (which verifies it
// and stores it sealed server-side), and is cleared on success or cancel. It never
// enters the query cache, the mutation cache, or storage on this device.
import { useId, useState } from "react";

import { Field, TextInput } from "../../../../design-system/components/FormControls";
import { InlineNotice } from "../../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../../lib/i18n";
import type { WorkspaceAdminScope } from "../../domain";
import { runWorkspaceAdmin } from "../../requests";
import { emptyNeon, type NeonConfiguration } from "../domain";
import { hasNeonFormIssues, neonFormIssues } from "./accountModel";
import ExternalGuideButton from "./ExternalGuideButton";
import ProviderConnectDialogFrame from "./ProviderConnectDialogFrame";
import { providerErrorMessage } from "./providerErrors";

const NEON_API_KEY_GUIDE = "https://neon.com/docs/manage/api-keys";

const GUIDE_STEPS: ReadonlyArray<{ title: I18nKey; path: I18nKey; body: I18nKey }> = [
  {
    title: "workspaceProviders.neonGuideOrganizationTitle",
    path: "workspaceProviders.neonGuideOrganizationPath",
    body: "workspaceProviders.neonGuideOrganizationBody",
  },
  {
    title: "workspaceProviders.neonGuideKeyTitle",
    path: "workspaceProviders.neonGuideKeyPath",
    body: "workspaceProviders.neonGuideKeyBody",
  },
  {
    title: "workspaceProviders.neonGuideProjectTitle",
    path: "workspaceProviders.neonGuideProjectPath",
    body: "workspaceProviders.neonGuideProjectBody",
  },
];

export default function NeonConnectDialog({
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
  const [form, setForm] = useState<NeonConfiguration>(emptyNeon);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = neonFormIssues(form);
  const showIssues = attempted && !submitting;

  const update = (field: keyof NeonConfiguration, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  async function submit() {
    setAttempted(true);
    if (hasNeonFormIssues(issues)) return;
    setSubmitting(true);
    setError(null);
    try {
      await runWorkspaceAdmin(scope.accountId, {
        kind: "connectNeon",
        workspaceId: scope.workspaceId,
        apiKey: form.apiKey.trim(),
        projectId: form.projectId.trim() || null,
        organizationId: form.organizationId.trim() || null,
      });
      setForm(emptyNeon);
      onConnected();
    } catch (cause) {
      setError(providerErrorMessage(cause, { lang, t }, "workspaceProviders.neonConnectFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function cancel() {
    if (submitting) return;
    setForm(emptyNeon);
    onCancel();
  }

  return (
    <ProviderConnectDialogFrame
      titleId={titleId}
      title={t(mode === "reconnect"
        ? "workspaceProviders.neonReconnectTitle"
        : "workspaceProviders.neonTitle")}
      submitLabel={t("workspaceProviders.verifyConnect")}
      submitting={submitting}
      onCancel={cancel}
      onSubmit={() => void submit()}
    >
      <div className="tw:grid tw:gap-2">
        <p className="tw:m-0 tw:text-ui tw:leading-body tw:text-foreground">
          {t("workspaceProviders.neonIntro")}
        </p>
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("workspaceProviders.neonKeyStorage")}
        </p>
      </div>
      <details className="tw:border-y tw:border-border-subtle tw:py-2">
        <summary className="tw:cursor-pointer tw:text-ui tw:font-medium tw:text-foreground">
          {t("workspaceProviders.neonGuideTitle")}
        </summary>
        <div className="tw:mt-3 tw:grid tw:gap-3">
          <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
            {t("workspaceProviders.neonGuideDescription")}
          </p>
          <ol className="tw:m-0 tw:grid tw:gap-3 tw:pl-5 tw:text-xs tw:leading-body tw:text-muted-foreground">
            {GUIDE_STEPS.map((step) => (
              <li key={step.title} className="tw:pl-1">
                <strong className="tw:block tw:text-ui tw:font-medium tw:text-foreground">
                  {t(step.title)}
                </strong>
                <code className="tw:block tw:font-mono tw:text-xs tw:text-foreground">
                  {t(step.path)}
                </code>
                <span className="tw:block">{t(step.body)}</span>
              </li>
            ))}
          </ol>
          <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
            <strong className="tw:block tw:text-ui tw:font-medium tw:text-foreground">
              {t("workspaceProviders.neonGuidePersonalTitle")}
            </strong>
            <code className="tw:block tw:font-mono tw:text-xs tw:text-foreground">
              {t("workspaceProviders.neonGuidePersonalPath")}
            </code>
            {t("workspaceProviders.neonGuidePersonalBody")}
          </p>
          <div>
            <ExternalGuideButton href={NEON_API_KEY_GUIDE}>
              {t("workspaceProviders.neonGuideOpen")}
            </ExternalGuideButton>
          </div>
        </div>
      </details>
      <InlineNotice tone="warning" icon="alert">
        {t("workspaceProviders.neonGuideCaution")}
      </InlineNotice>
      <Field
        label={t("workspaceProviders.neonApiKey")}
        validation={showIssues && issues.apiKey
          ? { tone: "danger", message: t("workspaceProviders.neonApiKeyInvalid") }
          : undefined}
      >
        {(binding) => (
          <TextInput
            {...binding.controlProps()}
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            data-modal-initial-focus
            disabled={submitting}
            placeholder={t("workspaceProviders.neonApiKeyPlaceholder")}
            value={form.apiKey}
            onChange={(event) => update("apiKey", event.target.value)}
          />
        )}
      </Field>
      <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[520px]:grid-cols-1">
        <Field
          label={t("workspaceProviders.neonProjectId")}
          validation={showIssues && issues.projectId
            ? { tone: "danger", message: t("workspaceProviders.neonIdentifierInvalid") }
            : undefined}
        >
          {(binding) => (
            <TextInput
              {...binding.controlProps()}
              autoComplete="off"
              spellCheck={false}
              monospace
              disabled={submitting}
              placeholder={t("workspaceProviders.neonProjectIdPlaceholder")}
              value={form.projectId}
              onChange={(event) => update("projectId", event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("workspaceProviders.neonOrganizationId")}
          validation={showIssues && issues.organizationId
            ? { tone: "danger", message: t("workspaceProviders.neonIdentifierInvalid") }
            : undefined}
        >
          {(binding) => (
            <TextInput
              {...binding.controlProps()}
              autoComplete="off"
              spellCheck={false}
              monospace
              disabled={submitting}
              placeholder={t("workspaceProviders.neonOrganizationIdPlaceholder")}
              value={form.organizationId}
              onChange={(event) => update("organizationId", event.target.value)}
            />
          )}
        </Field>
      </div>
      {error ? (
        <p className="tw:m-0 tw:text-ui tw:leading-body tw:text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </ProviderConnectDialogFrame>
  );
}
