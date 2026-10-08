// Turns control-plane refusals and Neon preflight findings into readable text for
// both UI languages. Known sentences map to catalogue keys; documented conflict
// sentences are classified so the screens can recover (refresh, reload, re-plan).
// Anything unknown falls back to the shared administration error policy.
import type { I18nKey, Lang } from "../../../../lib/i18n";
import {
  WorkspaceAdminRequestError,
  workspaceAdminErrorMessage,
} from "../../requests";
import type { NeonBootstrapFinding } from "../domain";
import type { WizardError } from "./model";

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;
type I18n = { lang: Lang; t: Translate };

const PROVIDER_MESSAGES = new Map<string, I18nKey>([
  ["Neon API key is invalid or revoked", "workspaceProviderDatabases.serverError.neonKeyInvalid"],
  [
    "Neon API key cannot access the requested scope",
    "workspaceProviderDatabases.serverError.neonScopeDenied",
  ],
  [
    "Neon could not discover projects for this API key",
    "workspaceProviderDatabases.serverError.neonProjectsDenied",
  ],
  [
    "Neon could not verify this project for the API key",
    "workspaceProviderDatabases.serverError.neonProjectUnverified",
  ],
  [
    "Neon project was not found or this API key cannot access it",
    "workspaceProviderDatabases.serverError.neonProjectNotFound",
  ],
  [
    "Neon branch is starting or resetting. Try again shortly.",
    "workspaceProviderDatabases.serverError.neonBranchStarting",
  ],
  ["Neon API key cannot access a project", "workspaceProviderDatabases.serverError.neonNoProject"],
  [
    "Neon API request limit was reached. Try again shortly.",
    "workspaceProviderDatabases.serverError.neonRateLimited",
  ],
  [
    "Neon branch managed access needs repair before bootstrap",
    "workspaceProviderDatabases.serverError.neonBranchNeedsRepair",
  ],
  [
    "Classify this default or unclassified Neon branch before continuing",
    "workspaceProviderDatabases.serverError.neonClassifyBranch",
  ],
  [
    "이 Cloud SQL 계정 연결은 고정 DB 목록을 저장하기 전 버전입니다. 클라우드 계정에서 다시 연결해 주세요.",
    "workspaceProviderDatabases.serverError.gcpLegacyIntegration",
  ],
]);

function refusal(error: unknown): WorkspaceAdminRequestError | null {
  return error instanceof WorkspaceAdminRequestError ? error : null;
}

/** One sentence for a failed provider command, localized when the refusal is known. */
export function providerErrorMessage(error: unknown, i18n: I18n, fallback: I18nKey): string {
  const message = refusal(error)?.serverMessage;
  const known = message ? PROVIDER_MESSAGES.get(message) : undefined;
  return known ? i18n.t(known) : workspaceAdminErrorMessage(error, i18n, fallback);
}

/** The specific reason for a failure, or null when only a generic failure is known. */
export function providerErrorDetail(error: unknown, i18n: I18n): string | null {
  const message = providerErrorMessage(error, i18n, "workspaceAdmin.requestFailed");
  return message === i18n.t("workspaceAdmin.requestFailed") ? null : message;
}

/** Whether the refusal asks for the provider account to be reconnected. */
export function suggestsProviderReconnect(error: unknown): boolean {
  const message = refusal(error)?.serverMessage ?? "";
  return /reconnect/i.test(message) || message.includes("다시 연결");
}

/** Neon account names are composed by the control plane with a Korean project count. */
export function integrationDisplayName(value: string, t: Translate): string {
  const neonProjects = /^Neon · 프로젝트 (\d+)개$/.exec(value);
  return neonProjects
    ? t("workspaceProviderDatabases.neonProjectsAccount", { count: neonProjects[1] })
    : value;
}

export function describeFailure(error: unknown, i18n: I18n, fallback: I18nKey): WizardError {
  return {
    message: providerErrorMessage(error, i18n, fallback),
    reconnect: suggestsProviderReconnect(error),
  };
}

export type RemovalFailure =
  | "conflictRecorded"
  | "changed"
  | "missing"
  | "revocationPending"
  | "busy";

