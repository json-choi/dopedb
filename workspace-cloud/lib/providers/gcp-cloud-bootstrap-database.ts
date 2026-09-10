// Cloud SQL connection setup preserves every existing database user and ACL.
import "server-only";

import { assertDatabaseUserRoles } from "./gcp-cloud-connection-policy";

import { gcpDatabaseUsername } from "./gcp-cloud-sql-core";
import { gcpCloudSqlProduction, type GcpSetupCredential } from "./gcp-cloud-oauth";
import { ProviderRequestError } from "./provider-types";
import {
  CLOUD_SQL_IDENTITY_PROPAGATION_TIMEOUT_MS,
  GcpUpstreamRequestError,
  PROPAGATION_RETRY_INTERVAL_MS,
  SQL_ADMIN_ORIGIN,
  googleRequest,
  object,
  waitSqlOperation,
  type GcpCloudBootstrapInput,
  type JsonObject,
} from "./gcp-cloud-bootstrap-core";
import {
  type GcpDatabaseBootstrapRecovery,
} from "./gcp-cloud-bootstrap-recovery";

export function databaseFlag(
  details: JsonObject,
  engine: "postgres" | "mysql",
) {
  const settings = details.settings && typeof details.settings === "object"
    && !Array.isArray(details.settings)
    ? details.settings as JsonObject
    : null;
  const flags = settings && Array.isArray(settings.databaseFlags)
    ? settings.databaseFlags.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const row = value as JsonObject;
      return typeof row.name === "string" && typeof row.value === "string"
        ? [{ name: row.name, value: row.value }]
        : [];
    })
    : [];
  const name = engine === "postgres"
    ? "cloudsql.iam_authentication"
    : "cloudsql_iam_authentication";
  return {
    settings,
    flags,
    name,
    enabled: flags.some((flag) => (
      flag.name === name
      && ["on", "true", "1"].includes(flag.value.toLowerCase())
    )),
  };
}

export async function instanceDetails(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
) {
  return (await googleRequest(
    credential,
    `${SQL_ADMIN_ORIGIN}/projects/${encodeURIComponent(projectId)}/instances/${
      encodeURIComponent(instanceId)
    }`,
  ))!;
}

export async function ensureEnvironmentClassification(
  credential: GcpSetupCredential,
  input: GcpCloudBootstrapInput,
  classification: "production" | "development",
) {
  const desiredProduction = classification === "production";
  const details = await instanceDetails(
    credential,
    input.projectId,
    input.instanceId,
  );
  const currentProduction = gcpCloudSqlProduction(details);
  if (currentProduction !== "unknown") {
    if (currentProduction !== desiredProduction) {
      throw new ProviderRequestError(
        "gcpCloudSql",
        "Cloud SQL environment classification changed during setup",
        409,
      );
    }
    return currentProduction;
  }
  const settings = details.settings && typeof details.settings === "object"
    && !Array.isArray(details.settings)
    ? details.settings as JsonObject
    : null;
  if (!settings || typeof settings.settingsVersion !== "string") {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL settings version is unavailable",
      409,
    );
  }
  const currentLabels = settings.userLabels
    && typeof settings.userLabels === "object"
    && !Array.isArray(settings.userLabels)
    ? settings.userLabels as JsonObject
    : {};
  let operation: JsonObject;
  try {
    operation = (await googleRequest(
      credential,
      `${SQL_ADMIN_ORIGIN}/projects/${encodeURIComponent(input.projectId)}/instances/${
        encodeURIComponent(input.instanceId)
      }`,
      {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            settingsVersion: settings.settingsVersion,
            userLabels: {
              ...currentLabels,
              environment: classification,
            },
          },
        }),
      },
    ))!;
  } catch (error) {
    if (error instanceof ProviderRequestError && error.status === 403) {
      throw new ProviderRequestError(
        "gcpCloudSql",
        "The Google account needs Cloud SQL Admin permission to classify this instance",
        403,
      );
    }
    throw error;
  }
  await waitSqlOperation(credential, input.projectId, operation);
  const confirmed = await instanceDetails(
    credential,
    input.projectId,
    input.instanceId,
  );
  if (gcpCloudSqlProduction(confirmed) !== desiredProduction) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL environment classification was not applied",
      409,
    );
  }
  return desiredProduction;
}

export async function enableIamAuthentication(
  credential: GcpSetupCredential,
  input: GcpCloudBootstrapInput,
  engine: "postgres" | "mysql",
  details: JsonObject,
) {
  const current = databaseFlag(details, engine);
  if (current.enabled) return false;
  if (!input.approveIamAuthenticationChange) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Approve the Cloud SQL IAM database authentication setting change before it is applied",
      409,
    );
  }
  if (!current.settings || typeof current.settings.settingsVersion !== "string") {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL settings version is unavailable",
      409,
    );
  }
  const flags = [
    ...current.flags.filter((flag) => flag.name !== current.name),
    { name: current.name, value: "on" },
  ];
  const operation = (await googleRequest(
    credential,
    `${SQL_ADMIN_ORIGIN}/projects/${encodeURIComponent(input.projectId)}/instances/${
      encodeURIComponent(input.instanceId)
    }`,
    {
      method: "PATCH",
      body: JSON.stringify({
        settings: {
          settingsVersion: current.settings.settingsVersion,
          databaseFlags: flags,
        },
      }),
    },
  ))!;
  await waitSqlOperation(credential, input.projectId, operation);
  return true;
}

