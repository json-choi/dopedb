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

/** Discards backend detail before a connection-test failure enters React state. */
export function connectionTestIssue(
  failure: ConnectionTestFailure,
): ConnectionTestIssue {
  return { code: failure.code, field: failure.field };
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
    case "cancelled": return t("connections.catalogIssue.cancelled");
    default: return t("connections.testFailure.unknownTitle");
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
): string {
  if (isWorkspaceManaged(context)) {
    return context?.workspaceAccess === "manage"
      ? t("connections.testFailure.managedManagerRecovery")
      : t("connections.testFailure.managedMemberRecovery");
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

export function connectionTestFailureTarget(
  failure: ConnectionTestIssue,
  context?: ConnectionTestFailureContext,
): { tab: ConnectionTab; fieldId: string } | null {
  if (isWorkspaceManaged(context)) return null;
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
