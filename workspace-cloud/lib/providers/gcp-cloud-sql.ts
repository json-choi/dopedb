// GCP Cloud SQL adapter using Vercel OIDC and Workload Identity Federation.
// Customer service-account keys are never created, uploaded, or persisted.
import "server-only";

import {
  GCP_LEASE_SECONDS,
  GCP_SCHEMA_LEASE_SECONDS,
  gcpCloudSqlEngine,
  gcpConnectionTarget,
  gcpDatabaseUsername,
  gcpWifAudience,
  parseGcpCloudSqlCredential,
  type GcpCloudSqlCredential,
  type GcpCloudSqlResource,
} from "./gcp-cloud-sql-core";
import {
  ProviderRequestError,
  type ManagedAccessMode,
  type ManagedProviderLease,
  type ProviderResourceItem,
} from "./provider-types";
import {
  gcpJsonRequest,
  type GcpRequestStage,
} from "./gcp-cloud-managed-http";
import { verifyGcpSchemaServiceAccountPolicy } from "./gcp-cloud-schema-authority";

const STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_CREDENTIALS_ORIGIN = "https://iamcredentials.googleapis.com";
const SQL_ADMIN_ORIGIN = "https://sqladmin.googleapis.com/sql/v1beta4";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const SQL_LOGIN_SCOPE = "https://www.googleapis.com/auth/sqlservice.login";
type JsonObject = Record<string, unknown>;

type GcpAccessToken = {
  accessToken: string;
  expiresAt: string;
};

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderRequestError("gcpCloudSql", "GCP returned an invalid response", 502);
  }
  return value as JsonObject;
}

function requireCurrentSecurityConfiguration(
  credential: GcpCloudSqlCredential,
) {
  try {
    parseGcpCloudSqlCredential(credential);
  } catch {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Reconnect GCP with a dedicated instance and instance-scoped IAM confirmation",
      409,
    );
  }
}

function requiredString(value: unknown, field: string, maxLength: number) {
  if (
    typeof value !== "string"
    || !value
    || value.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ProviderRequestError("gcpCloudSql", `GCP response omitted ${field}`, 502);
  }
  return value;
}

function requestOidcToken(value: string | null) {
  if (
    !value
    || value.length < 100
    || value.length > 32 * 1_024
    || value.split(".").length !== 3
    || /\s/.test(value)
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Vercel OIDC is not available for GCP federation",
      503,
    );
  }
  return value;
}

export function vercelOidcToken(request: Request): string | null {
  if (process.env.VERCEL === "1") {
    return request.headers.get("x-vercel-oidc-token");
  }
  if (process.env.NODE_ENV !== "production") {
    return process.env.VERCEL_OIDC_TOKEN?.trim() || null;
  }
  return null;
}

async function federatedToken(
  credential: GcpCloudSqlCredential,
  oidcToken: string,
) {
  const body = await gcpJsonRequest("federation", STS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audience: gcpWifAudience(credential),
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      scope: CLOUD_PLATFORM_SCOPE,
      subjectToken: requestOidcToken(oidcToken),
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    }),
  });
  return requiredString(body.access_token, "federated access token", 32 * 1_024);
}

