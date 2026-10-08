// Approval and execution history for one Neon project. Each row shows the plan, its
// risk and approval policy, the provider state, and only the decisions and executions
// the server says this administrator may perform now. Approving or running a discard
// or a connection switch goes through a blocking confirmation.
import { useId } from "react";
import ConfirmButton from "../../../../components/ConfirmButton";
import { Icon } from "../../../../components/Icon";
import { Button } from "../../../../design-system/components/Button";
import { InlineNotice, LoadingLabel, StatusBadge } from "../../../../design-system/components/Status";
import { useI18n } from "../../../../lib/i18n";
import { neonOperationBusy, type NeonBranchOperation } from "./domain";
import {
  formatNeonTime,
  neonExecuteLabelKey,
  neonOperationStateKey,
  neonOperationTone,
  neonWarningKey,
} from "./model";
import type { NeonBranchController } from "./useNeonBranchManager";

type Translate = ReturnType<typeof useI18n>["t"];

export default function NeonOperationHistory({ controller }: { controller: NeonBranchController }) {
  const { t } = useI18n();
  const titleId = useId();
  const { operations, operationsPhase, operationsError } = controller;
  const loaded = operationsPhase === "loaded" || operationsPhase === "staleError";

  return (
    <section
      aria-labelledby={titleId}
      className="tw:grid tw:min-w-0 tw:gap-2 tw:border-t tw:border-border-subtle tw:pt-3"
    >
      <div className="tw:flex tw:items-end tw:justify-between tw:gap-3">
        <div className="tw:grid tw:min-w-0 tw:gap-1">
          <h4 id={titleId} className="tw:m-0 tw:text-ui tw:font-semibold tw:text-foreground">
            {t("workspaceNeonBranches.historyTitle")}
          </h4>
          <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t("workspaceNeonBranches.historyDescription")}
          </p>
        </div>
        {loaded ? (
          <span className="tw:shrink-0 tw:text-2xs tw:text-muted-foreground">
            {t("workspaceNeonBranches.historyCount", { count: operations.length })}
          </span>
        ) : null}
      </div>
      {operationsPhase === "coldLoading" ? (
        <p className="tw:m-0 tw:py-2 tw:text-sm">
          <LoadingLabel>{t("workspaceNeonBranches.loadingOperations")}</LoadingLabel>
        </p>
      ) : null}
      {operationsError ? (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={(
            <Button
              size="compact"
              disabled={controller.busy || controller.refreshing}
              onClick={controller.refresh}
            >
              {t("workspaceAdmin.retry")}
            </Button>
          )}
        >
          {operationsError}
        </InlineNotice>
      ) : null}
      {loaded && operations.length > 0 ? (
        <ul className="tw:m-0 tw:grid tw:list-none tw:divide-y tw:divide-border-subtle tw:border-y tw:border-border-subtle tw:p-0">
          {operations.map((operation) => (
            <NeonOperationRow key={operation.id} operation={operation} controller={controller} />
          ))}
        </ul>
      ) : null}
      {loaded && operations.length === 0 ? (
        <p className="tw:m-0 tw:border-y tw:border-border-subtle tw:py-5 tw:text-center tw:text-sm tw:text-muted-foreground">
          {t("workspaceNeonBranches.historyEmpty")}
        </p>
      ) : null}
    </section>
  );
}

function operationTitle(operation: NeonBranchOperation, t: Translate) {
  const plan = operation.plan;
  if (plan.kind === "neon.branch.delete") {
    return t("workspaceNeonBranches.operationDeleteTitle", { name: plan.target.name });
  }
  if (plan.kind === "neon.branch.switch") {
    return `${plan.source.connectionName} · ${plan.source.name} → ${plan.target.name}`;
  }
  return `${plan.source.name} → ${plan.target.name}`;
}

function operationSummary(operation: NeonBranchOperation, t: Translate) {
  const plan = operation.plan;
  if (plan.kind === "neon.branch.delete") {
    return t("workspaceNeonBranches.operationDeleteSummary", {
      endpoints: plan.references.endpointIds.length,
    });
  }
  if (plan.kind === "neon.branch.switch") {
    return t("workspaceNeonBranches.operationSwitchSummary", {
      database: plan.source.database,
      leases: plan.impact.activeLeaseCount,
    });
  }
  const scope = t(plan.target.initSource === "schema-only"
    ? "workspaceNeonBranches.schemaOnly"
    : "workspaceNeonBranches.dataAndSchema");
  const endpoint = t(plan.target.endpoint === "read_write"
    ? "workspaceNeonBranches.endpointIncluded"
    : "workspaceNeonBranches.checkpoint");
  return `${scope} · ${endpoint}`;
}

/** Approving a discard or a switch authorizes a destructive provider change. */
function approvalConfirmation(operation: NeonBranchOperation, t: Translate): string | null {
  const plan = operation.plan;
  if (plan.kind === "neon.branch.delete") {
    return t("workspaceNeonBranches.confirmApproveDelete", { name: plan.target.name });
  }
  if (plan.kind === "neon.branch.switch") {
    return t("workspaceNeonBranches.confirmApproveSwitch", {
      connection: plan.source.connectionName,
      branch: plan.target.name,
    });
  }
  return null;
}

/** Starting a discard or a switch is confirmed; continuing a started one is not. */
function executionConfirmation(operation: NeonBranchOperation, t: Translate): string | null {
  const plan = operation.plan;
  if (neonOperationBusy(operation)) return null;
  if (plan.kind === "neon.branch.delete") {
    return t("workspaceNeonBranches.confirmExecuteDelete", { name: plan.target.name });
  }
  if (plan.kind === "neon.branch.switch") {
    return t("workspaceNeonBranches.confirmExecuteSwitch", {
      connection: plan.source.connectionName,
      branch: plan.target.name,
      count: plan.impact.activeLeaseCount,
    });
  }
  return null;
}

