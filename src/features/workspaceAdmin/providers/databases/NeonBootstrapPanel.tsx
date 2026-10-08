// Review-step section that prepares Neon least-privilege access before import:
// branch environment, the no-change preflight report and its findings, explicit
// approvals, and apply/verify. State and commands come from useNeonBootstrap.
import { useId } from "react";
import { Icon } from "../../../../components/Icon";
import { Button } from "../../../../design-system/components/Button";
import {
  CheckboxField,
  Field,
  SelectInput,
} from "../../../../design-system/components/FormControls";
import { StatusBadge, type StatusTone } from "../../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../../lib/i18n";
import type {
  NeonBootstrapFinding,
  NeonBootstrapReport,
  NeonEnvironmentClassification,
} from "../domain";
import { neonFindingDescription, neonFindingValue } from "./serverMessages";
import type { ManagedDatabaseImport } from "./useManagedDatabaseImport";

const FINDING_TONES: Record<NeonBootstrapFinding["level"], StatusTone> = {
  blocker: "danger",
  change: "warning",
  verified: "success",
};

const FINDING_LABELS: Record<NeonBootstrapFinding["level"], I18nKey> = {
  blocker: "workspaceProviderDatabases.findingBlocker",
  change: "workspaceProviderDatabases.findingChange",
  verified: "workspaceProviderDatabases.findingVerified",
};

const REPORT_TITLES: Record<NeonBootstrapReport["status"], I18nKey> = {
  blocked: "workspaceProviderDatabases.blockedTitle",
  approvalRequired: "workspaceProviderDatabases.approvalTitle",
  readyToApply: "workspaceProviderDatabases.readyTitle",
};

function environmentChoice(value: string): NeonEnvironmentClassification {
  return value === "development" || value === "production" ? value : "";
}

