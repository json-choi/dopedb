// Idempotent Google Cloud bootstrap for one workspace/Cloud SQL instance.
// The caller's short-lived OAuth token performs setup; the returned durable
// configuration contains only WIF coordinates and service-account identities.
import "server-only";

import { createHash } from "node:crypto";
import { boundedJsonResponse } from "../bounded-json-response";
import {
  gcpCloudSqlEngine,
  gcpDatabaseUsername,
  parseGcpCloudSqlCredential,
  type GcpCloudSqlCredential,
} from "./gcp-cloud-sql-core";
import {
  gcpCloudSqlProduction,
  listGcpOAuthInstances,
  type GcpSetupCredential,
} from "./gcp-cloud-oauth";
import { validateGcpCloudSqlCredential } from "./gcp-cloud-sql";
import { ProviderRequestError } from "./provider-types";
import { verifyVercelOidcToken } from "./vercel-oidc";

export const IAM_ORIGIN = "https://iam.googleapis.com";
export const IAM_CREDENTIALS_ORIGIN = "https://iamcredentials.googleapis.com";
export const RESOURCE_MANAGER_ORIGIN = "https://cloudresourcemanager.googleapis.com";
export const SERVICE_USAGE_ORIGIN = "https://serviceusage.googleapis.com";
export const SQL_ADMIN_ORIGIN = "https://sqladmin.googleapis.com/sql/v1beta4";
export const REQUEST_TIMEOUT_MS = 30_000;
export const OPERATION_TIMEOUT_MS = 210_000;
export const CLOUD_SQL_IDENTITY_PROPAGATION_TIMEOUT_MS = 90_000;
export const DATA_API_PROPAGATION_TIMEOUT_MS = 30_000;
export const PROPAGATION_RETRY_INTERVAL_MS = 5_000;
export const MAX_GOOGLE_RESPONSE_BYTES = 2 * 1_024 * 1_024;
export const POOL_ID = "dopedb-vercel";
export const PROVIDER_ID = "dopedb-vercel";
export const REQUIRED_SERVICES = [
  "cloudresourcemanager.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "sqladmin.googleapis.com",
  "sts.googleapis.com",
] as const;
export type JsonObject = Record<string, unknown>;

export type GcpSetupPermissionRequirement = {
  role: string;
  label: string;
  purpose: string;
  missingPermissions: string[];
};

export type GcpSetupPermissionCheck = {
  account: string;
  projectId: string;
  canAutoGrant: boolean;
  missing: GcpSetupPermissionRequirement[];
};

export const GCP_SETUP_ROLE_REQUIREMENTS = [
  {
    role: "roles/serviceusage.serviceUsageAdmin",
    label: "Service Usage Admin",
    purpose: "필수 Google Cloud API 활성화",
    permissions: [
      "serviceusage.services.enable",
      "serviceusage.services.use",
    ],
  },
  {
    role: "roles/iam.workloadIdentityPoolAdmin",
    label: "Workload Identity Pool Admin",
    purpose: "키 없이 연결할 Workload Identity Pool과 Provider 구성",
    permissions: [
      "iam.workloadIdentityPools.create",
      "iam.workloadIdentityPoolProviders.create",
    ],
  },
  {
    role: "roles/iam.serviceAccountAdmin",
    label: "Service Account Admin",
    purpose: "연결 전용 서비스 계정 생성과 IAM 정책 구성",
    permissions: [
      "iam.serviceAccounts.create",
      "iam.serviceAccounts.delete",
      "iam.serviceAccounts.getIamPolicy",
      "iam.serviceAccounts.setIamPolicy",
    ],
  },
  {
    role: "roles/resourcemanager.projectIamAdmin",
    label: "Project IAM Admin",
    purpose: "Cloud SQL 인스턴스 범위의 최소 권한 부여",
    permissions: [
      "resourcemanager.projects.getIamPolicy",
      "resourcemanager.projects.setIamPolicy",
    ],
  },
  {
    role: "roles/cloudsql.admin",
    label: "Cloud SQL Admin",
    purpose: "IAM DB 인증과 전용 데이터베이스 사용자 구성",
    permissions: [
      "cloudsql.instances.executeSql",
      "cloudsql.instances.update",
      "cloudsql.users.create",
      "cloudsql.users.delete",
      "cloudsql.users.list",
      "cloudsql.users.update",
    ],
  },
] as const;

export type GcpCloudBootstrapInput = {
  workspaceId: string;
  projectId: string;
  projectNumber: string;
  instanceId: string;
  environmentClassification: "production" | "development" | null;
  writeAccess: boolean;
  approveProduction: boolean;
  approveIamAuthenticationChange: boolean;
};

export type GcpCloudBootstrapResult = {
  configuration: GcpCloudSqlCredential;
  engine: "postgres" | "mysql";
  production: boolean;
  iamAuthenticationChanged: boolean;
  databaseUsers: {
    read: string;
    write: string | null;
  };
};

export function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Google Cloud returned an invalid response",
      502,
    );
  }
  return value as JsonObject;
}

