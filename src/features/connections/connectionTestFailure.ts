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
  return null;
}
