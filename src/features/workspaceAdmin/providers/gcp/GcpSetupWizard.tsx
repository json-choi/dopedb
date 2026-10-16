// Google Cloud SQL setup after the browser authorization: choose the project and
// instance (pinned during a repair), review only the approvals that target needs,
// then configure and save. Progress follows the real request phases, and the one
// primary command is either "configure" or, once the setup expired, "reconnect".
import { useEffect, useState } from "react";

import { Button } from "../../../../design-system/components/Button";
import { Field, SelectInput } from "../../../../design-system/components/FormControls";
import { ProgressBar } from "../../../../design-system/components/Progress";
import { SettingsSectionHeader } from "../../../../design-system/components/SettingsList";
import { InlineNotice } from "../../../../design-system/components/Status";
import { useI18n, type I18nKey, type Lang } from "../../../../lib/i18n";
import { databaseEngineLabel } from "../../../connections/domain";
import type { WorkspaceAdminScope } from "../../domain";
import { workspaceAdminErrorMessage } from "../../requests";
import GcpSetupApprovals from "./GcpSetupApprovals";
import type { GcpRepairTarget, GcpSetupSession } from "./gcpModel";
import { useGcpSetupWizard, type GcpSetupSaved, type GcpWizardPhase } from "./useGcpSetupWizard";

type StepState = "complete" | "current" | "waiting";

const STEP_STATE_LABELS: Record<StepState, I18nKey> = {
  complete: "workspaceProviders.gcpStepComplete",
  current: "workspaceProviders.gcpStepCurrent",
  waiting: "workspaceProviders.gcpStepWaiting",
};

const PROGRESS: Record<Exclude<GcpWizardPhase, "idle">, { title: I18nKey; body: I18nKey }> = {
  configuring: {
    title: "workspaceProviders.gcpConfiguringTitle",
    body: "workspaceProviders.gcpConfiguringDescription",
  },
  propagating: {
    title: "workspaceProviders.gcpIamPropagationTitle",
    body: "workspaceProviders.gcpIamPropagationDescription",
  },
  saving: {
    title: "workspaceProviders.gcpSavingTitle",
    body: "workspaceProviders.gcpSavingDescription",
  },
};

function SetupStep({ state, title }: { state: StepState; title: string }) {
  const { t } = useI18n();
  return (
    <li
      aria-current={state === "current" ? "step" : undefined}
      data-state={state}
      className="tw:group tw:grid tw:min-w-0 tw:gap-0.5 tw:border-r tw:border-border-subtle tw:px-3 tw:py-2 tw:text-foreground tw:last:border-r-0 tw:aria-[current=step]:bg-selection tw:aria-[current=step]:text-selection-foreground tw:@max-[640px]:border-r-0 tw:@max-[640px]:border-b tw:@max-[640px]:last:border-b-0"
    >
      <span className="tw:text-2xs tw:text-muted-foreground tw:group-data-[state=complete]:text-success tw:group-aria-[current=step]:text-selection-foreground">
        {t(STEP_STATE_LABELS[state])}
      </span>
      <strong className="tw:text-xs tw:font-medium">{title}</strong>
    </li>
  );
}

function useElapsedSeconds(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  return elapsed;
}

function formatTime(value: string, lang: Lang): string {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", { timeStyle: "short" })
      .format(new Date(time))
    : value;
}

