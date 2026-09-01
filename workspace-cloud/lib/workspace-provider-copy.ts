import type { WorkspaceLocale } from "./workspace-locale";

const koreanByEnglish: Readonly<Record<string, string>> = {
  "Neon API key is invalid or revoked":
    "Neon API 키가 유효하지 않거나 폐기되었습니다. Neon Console에서 새 키를 발급해 다시 연결하세요.",
  "Neon API key cannot access the requested scope":
    "Neon API 키로 요청한 범위에 접근할 수 없습니다. 개인 키와 조직 ID 또는 조직·프로젝트 범위 키의 권한을 확인하세요.",
  "Neon could not discover projects for this API key":
    "Neon이 이 API 키의 프로젝트 목록 요청을 거부했습니다. 키가 프로젝트 범위 조직 키인지 확인하고 새 키로 다시 시도하세요.",
  "Neon could not verify this project for the API key":
    "Neon이 입력한 프로젝트와 API 키의 범위를 확인하지 못했습니다. 프로젝트 ID와 키를 같은 프로젝트에서 복사했는지 확인하세요.",
  "Neon project was not found or this API key cannot access it":
    "Neon 프로젝트를 찾을 수 없거나 이 API 키로 접근할 수 없습니다. 프로젝트 ID와 키 범위를 확인하세요.",
  "Neon branch is starting or resetting. Try again shortly.":
    "Neon 브랜치가 시작 또는 초기화 중입니다. 잠시 뒤 다시 시도하세요.",
  "Neon API key cannot access a project":
    "Neon API 키로 접근 가능한 프로젝트가 없습니다. 프로젝트 범위와 조직 권한을 확인하세요.",
  "Neon API request limit was reached. Try again shortly.":
    "Neon API 요청 한도에 도달했습니다. 잠시 뒤 다시 시도하세요.",
  "Active write access cannot be revoked until its short-lived credential expires. Retry shortly.":
    "현재 사용 중인 쓰기 자격 증명은 만료 전 강제로 폐기할 수 없습니다. 잠시 뒤 다시 시도하세요.",
  "Active database access could not be revoked. Retry the update.":
    "현재 사용 중인 단기 DB 자격 증명을 폐기하지 못했습니다. 자격 증명이 만료된 뒤 다시 시도하세요.",
};