function NeonOperationRow({
  operation,
  controller,
}: {
  operation: NeonBranchOperation;
  controller: NeonBranchController;
}) {
  const { t, lang } = useI18n();
  const { busy, pending } = controller;
  const plan = operation.plan;
  const pendingHere = pending && "operationId" in pending && pending.operationId === operation.id
    ? pending.kind
    : null;
  const error = controller.errorFor(`operation:${operation.id}`);
  const tone = plan.kind === "neon.branch.delete" ? "danger" : "neutral";
  const working = t("common.working");
  const approveLabel = t("workspaceNeonBranches.approve");
  const executeLabel = t(neonExecuteLabelKey(operation));
  const approveConfirmation = approvalConfirmation(operation, t);
  const executeConfirmation = executionConfirmation(operation, t);
  const decisionOpen = operation.state === "awaiting_approval" || operation.state === "approved";
  const approve = () => controller.decide(operation, "approved");
  const execute = () => controller.execute(operation);

  return (
    <li className="tw:grid tw:min-w-0 tw:gap-2 tw:py-3">
      <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:@max-[520px]:flex-col">
        <div className="tw:grid tw:min-w-0 tw:gap-0.5">
          <strong className="tw:truncate tw:text-ui tw:font-medium tw:text-foreground">
            {operationTitle(operation, t)}
          </strong>
          <span className="tw:text-xs tw:leading-body tw:text-muted-foreground">
            {operationSummary(operation, t)}
          </span>
          <span className="tw:text-2xs tw:text-muted-foreground">
            {t("workspaceNeonBranches.plannedAt", { time: formatNeonTime(plan.issuedAt, lang) })}
            {decisionOpen
              ? ` · ${operation.expired
                ? t("workspaceNeonBranches.planExpired")
                : t("workspaceNeonBranches.planExpires", {
                  time: formatNeonTime(operation.planExpiresAt, lang),
                })}`
              : ""}
          </span>
        </div>
        <div className="tw:flex tw:shrink-0 tw:flex-wrap tw:items-center tw:gap-1 tw:@max-[520px]:shrink">
          {operation.risk === "production_data" ? (
            <StatusBadge tone="warning">{t("workspaceNeonBranches.riskProduction")}</StatusBadge>
          ) : null}
          {operation.approvalPolicy === "separate_admin" ? (
            <StatusBadge>{t("workspaceNeonBranches.approvalSeparate")}</StatusBadge>
          ) : null}
          <StatusBadge tone={neonOperationTone(operation.state)}>
            {t(neonOperationStateKey(operation))}
          </StatusBadge>
        </div>
      </div>

      {plan.warningCodes.length > 0 ? (
        <ul className="tw:m-0 tw:grid tw:list-none tw:gap-1 tw:p-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {plan.warningCodes.map((code) => {
            const key = neonWarningKey(code);
            return (
              <li key={code} className="tw:flex tw:min-w-0 tw:items-start tw:gap-1.5">
                <Icon name="alert" className="tw:mt-0.5 tw:shrink-0 tw:text-warning" />
                <span className="tw:min-w-0">
                  {key ? t(key) : <code className="tw:font-mono">{code}</code>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {operation.approvalPolicy === "separate_admin"
        && operation.requestedByCurrentActor
        && operation.state === "awaiting_approval" ? (
          <InlineNotice tone="warning" icon="user">{t("workspaceNeonBranches.separateApproval")}</InlineNotice>
        ) : null}
      {plan.kind === "neon.branch.create" && operation.managedAccessState === "bootstrap_required" ? (
        <InlineNotice tone="warning" icon="shield">{t("workspaceNeonBranches.bootstrapRequired")}</InlineNotice>
      ) : null}
      {operation.failureCode ? (
        <p className="tw:m-0 tw:text-xs tw:text-danger">
          {t("workspaceNeonBranches.failureCode")}{" "}
          <code className="tw:font-mono">{operation.failureCode}</code>
        </p>
      ) : null}
      {error ? <InlineNotice tone="danger" icon="alert" role="alert">{error}</InlineNotice> : null}

      {operation.canApprove || operation.canReject || operation.canExecute ? (
        <div className="ds-control-row tw:flex tw:flex-wrap tw:justify-end tw:gap-[var(--ds-control-gap)]">
          {operation.canReject ? (
            <Button
              size="compact"
              disabled={busy}
              onClick={() => controller.decide(operation, "rejected")}
            >
              {pendingHere === "reject" ? working : t("workspaceNeonBranches.reject")}
            </Button>
          ) : null}
          {operation.canApprove && approveConfirmation ? (
            <ConfirmButton
              size="compact"
              tone={tone}
              disabled={busy}
              label={approveLabel}
              confirmLabel={approveConfirmation}
              onConfirm={approve}
            >
              {pendingHere === "approve" ? working : approveLabel}
            </ConfirmButton>
          ) : null}
          {operation.canApprove && !approveConfirmation ? (
            <Button size="compact" disabled={busy} onClick={approve}>
              {pendingHere === "approve" ? working : approveLabel}
            </Button>
          ) : null}
          {operation.canExecute && executeConfirmation ? (
            <ConfirmButton
              size="compact"
              tone={tone}
              disabled={busy}
              label={executeLabel}
              confirmLabel={executeConfirmation}
              onConfirm={execute}
            >
              {pendingHere === "execute" ? working : executeLabel}
            </ConfirmButton>
          ) : null}
          {operation.canExecute && !executeConfirmation ? (
            <Button size="compact" disabled={busy} onClick={execute}>
              {pendingHere === "execute" ? working : executeLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