export default function GcpSetupWizard({
  scope,
  session,
  repair,
  onCancel,
  onReconnect,
  onSaved,
  onBusyChange,
}: {
  scope: WorkspaceAdminScope;
  session: GcpSetupSession;
  repair: GcpRepairTarget | null;
  onCancel: () => void;
  onReconnect: () => void;
  onSaved: (saved: GcpSetupSaved) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { lang, t } = useI18n();
  const wizard = useGcpSetupWizard({ scope, session, repair, onSaved });
  const elapsed = useElapsedSeconds(wizard.busy);
  const { projects, instances, permissions } = wizard;

  useEffect(() => {
    onBusyChange(wizard.busy);
  }, [wizard.busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const title = t(repair ? "workspaceProviders.gcpRepairTitle" : "workspaceProviders.gcpTitle");
  const discoveryError = !wizard.sessionExpired
    ? instances.error ?? permissions.error ?? null
    : null;
  const progress = wizard.phase === "idle" ? null : PROGRESS[wizard.phase];
  const configureLabel = wizard.busy
    ? t("workspaceProviders.gcpConfiguringButton")
    : repair
      ? t("workspaceProviders.gcpRepairConfigure")
      : permissions.data?.missing.length
        ? t("workspaceProviders.gcpConfigureWithGrant")
        : wizard.instance?.production === "unknown"
          ? t("workspaceProviders.gcpConfigureWithClassification")
          : t("workspaceProviders.gcpConfigure");

  return (
    <section className="tw:grid tw:min-w-0 tw:gap-4" aria-label={title} data-primary-flow>
      <div className="tw:grid tw:gap-1">
        <SettingsSectionHeader
          title={title}
          trailing={(
            <Button size="compact" variant="ghost" disabled={wizard.busy} onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          )}
        />
        <p className="tw:m-0 tw:text-ui tw:leading-body tw:text-muted-foreground">
          {wizard.sessionExpired
            ? t("workspaceProviders.gcpReconnectDescription")
            : t(repair
              ? "workspaceProviders.gcpRepairDescription"
              : "workspaceProviders.gcpAccountDescription", { account: session.account })}
        </p>
        {!wizard.sessionExpired ? (
          <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
            {t("workspaceProviders.gcpExpiresAt", {
              time: formatTime(projects.data?.expiresAt ?? session.expiresAt, lang),
            })}
          </p>
        ) : null}
      </div>

      <ol
        className="tw:m-0 tw:grid tw:list-none tw:grid-cols-3 tw:border-y tw:border-border-subtle tw:p-0 tw:@max-[640px]:grid-cols-1"
        aria-label={t("workspaceProviders.gcpStepsLabel")}
      >
        <SetupStep
          state={wizard.sessionExpired ? "current" : "complete"}
          title={t("workspaceProviders.gcpStepAuthorize")}
        />
        <SetupStep
          state={wizard.sessionExpired ? "waiting" : wizard.busy ? "complete" : "current"}
          title={t("workspaceProviders.gcpStepTarget")}
        />
        <SetupStep
          state={wizard.busy ? "current" : "waiting"}
          title={t(repair ? "workspaceProviders.gcpStepRepair" : "workspaceProviders.gcpStepConfigure")}
        />
      </ol>

      {repair ? (
        <div className="tw:grid tw:min-w-0 tw:gap-1 tw:border-l-2 tw:border-border-strong tw:pl-3">
          <strong className="tw:text-xs tw:font-semibold tw:text-foreground">
            {t("workspaceProviders.gcpPinnedTitle")}
          </strong>
          <code className="tw:font-mono tw:text-xs tw:text-foreground tw:[overflow-wrap:anywhere]">
            {repair.resource.project} / {repair.resource.instance} / {repair.resource.database}
          </code>
          <span className="tw:text-xs tw:leading-body tw:text-muted-foreground">
            {t("workspaceProviders.gcpPinnedDescription")}
          </span>
        </div>
      ) : null}

      {wizard.repairTargetMissing ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          {t("workspaceProviders.gcpRepairTargetUnavailable")}
        </InlineNotice>
      ) : null}

      {wizard.sessionExpired ? (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={(
            <Button size="compact" variant="primary" onClick={onReconnect}>
              {t("workspaceProviders.gcpReconnect")}
            </Button>
          )}
        >
          <strong className="tw:block tw:font-semibold">{t("workspaceProviders.gcpExpiredTitle")}</strong>
          {t("workspaceProviders.gcpExpiredDescription")}
        </InlineNotice>
      ) : null}

      <div className="tw:grid tw:gap-1">
        <h3>{t("workspaceProviders.gcpTargetTitle")}</h3>
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("workspaceProviders.gcpTargetDescription")}
        </p>
      </div>

      <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[640px]:grid-cols-1">
        <Field label={t("workspaceProviders.gcpProject")}>
          {(binding) => (
            <SelectInput
              {...binding.controlProps()}
              disabled={!projects.data || wizard.busy || Boolean(repair) || wizard.sessionExpired}
              value={wizard.projectId}
              onChange={(event) => wizard.selectProject(event.target.value)}
            >
              <option value="">
                {projects.isLoading
                  ? t("workspaceProviders.gcpProjectsLoading")
                  : t("workspaceProviders.gcpChooseProject")}
              </option>
              {(projects.data?.projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name && project.name !== project.id
                    ? `${project.name} · ${project.id}`
                    : project.id}
                </option>
              ))}
              {repair && !wizard.project ? (
                <option value={repair.resource.project}>{repair.resource.project}</option>
              ) : null}
            </SelectInput>
          )}
        </Field>
        <Field label={t("workspaceProviders.gcpInstance")}>
          {(binding) => (
            <SelectInput
              {...binding.controlProps()}
              disabled={!instances.data || wizard.busy || Boolean(repair) || wizard.sessionExpired}
              value={wizard.instanceId}
              onChange={(event) => wizard.selectInstance(event.target.value)}
            >
              <option value="">
                {instances.isLoading
                  ? t("workspaceProviders.gcpInstancesLoading")
                  : t("workspaceProviders.gcpChooseInstance")}
              </option>
              {(instances.data?.instances ?? []).map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {`${instance.name} · ${databaseEngineLabel(instance.engine)} · ${instance.region}`}
                </option>
              ))}
              {repair && !wizard.instance ? (
                <option value={repair.resource.instance}>{repair.resource.instance}</option>
              ) : null}
            </SelectInput>
          )}
        </Field>
      </div>

      {projects.isError && !wizard.sessionExpired ? (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={(
            <Button
              size="compact"
              disabled={projects.isFetching}
              onClick={() => void projects.refetch()}
            >
              {t("workspaceAdmin.retry")}
            </Button>
          )}
        >
          {workspaceAdminErrorMessage(projects.error, { lang, t }, "workspaceProviders.gcpProjectsFailed")}
        </InlineNotice>
      ) : null}
      {discoveryError ? (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={(
            <Button
              size="compact"
              disabled={instances.isFetching || permissions.isFetching}
              onClick={() => {
                if (instances.isError) void instances.refetch();
                if (permissions.isError) void permissions.refetch();
              }}
            >
              {t("workspaceAdmin.retry")}
            </Button>
          )}
        >
          {workspaceAdminErrorMessage(
            discoveryError,
            { lang, t },
            instances.isError
              ? "workspaceProviders.gcpInstancesFailed"
              : "workspaceProviders.gcpPermissionsFailed",
          )}
        </InlineNotice>
      ) : null}
      {projects.data && projects.data.projects.length === 0 && !repair ? (
        <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
          {t("workspaceProviders.gcpProjectsEmpty")}
        </p>
      ) : null}
      {instances.data && instances.data.instances.length === 0 && !repair ? (
        <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
          {t("workspaceProviders.gcpInstancesEmpty")}
        </p>
      ) : null}

      <GcpSetupApprovals wizard={wizard} />

      <div className="tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3">
        {progress ? (
          <div className="tw:grid tw:gap-2" role="status">
            <div className="tw:flex tw:items-center tw:justify-between tw:gap-3">
              <strong className="tw:text-xs tw:font-semibold tw:text-foreground">{t(progress.title)}</strong>
              <span className="tw:shrink-0 tw:font-mono tw:text-2xs tw:tabular-nums tw:text-muted-foreground">
                {t("workspaceProviders.gcpElapsed", { seconds: elapsed })}
              </span>
            </div>
            <ProgressBar value={null} label={t(progress.title)} />
            <span className="tw:text-xs tw:leading-body tw:text-muted-foreground">{t(progress.body)}</span>
          </div>
        ) : null}
        {wizard.error ? (
          <InlineNotice tone="danger" icon="alert" role="alert">
            <strong className="tw:block tw:font-semibold">{t("workspaceProviders.gcpFailureTitle")}</strong>
            {wizard.error}
          </InlineNotice>
        ) : null}
        {!wizard.sessionExpired ? (
          <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
            <p className="tw:m-0 tw:max-w-[62ch] tw:text-xs tw:leading-body tw:text-muted-foreground">
              {t(repair
                ? "workspaceProviders.gcpRepairFinalDescription"
                : "workspaceProviders.gcpFinalDescription")}
            </p>
            <Button
              variant="primary"
              disabled={!wizard.approvalsComplete || wizard.busy}
              disabledBehavior={wizard.busy ? "focusable" : "native"}
              onClick={wizard.configure}
            >
              {configureLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
