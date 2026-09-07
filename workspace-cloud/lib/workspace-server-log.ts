// The only application-owned server log sink. Every event has a closed,
// categorical projection: no request/response bodies, identifiers, SQL, result
// rows, credentials, certificates, provider messages, or Error objects cross it.
import "server-only";

const PROVIDERS = new Set(["planetScale", "neon", "gcpCloudSql", "vault"]);
const CONNECTION_STAGES = new Set([
  "provider_authorization",
  "gcp_setup_ticket",
  "gcp_credential_validation",
  "integration_lookup",
  "credential_sealing",
  "lease_revocation",
  "integration_persistence",
  "setup_consumption",
]);
const GCP_REQUEST_STAGES = new Set([
  "federation",
  "serviceAccount",
  "iam.serviceAccountPolicy",
  "setup.serviceUsage",
  "setup.workloadIdentity",
  "setup.serviceAccount",
  "setup.projectIam",
  "setup.sqlUser.create",
  "setup.sqlUser.update",
  "setup.sqlUser.delete",
  "setup.sqlUser.read",
  "setup.sqlOperation",
  "setup.sqlInstance",
  "setup.sqlExecution",
  "cloudSqlAdmin.connectSettings",
  "cloudSqlAdmin.instance",
]);
const GCP_CALLBACK_STAGES = new Set([
  "token_exchange",
  "credential_sealing",
  "expired_session_cleanup",
  "setup_session_insert",
]);
const DATABASE_SCHEMA_ERROR_CODES = new Set([
  "3F000",
  "42P01",
  "42703",
  "42704",
  "42883",
]);
const GOOGLE_STATUSES = new Set([
  "ABORTED",
  "ALREADY_EXISTS",
  "DEADLINE_EXCEEDED",
  "FAILED_PRECONDITION",
  "INTERNAL",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "UNAUTHENTICATED",
  "UNAVAILABLE",
]);
const GOOGLE_REASONS = new Set([
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
  "API_KEY_INVALID",
  "BILLING_DISABLED",
  "CREDENTIALS_MISSING",
  "IAM_PERMISSION_DENIED",
  "LOCATION_POLICY_VIOLATED",
  "ORG_RESTRICTION_VIOLATION",
  "RATE_LIMIT_EXCEEDED",
  "RESOURCE_PROJECT_INVALID",
  "SECURITY_POLICY_VIOLATED",
  "SERVICE_DISABLED",
]);
const WORKSPACE_KMS_OPERATIONS = new Set(["encrypt", "decrypt", "rotate"]);
const WORKSPACE_KMS_FAILURE_KINDS = new Set([
  "configuration",
  "oidc",
  "federation",
  "impersonation",
  "encrypt",
  "decrypt",
  "integrity",
  "unavailable",
  "unexpected",
]);
const KNOWLEDGE_MUTATIONS = new Set([
  "project_create",
  "project_delete",
  "environment_create",
  "personal_scope_sync",
]);
const GITHUB_KNOWLEDGE_SETUP_STAGES = new Set([
  "request_validation",
  "setup_lookup",
  "workspace_authorization",
  "state_consumption",
  "installation_inspection",
  "installation_validation",
  "user_authorization",
  "installation_persistence",
]);
const GITHUB_KNOWLEDGE_SETUP_FAILURE_KINDS = new Set([
  "invalid_request",
  "expired_or_unknown_state",
  "unauthorized",
  "authority_changed",
  "provider_request",
  "invalid_installation",
  "installation_not_authorized",
  "database",
  "unexpected",
]);

type SafeLogScalar = string | number | boolean | null;

function category(value: unknown, allowed: Set<string>, fallback = "other") {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

function optionalCategory(value: unknown, allowed: Set<string>) {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

function safeStatus(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599
    ? Number(value)
    : 0;
}

function databaseFailureKind(value: unknown) {
  if (typeof value !== "string" || !/^[0-9A-Z]{5}$/.test(value)) return null;
  if (value === "23505") return "unique_conflict";
  if (DATABASE_SCHEMA_ERROR_CODES.has(value)) return "database_schema";
  if (value.startsWith("08")) return "database_unavailable";
  return "other";
}

export function databaseErrorCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return null;
    const code = "code" in current ? current.code : null;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

function emitServerFailure(
  event: string,
  fields: Readonly<Record<string, SafeLogScalar>>,
) {
  console.error(event, fields);
}

export function logProviderConnectionFailure(input: {
  provider: unknown;
  stage: unknown;
  postgresCode: unknown;
  providerStatus: unknown;
}) {
  emitServerFailure("provider_connection_failed", {
    provider: category(input.provider, PROVIDERS),
    stage: category(input.stage, CONNECTION_STAGES),
    databaseKind: databaseFailureKind(input.postgresCode),
    providerStatus: safeStatus(input.providerStatus),
  });
}

export function logGcpManagedAccessUpstreamRejection(input: {
  stage: unknown;
  upstreamStatus: unknown;
  googleStatus: unknown;
  googleReason: unknown;
}) {
  emitServerFailure("gcp_managed_access_upstream_rejection", {
    stage: category(input.stage, GCP_REQUEST_STAGES),
    upstreamStatus: safeStatus(input.upstreamStatus),
    googleStatus: optionalCategory(input.googleStatus, GOOGLE_STATUSES),
    googleReason: optionalCategory(input.googleReason, GOOGLE_REASONS),
  });
}

export function logGcpCloudSetupCallbackFailure(input: {
  stage: unknown;
  providerRequest: boolean;
  status: unknown;
}) {
  emitServerFailure("gcp_cloud_setup_callback_failed", {
    stage: category(input.stage, GCP_CALLBACK_STAGES),
    kind: input.providerRequest ? "provider_request" : "unexpected",
    status: input.providerRequest ? safeStatus(input.status) : 0,
  });
}

export function logManagedDatabaseAccessFailure(input: {
  provider: unknown;
  providerRequest: boolean;
  status: unknown;
  databaseCode: unknown;
}) {
  const databaseKind = databaseFailureKind(input.databaseCode);
  const kind = input.providerRequest
    ? "provider_request"
    : databaseKind === "database_schema" || databaseKind === "database_unavailable"
      ? databaseKind
      : "unexpected";
  emitServerFailure("managed_database_access_failed", {
    provider: category(input.provider, PROVIDERS),
    kind,
    status: input.providerRequest ? safeStatus(input.status) : 0,
  });
}

export function logWorkspaceKmsFailure(input: {
  operation: unknown;
  kind: unknown;
  status: unknown;
}) {
  emitServerFailure("workspace_kms_failed", {
    operation: category(input.operation, WORKSPACE_KMS_OPERATIONS),
    kind: category(input.kind, WORKSPACE_KMS_FAILURE_KINDS),
    status: safeStatus(input.status),
  });
}

export function logKnowledgeMutationFailure(input: {
  operation: unknown;
  databaseCode: unknown;
}) {
  emitServerFailure("knowledge_mutation_failed", {
    operation: category(input.operation, KNOWLEDGE_MUTATIONS),
    databaseKind: databaseFailureKind(input.databaseCode),
  });
}

export function logGithubKnowledgeSetupFailure(input: {
  stage: unknown;
  kind: unknown;
  status: unknown;
  databaseCode: unknown;
}) {
  emitServerFailure("github_knowledge_setup_failed", {
    stage: category(input.stage, GITHUB_KNOWLEDGE_SETUP_STAGES),
    kind: category(input.kind, GITHUB_KNOWLEDGE_SETUP_FAILURE_KINDS),
    status: safeStatus(input.status),
    databaseKind: databaseFailureKind(input.databaseCode),
  });
}