export function safeSegment(value: string, pattern: RegExp, message: string) {
  if (!pattern.test(value)) {
    throw new ProviderRequestError("gcpCloudSql", message, 400);
  }
  return encodeURIComponent(value);
}

export function quotaProjectCredential(
  credential: GcpSetupCredential,
  projectId: string,
): GcpSetupCredential {
  safeSegment(
    projectId,
    /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
    "Invalid Google Cloud project",
  );
  return { ...credential, quotaProjectId: projectId };
}

export type GoogleErrorInfo = {
  reason: string;
  service: string;
  consumer: string;
};

export class GcpUpstreamRequestError extends ProviderRequestError {
  constructor(
    message: string,
    status: number,
    public readonly upstreamStatus: number,
    public readonly iamServiceAccountPropagationPending: boolean,
  ) {
    super("gcpCloudSql", message, status);
    this.name = "GcpUpstreamRequestError";
  }
}

export function googleErrorInfo(body: unknown): GoogleErrorInfo {
  const empty = { reason: "", service: "", consumer: "" };
  if (!body || typeof body !== "object" || Array.isArray(body)) return empty;
  const error = (body as JsonObject).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return empty;
  const details = Array.isArray((error as JsonObject).details)
    ? (error as JsonObject).details as unknown[]
    : [];
  for (const detail of details) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) continue;
    const row = detail as JsonObject;
    const reason = row.reason;
    if (typeof reason === "string" && /^[A-Z0-9_]{1,100}$/.test(reason)) {
      const metadata = row.metadata;
      const values = metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata as JsonObject
        : {};
      const service = typeof values.service === "string"
        && /^[a-z0-9.-]{1,128}\.googleapis\.com$/.test(values.service)
        ? values.service
        : "";
      const consumer = typeof values.consumer === "string"
        && /^projects\/[A-Za-z0-9.-]{1,64}$/.test(values.consumer)
        ? values.consumer
        : "";
      return { reason, service, consumer };
    }
  }
  return empty;
}

export function googleErrorMessage(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const error = (body as JsonObject).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const message = (error as JsonObject).message;
  return typeof message === "string" && message.length <= 500 ? message : "";
}

export function iamServiceAccountPropagationPending(
  status: number,
  url: string,
  body: unknown,
) {
  if (
    status !== 400
    || !url.startsWith(RESOURCE_MANAGER_ORIGIN)
    || !url.endsWith(":setIamPolicy")
  ) {
    return false;
  }
  return /^Service account [a-z][a-z0-9-]{4,29}@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com does not exist\.$/
    .test(googleErrorMessage(body));
}

export function upstreamMessage(status: number, url: string, body: unknown) {
  if (status === 401) return "Google Cloud 승인이 만료되었습니다. 계정을 다시 연결하세요.";
  if (status === 403) {
    const { reason, service, consumer } = googleErrorInfo(body);
    if (reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") {
      return "Google 승인에 cloud-platform 권한이 포함되지 않았습니다. 계정을 다시 연결하고 Google Cloud 접근을 승인하세요.";
    }
    if (reason === "SERVICE_DISABLED") {
      if (service && consumer) {
        return `Google Cloud API ${service}가 quota project ${consumer}에서 비활성화되어 있습니다.`;
      }
      if (service) {
        return `Google Cloud API ${service}가 quota project에서 비활성화되어 있습니다.`;
      }
      return "quota project에 필요한 Google Cloud API가 비활성화되어 있습니다.";
    }
    if (reason.includes("ORG_POLICY")) {
      return "Google Cloud 조직 정책이 이 설정 작업을 차단했습니다.";
    }
    if (url.startsWith(SERVICE_USAGE_ORIGIN)) {
      return "필수 API를 활성화할 수 없습니다. Service Usage Admin 권한이 필요합니다.";
    }
    if (url.startsWith(IAM_CREDENTIALS_ORIGIN)) {
      return "임시 서비스 계정 자격 증명을 발급할 수 없습니다.";
    }
    if (url.startsWith(IAM_ORIGIN) && url.includes("workloadIdentityPool")) {
      return "Workload Identity를 구성할 수 없습니다. Workload Identity Pool Admin 권한이 필요합니다.";
    }
    if (url.startsWith(IAM_ORIGIN) && url.includes("serviceAccounts")) {
      return "서비스 계정을 구성할 수 없습니다. Service Account Admin 권한이 필요합니다.";
    }
    if (url.startsWith(RESOURCE_MANAGER_ORIGIN)) {
      return "프로젝트 IAM 정책을 변경할 수 없습니다. Project IAM Admin 권한이 필요합니다.";
    }
    if (url.startsWith(SQL_ADMIN_ORIGIN)) {
      return "Cloud SQL 설정을 변경할 수 없습니다. Cloud SQL Admin 권한이 필요합니다.";
    }
    return "Google Cloud에서 이 설정 작업을 거부했습니다.";
  }
  if (status === 404) return "선택한 Google Cloud 리소스를 찾지 못했습니다.";
  if (status === 409) return "기존 Google Cloud 리소스가 이 DopeDB 설정과 충돌합니다.";
  if (status === 429) return "Google Cloud 요청 한도에 도달했습니다. 잠시 뒤 다시 시도하세요.";
  return "Google Cloud 설정을 완료하지 못했습니다.";
}