export async function ensureDatabaseUserOnce(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
  email: string,
  engine: "postgres" | "mysql",
  databaseRoles: string[] = [],
) {
  const base = `${SQL_ADMIN_ORIGIN}/projects/${encodeURIComponent(projectId)
  }/instances/${encodeURIComponent(instanceId)}`;
  const users = (await googleRequest(credential, `${base}/users`))!;
  const rows = Array.isArray(users.items) ? users.items : [];
  const databaseUsername = gcpDatabaseUsername(email, engine);
  const existing = rows.find((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as JsonObject;
    return typeof row.name === "string"
      && (
        row.name.toLowerCase() === email.toLowerCase()
        || row.name.toLowerCase() === databaseUsername.toLowerCase()
        || `${row.name}.gserviceaccount.com`.toLowerCase() === email.toLowerCase()
      );
  });
  if (existing) {
    if ((existing as JsonObject).type !== "CLOUD_IAM_SERVICE_ACCOUNT") {
      throw new ProviderRequestError(
        "gcpCloudSql",
        "A database user name is already used by a non-IAM account",
        409,
      );
    }
    assertDatabaseUserRoles(existing as JsonObject, databaseRoles);
    return existing as JsonObject;
  }
  const operation = (await googleRequest(
    credential,
    `${base}/users`,
    {
      method: "POST",
      body: JSON.stringify({
        name: engine === "postgres" ? databaseUsername : email,
        type: "CLOUD_IAM_SERVICE_ACCOUNT",
        ...(databaseRoles.length > 0 ? { databaseRoles } : {}),
      }),
    },
  ))!;
  await waitSqlOperation(credential, projectId, operation);
  const refreshed = (await googleRequest(credential, `${base}/users`))!;
  const created = (Array.isArray(refreshed.items) ? refreshed.items : []).find((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as JsonObject;
    return row.type === "CLOUD_IAM_SERVICE_ACCOUNT"
      && typeof row.name === "string"
      && (
        row.name.toLowerCase() === email.toLowerCase()
        || row.name.toLowerCase() === databaseUsername.toLowerCase()
        || `${row.name}.gserviceaccount.com`.toLowerCase() === email.toLowerCase()
      );
  });
  if (!created) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL did not create the IAM database user",
      502,
    );
  }
  assertDatabaseUserRoles(created as JsonObject, databaseRoles);
  return created as JsonObject;
}

export function cloudSqlIdentityPropagationPending(error: unknown) {
  if (error instanceof GcpUpstreamRequestError) {
    return [400, 404, 409, 429, 500, 502, 503].includes(
      error.upstreamStatus,
    );
  }
  return error instanceof ProviderRequestError
    && [502, 503].includes(error.status);
}

export async function ensureDatabaseUser(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
  email: string,
  engine: "postgres" | "mysql",
  databaseRoles: string[] = [],
) {
  const startedAt = Date.now();
  for (;;) {
    try {
      return await ensureDatabaseUserOnce(
        credential,
        projectId,
        instanceId,
        email,
        engine,
        databaseRoles,
      );
    } catch (error) {
      if (!cloudSqlIdentityPropagationPending(error)) throw error;
      if (
        Date.now() - startedAt
        >= CLOUD_SQL_IDENTITY_PROPAGATION_TIMEOUT_MS
      ) {
        throw new ProviderRequestError(
          "gcpCloudSql",
          "새 Google Cloud 서비스 계정이 아직 Cloud SQL에 반영되지 않았습니다. 잠시 뒤 다시 시도하세요.",
          503,
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, PROPAGATION_RETRY_INTERVAL_MS)
      );
    }
  }
}

// Old interrupted setup journals are retained for a separate administrator review.
// A connection retry must not revoke roles or delete an existing login account.
export async function recoverDatabaseBootstrapUser(
  _credential: GcpSetupCredential,
  _recovery: GcpDatabaseBootstrapRecovery,
) {
  throw new ProviderRequestError(
    "gcpCloudSql",
    "An earlier setup left a database privilege recovery record. An administrator must review it separately; reconnect will not change existing users or permissions.",
    409,
  );
}

export async function databaseNames(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
) {
  const body = (await googleRequest(
    credential,
    `${SQL_ADMIN_ORIGIN}/projects/${encodeURIComponent(projectId)}/instances/${
      encodeURIComponent(instanceId)
    }/databases`,
  ))!;
  if (typeof body.nextPageToken === "string") {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL database scope is too large to configure safely",
      409,
    );
  }
  const names = (Array.isArray(body.items) ? body.items : []).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const name = (value as JsonObject).name;
    return typeof name === "string" && name.length > 0 && name.length <= 128
      ? [name]
      : [];
  });
  if (names.length > 100) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL database scope is too large to configure safely",
      409,
    );
  }
  return names;
}