async function serviceAccountTokenFromFederation(input: {
  credential: GcpCloudSqlCredential;
  federatedAccessToken: string;
  serviceAccountEmail: string;
  scope: string;
  lifetimeSeconds?: number;
}): Promise<GcpAccessToken> {
  requireCurrentSecurityConfiguration(input.credential);
  const lifetimeSeconds = input.lifetimeSeconds ?? GCP_LEASE_SECONDS;
  if (
    !Number.isInteger(lifetimeSeconds)
    || lifetimeSeconds < 60
    || lifetimeSeconds > GCP_LEASE_SECONDS
  ) {
    throw new ProviderRequestError("gcpCloudSql", "Invalid GCP token lifetime", 500);
  }
  const body = await gcpJsonRequest(
    "serviceAccount",
    `${IAM_CREDENTIALS_ORIGIN}/v1/projects/-/serviceAccounts/${
      encodeURIComponent(input.serviceAccountEmail)
    }:generateAccessToken`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.federatedAccessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scope: [input.scope],
        lifetime: `${lifetimeSeconds}s`,
      }),
    },
  );
  const accessToken = requiredString(
    body.accessToken,
    "service account access token",
    32 * 1_024,
  );
  const expiresAt = requiredString(body.expireTime, "service account token expiry", 64);
  const validMs = new Date(expiresAt).valueOf() - Date.now();
  if (
    !Number.isFinite(validMs)
    || validMs < 60_000
    || validMs > (lifetimeSeconds + 60) * 1_000
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "GCP returned an unsafe token expiry",
      502,
    );
  }
  return { accessToken, expiresAt: new Date(expiresAt).toISOString() };
}

async function serviceAccountToken(input: {
  credential: GcpCloudSqlCredential;
  oidcToken: string;
  serviceAccountEmail: string;
  scope: string;
}): Promise<GcpAccessToken> {
  const federatedAccessToken = await federatedToken(
    input.credential,
    input.oidcToken,
  );
  return serviceAccountTokenFromFederation({
    credential: input.credential,
    federatedAccessToken,
    serviceAccountEmail: input.serviceAccountEmail,
    scope: input.scope,
  });
}

async function controlPlaneToken(
  credential: GcpCloudSqlCredential,
  oidcToken: string,
) {
  return serviceAccountToken({
    credential,
    oidcToken,
    serviceAccountEmail: credential.readServiceAccountEmail,
    scope: CLOUD_PLATFORM_SCOPE,
  });
}

function verifySchemaServiceAccountPolicy(
  credential: GcpCloudSqlCredential,
  controlAccessToken: string,
) {
  return verifyGcpSchemaServiceAccountPolicy({
    credential,
    controlAccessToken,
    request: (url, init) => gcpJsonRequest(
      "iam.serviceAccountPolicy",
      url,
      init,
    ),
  });
}

async function sqlAdminRequest(
  credential: GcpCloudSqlCredential,
  accessToken: string,
  stage: Extract<GcpRequestStage, `cloudSqlAdmin.${string}`>,
  path: string,
): Promise<JsonObject> {
  return gcpJsonRequest(
    stage,
    `${SQL_ADMIN_ORIGIN}${path}`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-goog-user-project": credential.projectId,
      },
    },
  );
}

function pathSegment(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Invalid Cloud SQL resource identifier",
      400,
    );
  }
  return encodeURIComponent(value);
}

function gcpInstanceProduction(details: JsonObject): true | false | "unknown" {
  const settings = details.settings;
  const labels = settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as JsonObject).userLabels
    : null;
  const environmentValue = labels && typeof labels === "object" && !Array.isArray(labels)
    ? (labels as JsonObject).environment
    : null;
  const environment = typeof environmentValue === "string"
    ? environmentValue.trim().toLowerCase()
    : null;
  return environment === "prod" || environment === "production"
    ? true
    : environment !== null && /^(dev|development|stage|staging|test|sandbox)$/.test(environment)
      ? false
      : "unknown";
}