const englishByKorean: Readonly<Record<string, string>> = {
  "Google Cloud 자동 설정에 필요한 권한을 확인하세요.":
    "Check the permissions required for automatic Google Cloud setup.",
  "임시 Google Cloud 설정 권한을 바로 제거하지 못했습니다. 해당 권한은 15분 뒤 자동 만료됩니다.":
    "Temporary Google Cloud setup permissions could not be removed immediately. They will expire automatically in 15 minutes.",
  "이 Cloud SQL 계정 연결은 고정 DB 목록을 저장하기 전 버전입니다. 클라우드 계정에서 다시 연결해 주세요.":
    "This Cloud SQL account connection predates the fixed database inventory. Reconnect it under Cloud accounts.",
  "Google Cloud 승인이 만료되었습니다. 계정을 다시 연결하세요.":
    "Google Cloud authorization expired. Reconnect the account.",
  "Google 승인에 cloud-platform 권한이 포함되지 않았습니다. 계정을 다시 연결하고 Google Cloud 접근을 승인하세요.":
    "Google authorization does not include cloud-platform access. Reconnect the account and approve Google Cloud access.",
  "quota project에 필요한 Google Cloud API가 비활성화되어 있습니다.":
    "A required Google Cloud API is disabled in the quota project.",
  "Google Cloud 조직 정책이 이 설정 작업을 차단했습니다.":
    "A Google Cloud organization policy blocked this setup operation.",
  "필수 API를 활성화할 수 없습니다. Service Usage Admin 권한이 필요합니다.":
    "Required APIs cannot be enabled. Service Usage Admin is required.",
  "임시 서비스 계정 자격 증명을 발급할 수 없습니다.":
    "Temporary service account credentials could not be issued.",
  "Workload Identity를 구성할 수 없습니다. Workload Identity Pool Admin 권한이 필요합니다.":
    "Workload Identity could not be configured. Workload Identity Pool Admin is required.",
  "서비스 계정을 구성할 수 없습니다. Service Account Admin 권한이 필요합니다.":
    "Service accounts could not be configured. Service Account Admin is required.",
  "프로젝트 IAM 정책을 변경할 수 없습니다. Project IAM Admin 권한이 필요합니다.":
    "The project IAM policy could not be changed. Project IAM Admin is required.",
  "Cloud SQL 설정을 변경할 수 없습니다. Cloud SQL Admin 권한이 필요합니다.":
    "Cloud SQL settings could not be changed. Cloud SQL Admin is required.",
  "Google Cloud에서 이 설정 작업을 거부했습니다.":
    "Google Cloud rejected this setup operation.",
  "선택한 Google Cloud 리소스를 찾지 못했습니다.":
    "The selected Google Cloud resource was not found.",
  "기존 Google Cloud 리소스가 이 DopeDB 설정과 충돌합니다.":
    "An existing Google Cloud resource conflicts with this DopeDB setup.",
  "Google Cloud 요청 한도에 도달했습니다. 잠시 뒤 다시 시도하세요.":
    "The Google Cloud request limit was reached. Try again shortly.",
  "Google Cloud 설정을 완료하지 못했습니다.":
    "Google Cloud setup could not be completed.",
  "새 Google Cloud 서비스 계정이 아직 IAM에 반영되지 않았습니다. 잠시 뒤 다시 시도하세요.":
    "The new Google Cloud service account has not propagated to IAM yet. Try again shortly.",
  "Google Cloud 프로젝트 IAM 관리자가 누락된 설정 역할을 승인해야 합니다.":
    "A Google Cloud project IAM administrator must approve the missing setup roles.",
  "임시 Google Cloud 설정 권한이 제한 시간 안에 활성화되지 않았습니다.":
    "Temporary Google Cloud setup permissions did not become active before the timeout.",
  "새 Google Cloud 서비스 계정이 아직 Cloud SQL에 반영되지 않았습니다. 잠시 뒤 다시 시도하세요.":
    "The new Google Cloud service account has not propagated to Cloud SQL yet. Try again shortly.",
  "Cloud SQL Data API 설정 반영이 지연되고 있습니다. 잠시 뒤 다시 시도하세요.":
    "Cloud SQL Data API configuration is still propagating. Try again shortly.",
  "Cloud SQL IAM 데이터베이스 인증 반영이 지연되고 있습니다. 잠시 뒤 다시 시도하세요.":
    "Cloud SQL IAM database authentication is still propagating. Try again shortly.",
};

export function localizedProviderMessage(
  message: string,
  locale: WorkspaceLocale,
  fallback = message,
): string {
  const containsKorean = /[가-힣]/.test(message);
  if (locale === "ko") {
    return containsKorean ? message : koreanByEnglish[message] ?? fallback;
  }
  const exact = englishByKorean[message];
  if (exact) return exact;

  const serviceConsumer = message.match(
    /^Google Cloud API (.+)가 quota project (.+)에서 비활성화되어 있습니다\.$/,
  );
  if (serviceConsumer) {
    return `Google Cloud API ${serviceConsumer[1]} is disabled in quota project ${serviceConsumer[2]}.`;
  }
  const service = message.match(
    /^Google Cloud API (.+)가 quota project에서 비활성화되어 있습니다\.$/,
  );
  if (service) {
    return `Google Cloud API ${service[1]} is disabled in the quota project.`;
  }
  return containsKorean ? fallback : message;
}

export function localizedIntegrationDisplayName(
  value: string,
  locale: WorkspaceLocale,
): string {
  if (locale === "ko") return value;
  const neonProjects = value.match(/^Neon · 프로젝트 (\d+)개$/);
  return neonProjects ? `Neon · ${neonProjects[1]} projects` : value;
}

