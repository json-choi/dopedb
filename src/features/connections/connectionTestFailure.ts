// Projects the closed native connection-test receipt into localized recovery copy
// and an optional editor focus target without inspecting driver message text.
import type { I18nKey } from "../../lib/i18n";
import { errDetails } from "../../ipc/types";

import type {
  ConnectionProfile,
  ConnectionTestFailure,
  ConnectionTestFailureCode,
  ConnectionTestIssue,
} from "./domain";
import type { ConnectionTab } from "./connectionEditorModel";

type Translate = (
  key: I18nKey,
  vars?: Record<string, string | number>,
) => string;

type ConnectionTestFailureContext = Pick<
  ConnectionProfile,
  "credentialMode" | "workspaceAccess"
>;

function isWorkspaceManaged(
  context?: ConnectionTestFailureContext,
): boolean {
  return context?.credentialMode === "managed"
    && context.workspaceAccess !== "local";
}

function isMemberLocalBinding(
  context?: ConnectionTestFailureContext,
): boolean {
  return context?.credentialMode === "memberLocal"
    && context.workspaceAccess !== "local";
}

/** Failures a member fixes in their own credential binding, not in the template. */
function isBindingFailure(code: ConnectionTestFailureCode): boolean {
  return code.startsWith("ssh") || code === "authentication" || code === "tls";
}

/** Discards backend detail before a connection-test failure enters React state. */
export function connectionTestIssue(
  failure: ConnectionTestFailure,
): ConnectionTestIssue {
  return failure.refusal
    ? { code: failure.code, field: failure.field, refusal: failure.refusal }
    : { code: failure.code, field: failure.field };
}

/** A local save refused because it would move the saved password elsewhere. */
export function connectionSaveNeedsPassword(error: unknown): boolean {
  return errDetails(error).kind === "credentialBindingRequired";
}

/** Stable copy for connection operations that fail before a typed test receipt. */
export function connectionOperationErrorTitle(
  t: Translate,
  error: unknown,
): string {
  switch (errDetails(error).kind) {
    case "sshClientMissing": return t("connections.testFailure.sshClientMissingTitle");
    case "sshConfiguration": return t("connections.testFailure.sshConfigurationTitle");
    case "sshHostKey": return t("connections.testFailure.sshHostKeyTitle");
    case "sshAuthentication": return t("connections.testFailure.sshAuthenticationTitle");
    case "sshForwarding": return t("connections.testFailure.sshForwardingTitle");
    case "sshTimeout": return t("connections.testFailure.sshTimeoutTitle");
    case "sshUnknown": return t("connections.testFailure.sshUnknownTitle");
    case "connectionNetwork": return t("connections.testFailure.timeoutNetworkTitle");
    case "connectionTls": return t("connections.testFailure.tlsTitle");
    case "connectionAuthentication": return t("connections.testFailure.authenticationTitle");
    case "connectionConfiguration": return t("connections.testFailure.databaseConfigTitle");
    case "connectionUnknown": return t("connections.testFailure.unknownTitle");
    case "keychain": return t("sql.credentialStoreDenied.title");
    case "cancelled": return t("connections.catalogIssue.cancelled");
    default: return t("connections.testFailure.unknownTitle");
  }
}

/** The save step that failed; a Project binding runs only after the profile saved. */
export type ConnectionSavePhase = "profile" | "projectBinding";

/**
 * Stable copy for a failed save. Saving does not probe the database, so a failed
 * save never reads as a failed connection check; only typed connection
 * categories reuse their check titles.
 */
export function connectionSaveFailureMessage(
  t: Translate,
  error: unknown,
  phase: ConnectionSavePhase,
): string {
  if (phase === "projectBinding") {
    return t("connections.saveFailure.projectBinding");
  }
  const kind = errDetails(error).kind ?? "";
  switch (kind) {
    case "credentialBindingRequired":
      return t("connections.testFailure.savedCredentialEndpointChangedTitle");
    case "keychain":
      return t("connections.saveFailure.credentialStore");
    case "config":
    case "parse":
    case "serialization":
      return t("connections.saveFailure.configuration");
    case "blocked":
    case "safety":
      return t("connections.saveFailure.blocked");
    case "notFound":
      return t("connections.saveFailure.notFound");
    case "network":
    case "timeout":
      return t("connections.saveFailure.workspaceUnavailable");
    default:
      return kind.startsWith("ssh") || kind.startsWith("connection")
        ? connectionOperationErrorTitle(t, error)
        : t("connections.saveFailure.unknown");
  }
}

/** Stable copy for a failed delete of a local or shared connection. */
export function connectionDeleteFailureMessage(
  t: Translate,
  error: unknown,
): string {
  switch (errDetails(error).kind) {
    case "blocked":
    case "safety":
      return t("connections.deleteFailure.blocked");
    case "network":
    case "timeout":
      return t("connections.saveFailure.workspaceUnavailable");
    default:
      return t("connections.deleteFailure.unknown");
  }
}

export function connectionTestFailureTitle(
  t: Translate,
  code: ConnectionTestFailureCode,
  context?: ConnectionTestFailureContext,
): string {
  if (isWorkspaceManaged(context)) {
    return t("connections.testFailure.managedTitle");
  }
  switch (code) {
    case "sshClientMissing": return t("connections.testFailure.sshClientMissingTitle");
    case "sshConfiguration": return t("connections.testFailure.sshConfigurationTitle");
    case "sshHostKey": return t("connections.testFailure.sshHostKeyTitle");
    case "sshAuthentication": return t("connections.testFailure.sshAuthenticationTitle");
    case "sshForwarding": return t("connections.testFailure.sshForwardingTitle");
    case "sshTimeout": return t("connections.testFailure.sshTimeoutTitle");
    case "sshUnknown": return t("connections.testFailure.sshUnknownTitle");
    case "timeoutNetwork": return t("connections.testFailure.timeoutNetworkTitle");
    case "authentication": return t("connections.testFailure.authenticationTitle");
    case "tls": return t("connections.testFailure.tlsTitle");
    case "databaseConfig": return t("connections.testFailure.databaseConfigTitle");
    case "unknown": return t("connections.testFailure.unknownTitle");
  }
}

