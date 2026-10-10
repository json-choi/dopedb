// Maps Analysis Article command failures to catalog copy by closed error kind.
// Backend and control-plane text never becomes the message; only a database's own
// diagnostic is kept, as optional detail the person can expand. A run precondition
// failure also says what changed and names the one recovery step this person can
// take, or whom to ask when their role cannot take it.
import type { I18nKey } from "../../lib/i18n";
import type { EnvironmentConnection } from "../knowledge/domain";
import type { AnalysisArticleRecord } from "./domain";

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

/**
 * Connect this device's credential, re-check the shared connection pin, reconfirm a
 * stale Environment binding, or edit the Article so it pins a current database.
 */
export type AnalysisRecovery =
  | "connectCredentials"
  | "recheckConnection"
  | "reconfirmBinding"
  | "editArticle";

/** What no longer matches between the Article's pin and this Environment. */
export type AnalysisRunPinIssue =
  | Readonly<{ kind: "unbound" }>
  | Readonly<{ kind: "bindingStale"; binding: EnvironmentConnection }>
  | Readonly<{ kind: "pinOutdated"; binding: EnvironmentConnection }>
  | Readonly<{ kind: "unavailable"; binding: EnvironmentConnection }>;

/** Mirrors the Desktop runner's pin preconditions, in the order a fix applies them. */
export function analysisRunPinIssue(
  article: Pick<AnalysisArticleRecord, "connectionRevision">,
  binding: EnvironmentConnection | null,
  mirroredOnDevice: boolean,
): AnalysisRunPinIssue | null {
  if (!binding) return { kind: "unbound" };
  if (binding.stale) return { kind: "bindingStale", binding };
  if (binding.connectionContentRevision !== article.connectionRevision) {
    return { kind: "pinOutdated", binding };
  }
  if (!binding.connectionId || !mirroredOnDevice) return { kind: "unavailable", binding };
  return null;
}

/**
 * Says what changed. Until the person re-checks, the step is a re-check because the
 * cache may be behind; afterwards it is the real fix for their role, or a request
 * to the role that has it.
 */
export function analysisPinFailure(
  t: Translate,
  issue: AnalysisRunPinIssue,
  article: Pick<AnalysisArticleRecord, "connectionRevision">,
  access: Readonly<{ rechecked: boolean; canWrite: boolean; canManage: boolean }>,
): AnalysisFailure {
  const name = issue.kind === "unbound" ? "" : issue.binding.alias || issue.binding.connectionName;
  const [message, fix, ask]: [string, AnalysisRecovery | null, I18nKey] =
    issue.kind === "unbound"
      ? [t("analysis.pinUnbound"), access.canWrite ? "editArticle" : null, "analysis.askEditor"]
      : issue.kind === "bindingStale"
        ? [
            t("analysis.pinBindingStale", {
              name,
              from: issue.binding.connectionRevision,
              to: issue.binding.currentConnectionRevision,
            }),
            access.canManage && issue.binding.connectionId ? "reconfirmBinding" : null,
            "analysis.askAdminReconfirm",
          ]
        : issue.kind === "pinOutdated"
          ? [
              t("analysis.pinContentChanged", {
                name,
                pinned: article.connectionRevision,
                current: issue.binding.connectionContentRevision,
              }),
              access.canWrite ? "editArticle" : null,
              "analysis.askEditor",
            ]
          : [t("analysis.pinUnavailable", { name }), null, "analysis.askAdminAccess"];
  if (!access.rechecked) return { message, detail: null, recovery: "recheckConnection" };
  return fix
    ? { message, detail: null, recovery: fix }
    : { message: `${message} ${t(ask)}`, detail: null };
}

export type AnalysisFailure = Readonly<{
  message: string;
  detail: string | null;
  recovery?: AnalysisRecovery;
}>;

function errorShape(error: unknown) {
  if (error && typeof error === "object" && "kind" in error) {
    const { kind, message } = error as { kind?: unknown; message?: unknown };
    return {
      kind: typeof kind === "string" ? kind : null,
      message: typeof message === "string" ? message : null,
    };
  }
  return { kind: null, message: null };
}

export function analysisFailure(t: Translate, error: unknown): AnalysisFailure {
  const { kind, message } = errorShape(error);
  if (kind?.startsWith("ssh") || kind?.startsWith("connection")) {
    return { message: t("analysis.errorConnection"), detail: null };
  }
  switch (kind) {
    case "network":
      return { message: t("analysis.errorService"), detail: null };
    case "blocked":
    case "sqlPolicyBlocked":
      return { message: t("analysis.errorPermission"), detail: null };
    case "notFound":
      return { message: t("analysis.errorNotFound"), detail: null };
    case "config":
      return { message: t("analysis.errorInvalid"), detail: null };
    case "timeout":
      return { message: t("analysis.errorTimeout"), detail: null };
    case "credentialBindingRequired":
      return {
        message: t("analysis.errorCredentialBinding"),
        detail: null,
        recovery: "connectCredentials",
      };
    case "sharedConnectionChanged":
      return {
        message: t("analysis.errorConnectionChanged"),
        detail: null,
        recovery: "recheckConnection",
      };
    case "authenticationRequired":
    case "managedConnectionRecoveryRequired":
      return { message: t("analysis.errorCredential"), detail: null };
    case "safety":
    case "cancelled":
      return { message: t("analysis.errorStopped"), detail: null };
    case "outcomeUnknown":
      return { message: t("analysis.errorOutcomeUnknown"), detail: null };
    case "db":
      return { message: t("analysis.errorDatabase"), detail: message };
    default:
      return { message: t("analysis.errorGeneric"), detail: null };
  }
}
