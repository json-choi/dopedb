// Turns a refused database-access command into one sentence in the UI language.
// Documented control-plane refusals map to specific guidance; session, timeout,
// network and unknown failures follow the shared administration message rules.
import type { I18nKey, Lang } from "../../../lib/i18n";
import {
  WorkspaceAdminRequestError,
  isWorkspaceSessionRejected,
  workspaceAdminErrorMessage,
} from "../requests";
import { AccessResponseError } from "./parsers";

const KNOWN_REFUSALS = new Map<string, I18nKey>([
  ["A manager cannot reduce their own connection grant", "workspaceAccess.errorOwnGrant"],
  ["A manager cannot remove their own connection grant", "workspaceAccess.errorOwnGrant"],
  [
    "Access changed or needs a lower level. Remove the current grant before granting less access.",
    "workspaceAccess.errorGrantChanged",
  ],
  ["Connection grant changed concurrently. Retry.", "workspaceAccess.errorGrantConcurrent"],
  [
    "Another membership access change is already in progress",
    "workspaceAccess.errorMemberChangeInProgress",
  ],
  [
    "Active database access could not be revoked. Retry grant removal.",
    "workspaceAccess.errorMemberLeaseRevoke",
  ],
  ["Connection access changed. Refresh and retry.", "workspaceAccess.errorAccessChanged"],
  [
    "Another connection access change is already in progress",
    "workspaceAccess.errorConnectionChangeInProgress",
  ],
  [
    "Active database access could not be revoked. Retry after its credentials expire.",
    "workspaceAccess.errorTeamReadLeaseRevoke",
  ],
  [
    "Workspace administrator permission is required to change write access",
    "workspaceAccess.errorWritePolicyAdmin",
  ],
  ["Workspace access denied", "workspaceAccess.errorWorkspaceDenied"],
  ["Insufficient workspace permission", "workspaceAccess.errorRoleInsufficient"],
  [
    "Connection changed again. Review the current revision.",
    "workspaceAccess.errorConflictChangedAgain",
  ],
  [
    "Connection conflict was already resolved differently",
    "workspaceAccess.errorConflictResolvedElsewhere",
  ],
  ["Connection conflict not found", "workspaceAccess.errorConflictGone"],
  ["Connection not found", "workspaceAccess.errorConnectionGone"],
  [
    "Connection changed concurrently. Retry the update.",
    "workspaceAccess.errorConnectionConcurrent",
  ],
  ["Connection changed concurrently. Retry deletion.", "workspaceAccess.errorConnectionConcurrent"],
  [
    "Connection access changed concurrently. Retry the update.",
    "workspaceAccess.errorConnectionConcurrent",
  ],
  [
    "Connection access changed concurrently. Retry deletion.",
    "workspaceAccess.errorConnectionConcurrent",
  ],
  [
    "Active database access could not be revoked. Retry the update.",
    "workspaceAccess.errorConnectionLeaseRevoke",
  ],
  [
    "Active database access could not be revoked. Retry deletion.",
    "workspaceAccess.errorConnectionLeaseRevoke",
  ],
  [
    "Active data or schema change access cannot be revoked until its short-lived credential expires. Retry shortly.",
    "workspaceAccess.errorConnectionLeaseRevoke",
  ],
  [
    "Switch to member-local credentials before changing a managed database engine",
    "workspaceAccess.errorManagedEngine",
  ],
  [
    "This managed provider connection has no write credential",
    "workspaceAccess.errorNoWriteCredential",
  ],
]);

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

/** A stale expected revision is preserved by the server as a new conflict to review. */
function recordedNewConflict(error: WorkspaceAdminRequestError): boolean {
  const body = error.body;
  return error.status === 409
    && error.serverMessage === "Connection conflict"
    && typeof body === "object"
    && body !== null
    && typeof (body as Record<string, unknown>).conflictId === "string";
}

export function accessErrorMessage(
  error: unknown,
  i18n: { lang: Lang; t: Translate },
  fallback: I18nKey,
): string {
  if (error instanceof AccessResponseError) return i18n.t("workspaceAccess.responseInvalid");
  if (error instanceof WorkspaceAdminRequestError && !isWorkspaceSessionRejected(error)) {
    if (recordedNewConflict(error)) return i18n.t("workspaceAccess.errorApplyConflict");
    const known = error.serverMessage === null ? undefined : KNOWN_REFUSALS.get(error.serverMessage);
    if (known) return i18n.t(known);
    if (error.status === 403) return i18n.t("workspaceAccess.errorForbidden");
  }
  return workspaceAdminErrorMessage(error, i18n, fallback);
}
