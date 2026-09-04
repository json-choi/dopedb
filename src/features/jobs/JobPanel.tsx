// Connection-scoped import/export control surface. Workflow effects stay in the
// controller; the plan form and this shell project one accessible view.
import type { ReactNode } from "react";

import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { ProgressBar } from "../../design-system/components/Progress";
import { StatusDot } from "../../design-system/components/Status";
import { InspectorHeader } from "../../design-system/components/Workbench";
import { errMessage, type CatalogRelationV2 } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { JobPlanForm } from "./JobPlanForm";
import {
  formatJobBytes,
  jobProgress,
  JOB_STATE_KEYS,
  jobStateTone,
} from "./jobPanelPresentation";
import { useJobPanelController } from "./useJobPanelController";

function JobFacts({ children }: { children: ReactNode }) {
  return (
    <dl className="tw:m-0 tw:grid tw:gap-0 tw:[&>div]:grid tw:[&>div]:grid-cols-[minmax(72px,0.4fr)_minmax(0,1fr)] tw:[&>div]:gap-2 tw:[&>div]:border-b tw:[&>div]:border-border-subtle tw:[&>div]:py-1 tw:[&_dd]:m-0 tw:[&_dd]:min-w-0 tw:[&_dd]:break-words tw:[&_dd]:text-right tw:[&_dt]:text-xs tw:[&_dt]:text-muted-foreground">
      {children}
    </dl>
  );
}

