import "server-only";

import { gcpDatabaseUsername } from "./gcp-cloud-sql-core";
import { gcpCloudSqlProduction, type GcpSetupCredential } from "./gcp-cloud-oauth";
import { ProviderRequestError } from "./provider-types";
import {
  CLOUD_SQL_IDENTITY_PROPAGATION_TIMEOUT_MS,
  DATA_API_PROPAGATION_TIMEOUT_MS,
  GcpUpstreamRequestError,
  PROPAGATION_RETRY_INTERVAL_MS,
  SQL_ADMIN_ORIGIN,
  googleRequest,
  object,
  waitSqlOperation,
  type GcpCloudBootstrapInput,
  type JsonObject,
} from "./gcp-cloud-bootstrap-core";

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

export type GcpDatabaseBootstrapUser = {
  user: JsonObject;
  created: boolean;
  engine: "postgres" | "mysql";
  originalRoles: string[];
};

function databaseRoles(user: JsonObject) {
  if (user.databaseRoles === undefined) return [];
  if (
    !Array.isArray(user.databaseRoles)
    || user.databaseRoles.length > 100
    || user.databaseRoles.some((role) => (
      typeof role !== "string"
      || role.length === 0
      || role.length > 63
      || /[\u0000-\u001f\u007f]/.test(role)
    ))
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL returned invalid database roles",
      502,
    );
  }
  return [...new Set(user.databaseRoles)].sort();
}

function bootstrapDatabaseUsername(
  email: string,
  engine: "postgres" | "mysql",
) {
  if (!/^[^@\s]{1,128}@[^@\s]{1,190}$/.test(email)) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Google Cloud setup account is invalid",
      403,
    );
  }
  return engine === "postgres" ? email : email.slice(0, email.indexOf("@"));
}

function findBootstrapDatabaseUser(
  rows: unknown[],
  email: string,
  engine: "postgres" | "mysql",
) {
  const expectedName = bootstrapDatabaseUsername(email, engine).toLowerCase();
  const normalizedEmail = email.toLowerCase();
  const candidates = rows.flatMap((value) => (
    value && typeof value === "object" && !Array.isArray(value)
      ? [value as JsonObject]
      : []
  ));
  const exact = candidates.find((row) => (
    row.type === "CLOUD_IAM_USER"
    && (typeof row.iamEmail === "string"
      ? row.iamEmail.toLowerCase() === normalizedEmail
      : typeof row.name === "string"
        && row.name.toLowerCase() === expectedName)
  ));
  const collision = candidates.find((row) => (
    row !== exact
    && typeof row.name === "string"
    && row.name.toLowerCase() === expectedName
  ));
  if (collision) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "The setup account database user name is already in use",
      409,
    );
  }
  return exact ?? null;
}

async function listDatabaseUsers(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
) {
  const body = (await googleRequest(
    credential,
    `${SQL_ADMIN_ORIGIN}/projects/${encodeURIComponent(projectId)}/instances/${
      encodeURIComponent(instanceId)
    }/users`,
  ))!;
  return Array.isArray(body.items) ? body.items : [];
}

async function deleteDatabaseUser(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
  user: JsonObject,
) {
  if (typeof user.name !== "string") return;
  const query = new URLSearchParams({
    name: user.name,
    host: typeof user.host === "string" ? user.host : "",
  });
  const operation = (await googleRequest(
    credential,
    `${SQL_ADMIN_ORIGIN}/projects/${encodeURIComponent(projectId)}/instances/${
      encodeURIComponent(instanceId)
    }/users?${query}`,
    { method: "DELETE" },
  ))!;
  await waitSqlOperation(credential, projectId, operation);
}