export async function validateGcpCloudSqlCredential(
  credential: GcpCloudSqlCredential,
  oidcToken: string,
) {
  const federatedAccessToken = await federatedToken(credential, oidcToken);
  const controlPromise = serviceAccountTokenFromFederation({
    credential,
    federatedAccessToken,
    serviceAccountEmail: credential.readServiceAccountEmail,
    scope: CLOUD_PLATFORM_SCOPE,
  });
  const [control] = await Promise.all([
    controlPromise,
    serviceAccountTokenFromFederation({
      credential,
      federatedAccessToken,
      serviceAccountEmail: credential.readServiceAccountEmail,
      scope: SQL_LOGIN_SCOPE,
    }),
    ...(credential.writeServiceAccountEmail ? [
      serviceAccountTokenFromFederation({
        credential,
        federatedAccessToken,
        serviceAccountEmail: credential.writeServiceAccountEmail,
        scope: SQL_LOGIN_SCOPE,
      }),
    ] : []),
    ...(credential.schemaServiceAccountEmail ? [
      serviceAccountTokenFromFederation({
        credential,
        federatedAccessToken,
        serviceAccountEmail: credential.schemaServiceAccountEmail,
        scope: SQL_LOGIN_SCOPE,
        lifetimeSeconds: GCP_SCHEMA_LEASE_SECONDS,
      }),
    ] : []),
  ]);
  const [details] = await Promise.all([
    instanceDetailsWithToken(
      credential,
      control.accessToken,
      credential.instanceId,
    ),
    credential.schemaServiceAccountEmail
      ? verifySchemaServiceAccountPolicy(credential, control.accessToken)
      : Promise.resolve(),
  ]);
  if (
    details.name !== credential.instanceId
    || !gcpCloudSqlEngine(details.databaseVersion)
    || details.state !== "RUNNABLE"
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "The dedicated Cloud SQL instance was not found or is not runnable",
      409,
    );
  }
}

export function listGcpProjects(
  credential: GcpCloudSqlCredential,
): ProviderResourceItem[] {
  return [{
    id: credential.projectId,
    value: credential.projectId,
    name: credential.projectId,
    ready: true,
    production: "unknown",
  }];
}

export async function listGcpCloudSqlInstances(
  credential: GcpCloudSqlCredential,
  oidcToken: string,
): Promise<ProviderResourceItem[]> {
  const token = await controlPlaneToken(credential, oidcToken);
  return listGcpCloudSqlInstancesWithToken(credential, token.accessToken);
}

async function listGcpCloudSqlInstancesWithToken(
  credential: GcpCloudSqlCredential,
  accessToken: string,
): Promise<ProviderResourceItem[]> {
  const row = await instanceDetailsWithToken(
    credential,
    accessToken,
    credential.instanceId,
  );
  const kind = gcpCloudSqlEngine(row.databaseVersion);
  if (!kind) return [];
  const name = requiredString(row.name, "instance name", 128);
  if (name !== credential.instanceId) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "GCP returned an unexpected Cloud SQL instance",
      502,
    );
  }
  return [{
    id: name,
    value: name,
    name,
    kind,
    production: gcpInstanceProduction(row),
    ready: row.state === "RUNNABLE",
  }];
}

export async function listGcpCloudSqlDatabases(
  credential: GcpCloudSqlCredential,
  _oidcToken: string,
  instance: string,
  engine: "postgres" | "mysql" | null,
): Promise<ProviderResourceItem[]> {
  return configuredGcpCloudSqlDatabases(credential, instance, engine);
}

function configuredGcpCloudSqlDatabases(
  credential: GcpCloudSqlCredential,
  instance: string,
  engine: "postgres" | "mysql" | null,
): Promise<ProviderResourceItem[]> {
  requireDedicatedInstance(credential, instance);
  if (credential.databaseNames.length === 0) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "이 Cloud SQL 계정 연결은 고정 DB 목록을 저장하기 전 버전입니다. 클라우드 계정에서 다시 연결해 주세요.",
      409,
    );
  }
  return Promise.resolve(credential.databaseNames.map((name) => ({
      id: name,
      value: name,
      name,
      ...(engine ? { kind: engine } : {}),
      ready: true,
      production: "unknown" as const,
  })));
}

function requireDedicatedInstance(
  credential: GcpCloudSqlCredential,
  instance: string,
) {
  if (instance !== credential.instanceId) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "This integration is restricted to its dedicated Cloud SQL instance",
      403,
    );
  }
}