const neonFindingDescriptions: Readonly<Record<string, string>> = {
  NEON_BRANCH_NOT_READY: "The selected Neon branch compute is not Ready.",
  NEON_DATABASE_OWNER_MISMATCH: "The Neon owner session does not match the selected database owner.",
  NEON_ROLE_CREATE_UNAVAILABLE: "The database owner cannot create least-privilege lease roles.",
  NEON_DATABASE_CONNECT_NOT_GRANTABLE: "Database CONNECT cannot be delegated to a short-lived role.",
  NEON_DATABASE_INVENTORY_INVALID: "The database inventory could not be pinned safely.",
  NEON_OTHER_DATABASE_INVALID: "A public access target in another database could not be identified safely.",
  NEON_OTHER_DATABASE_CONNECT_NOT_GRANTABLE: "PUBLIC CONNECT on another database cannot be revoked by the current owner.",
  NEON_REVOKE_OTHER_DATABASE_PUBLIC_CONNECT: "Revoke PUBLIC CONNECT so short-lived roles cannot move to another database.",
  NEON_SCHEMA_NOT_GRANTABLE: "An allowed schema is missing or does not satisfy role delegation and write-probe boundaries.",
  NEON_SCHEMA_INVENTORY_INVALID: "A public schema privilege target could not be identified safely.",
  NEON_REVOKE_PUBLIC_SCHEMA_CREATE: "Revoke CREATE so PUBLIC cannot create objects in managed schemas.",
  NEON_SCHEMA_OWNERSHIP_UNSAFE: "A managed schema creator or object owner is outside the single-owner boundary.",
  NEON_OUTSIDE_SCHEMA_PUBLIC_ACCESS: "PUBLIC USAGE or CREATE remains on a schema outside the allowlist.",
  NEON_PUBLIC_OBJECT_WRITE_ACCESS: "An object in a managed schema grants write access to PUBLIC.",
  NEON_OBJECT_NOT_GRANTABLE: "Current object read/write privileges cannot be delegated to a least-privilege role.",
  NEON_PUBLIC_SECURITY_DEFINER: "A SECURITY DEFINER function can be executed by PUBLIC.",
  NEON_CREATE_OWNERSHIP_MARKER: "Create a NOLOGIN marker so only policy boundaries created by DopeDB are eligible for later recovery.",
  NEON_OWNERSHIP_MARKER_DRIFT: "The existing DopeDB marker differs from the expected policy and will not be adopted automatically.",
  NEON_LEASE_ROLE_DRIFT: "An existing DopeDB-formatted role differs from the expected login, expiry, or privilege boundary.",
  NEON_ACTIVE_LEASE_ROLE_PRESENT: "An active short-lived DopeDB role remains and cannot be attributed safely to a branch credential.",
  NEON_READ_WRITE_SMOKE_PLANNED: "Connect with short-lived read/write roles and verify allowed and denied boundaries.",
  NEON_POLICY_ALREADY_READY: "Current ACLs and the ownership marker satisfy the DopeDB read boundary.",
};

const neonFindingValues: Readonly<Record<string, string>> = {
  "검증 실패": "Verification failed",
  "전용 개발 브랜치 또는 DBA 조치 필요": "Dedicated development branch or DBA action required",
  "같은 Neon 브랜치": "Same Neon branch",
  "allowlist 밖 schema": "Schema outside the allowlist",
  "PUBLIC CONNECT 없음": "No PUBLIC CONNECT",
  "PUBLIC CREATE 없음": "No PUBLIC CREATE",
  "marker 없음": "No marker",
  "NOLOGIN 최소권한 marker": "NOLOGIN least-privilege marker",
  "기존 단기 role": "Existing short-lived role",
  "실행 전 검증 없음": "No pre-run verification",
  "read 성공·write DML 성공·DDL/role 관리 거부·probe 제거":
    "Read succeeds · write DML succeeds · DDL and role administration denied · probe removed",
  "정책 충족": "Policy satisfied",
  "변경 없음": "No change",
};

export function localizedNeonFindingText(
  code: string,
  field: "after" | "before" | "description" | "target",
  value: string,
  locale: WorkspaceLocale,
): string {
  if (locale === "ko") return value;
  if (field === "description") {
    const description = neonFindingDescriptions[code];
    if (description) return description;
    const publicDatabase = code.match(/^NEON_REVOKE_PUBLIC_DATABASE_(CREATE|TEMPORARY)$/);
    if (publicDatabase) {
      return `Revoke PUBLIC ${publicDatabase[1]} on the database.`;
    }
  }
  if (field === "after") {
    const noPublic = value.match(/^PUBLIC (CREATE|TEMPORARY) 없음$/);
    if (noPublic) return `No PUBLIC ${noPublic[1]}`;
  }
  return neonFindingValues[value] ?? value;
}