export default function NeonBootstrapPanel({ flow }: { flow: ManagedDatabaseImport }) {
  const { t } = useI18n();
  const headingId = useId();
  const { neon, discovery, busy, mutation } = flow;
  const { report } = neon;
  const branch = discovery.branch;
  const unclassified = branch?.production !== true && branch?.production !== false;

  return (
    <section aria-labelledby={headingId} className="tw:grid tw:min-w-0 tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3">
      <div className="tw:grid tw:gap-1">
        <h6 id={headingId} className="tw:m-0 tw:text-ui tw:font-semibold tw:text-foreground">
          {t("workspaceProviderDatabases.neonTitle")}
        </h6>
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("workspaceProviderDatabases.neonDescription")}
        </p>
      </div>

      {unclassified ? (
        <div className="tw:max-w-[320px]">
          <Field label={t("workspaceProviderDatabases.branchEnvironment")}>
            <SelectInput
              density="compact"
              value={neon.classification}
              disabled={busy || neon.verified}
              onChange={(event) => neon.classify(environmentChoice(event.target.value))}
            >
              <option value="">{t("workspaceProviderDatabases.chooseEnvironment")}</option>
              <option value="development">{t("workspaceProviderDatabases.environmentDevelopment")}</option>
              <option value="production">{t("workspaceProviderDatabases.environmentProduction")}</option>
            </SelectInput>
          </Field>
        </div>
      ) : (
        <p
          data-production={branch?.production === true}
          className="tw:m-0 tw:border-l-2 tw:border-border-strong tw:pl-3 tw:text-sm tw:leading-body tw:text-muted-foreground tw:data-[production=true]:border-danger tw:data-[production=true]:text-danger"
        >
          {t(branch?.production === true
            ? "workspaceProviderDatabases.protectedBranch"
            : "workspaceProviderDatabases.developmentBranch")}
        </p>
      )}

      {!report ? (
        <div className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
          <p className="tw:m-0 tw:min-w-0 tw:flex-1 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t("workspaceProviderDatabases.preflightDescription")}
          </p>
          <Button
            size="compact"
            variant="primary"
            disabled={busy || !neon.environment}
            onClick={() => void neon.preflight()}
          >
            {t(mutation === "neonPreflight"
              ? "workspaceProviderDatabases.preflighting"
              : "workspaceProviderDatabases.preflight")}
          </Button>
        </div>
      ) : (
        <>
          <div
            data-status={report.status}
            className="tw:grid tw:gap-0.5 tw:border-l-2 tw:border-border-strong tw:pl-3 tw:data-[status=approvalRequired]:border-warning tw:data-[status=blocked]:border-danger tw:data-[status=readyToApply]:border-success"
          >
            <strong className="tw:text-ui tw:font-semibold tw:text-foreground">
              {t(REPORT_TITLES[report.status])}
            </strong>
            <span className="tw:text-sm tw:leading-body tw:text-muted-foreground">
              {t(report.canRollback
                ? "workspaceProviderDatabases.rollback"
                : "workspaceProviderDatabases.noRollback")}
            </span>
          </div>

          <ul
            aria-label={t("workspaceProviderDatabases.findingsLabel")}
            className="tw:m-0 tw:grid tw:list-none tw:divide-y tw:divide-border-subtle tw:border-y tw:border-border-subtle tw:p-0"
          >
            {report.findings.map((finding, index) => (
              <li key={`${finding.code}:${finding.target}:${index}`} className="tw:grid tw:min-w-0 tw:gap-1.5 tw:py-2">
                <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
                  <StatusBadge tone={FINDING_TONES[finding.level]} density="compact">
                    {t(FINDING_LABELS[finding.level])}
                  </StatusBadge>
                  {finding.requiresApproval === "publicAcl" ? (
                    <StatusBadge tone="warning" density="compact">
                      {t("workspaceProviderDatabases.findingNeedsApproval")}
                    </StatusBadge>
                  ) : null}
                  <code className="tw:ml-auto tw:min-w-0 tw:truncate tw:font-mono tw:text-2xs tw:text-muted-foreground">
                    {finding.code}
                  </code>
                </div>
                <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-foreground">
                  {neonFindingDescription(finding, t)}
                </p>
                <p className="tw:m-0 tw:font-mono tw:text-2xs tw:text-muted-foreground tw:[overflow-wrap:anywhere]">
                  {neonFindingValue(finding.target, t)}
                </p>
                <p className="tw:m-0 tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] tw:items-center tw:gap-2 tw:text-2xs tw:@max-[520px]:grid-cols-1">
                  <span className="tw:min-w-0 tw:text-muted-foreground tw:[overflow-wrap:anywhere]">
                    <span className="tw:sr-only">{t("workspaceProviderDatabases.findingBefore")}: </span>
                    {neonFindingValue(finding.before, t)}
                  </span>
                  <Icon
                    name="arrowRight"
                    aria-hidden="true"
                    className="tw:text-muted-foreground tw:@max-[520px]:hidden"
                  />
                  <span className="tw:min-w-0 tw:text-foreground tw:[overflow-wrap:anywhere]">
                    <span className="tw:sr-only">{t("workspaceProviderDatabases.findingAfter")}: </span>
                    {neonFindingValue(finding.after, t)}
                  </span>
                </p>
              </li>
            ))}
          </ul>

          {report.requiresPublicAclApproval ? (
            <CheckboxField
              checked={neon.publicAclApproved}
              disabled={busy || neon.verified}
              onChange={(event) => neon.setPublicAclApproved(event.target.checked)}
              label={
                <span className="tw:grid tw:gap-0.5">
                  <span>{t("workspaceProviderDatabases.publicApproval")}</span>
                  <span className="tw:text-xs tw:leading-body tw:text-muted-foreground">
                    {t("workspaceProviderDatabases.publicApprovalDescription")}
                  </span>
                </span>
              }
            />
          ) : null}
          {report.requiresProductionApproval ? (
            <CheckboxField
              checked={neon.productionApproved}
              disabled={busy || neon.verified}
              onChange={(event) => neon.setProductionApproved(event.target.checked)}
              label={
                <span className="tw:grid tw:gap-0.5">
                  <span className="tw:text-danger">
                    {t("workspaceProviderDatabases.productionChangeApproval")}
                  </span>
                  <span className="tw:text-xs tw:leading-body tw:text-muted-foreground">
                    {t("workspaceProviderDatabases.productionChangeApprovalDescription")}
                  </span>
                </span>
              }
            />
          ) : null}

          {neon.verified ? (
            <p role="status" className="tw:m-0 tw:border-l-2 tw:border-success tw:pl-3 tw:text-sm tw:leading-body tw:text-foreground">
              {t("workspaceProviderDatabases.neonVerified")}
            </p>
          ) : (
            <div className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
              <Button size="compact" disabled={busy} onClick={() => void neon.preflight()}>
                {t(mutation === "neonPreflight"
                  ? "workspaceProviderDatabases.preflighting"
                  : "workspaceProviderDatabases.recheck")}
              </Button>
              <Button
                size="compact"
                variant="primary"
                disabled={busy || !neon.canApply}
                onClick={() => void neon.apply()}
              >
                {t(mutation === "neonApply"
                  ? "workspaceProviderDatabases.applying"
                  : "workspaceProviderDatabases.apply")}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