export async function googleRequest(
  credential: GcpSetupCredential,
  url: string,
  init: RequestInit = {},
  allowNotFound = false,
): Promise<JsonObject | null> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
      authorization: `Bearer ${credential.accessToken}`,
      ...(credential.quotaProjectId
        ? { "x-goog-user-project": credential.quotaProjectId }
        : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Google Cloud is unavailable",
      502,
    );
  });
  if (allowNotFound && response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const body = await boundedJsonResponse(response, MAX_GOOGLE_RESPONSE_BYTES)
    .catch(() => null);
  if (!response.ok || !body) {
    throw new GcpUpstreamRequestError(
      upstreamMessage(response.status, url, body),
      response.status === 401 || response.status === 403 || response.status === 404
        ? response.status
        : response.status === 409
          ? 409
          : 502,
      response.status,
      iamServiceAccountPropagationPending(response.status, url, body),
    );
  }
  return object(body);
}

export async function checkGcpSetupPermissions(
  credential: GcpSetupCredential,
  projectId: string,
): Promise<GcpSetupPermissionCheck> {
  const scopedCredential = quotaProjectCredential(credential, projectId);
  const requested = GCP_SETUP_ROLE_REQUIREMENTS.flatMap(
    (requirement) => [...requirement.permissions],
  );
  const body = (await googleRequest(
    scopedCredential,
    `${RESOURCE_MANAGER_ORIGIN}/v3/projects/${encodeURIComponent(projectId)
    }:testIamPermissions`,
    {
      method: "POST",
      body: JSON.stringify({ permissions: requested }),
    },
  ))!;
  const granted = new Set(
    Array.isArray(body.permissions)
      ? body.permissions.filter(
          (permission): permission is string => typeof permission === "string",
        )
      : [],
  );
  const missing = GCP_SETUP_ROLE_REQUIREMENTS.flatMap((requirement) => {
    const missingPermissions = requirement.permissions.filter(
      (permission) => !granted.has(permission),
    );
    return missingPermissions.length > 0
      ? [{
          role: requirement.role,
          label: requirement.label,
          purpose: requirement.purpose,
          missingPermissions,
        }]
      : [];
  });
  return {
    account: credential.email,
    projectId,
    canAutoGrant:
      granted.has("resourcemanager.projects.getIamPolicy")
      && granted.has("resourcemanager.projects.setIamPolicy"),
    missing,
  };
}

export function operationName(value: JsonObject) {
  if (
    typeof value.name !== "string"
    || !/^[A-Za-z0-9_./-]{1,500}$/.test(value.name)
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Google Cloud setup operation was not identified",
      502,
    );
  }
  return value.name;
}

export function operationFailed(value: JsonObject) {
  if (!value.error) return false;
  const error = object(value.error);
  return typeof error.code === "number" && error.code !== 0;
}

export async function waitOperation(
  credential: GcpSetupCredential,
  origin: string,
  version: string,
  operation: JsonObject,
) {
  const name = operationName(operation);
  const startedAt = Date.now();
  let current = operation;
  while (current.done !== true) {
    if (Date.now() - startedAt > OPERATION_TIMEOUT_MS) {
      throw new ProviderRequestError(
        "gcpCloudSql",
        "Google Cloud setup is still running. Retry to continue safely.",
        503,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    current = (await googleRequest(
      credential,
      `${origin}/${version}/${name.split("/").map(encodeURIComponent).join("/")}`,
    ))!;
  }
  if (operationFailed(current)) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Google Cloud setup operation failed",
      409,
    );
  }
}

export async function waitSqlOperation(
  credential: GcpSetupCredential,
  projectId: string,
  operation: JsonObject,
) {
  const name = operationName(operation);
  const startedAt = Date.now();
  let current = operation;
  while (current.status !== "DONE") {
    if (Date.now() - startedAt > OPERATION_TIMEOUT_MS) {
      throw new ProviderRequestError(
        "gcpCloudSql",
        "Cloud SQL is still applying the change. Retry to continue safely.",
        503,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    current = (await googleRequest(
      credential,
      `${SQL_ADMIN_ORIGIN}/projects/${encodeURIComponent(projectId)}/operations/${
        encodeURIComponent(name)
      }`,
    ))!;
  }
  if (current.error) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL rejected the requested change",
      409,
    );
  }
}

export async function enableServices(
  credential: GcpSetupCredential,
  projectNumber: string,
) {
  const operation = (await googleRequest(
    credential,
    `${SERVICE_USAGE_ORIGIN}/v1/projects/${encodeURIComponent(projectNumber)}/services:batchEnable`,
    {
      method: "POST",
      body: JSON.stringify({ serviceIds: REQUIRED_SERVICES }),
    },
  ))!;
  await waitOperation(credential, SERVICE_USAGE_ORIGIN, "v1", operation);
}