export async function prepareDatabaseBootstrapUser(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
  engine: "postgres" | "mysql",
): Promise<GcpDatabaseBootstrapUser> {
  const rows = await listDatabaseUsers(credential, projectId, instanceId);
  const existing = findBootstrapDatabaseUser(
    rows,
    credential.email,
    engine,
  );
  if (existing) {
    const originalRoles = databaseRoles(existing);
    const elevated = !originalRoles.includes("cloudsqlsuperuser");
    if (elevated) {
      try {
        await setDatabaseRoles(
          credential,
          projectId,
          instanceId,
          existing,
          ["cloudsqlsuperuser"],
        );
      } catch (error) {
        await restoreDatabaseBootstrapUser(
          credential,
          projectId,
          instanceId,
          {
            user: existing,
            created: false,
            engine,
            originalRoles,
          },
        ).catch(() => {
          throw new ProviderRequestError(
            "gcpCloudSql",
            "Temporary Cloud SQL setup account cleanup failed",
            409,
          );
        });
        throw error;
      }
    }
    return { user: existing, created: false, engine, originalRoles };
  }

  const operation = (await googleRequest(
    credential,
    `${SQL_ADMIN_ORIGIN}/projects/${encodeURIComponent(projectId)}/instances/${
      encodeURIComponent(instanceId)
    }/users`,
    {
      method: "POST",
      body: JSON.stringify({
        name: credential.email,
        type: "CLOUD_IAM_USER",
        databaseRoles: ["cloudsqlsuperuser"],
      }),
    },
  ))!;
  try {
    await waitSqlOperation(credential, projectId, operation);
    const created = findBootstrapDatabaseUser(
      await listDatabaseUsers(credential, projectId, instanceId),
      credential.email,
      engine,
    );
    if (!created) {
      throw new ProviderRequestError(
        "gcpCloudSql",
        "Cloud SQL did not create the temporary setup user",
        502,
      );
    }
    return {
      user: created,
      created: true,
      engine,
      originalRoles: [],
    };
  } catch (error) {
    const created = findBootstrapDatabaseUser(
      await listDatabaseUsers(credential, projectId, instanceId).catch(() => []),
      credential.email,
      engine,
    );
    if (created) {
      await deleteDatabaseUser(
        credential,
        projectId,
        instanceId,
        created,
      ).catch(() => {
        throw new ProviderRequestError(
          "gcpCloudSql",
          "Temporary Cloud SQL setup account cleanup failed",
          409,
        );
      });
    }
    throw error;
  }
}

export async function restoreDatabaseBootstrapUser(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
  bootstrap: GcpDatabaseBootstrapUser,
) {
  if (bootstrap.created) {
    await deleteDatabaseUser(
      credential,
      projectId,
      instanceId,
      bootstrap.user,
    );
    return;
  }
  const current = findBootstrapDatabaseUser(
    await listDatabaseUsers(credential, projectId, instanceId),
    credential.email,
    bootstrap.engine,
  );
  if (!current) return;
  const currentRoles = databaseRoles(current);
  if (
    currentRoles.length !== bootstrap.originalRoles.length
    || currentRoles.some((role, index) => role !== bootstrap.originalRoles[index])
  ) {
    await setDatabaseRoles(
      credential,
      projectId,
      instanceId,
      current,
      bootstrap.originalRoles,
      true,
    );
  }
}

export async function setDatabaseRoles(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
  user: JsonObject,
  roles: string[],
  revokeExistingRoles = false,
) {
  const userType = user.type;
  if (
    typeof user.name !== "string"
    || (
      userType !== "CLOUD_IAM_SERVICE_ACCOUNT"
      && userType !== "CLOUD_IAM_USER"
    )
    || roles.length > 100
    || new Set(roles).size !== roles.length
    || roles.some((role) => (
      role.length === 0
      || role.length > 63
      || /[\u0000-\u001f\u007f]/.test(role)
    ))
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Invalid Cloud SQL database role assignment",
      409,
    );
  }
  const query = new URLSearchParams({
    name: user.name,
    host: typeof user.host === "string" ? user.host : "",
    revokeExistingRoles: String(revokeExistingRoles),
  });
  for (const role of roles) query.append("databaseRoles", role);
  const operation = (await googleRequest(
    credential,
    `https://sqladmin.googleapis.com/v1/projects/${encodeURIComponent(projectId)
    }/instances/${encodeURIComponent(instanceId)}/users?${query}`,
    {
      method: "PUT",
      body: JSON.stringify({
        name: user.name,
        type: userType,
      }),
    },
  ))!;
  await waitSqlOperation(credential, projectId, operation);
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

export function dataApiState(details: JsonObject) {
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
  return {
    enabled: settings.dataApiAccess === "ALLOW_DATA_API",
    settingsVersion: settings.settingsVersion,
  };
}

export async function setDataApiAccess(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
  allow: boolean,
) {
  const details = await instanceDetails(credential, projectId, instanceId);
  const state = dataApiState(details);
  if (state.enabled !== allow) {
    const operation = (await googleRequest(
      credential,
      `${SQL_ADMIN_ORIGIN}/projects/${encodeURIComponent(projectId)}/instances/${
        encodeURIComponent(instanceId)
      }`,
      {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            settingsVersion: state.settingsVersion,
            dataApiAccess: allow ? "ALLOW_DATA_API" : "DISALLOW_DATA_API",
          },
        }),
      },
    ))!;
    await waitSqlOperation(credential, projectId, operation);
  }

  const startedAt = Date.now();
  for (;;) {
    const confirmed = dataApiState(
      await instanceDetails(credential, projectId, instanceId),
    );
    if (confirmed.enabled === allow) return;
    if (Date.now() - startedAt >= DATA_API_PROPAGATION_TIMEOUT_MS) {
      throw new ProviderRequestError(
        "gcpCloudSql",
        "Cloud SQL Data API 설정 반영이 지연되고 있습니다. 잠시 뒤 다시 시도하세요.",
        503,
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, PROPAGATION_RETRY_INTERVAL_MS)
    );
  }
}