export function connectionTestFailureRecovery(
  t: Translate,
  code: ConnectionTestFailureCode,
  context?: ConnectionTestFailureContext,
  options?: { usedSavedCredential?: boolean },
): string {
  if (isWorkspaceManaged(context)) {
    return context?.workspaceAccess === "manage"
      ? t("connections.testFailure.managedManagerRecovery")
      : t("connections.testFailure.managedMemberRecovery");
  }
  if (isMemberLocalBinding(context) && isBindingFailure(code)) {
    return t("connections.testFailure.memberBindingRecovery");
  }
  if (code === "authentication" && options?.usedSavedCredential) {
    return t("connections.testFailure.savedCredentialRecovery");
  }
  switch (code) {
    case "sshClientMissing": return t("connections.testFailure.sshClientMissingRecovery");
    case "sshConfiguration": return t("connections.testFailure.sshConfigurationRecovery");
    case "sshHostKey": return t("connections.testFailure.sshHostKeyRecovery");
    case "sshAuthentication": return t("connections.testFailure.sshAuthenticationRecovery");
    case "sshForwarding": return t("connections.testFailure.sshForwardingRecovery");
    case "sshTimeout": return t("connections.testFailure.sshTimeoutRecovery");
    case "sshUnknown": return t("connections.testFailure.sshUnknownRecovery");
    case "timeoutNetwork": return t("connections.testFailure.timeoutNetworkRecovery");
    case "authentication": return t("connections.testFailure.authenticationRecovery");
    case "tls": return t("connections.testFailure.tlsRecovery");
    case "databaseConfig": return t("connections.testFailure.databaseConfigRecovery");
    case "unknown": return t("connections.testFailure.unknownRecovery");
  }
}

/**
 * Title for one check outcome. A refusal made before connecting has its own copy,
 * except a cooldown, which keeps its network-family title.
 */
export function connectionTestIssueTitle(
  t: Translate,
  issue: ConnectionTestIssue,
  context?: ConnectionTestFailureContext,
): string {
  switch (issue.refusal) {
    case "savedCredentialEndpointChanged":
      return t("connections.testFailure.savedCredentialEndpointChangedTitle");
    case "sharedConnectionChanged":
      return t("connections.testFailure.sharedConnectionChangedTitle");
    case "workspaceSignInRequired":
      return t("connections.testFailure.workspaceSignInRequiredTitle");
    case "credentialStoreDenied":
      return t("sql.credentialStoreDenied.title");
    case "lockTimeout":
      return t("connections.testFailure.lockTimeoutTitle");
    default:
      return connectionTestFailureTitle(t, issue.code, context);
  }
}

/** `retrySeconds` is the live remainder of a cooldown; 0 once a check may run. */
export function connectionTestIssueRecovery(
  t: Translate,
  issue: ConnectionTestIssue,
  context?: ConnectionTestFailureContext,
  options?: { usedSavedCredential?: boolean; retrySeconds?: number },
): string {
  switch (issue.refusal) {
    case "savedCredentialEndpointChanged":
      return t("connections.testFailure.savedCredentialEndpointChangedRecovery");
    case "sharedConnectionChanged":
      return t("connections.testFailure.sharedConnectionChangedRecovery");
    case "workspaceSignInRequired":
      return t("connections.testFailure.workspaceSignInRequiredRecovery");
    case "credentialStoreDenied":
      return t("connections.testFailure.credentialStoreDeniedRecovery");
    case "lockTimeout":
      return t("connections.testFailure.lockTimeoutRecovery");
    case "retryLater":
      return options?.retrySeconds
        ? t("schema.connectionRetryAfter", { seconds: options.retrySeconds })
        : t("schema.connectionRetryLater");
    default:
      return connectionTestFailureRecovery(t, issue.code, context, options);
  }
}

/**
 * A shared member-local connection keeps its username, password, SSH alias, and
 * TLS files in the member's binding, which the template tabs never edit. Those
 * failures open the binding dialog instead of a tab with unsaved template fields.
 */
export function connectionTestFailureOpensBinding(
  failure: ConnectionTestIssue,
  context: Pick<ConnectionProfile, "credentialMode" | "engine" | "workspaceAccess">,
): boolean {
  return isMemberLocalBinding(context)
    && context.workspaceAccess !== "view"
    && context.engine !== "bigquery"
    && (isBindingFailure(failure.code)
      || failure.field === "credentials"
      || failure.field === "ssh"
      || failure.field === "tls");
}

export function connectionTestFailureTarget(
  failure: ConnectionTestIssue,
  context?: ConnectionTestFailureContext,
): { tab: ConnectionTab; fieldId: string } | null {
  if (isWorkspaceManaged(context) || isMemberLocalBinding(context)) return null;
  if (failure.code.startsWith("ssh") || failure.field === "ssh") {
    return { tab: "sshSsl", fieldId: "connection-ssh-alias" };
  }
  if (failure.field === "credentials") {
    return { tab: "general", fieldId: "connection-password" };
  }
  if (failure.field === "database") {
    return { tab: "general", fieldId: "connection-database" };
  }
  if (failure.field === "tls") {
    return { tab: "sshSsl", fieldId: "connection-tls-control" };
  }
  return null;
}
