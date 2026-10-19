// Second step of the direct-connection flow: the administrator credential and the
// preflight result it earns. The credential stays on this device (OS keychain) and is
// used only for setup, grants and cleanup; the report shows the server version, whether
// accounts can be created and each namespace's grantability, or one closed failure.
import { Field, TextInput } from "../../../../design-system/components/FormControls";
import { InlineNotice, LoadingLabel, StatusBadge } from "../../../../design-system/components/Status";
import { useI18n } from "../../../../lib/i18n";
import type { DirectPreflightReport } from "../../../directAccess/domain";
import { DIRECT_FAILURE_KEYS } from "../../../directAccess/messages";
import { ReviewItem, ReviewList } from "./WizardFrame";
import type { DirectDatabaseSetup } from "./useDirectDatabaseSetup";

function PreflightReportView({ report }: { report: DirectPreflightReport }) {
  const { t } = useI18n();
  if (report.failureCode) {
    return (
      <InlineNotice tone="danger" icon="alert" role="alert">
        {t(DIRECT_FAILURE_KEYS[report.failureCode])}
      </InlineNotice>
    );
  }
  const grantable = report.namespaces.filter((namespace) => namespace.grantable);
  const publicCreate = report.namespaces.filter((namespace) => namespace.publicCreate);
  return (
    <div className="tw:grid tw:min-w-0 tw:gap-3">
      <ReviewList>
        <ReviewItem term={t("directAccess.add.reportVersion")}>
          <span className="tw:inline-flex tw:flex-wrap tw:items-center tw:gap-2">
            {report.serverVersion ?? "—"}
            <StatusBadge tone={report.versionSupported ? "success" : "danger"}>
              {t(report.versionSupported
                ? "directAccess.add.reportSupported"
                : "directAccess.add.reportUnsupported")}
            </StatusBadge>
          </span>
        </ReviewItem>
        <ReviewItem term={t("directAccess.add.reportCreate")}>
          <StatusBadge tone={report.canCreatePrincipal ? "success" : "danger"}>
            {t(report.canCreatePrincipal
              ? "directAccess.add.reportCanCreate"
              : "directAccess.add.reportCannotCreate")}
          </StatusBadge>
        </ReviewItem>
        <ReviewItem term={t("directAccess.add.reportNamespaces")}>
          {t("directAccess.add.reportGrantable", {
            grantable: grantable.length,
            total: report.namespaces.length,
          })}
        </ReviewItem>
      </ReviewList>
      {report.warnings.includes("grantor_insufficient") ? (
        <InlineNotice tone="warning" icon="alert">
          {t("directAccess.add.warningGrantor")}
        </InlineNotice>
      ) : null}
      {report.warnings.includes("public_create") ? (
        <InlineNotice tone="warning" icon="alert">
          {t("directAccess.add.warningPublicCreate", {
            names: publicCreate.map((namespace) => namespace.name).join(", "),
          })}
        </InlineNotice>
      ) : null}
      {grantable.length === 0 && report.canCreatePrincipal && report.versionSupported ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          {t("directAccess.add.noGrantable")}
        </InlineNotice>
      ) : null}
    </div>
  );
}

export default function DirectCredentialStep({ flow }: { flow: DirectDatabaseSetup }) {
  const { t } = useI18n();
  const { credential, busy } = flow;
  return (
    <div className="tw:grid tw:min-w-0 tw:gap-3">
      <div className="tw:grid tw:min-w-0 tw:grid-cols-2 tw:items-start tw:gap-3 tw:@max-[640px]:grid-cols-1">
        <Field label={t("directAccess.add.adminUser")}>
          {(binding) => (
            <TextInput
              {...binding.controlProps()}
              density="compact"
              value={credential.username}
              maxLength={1024}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => flow.setCredential({ username: event.target.value })}
            />
          )}
        </Field>
        <Field label={t("directAccess.add.adminPassword")}>
          {(binding) => (
            <TextInput
              {...binding.controlProps()}
              density="compact"
              type="password"
              value={credential.password}
              maxLength={1024}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => flow.setCredential({ password: event.target.value })}
            />
          )}
        </Field>
      </div>
      <p className="tw:m-0 tw:max-w-[680px] tw:text-xs tw:leading-body tw:text-muted-foreground">
        {t("directAccess.add.adminHint")}
      </p>
      {flow.probing ? (
        <span className="tw:text-sm">
          <LoadingLabel>{t("directAccess.add.checking")}</LoadingLabel>
        </span>
      ) : flow.checked && flow.report ? (
        <PreflightReportView report={flow.report} />
      ) : null}
    </div>
  );
}
