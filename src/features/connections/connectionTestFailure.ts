// Projects the closed native connection-test receipt into localized recovery copy
// and an optional editor focus target without inspecting driver message text.
import type { I18nKey } from "../../lib/i18n";

import type {
  ConnectionProfile,
  ConnectionTestFailure,
  ConnectionTestFailureCode,
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

export function connectionTestFailureTitle(
  t: Translate,
  code: ConnectionTestFailureCode,
  context?: ConnectionTestFailureContext,
): string {
  if (isWorkspaceManaged(context)) {
    return t("connections.testFailure.managedTitle");
  }
  switch (code) {
    case "timeoutNetwork": return t("connections.testFailure.timeoutNetworkTitle");
    case "authentication": return t("connections.testFailure.authenticationTitle");
    case "tls": return t("connections.testFailure.tlsTitle");
    case "databaseConfig": return t("connections.testFailure.databaseConfigTitle");
    case "sshLaunch": return t("connections.testFailure.sshLaunchTitle");
    case "sshHost": return t("connections.testFailure.sshHostTitle");
    case "sshAuthentication": return t("connections.testFailure.sshAuthenticationTitle");
    case "sshHostKey": return t("connections.testFailure.sshHostKeyTitle");
    case "sshTimeout": return t("connections.testFailure.sshTimeoutTitle");
    case "sshUnclassified": return t("connections.testFailure.sshUnclassifiedTitle");
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
    case "timeoutNetwork": return t("connections.testFailure.timeoutNetworkRecovery");
    case "authentication": return t("connections.testFailure.authenticationRecovery");
    case "tls": return t("connections.testFailure.tlsRecovery");
    case "databaseConfig": return t("connections.testFailure.databaseConfigRecovery");
    case "sshLaunch": return t("connections.testFailure.sshLaunchRecovery");
    case "sshHost": return t("connections.testFailure.sshHostRecovery");
    case "sshAuthentication": return t("connections.testFailure.sshAuthenticationRecovery");
    case "sshHostKey": return t("connections.testFailure.sshHostKeyRecovery");
    case "sshTimeout": return t("connections.testFailure.sshTimeoutRecovery");
    case "sshUnclassified": return t("connections.testFailure.sshUnclassifiedRecovery");
    case "unknown": return t("connections.testFailure.unknownRecovery");
  }
}

export function connectionTestFailureTarget(
  failure: ConnectionTestFailure,
  context?: ConnectionTestFailureContext,
): { tab: ConnectionTab; fieldId: string } | null {
  if (isWorkspaceManaged(context)) return null;
  if (failure.field === "credentials") {
    return { tab: "general", fieldId: "connection-password" };
  }
  if (failure.field === "database") {
    return { tab: "general", fieldId: "connection-database" };
  }
  if (failure.field === "tls") {
    return { tab: "sshSsl", fieldId: "connection-tls-control" };
  }
  if (failure.field === "sshAlias") {
    return { tab: "sshSsl", fieldId: "connection-ssh-alias" };
  }
  return null;
}

/**
 * What the Database Explorer's single recovery button should do.
 *
 * Retrying only helps while the target may simply have been unreachable. Every
 * other cause needs a settings change or an action the user takes outside the
 * app, so the tree opens that connection's editor instead of offering a button
 * that reproduces the same failure.
 */
export function connectionTestFailureAction(
  code: ConnectionTestFailureCode,
): "retry" | "edit" {
  return code === "timeoutNetwork" || code === "sshTimeout" ? "retry" : "edit";
}
