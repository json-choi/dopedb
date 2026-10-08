// Turns a refused provider administration request into one localized sentence.
// Documented control-plane sentences (English or Korean) map to catalogue keys so
// either UI language reads them; anything else follows the shared admin rule of
// showing the server text only when it is already in the UI language.
import type { I18nKey, Lang } from "../../../../lib/i18n";
import {
  isWorkspaceSessionRejected,
  workspaceAdminErrorMessage,
  WorkspaceAdminRequestError,
} from "../../requests";

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;
export type ProviderI18n = { lang: Lang; t: Translate };

const SERVER_SENTENCES: Readonly<Record<string, I18nKey>> = {
  "Another provider access change is already in progress":
    "workspaceProviders.serverChangeInProgress",
  "Provider access changed concurrently. Retry connecting.":
    "workspaceProviders.serverConcurrentChange",
  "Managed access for this provider is not available":
    "workspaceProviders.serverProviderUnavailable",
  "Provider connection could not be verified": "workspaceProviders.serverProviderUnverified",
  "Active database access could not be revoked yet. Retry reconnecting.":
    "workspaceProviders.serverActiveAccessPending",
  "Provider integration not found": "workspaceProviders.serverIntegrationNotFound",
  "Provider lease cleanup is pending durable reconciliation.":
    "workspaceProviders.serverDisconnectCleanupPending",
  "Provider disconnect requires reconciliation":
    "workspaceProviders.serverDisconnectReconciliation",
  "Provider disconnect is ambiguous; explicit reconnect is required.":
    "workspaceProviders.serverDisconnectAmbiguous",
  "Provider authorization outcome is ambiguous; explicit reconnect is required.":
    "workspaceProviders.serverDisconnectAmbiguous",
  "Invalid Neon API key configuration": "workspaceProviders.serverNeonConfigurationInvalid",
  "Neon API key is invalid or revoked": "workspaceProviders.serverNeonKeyInvalid",
  "Neon API key cannot access the requested scope": "workspaceProviders.serverNeonScopeDenied",
  "Neon could not discover projects for this API key":
    "workspaceProviders.serverNeonProjectsHidden",
  "Neon could not verify this project for the API key":
    "workspaceProviders.serverNeonProjectUnverified",
  "Neon project was not found or this API key cannot access it":
    "workspaceProviders.serverNeonProjectNotFound",
  "Neon API key cannot access a project": "workspaceProviders.serverNeonNoProject",
  "Neon API request limit was reached. Try again shortly.":
    "workspaceProviders.serverNeonRateLimited",
  "Vault verification is being retried too quickly": "workspaceProviders.serverVaultRateLimited",
  "Invalid Vault AppRole configuration": "workspaceProviders.serverVaultConfigurationInvalid",
  "Vault is unavailable": "workspaceProviders.serverVaultUnavailable",
  "Vault rejected the request": "workspaceProviders.serverVaultRejected",
  "Disconnect the existing Vault target before changing its broker roles or mounts":
    "workspaceProviders.serverVaultTargetChanged",
  "Workspace workload identity is not enabled for this deployment":
    "workspaceProviders.serverGcpDisabled",
  "Google Cloud setup session expired": "workspaceProviders.serverGcpSetupExpired",
  "Each Cloud SQL instance must use dedicated service accounts":
    "workspaceProviders.serverGcpDedicatedAccounts",
  "Cloud SQL target is already connected more than once":
    "workspaceProviders.serverGcpTargetDuplicated",
  "Cloud SQL service accounts or target are already connected":
    "workspaceProviders.serverGcpAlreadyConnected",
  "The managed Cloud SQL repair target changed. Start repair again from the database.":
    "workspaceProviders.serverGcpRepairTargetChanged",
  "Google Cloud project identity changed during setup":
    "workspaceProviders.serverGcpProjectChanged",
  "Google Cloud project is no longer available": "workspaceProviders.serverGcpProjectUnavailable",
  "Specify the exact database and existing migration owner for schema access":
    "workspaceProviders.serverGcpSchemaTarget",
  "Schema delegation requires explicit administrator approval":
    "workspaceProviders.serverGcpSchemaApproval",
  "Google Cloud resource discovery failed": "workspaceProviders.serverGcpDiscoveryFailed",
  "Google Cloud setup failed": "workspaceProviders.serverGcpSetupFailed",
  "Active Cloud SQL database access is still valid": "workspaceProviders.serverGcpActiveAccess",
  "The dedicated Cloud SQL data account does not have the expected roles. Existing roles were preserved; an administrator must review this account separately.":
    "workspaceProviders.serverGcpDataAccountRoles",
  "Cloud SQL returned a different database user. Existing access was preserved.":
    "workspaceProviders.serverGcpUnexpectedUser",
  "The setup account database role already exists outside Cloud SQL user management. A database administrator must resolve the conflicting role before reconnecting.":
    "workspaceProviders.serverGcpRoleConflict",
  "Google Cloud runtime access is still denied after setup. Retry shortly; if this persists, check the Workload Identity and service-account IAM policies.":
    "workspaceProviders.serverGcpRuntimeDenied",
  "Google Cloud 자동 설정에 필요한 권한을 확인하세요.":
    "workspaceProviders.serverGcpPermissionsRequired",
  "임시 Google Cloud 설정 권한을 바로 제거하지 못했습니다. 해당 권한은 15분 뒤 자동 만료됩니다.":
    "workspaceProviders.serverGcpTemporaryGrantCleanup",
  "이 Cloud SQL 계정 연결은 고정 DB 목록을 저장하기 전 버전입니다. 클라우드 계정에서 다시 연결해 주세요.":
    "workspaceProviders.serverGcpLegacyIntegration",
  "Google Cloud 승인이 만료되었습니다. 계정을 다시 연결하세요.":
    "workspaceProviders.serverGcpAuthorizationExpired",
  "Google 승인에 cloud-platform 권한이 포함되지 않았습니다. 계정을 다시 연결하고 Google Cloud 접근을 승인하세요.":
    "workspaceProviders.serverGcpScopeMissing",
  "quota project에 필요한 Google Cloud API가 비활성화되어 있습니다.":
    "workspaceProviders.serverGcpQuotaApiDisabled",
  "Google Cloud 조직 정책이 이 설정 작업을 차단했습니다.":
    "workspaceProviders.serverGcpOrganizationPolicy",
  "필수 API를 활성화할 수 없습니다. Service Usage Admin 권한이 필요합니다.":
    "workspaceProviders.serverGcpServiceUsageRequired",
  "임시 서비스 계정 자격 증명을 발급할 수 없습니다.":
    "workspaceProviders.serverGcpTemporaryCredential",
  "Workload Identity를 구성할 수 없습니다. Workload Identity Pool Admin 권한이 필요합니다.":
    "workspaceProviders.serverGcpWorkloadIdentityRequired",
  "서비스 계정을 구성할 수 없습니다. Service Account Admin 권한이 필요합니다.":
    "workspaceProviders.serverGcpServiceAccountRequired",
  "프로젝트 IAM 정책을 변경할 수 없습니다. Project IAM Admin 권한이 필요합니다.":
    "workspaceProviders.serverGcpProjectIamRequired",
  "Cloud SQL 설정을 변경할 수 없습니다. Cloud SQL Admin 권한이 필요합니다.":
    "workspaceProviders.serverGcpCloudSqlAdminRequired",
  "Google Cloud에서 이 설정 작업을 거부했습니다.": "workspaceProviders.serverGcpRejected",
  "선택한 Google Cloud 리소스를 찾지 못했습니다.":
    "workspaceProviders.serverGcpResourceNotFound",
  "기존 Google Cloud 리소스가 이 DopeDB 설정과 충돌합니다.":
    "workspaceProviders.serverGcpResourceConflict",
  "Google Cloud 요청 한도에 도달했습니다. 잠시 뒤 다시 시도하세요.":
    "workspaceProviders.serverGcpRateLimited",
  "Google Cloud 설정을 완료하지 못했습니다.": "workspaceProviders.serverGcpSetupIncomplete",
  "새 Google Cloud 서비스 계정이 아직 IAM에 반영되지 않았습니다. 잠시 뒤 다시 시도하세요.":
    "workspaceProviders.serverGcpIamPropagation",
  "Google Cloud 프로젝트 IAM 관리자가 누락된 설정 역할을 승인해야 합니다.":
    "workspaceProviders.serverGcpIamAdminApproval",
  "임시 Google Cloud 설정 권한이 제한 시간 안에 활성화되지 않았습니다.":
    "workspaceProviders.serverGcpTemporaryGrantTimeout",
  "새 Google Cloud 서비스 계정이 아직 Cloud SQL에 반영되지 않았습니다. 잠시 뒤 다시 시도하세요.":
    "workspaceProviders.serverGcpCloudSqlPropagation",
  "Cloud SQL 권한 복구 상태를 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.":
    "workspaceProviders.serverGcpRecoveryStateSave",
};