/** Documented refusals of a shared database removal; each one leaves the database intact. */
export function removalFailure(error: unknown): RemovalFailure | null {
  const failed = refusal(error);
  if (!failed) return null;
  if (failed.status === 404) return "missing";
  if (failed.status === 428) return "changed";
  if (failed.status !== 409) return null;
  const body = failed.body as Record<string, unknown> | null;
  if (failed.serverMessage === "Connection conflict" && typeof body?.conflictId === "string") {
    return "conflictRecorded";
  }
  if (failed.serverMessage === "Another connection access change is already in progress") {
    return "busy";
  }
  if (failed.serverMessage === "Active database access could not be revoked. Retry deletion.") {
    return "revocationPending";
  }
  return "changed";
}

export type ImportFailure = "alreadyImported" | "receiptRejected" | "idempotencyConflict";

export function importFailure(error: unknown): ImportFailure | null {
  const failed = refusal(error);
  if (failed?.status !== 409) return null;
  if (failed.serverMessage === "Provider resource is already imported") return "alreadyImported";
  if (failed.serverMessage === "Import request conflicts with an existing idempotency key") {
    return "idempotencyConflict";
  }
  return "receiptRejected";
}

/** A claim refused with 409 means the sealed selection expired or no longer matches. */
export function isStaleSelection(error: unknown): boolean {
  return refusal(error)?.status === 409;
}

const NEON_SELECTION_CHANGES = new Set([
  "Neon selection proof expired or changed",
  "Neon database is no longer selectable",
  "Neon branch identity is no longer selectable",
]);

export function isNeonSelectionChanged(error: unknown): boolean {
  const failed = refusal(error);
  return failed?.status === 409 && NEON_SELECTION_CHANGES.has(failed.serverMessage ?? "");
}

const NEON_PLAN_CHANGES = new Set([
  "Neon bootstrap plan expired or changed",
  "Neon branch bootstrap authority changed",
  "Neon branch database inventory changed during bootstrap",
  "Neon bootstrap idempotency key conflicts",
]);

export function neonApplyFailure(error: unknown): "planChanged" | "manualRepair" | null {
  const failed = refusal(error);
  if (failed?.status === 409 && NEON_PLAN_CHANGES.has(failed.serverMessage ?? "")) {
    return "planChanged";
  }
  if (failed?.status === 503 && failed.serverMessage?.startsWith("Neon bootstrap needs manual repair")) {
    return "manualRepair";
  }
  return null;
}

// Findings are keyed by level and code: a public ACL change is reported as a blocker
// that reuses its change code, so the code alone would describe the wrong action.
const NEON_FINDING_DESCRIPTIONS = new Map<string, I18nKey>([
  ["blocker:NEON_BRANCH_NOT_READY", "workspaceProviderDatabases.neonFinding.branchNotReady"],
  [
    "blocker:NEON_DATABASE_OWNER_MISMATCH",
    "workspaceProviderDatabases.neonFinding.databaseOwnerMismatch",
  ],
  [
    "blocker:NEON_ROLE_CREATE_UNAVAILABLE",
    "workspaceProviderDatabases.neonFinding.roleCreateUnavailable",
  ],
  [
    "blocker:NEON_DATABASE_CONNECT_NOT_GRANTABLE",
    "workspaceProviderDatabases.neonFinding.databaseConnectNotGrantable",
  ],
  [
    "blocker:NEON_DATABASE_INVENTORY_INVALID",
    "workspaceProviderDatabases.neonFinding.databaseInventoryInvalid",
  ],
  [
    "blocker:NEON_OTHER_DATABASE_INVALID",
    "workspaceProviderDatabases.neonFinding.otherDatabaseInvalid",
  ],
  [
    "blocker:NEON_OTHER_DATABASE_CONNECT_NOT_GRANTABLE",
    "workspaceProviderDatabases.neonFinding.otherDatabaseConnectNotGrantable",
  ],
  ["blocker:NEON_SCHEMA_NOT_GRANTABLE", "workspaceProviderDatabases.neonFinding.schemaNotGrantable"],
  [
    "blocker:NEON_SCHEMA_INVENTORY_INVALID",
    "workspaceProviderDatabases.neonFinding.schemaInventoryInvalid",
  ],
  [
    "blocker:NEON_SCHEMA_OWNERSHIP_UNSAFE",
    "workspaceProviderDatabases.neonFinding.schemaOwnershipUnsafe",
  ],
  [
    "blocker:NEON_OUTSIDE_SCHEMA_PUBLIC_ACCESS",
    "workspaceProviderDatabases.neonFinding.outsideSchemaPublicAccess",
  ],
  [
    "blocker:NEON_PUBLIC_OBJECT_WRITE_ACCESS",
    "workspaceProviderDatabases.neonFinding.publicObjectWriteAccess",
  ],
  ["blocker:NEON_OBJECT_NOT_GRANTABLE", "workspaceProviderDatabases.neonFinding.objectNotGrantable"],
  [
    "blocker:NEON_PUBLIC_SECURITY_DEFINER",
    "workspaceProviderDatabases.neonFinding.publicSecurityDefiner",
  ],
  [
    "blocker:NEON_OWNERSHIP_MARKER_DRIFT",
    "workspaceProviderDatabases.neonFinding.ownershipMarkerDrift",
  ],
  [
    "blocker:NEON_OWNERSHIP_MARKER_MEMBERSHIP_DRIFT",
    "workspaceProviderDatabases.neonFinding.ownershipMarkerMembershipDrift",
  ],
  ["blocker:NEON_LEASE_ROLE_DRIFT", "workspaceProviderDatabases.neonFinding.leaseRoleDrift"],
  [
    "blocker:NEON_ACTIVE_LEASE_ROLE_PRESENT",
    "workspaceProviderDatabases.neonFinding.activeLeaseRolePresent",
  ],
  [
    "change:NEON_REVOKE_OTHER_DATABASE_PUBLIC_CONNECT",
    "workspaceProviderDatabases.neonFinding.revokeOtherDatabasePublicConnect",
  ],
  [
    "change:NEON_REVOKE_PUBLIC_SCHEMA_CREATE",
    "workspaceProviderDatabases.neonFinding.revokePublicSchemaCreate",
  ],
  [
    "change:NEON_CREATE_OWNERSHIP_MARKER",
    "workspaceProviderDatabases.neonFinding.createOwnershipMarker",
  ],
  [
    "change:NEON_READ_WRITE_SMOKE_PLANNED",
    "workspaceProviderDatabases.neonFinding.readWriteSmokePlanned",
  ],
  [
    "verified:NEON_POLICY_ALREADY_READY",
    "workspaceProviderDatabases.neonFinding.policyAlreadyReady",
  ],
]);