export default function JobPanel({
  connectionId,
  relation,
  onClose,
}: {
  connectionId: string;
  relation: CatalogRelationV2;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const controller = useJobPanelController({ connectionId, relation });
  const { model, commands } = controller;
  const {
    approval,
    busy,
    busyJobId,
    canSubmit,
    detail,
    error,
    jobs,
    relationName,
  } = model;

  return (
    <aside
      className="grid-panel tw:flex tw:w-[clamp(320px,32vw,480px)] tw:max-w-[44%] tw:shrink-0 tw:flex-col tw:overflow-hidden tw:rounded-none tw:border-0 tw:border-l tw:border-border-subtle tw:bg-card tw:p-0 tw:shadow-none tw:@max-[920px]:max-h-[42%] tw:@max-[920px]:w-auto tw:@max-[920px]:max-w-none tw:@max-[760px]:max-h-[44%]"
      aria-label={t("jobs.title")}
    >
      <div className="tw:shrink-0 tw:border-b tw:border-border-subtle tw:px-3 tw:pt-3">
        <InspectorHeader
          title={t("jobs.title")}
          metadata={
            <span className="tw:overflow-hidden tw:text-xs tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap">
              {relationName}
            </span>
          }
          actions={
            <Button
              iconOnly
              onClick={onClose}
              size="xs"
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <Icon name="close" />
            </Button>
          }
        />
      </div>

      <div className="scrollbar-sleek tw:grid tw:min-h-0 tw:flex-1 tw:content-start tw:gap-3 tw:overflow-y-auto tw:overscroll-contain tw:p-3">
        <JobPlanForm controller={controller} />

        {approval && (
          <section
            className="tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3"
            aria-label={t("jobs.approval")}
          >
            <InspectorHeader
              title={t("jobs.reviewImport")}
              metadata={
                <span className="tw:font-mono tw:text-xs tw:text-muted-foreground">
                  {approval.job.format.toUpperCase()}
                </span>
              }
            />
            <JobFacts>
              <div>
                <dt>{t("jobs.source")}</dt>
                <dd>{approval.job.sourceSummary}</dd>
              </div>
              <div>
                <dt>{t("jobs.destination")}</dt>
                <dd>{approval.job.targetSummary}</dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd title={approval.payloadHash}>
                  <code>{approval.payloadHash.slice(0, 16)}…</code>
                </dd>
              </div>
            </JobFacts>
          </section>
        )}

        {error && <div className="tw:text-ui tw:text-danger">{error}</div>}

        <section
          className="tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3"
          aria-label={t("jobs.history")}
        >
          <InspectorHeader
            title={t("jobs.history")}
            actions={
              <Button
                disabled={jobs.isFetching}
                iconOnly
                onClick={() => void jobs.refetch()}
                size="compact"
                title={t("common.refresh")}
                aria-label={t("common.refresh")}
              >
                <Icon name="refresh" />
              </Button>
            }
          />
          {jobs.isPending ? (
            <div className="tw:py-4 tw:text-center tw:text-sm tw:text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : jobs.error ? (
            <div className="tw:text-ui tw:text-danger">
              {errMessage(jobs.error)}
            </div>
          ) : jobs.data?.length ? (
            <div className="tw:grid">
              {jobs.data.map((job) => {
                const percent = jobProgress(job);
                const jobBusy = busyJobId === job.id;
                return (
                  <div
                    className="tw:grid tw:min-w-0 tw:gap-1 tw:border-t tw:border-border-subtle tw:py-2"
                    key={job.id}
                  >
                    <button
                      className="tw:flex tw:w-full tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit tw:active:translate-y-px tw:disabled:cursor-default tw:disabled:opacity-50"
                      disabled={jobBusy}
                      onClick={() => void commands.openJob(job)}
                    >
                      <StatusDot tone={jobStateTone(job.state)} />
                      <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-0.5">
                        <strong className="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                          {job.kind === "export"
                            ? job.targetSummary
                            : job.sourceSummary}
                        </strong>
                        <small className="tw:overflow-hidden tw:font-mono tw:text-xs tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap">
                          {job.kind === "export"
                            ? t("jobs.export")
                            : t("jobs.import")} {" "}
                          · {job.format.toUpperCase()} · {t(JOB_STATE_KEYS[job.state])}
                        </small>
                      </span>
                      <span className="tw:font-mono tw:text-xs tw:text-muted-foreground">
                        {job.rowsProcessed.toLocaleString()}
                      </span>
                    </button>
                    {percent != null && (
                      <ProgressBar
                        density="compact"
                        value={percent}
                        label={`${percent.toFixed(0)}%`}
                      />
                    )}
                    <div className="ds-control-row tw:flex tw:justify-end tw:gap-1">
                      {(job.state === "queued" || job.state === "paused") && (
                        <Button
                          size="compact"
                          disabled={jobBusy}
                          onClick={() =>
                            job.kind === "import" && job.state === "queued"
                              ? void commands.openJob(job)
                              : void commands.mutateJob(job, "start")
                          }
                        >
                          <Icon name="play" />
                          {job.kind === "import" && job.state === "queued"
                            ? t("jobs.review")
                            : job.state === "paused"
                              ? t("jobs.resume")
                              : t("jobs.start")}
                        </Button>
                      )}
                      {job.state === "running" && job.resumable && (
                        <Button
                          size="compact"
                          disabled={jobBusy}
                          onClick={() => void commands.mutateJob(job, "pause")}
                        >
                          <Icon name="pause" />
                          {t("jobs.pause")}
                        </Button>
                      )}
                      {![
                        "cancel_requested",
                        "cancelled",
                        "succeeded",
                        "failed",
                      ].includes(job.state) && (
                        <Button
                          size="compact"
                          disabled={jobBusy}
                          onClick={() => void commands.mutateJob(job, "cancel")}
                        >
                          <Icon name="close" />
                          {t("common.cancel")}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="tw:py-4 tw:text-center tw:text-sm tw:text-muted-foreground">
              {t("jobs.empty")}
            </div>
          )}
        </section>

        {detail && (
          <section className="tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3">
            <InspectorHeader
              title={t("jobs.details")}
              actions={
                <Button
                  iconOnly
                  onClick={commands.closeDetail}
                  size="xs"
                  title={t("common.close")}
                  aria-label={t("common.close")}
                >
                  <Icon name="close" />
                </Button>
              }
            />
            <JobFacts>
              <div>
                <dt>{t("jobs.status")}</dt>
                <dd>{t(JOB_STATE_KEYS[detail.job.state])}</dd>
              </div>
              <div>
                <dt>{t("jobs.rows")}</dt>
                <dd>{detail.job.rowsProcessed.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{t("jobs.bytes")}</dt>
                <dd>{formatJobBytes(detail.job.bytesProcessed)}</dd>
              </div>
            </JobFacts>
            {detail.job.redactedError && (
              <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-xs tw:leading-[1.45] tw:text-warning tw:[&_.icon]:mt-0.5 tw:[&_.icon]:shrink-0">
                <Icon name="alert" />
                {detail.job.redactedError}
              </p>
            )}
            {detail.artifacts.map((artifact) => (
              <Button
                presentation="menuItem"
                size="compact"
                key={artifact.id}
                onClick={() => void commands.revealArtifact(artifact.id)}
              >
                <Icon name="folder" />
                <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                  {artifact.displayName}
                </span>
                <small className="tw:text-muted-foreground">
                  {formatJobBytes(artifact.sizeBytes)}
                </small>
              </Button>
            ))}
          </section>
        )}
      </div>
      <div className="ds-action-row ds-control-row tw:shrink-0 tw:border-t tw:border-border-subtle tw:bg-card tw:p-3">
        {approval ? (
          <>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void commands.approveAndStart()}
            >
              {t("jobs.approveAndStart")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void commands.cancelApproval()}
            >
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={() => void commands.submit()}
          >
            {busy ? t("common.loading") : t("jobs.create")}
          </Button>
        )}
      </div>
    </aside>
  );
}