async function connectSettingsWithToken(
  credential: GcpCloudSqlCredential,
  accessToken: string,
  instance: string,
) {
  return sqlAdminRequest(
    credential,
    accessToken,
    "cloudSqlAdmin.connectSettings",
    `/projects/${pathSegment(credential.projectId)}/instances/${
      pathSegment(instance)
    }/connectSettings`,
  );
}

async function instanceDetailsWithToken(
  credential: GcpCloudSqlCredential,
  accessToken: string,
  instance: string,
) {
  return sqlAdminRequest(
    credential,
    accessToken,
    "cloudSqlAdmin.instance",
    `/projects/${pathSegment(credential.projectId)}/instances/${
      pathSegment(instance)
    }`,
  );
}

function requireIamDatabaseConfiguration(
  instance: JsonObject,
  engine: "postgres" | "mysql",
) {
  const settings = instance.settings;
  const flags = settings && typeof settings === "object" && !Array.isArray(settings)
    && Array.isArray((settings as JsonObject).databaseFlags)
    ? ((settings as JsonObject).databaseFlags as unknown[]).map(object)
    : [];
  const requiredFlag = engine === "postgres"
    ? "cloudsql.iam_authentication"
    : "cloudsql_iam_authentication";
  const enabled = flags.some((flag) => (
    flag.name === requiredFlag
    && ["on", "true", "1"].includes(String(flag.value).toLowerCase())
  ));
  if (!enabled) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      `Cloud SQL IAM database authentication flag '${requiredFlag}' is not enabled`,
      409,
    );
  }
}

export async function validateGcpCloudSqlResource(
  credential: GcpCloudSqlCredential,
  oidcToken: string,
  resource: GcpCloudSqlResource,
) {
  if (resource.project !== credential.projectId) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL project does not match the integration",
      403,
    );
  }
  requireDedicatedInstance(credential, resource.instance);
  const control = await controlPlaneToken(credential, oidcToken);
  const [databases, settings, details] = await Promise.all([
    configuredGcpCloudSqlDatabases(
      credential,
      resource.instance,
      resource.engine,
    ),
    connectSettingsWithToken(credential, control.accessToken, resource.instance),
    instanceDetailsWithToken(credential, control.accessToken, resource.instance),
  ]);
  if (
    gcpCloudSqlEngine(details.databaseVersion) !== resource.engine
    || details.state !== "RUNNABLE"
    || gcpInstanceProduction(details) !== resource.production
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL instance was not found or is not runnable",
      404,
    );
  }
  if (!databases.some((item) => item.value === resource.database)) {
    throw new ProviderRequestError("gcpCloudSql", "Cloud SQL database was not found", 404);
  }
  requireIamDatabaseConfiguration(
    details,
    resource.engine,
  );
  try {
    gcpConnectionTarget({
      connectSettings: settings,
      instanceDetails: details,
      networkMode: resource.networkMode,
    });
  } catch (error) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      error instanceof Error ? error.message : "Cloud SQL connection is unavailable",
      409,
    );
  }
  const connectionName = details.connectionName;
  const connectionParts = typeof connectionName === "string"
    ? connectionName.split(":")
    : [];
  if (
    connectionParts.length !== 3
    || connectionParts[0] !== resource.project
    || !/^[a-z][a-z0-9-]{0,62}$/.test(connectionParts[1] ?? "")
    || connectionParts[2] !== resource.instance
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL instance identity changed during verification",
      409,
    );
  }
  return { providerAuditId: connectionName };
}

