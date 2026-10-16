// Closed label/tone projection for the Activity screen. Rust writers own the wire
// values (history status/origin, audit action, recorded identity); this module maps
// every known value to catalog copy and semantic tone, and never echoes a raw value.
import type { IconName } from "../../components/Icon";
import type { StatusTone } from "../../design-system/components/Status";
import type { I18nKey } from "../../lib/i18n";

export type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

export type ActivityStatusView = Readonly<{
  label: string;
  tone: StatusTone;
  icon: IconName;
  /** Explicit next step when the outcome needs a human check before rerunning. */
  detail: string | null;
}>;

export function queryKindLabel(t: Translate, kind: string) {
  if (kind === "read") return t("activity.kindRead");
  if (kind === "write") return t("activity.kindWrite");
  if (kind === "ddl") return t("activity.kindDdl");
  if (kind === "privilege") return t("activity.kindPrivilege");
  return t("activity.kindUnknown");
}

export function historyStatusView(t: Translate, status: string, kind: string): ActivityStatusView {
  if (status === "ok" || status === "success" || status === "done") {
    return { label: t("activity.statusSucceeded"), tone: "success", icon: "check", detail: null };
  }
  if (status === "error" || status === "failed") {
    return { label: t("activity.statusFailed"), tone: "danger", icon: "alert", detail: null };
  }
  if (status === "blocked") {
    return { label: t("activity.statusBlocked"), tone: "danger", icon: "circleSlash", detail: null };
  }
  if (status === "outcome_unknown") {
    return {
      label: t("activity.statusOutcomeUnknown"),
      tone: "warning",
      icon: "alert",
      detail: t("activity.statusVerifyDatabase"),
    };
  }
  if (status === "cancelled") {
    return {
      label: t("activity.statusCancelled"),
      tone: "warning",
      icon: "stop",
      detail: kind === "read"
        ? t("activity.statusCancelledRead")
        : t("activity.statusCancelledWrite"),
    };
  }
  if (status === "staged") {
    return {
      label: t("activity.statusStaged"),
      tone: "neutral",
      icon: "pause",
      detail: t("activity.statusStagedDetail"),
    };
  }
  return { label: t("activity.statusUnknown"), tone: "neutral", icon: "info", detail: null };
}

export function activityOriginLabel(t: Translate, origin: string) {
  if (origin === "manual") return t("activity.originManual");
  if (origin === "agent") return t("activity.originAgent");
  if (origin === "analysis_article") return t("activity.originAnalysisArticle");
  if (origin === "table_editor") return t("activity.originTableEditor");
  if (origin === "data-view" || origin === "data-view-count") return t("activity.originDataView");
  if (origin === "cli") return t("activity.originCli");
  return t("activity.originOther");
}

type AuditActionCopy = Readonly<{ key: I18nKey; tone: StatusTone }>;

const AUDIT_ACTIONS: Readonly<Record<string, AuditActionCopy>> = {
  propose: { key: "activity.actionPropose", tone: "neutral" },
  approve: { key: "activity.actionApprove", tone: "success" },
  reject: { key: "activity.actionReject", tone: "danger" },
  execute: { key: "activity.actionExecute", tone: "success" },
  "execute:attempt": { key: "activity.actionExecuteAttempt", tone: "neutral" },
  "execute:staged": { key: "activity.actionExecuteStaged", tone: "neutral" },
  blocked: { key: "activity.actionBlocked", tone: "danger" },
  error: { key: "activity.actionError", tone: "danger" },
  read: { key: "activity.actionRead", tone: "neutral" },
  "script:execute": { key: "activity.actionScriptExecute", tone: "neutral" },
  "script:execute:attempt": { key: "activity.actionScriptExecuteAttempt", tone: "neutral" },
  "analysis_article:run": { key: "activity.actionAnalysisRun", tone: "neutral" },
  "manual_transaction:commit": { key: "activity.actionTransactionCommit", tone: "success" },
  "manual_transaction:rollback": { key: "activity.actionTransactionRollback", tone: "neutral" },
  "manual_transaction:forced_rollback": {
    key: "activity.actionTransactionForcedRollback",
    tone: "warning",
  },
  "cli:plan_query": { key: "activity.actionCliPlan", tone: "neutral" },
  "cli:run_query": { key: "activity.actionCliRun", tone: "neutral" },
  "cli:run_document_query": { key: "activity.actionCliDocumentRun", tone: "neutral" },
  "monitoring:grant": { key: "activity.actionMonitoringGrant", tone: "neutral" },
  "monitoring:grant:attempt": { key: "activity.actionMonitoringGrantAttempt", tone: "neutral" },
  "monitoring:revoke": { key: "activity.actionMonitoringRevoke", tone: "neutral" },
  "monitoring:revoke:attempt": { key: "activity.actionMonitoringRevokeAttempt", tone: "neutral" },
  "monitoring:blocked": { key: "activity.actionMonitoringBlocked", tone: "danger" },
};

/** Cancelled and unknown outcomes keep a warning tone whatever surface wrote them. */
export function auditActionView(t: Translate, action: string) {
  const known = AUDIT_ACTIONS[action];
  if (known) return { label: t(known.key), tone: known.tone };
  if (action === "cancelled" || action.endsWith(":cancelled")) {
    return { label: t("activity.actionCancelled"), tone: "warning" as const };
  }
  if (action === "outcome_unknown" || action.endsWith(":outcome_unknown")) {
    return { label: t("activity.actionOutcomeUnknown"), tone: "warning" as const };
  }
  return { label: t("activity.actionOther"), tone: "neutral" as const };
}

/** The local single-user identity is a fixed wire token, not a display name. */
export function recordedIdentityLabel(t: Translate, identity: string) {
  return identity === "local-user" ? t("activity.actorLocalUser") : identity;
}

export function sqlFirstLine(sql: string, truncated: boolean) {
  const line = sql.trim().split("\n")[0] ?? "";
  return line.length > 120 || truncated ? `${line.slice(0, 120)}…` : line;
}
