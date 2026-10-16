// Safe-run journey for the project's newest isolated branch: checkpoint, isolate, run
// and inspect, then return and discard. The phase is projected from durable server
// state by the controller; this view only offers the next plan the journey allows.
import { useId } from "react";
import { Button } from "../../../../design-system/components/Button";
import { InlineNotice, StatusBadge } from "../../../../design-system/components/Status";
import { useI18n } from "../../../../lib/i18n";
import {
  neonSafeRunDescriptionKey,
  neonSafeRunPhaseKey,
  neonSafeRunStepStateKey,
  neonSafeRunSteps,
  neonSafeRunTone,
} from "./model";
import { neonSafeRunStepState } from "./safeRun";
import type { NeonBranchController } from "./useNeonBranchManager";

export default function NeonSafeRunTracker({ controller }: { controller: NeonBranchController }) {
  const { t } = useI18n();
  const titleId = useId();
  const { safeRun, safeRunActions, busy, pending } = controller;
  if (!safeRun) return null;
  const phase = safeRun.phase;
  const branchName = safeRun.branch?.name ?? safeRun.createOperation.plan.target.name;
  const sourceName = safeRun.sourceBranch?.name ?? safeRun.createOperation.plan.source.name;
  const error = controller.errorFor("safeRun");

  return (
    <section
      data-primary-flow
      aria-labelledby={titleId}
      className="tw:grid tw:min-w-0 tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3"
    >
      <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:@max-[520px]:flex-col">
        <div className="tw:grid tw:min-w-0 tw:gap-1">
          <h4 id={titleId} className="tw:m-0 tw:truncate tw:text-ui tw:font-semibold tw:text-foreground">
            {t("workspaceNeonBranches.safeRun.title", { branch: branchName })}
          </h4>
          <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t(neonSafeRunDescriptionKey[phase])}
          </p>
        </div>
        <StatusBadge tone={neonSafeRunTone(phase)}>{t(neonSafeRunPhaseKey[phase])}</StatusBadge>
      </div>

      <ol
        aria-label={t("workspaceNeonBranches.safeRun.aria")}
        className="tw:m-0 tw:grid tw:list-none tw:grid-cols-4 tw:gap-2 tw:p-0 tw:@max-[520px]:grid-cols-2"
      >
        {neonSafeRunSteps.map((step, index) => {
          const state = neonSafeRunStepState(phase, index + 1);
          return (
            <li
              key={step}
              data-state={state}
              aria-current={state === "active" ? "step" : undefined}
              className="tw:grid tw:min-w-0 tw:gap-1 tw:border-t-2 tw:border-border-subtle tw:pt-2 tw:text-muted-foreground tw:data-[state=active]:border-info tw:data-[state=active]:text-foreground tw:data-[state=complete]:border-success"
            >
              <span className="tw:font-mono tw:text-2xs tw:uppercase tw:tracking-[0.05em] tw:text-muted-foreground">
                {String(index + 1).padStart(2, "0")} · {t(neonSafeRunStepStateKey[state])}
              </span>
              <span className="tw:truncate tw:text-sm tw:font-medium">{t(step)}</span>
            </li>
          );
        })}
      </ol>

      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
        <p className="tw:m-0 tw:min-w-0 tw:truncate tw:font-mono tw:text-xs tw:text-muted-foreground">
          {sourceName} → {branchName}
          {safeRun.activeConnection ? ` · ${safeRun.activeConnection.connectionName}` : ""}
        </p>
        <div className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:gap-[var(--ds-control-gap)]">
          {phase === "ready_to_isolate" && !safeRunActions.canIsolate ? (
            <Button size="compact" disabled={busy} onClick={controller.selectSafeRunConnection}>
              {t("workspaceNeonBranches.safeRun.selectConnection")}
            </Button>
          ) : null}
          {phase === "ready_to_isolate" && safeRunActions.canIsolate ? (
            <Button size="compact" variant="primary" disabled={busy} onClick={controller.planIsolation}>
              {t(pending?.kind === "isolatePlan"
                ? "workspaceNeonBranches.planning"
                : "workspaceNeonBranches.safeRun.isolationPlan")}
            </Button>
          ) : null}
          {phase === "isolated_active" && safeRunActions.canReturn ? (
            <Button size="compact" variant="primary" disabled={busy} onClick={controller.planReturn}>
              {t(pending?.kind === "returnPlan"
                ? "workspaceNeonBranches.planning"
                : "workspaceNeonBranches.safeRun.returnPlan")}
            </Button>
          ) : null}
          {phase === "ready_to_discard" && safeRun.branch?.deletion?.canPlan ? (
            <Button size="compact" tone="danger" disabled={busy} onClick={controller.planDiscard}>
              {t(pending?.kind === "discardPlan"
                ? "workspaceNeonBranches.planning"
                : "workspaceNeonBranches.safeRun.discardPlan")}
            </Button>
          ) : null}
        </div>
      </div>

      {phase === "isolated_active" && !safeRun.switchedFromSource ? (
        <InlineNotice tone="warning" icon="alert">
          {t("workspaceNeonBranches.safeRun.standaloneNotice")}
        </InlineNotice>
      ) : null}
      {error ? (
        <InlineNotice tone="danger" icon="alert" role="alert">{error}</InlineNotice>
      ) : null}
    </section>
  );
}