const API_DISABLED_IN_PROJECT = /^Google Cloud API (.+)가 quota project (.+)에서 비활성화되어 있습니다\.$/;
const API_DISABLED = /^Google Cloud API (.+)가 quota project에서 비활성화되어 있습니다\.$/;

function knownServerSentence(message: string, t: Translate): string | null {
  const key = SERVER_SENTENCES[message];
  if (key) return t(key);
  const inProject = API_DISABLED_IN_PROJECT.exec(message);
  if (inProject) {
    return t("workspaceProviders.serverGcpApiDisabledInProject", {
      service: inProject[1],
      project: inProject[2],
    });
  }
  const disabled = API_DISABLED.exec(message);
  return disabled
    ? t("workspaceProviders.serverGcpApiDisabled", { service: disabled[1] })
    : null;
}

export function providerErrorMessage(
  error: unknown,
  i18n: ProviderI18n,
  fallback: I18nKey,
): string {
  if (
    error instanceof WorkspaceAdminRequestError
    && error.serverMessage
    && !isWorkspaceSessionRejected(error)
  ) {
    const known = knownServerSentence(error.serverMessage, i18n.t);
    if (known) return known;
  }
  return workspaceAdminErrorMessage(error, i18n, fallback);
}

/** A Google Cloud setup authorization that is gone; the workspace session is still valid. */
export function isGcpSetupExpired(error: unknown): boolean {
  return error instanceof WorkspaceAdminRequestError
    && !isWorkspaceSessionRejected(error)
    && (error.status === 401 || error.status === 410);
}

export type DisconnectFailure = {
  message: string;
  /** A repeated DELETE resumes the server's cleanup instead of starting over. */
  retryable: boolean;
  /** The account list no longer matches the server and must be re-read. */
  refresh: boolean;
};

export function disconnectFailure(error: unknown, i18n: ProviderI18n): DisconnectFailure {
  const message = providerErrorMessage(error, i18n, "workspaceProviders.disconnectFailed");
  if (!(error instanceof WorkspaceAdminRequestError)) {
    return { message, retryable: true, refresh: false };
  }
  if (error.status === 404) {
    return {
      message: i18n.t("workspaceProviders.serverIntegrationNotFound"),
      retryable: false,
      refresh: true,
    };
  }
  const ambiguous = error.serverMessage !== null
    && SERVER_SENTENCES[error.serverMessage] === "workspaceProviders.serverDisconnectAmbiguous";
  if (ambiguous) return { message, retryable: false, refresh: true };
  return { message, retryable: error.status === 409 || error.status >= 500, refresh: false };
}
