// Localized vocabulary for the Backups & deletion section. Documented control-plane
// refusals get a specific sentence in both languages; anything else follows the shared
// administration error policy (session, timeout, network, or the section's fallback).
import type { I18nKey, Lang } from "../../../lib/i18n";
import { formatAdminDate } from "../dateFormat";
import {
  isWorkspaceSessionRejected,
  workspaceAdminErrorMessage,
  type WorkspaceAdminI18n,
} from "../requests";
import {
  classifyLifecycleFailure,
  type DeletionBlockerKind,
  type LifecycleFailure,
} from "./domain";


const FAILURE_MESSAGES: Record<LifecycleFailure, I18nKey> = {
  unexpectedResponse: "workspaceLifecycle.errorUnexpectedResponse",
  ownerRequired: "workspaceLifecycle.errorOwnerRequired",
  workspaceNotFound: "workspaceLifecycle.errorWorkspaceNotFound",
  metadataUnavailable: "workspaceLifecycle.errorMetadataUnavailable",
  connectionLimit: "workspaceLifecycle.errorConnectionLimit",
  backupChanged: "workspaceLifecycle.errorBackupChanged",
  keyIntegrity: "workspaceLifecycle.errorKeyIntegrity",
  encryptionUnavailable: "workspaceLifecycle.errorEncryptionUnavailable",
  backupNotFound: "workspaceLifecycle.errorBackupNotFound",
  backupCleanupPending: "workspaceLifecycle.errorBackupCleanupPending",
  restoreIntegrity: "workspaceLifecycle.errorRestoreIntegrity",
  restoreChanged: "workspaceLifecycle.errorRestoreChanged",
  decryptionUnavailable: "workspaceLifecycle.errorDecryptionUnavailable",
  keyServiceUnavailable: "workspaceLifecycle.errorKeyServiceUnavailable",
  keyServiceNotConfigured: "workspaceLifecycle.errorKeyServiceNotConfigured",
  rotationUnavailable: "workspaceLifecycle.errorRotationUnavailable",
  deletionRefused: "workspaceLifecycle.errorDeletionRefused",
  deletionCleanupPending: "workspaceLifecycle.errorDeletionCleanupPending",
  confirmationRequired: "workspaceLifecycle.errorConfirmationRequired",
};

export function describeLifecycleFailure(
  error: unknown,
  i18n: WorkspaceAdminI18n,
  fallback: I18nKey,
): string {
  if (isWorkspaceSessionRejected(error)) return i18n.t("workspaceAdmin.sessionExpired");
  const failure = classifyLifecycleFailure(error);
  return failure ? i18n.t(FAILURE_MESSAGES[failure]) : workspaceAdminErrorMessage(error, i18n, fallback);
}

export const BLOCKER_LABELS: Record<DeletionBlockerKind, I18nKey> = {
  providerIntegrations: "workspaceLifecycle.blockerProviderIntegrations",
  credentialLeases: "workspaceLifecycle.blockerCredentialLeases",
  providerOperations: "workspaceLifecycle.blockerProviderOperations",
  keyRotations: "workspaceLifecycle.blockerKeyRotations",
  memberRevocations: "workspaceLifecycle.blockerMemberRevocations",
};

/** Parsers already rejected invalid timestamps, so every value here formats. */
export function formatLifecycleTime(timestamp: string, lang: Lang): string {
  return formatAdminDate(timestamp, lang, { dateStyle: "medium", timeStyle: "short" });
}