const NEON_FINDING_VALUES = new Map<string, I18nKey>([
  ["검증 실패", "workspaceProviderDatabases.neonValue.verificationFailed"],
  ["전용 개발 브랜치 또는 DBA 조치 필요", "workspaceProviderDatabases.neonValue.developmentBranchOrDba"],
  ["같은 Neon 브랜치", "workspaceProviderDatabases.neonValue.sameBranch"],
  ["allowlist 밖 schema", "workspaceProviderDatabases.neonValue.outsideAllowlist"],
  ["marker 없음", "workspaceProviderDatabases.neonValue.noMarker"],
  ["NOLOGIN 최소권한 marker", "workspaceProviderDatabases.neonValue.nologinMarker"],
  ["기존 단기 role", "workspaceProviderDatabases.neonValue.existingLeaseRole"],
  ["실행 전 검증 없음", "workspaceProviderDatabases.neonValue.noPreRunVerification"],
  [
    "read 성공·write DML 성공·DDL/role 관리 거부·probe 제거",
    "workspaceProviderDatabases.neonValue.smokeResult",
  ],
  ["정책 충족", "workspaceProviderDatabases.neonValue.policySatisfied"],
  ["변경 없음", "workspaceProviderDatabases.neonValue.noChange"],
]);

export function neonFindingDescription(finding: NeonBootstrapFinding, t: Translate): string {
  const known = NEON_FINDING_DESCRIPTIONS.get(`${finding.level}:${finding.code}`);
  if (known) return t(known);
  if (finding.level === "blocker" && finding.code.startsWith("NEON_REVOKE_")) {
    return t("workspaceProviderDatabases.neonFinding.publicAccessPreserved");
  }
  const database = finding.level === "change"
    ? /^NEON_REVOKE_PUBLIC_DATABASE_(CREATE|TEMPORARY)$/.exec(finding.code)
    : null;
  return database
    ? t("workspaceProviderDatabases.neonFinding.revokePublicDatabase", { privilege: database[1] })
    : finding.description;
}

/** Before, after and target values; identifiers and unknown values stay verbatim. */
export function neonFindingValue(value: string, t: Translate): string {
  const known = NEON_FINDING_VALUES.get(value);
  if (known) return t(known);
  const missingPublic = /^PUBLIC (CONNECT|CREATE|TEMPORARY) 없음$/.exec(value);
  return missingPublic
    ? t("workspaceProviderDatabases.neonValue.noPublicPrivilege", { privilege: missingPublic[1] })
    : value;
}