export async function issueGcpCloudSqlLease(input: {
  credential: GcpCloudSqlCredential;
  oidcToken: string;
  resource: GcpCloudSqlResource;
  accessMode: ManagedAccessMode;
  externalCredentialId: string;
}): Promise<ManagedProviderLease> {
  if (input.accessMode === "schema" && input.resource.engine !== "postgres") {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL managed schema access requires PostgreSQL",
      409,
    );
  }
  if (input.resource.project !== input.credential.projectId) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL project does not match the integration",
      403,
    );
  }
  requireDedicatedInstance(input.credential, input.resource.instance);
  const serviceAccountEmail = input.accessMode === "schema"
    ? input.credential.schemaServiceAccountEmail
    : input.accessMode === "write"
      ? input.credential.writeServiceAccountEmail
      : input.credential.readServiceAccountEmail;
  if (!serviceAccountEmail) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      input.accessMode === "schema"
        ? "Reconnect this Cloud SQL integration to configure managed schema access"
        : "Cloud SQL write service account is not configured",
      409,
    );
  }
  const leaseSeconds = input.accessMode === "schema"
    ? GCP_SCHEMA_LEASE_SECONDS
    : GCP_LEASE_SECONDS;
  const federatedAccessToken = await federatedToken(
    input.credential,
    input.oidcToken,
  );
  const connectorTokenPromise = serviceAccountTokenFromFederation({
    credential: input.credential,
    federatedAccessToken,
    serviceAccountEmail,
    scope: CLOUD_PLATFORM_SCOPE,
    lifetimeSeconds: leaseSeconds,
  });
  const controlTokenPromise = serviceAccountEmail
    === input.credential.readServiceAccountEmail
    ? connectorTokenPromise
    : serviceAccountTokenFromFederation({
        credential: input.credential,
        federatedAccessToken,
        serviceAccountEmail: input.credential.readServiceAccountEmail,
        scope: CLOUD_PLATFORM_SCOPE,
      });
  const [loginToken, connectorToken, control] = await Promise.all([
    serviceAccountTokenFromFederation({
      credential: input.credential,
      federatedAccessToken,
      serviceAccountEmail,
      scope: SQL_LOGIN_SCOPE,
      lifetimeSeconds: leaseSeconds,
    }),
    connectorTokenPromise,
    controlTokenPromise,
  ]);
  const [settings, details, databases] = await Promise.all([
    connectSettingsWithToken(
      input.credential,
      control.accessToken,
      input.resource.instance,
    ),
    instanceDetailsWithToken(
      input.credential,
      control.accessToken,
      input.resource.instance,
    ),
    configuredGcpCloudSqlDatabases(
      input.credential,
      input.resource.instance,
      input.resource.engine,
    ),
    input.accessMode === "schema"
      ? verifySchemaServiceAccountPolicy(input.credential, control.accessToken)
      : Promise.resolve(),
  ]);
  const actualEngine = gcpCloudSqlEngine(settings.databaseVersion);
  if (
    actualEngine !== input.resource.engine
    || gcpCloudSqlEngine(details.databaseVersion) !== input.resource.engine
    || details.state !== "RUNNABLE"
    || gcpInstanceProduction(details) === "unknown"
    || !databases.some((item) => item.value === input.resource.database)
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL database is no longer available",
      409,
    );
  }
  requireIamDatabaseConfiguration(
    details,
    input.resource.engine,
  );
  let target;
  try {
    target = gcpConnectionTarget({
      connectSettings: settings,
      instanceDetails: details,
      networkMode: input.resource.networkMode,
    });
  } catch (error) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      error instanceof Error ? error.message : "Cloud SQL connection is unavailable",
      409,
    );
  }
  return {
    externalCredentialId: input.externalCredentialId,
    externalCredentialKind: "iamToken",
    host: target.host,
    port: input.resource.engine === "postgres" ? 5432 : 3306,
    database: input.resource.database,
    username: gcpDatabaseUsername(serviceAccountEmail, input.resource.engine),
    password: loginToken.accessToken,
    sslmode: target.sslmode,
    connector: {
      kind: "gcpCloudSqlAuthProxy",
      instanceConnectionName: target.instanceConnectionName,
      accessToken: connectorToken.accessToken,
      networkMode: input.resource.networkMode,
    },
    expiresAt: loginToken.expiresAt,
  };
}
