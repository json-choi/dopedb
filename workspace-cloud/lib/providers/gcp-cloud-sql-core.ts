// Pure GCP Cloud SQL trust and resource validation. The integration stores only
// WIF coordinates and service-account identities, never a service-account key.

import type { ManagedEngine, ManagedSslMode } from "./provider-types";

export const GCP_LEASE_SECONDS = 15 * 60;
export const GCP_SCHEMA_LEASE_SECONDS = 10 * 60;

export type GcpCloudSqlNetworkMode =
  | "PUBLIC"
  | "PRIVATE_SERVICES_ACCESS"
  | "PRIVATE_SERVICE_CONNECT";

export type GcpCloudSqlCredential = {
  projectId: string;
  projectNumber: string;
  workloadIdentityPoolId: string;
  workloadIdentityProviderId: string;
  instanceId: string;
  readServiceAccountEmail: string;
  writeServiceAccountEmail: string | null;
  schemaServiceAccountEmail: string | null;
  workloadIdentitySubject: string | null;
  databaseNames: string[];
  dedicatedServiceAccountsConfirmed: true;
  instanceScopedIamConfirmed: true;
};

/** Secret-free target used only by a desktop local-authority receipt. */
export type GcpLocalVerificationTarget = Readonly<{
  kind: "gcpCloudSql";
  projectId: string;
  instanceId: string;
}>;

export type GcpCloudSqlResource = {
  project: string;
  instance: string;
  database: string;
  engine: ManagedEngine;
  networkMode: GcpCloudSqlNetworkMode;
  production: boolean;
};

export function gcpProjectId(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
}

function gcpWifId(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-z][a-z0-9-]{2,30}[a-z0-9]$/.test(value);
}

function gcpServiceAccountEmail(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/
      .test(value);
}

export function parseGcpCloudSqlCredential(
  value: unknown,
): GcpCloudSqlCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GCP trust configuration is required");
  }
  const body = value as Record<string, unknown>;
  const writeServiceAccountEmail = body.writeServiceAccountEmail === ""
    || body.writeServiceAccountEmail == null
    ? null
    : body.writeServiceAccountEmail;
  const schemaServiceAccountEmail = body.schemaServiceAccountEmail === ""
    || body.schemaServiceAccountEmail == null
    ? null
    : body.schemaServiceAccountEmail;
  const workloadIdentitySubject = body.workloadIdentitySubject === ""
    || body.workloadIdentitySubject == null
    ? null
    : body.workloadIdentitySubject;
  const databaseNames = body.databaseNames === undefined
    ? []
    : body.databaseNames;
  if (
    !gcpProjectId(body.projectId)
    || typeof body.projectNumber !== "string"
    || !/^[1-9][0-9]{5,19}$/.test(body.projectNumber)
    || !gcpWifId(body.workloadIdentityPoolId)
    || !gcpWifId(body.workloadIdentityProviderId)
    || !gcpResourceName(body.instanceId)
    || !gcpServiceAccountEmail(body.readServiceAccountEmail)
    || (writeServiceAccountEmail !== null
      && !gcpServiceAccountEmail(writeServiceAccountEmail))
    || (schemaServiceAccountEmail !== null
      && !gcpServiceAccountEmail(schemaServiceAccountEmail))
    || writeServiceAccountEmail === body.readServiceAccountEmail
    || schemaServiceAccountEmail === body.readServiceAccountEmail
    || (schemaServiceAccountEmail !== null
      && schemaServiceAccountEmail === writeServiceAccountEmail)
    || (workloadIdentitySubject !== null && (
      typeof workloadIdentitySubject !== "string"
      || !/^owner:[A-Za-z0-9_-]{1,100}:project:[A-Za-z0-9_-]{1,100}:environment:production$/
        .test(workloadIdentitySubject)
    ))
    || (schemaServiceAccountEmail !== null && workloadIdentitySubject === null)
    || !Array.isArray(databaseNames)
    || databaseNames.length > 200
    || !databaseNames.every((name) => gcpResourceName(name))
    || new Set(databaseNames).size !== databaseNames.length
    || body.dedicatedServiceAccountsConfirmed !== true
    || body.instanceScopedIamConfirmed !== true
  ) {
    throw new Error("Invalid GCP trust configuration");
  }
  return {
    projectId: body.projectId,
    projectNumber: body.projectNumber,
    workloadIdentityPoolId: body.workloadIdentityPoolId,
    workloadIdentityProviderId: body.workloadIdentityProviderId,
    instanceId: body.instanceId,
    readServiceAccountEmail: body.readServiceAccountEmail,
    writeServiceAccountEmail,
    schemaServiceAccountEmail,
    workloadIdentitySubject,
    databaseNames,
    dedicatedServiceAccountsConfirmed: true,
    instanceScopedIamConfirmed: true,
  };
}

function gcpResourceName(value: unknown, max = 98): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= max
    && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

export function parseGcpCloudSqlResource(
  value: unknown,
): GcpCloudSqlResource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GCP Cloud SQL resource is required");
  }
  const body = value as Record<string, unknown>;
  const networkMode = body.networkMode;
  if (
    !gcpProjectId(body.project)
    || !gcpResourceName(body.instance)
    || !gcpResourceName(body.database)
    || (body.engine !== "postgres" && body.engine !== "mysql")
    || (
      networkMode !== "PUBLIC"
      && networkMode !== "PRIVATE_SERVICES_ACCESS"
      && networkMode !== "PRIVATE_SERVICE_CONNECT"
    )
  ) {
    throw new Error("Invalid GCP Cloud SQL resource");
  }
  return {
    project: body.project,
    instance: body.instance,
    database: body.database,
    engine: body.engine,
    networkMode,
    // Rows created before production approval existed were all non-production.
    production: body.production === true,
  };
}

export function gcpCloudSqlEngine(value: unknown): ManagedEngine | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("POSTGRES_")) return "postgres";
  if (value.startsWith("MYSQL_")) return "mysql";
  return null;
}

export function gcpDatabaseUsername(
  serviceAccountEmail: string,
  engine: ManagedEngine,
) {
  if (!gcpServiceAccountEmail(serviceAccountEmail)) {
    throw new Error("Invalid GCP service account");
  }
  return engine === "postgres"
    ? serviceAccountEmail.replace(/\.gserviceaccount\.com$/, "")
    : serviceAccountEmail.slice(0, serviceAccountEmail.indexOf("@"));
}

export function gcpWifAudience(credential: GcpCloudSqlCredential) {
  return `//iam.googleapis.com/projects/${credential.projectNumber}`
    + `/locations/global/workloadIdentityPools/${credential.workloadIdentityPoolId}`
    + `/providers/${credential.workloadIdentityProviderId}`;
}

export function gcpWifPrincipal(credential: GcpCloudSqlCredential) {
  if (!credential.workloadIdentitySubject) {
    throw new Error("GCP workload identity subject is required");
  }
  return `principal://iam.googleapis.com/projects/${credential.projectNumber}`
    + `/locations/global/workloadIdentityPools/${credential.workloadIdentityPoolId}`
    + `/subject/${credential.workloadIdentitySubject}`;
}

export function gcpLocalVerificationTarget(
  credential: GcpCloudSqlCredential,
): GcpLocalVerificationTarget {
  return {
    kind: "gcpCloudSql",
    projectId: credential.projectId,
    instanceId: credential.instanceId,
  };
}

async function identityDigest(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function gcpCloudSqlTargetFingerprint(
  projectId: string,
  instanceId: string,
) {
  if (!gcpProjectId(projectId) || !gcpResourceName(instanceId)) {
    throw new Error("Invalid GCP Cloud SQL target");
  }
  return identityDigest({ projectId, instanceId });
}

export async function gcpCloudSqlIntegrationIdentity(
  credential: GcpCloudSqlCredential,
) {
  const [readPrincipal, writePrincipal, schemaPrincipal, instance, integration] =
    await Promise.all([
      identityDigest(credential.readServiceAccountEmail),
      credential.writeServiceAccountEmail
        ? identityDigest(credential.writeServiceAccountEmail)
        : Promise.resolve("none"),
      credential.schemaServiceAccountEmail
        ? identityDigest(credential.schemaServiceAccountEmail)
        : Promise.resolve("none"),
      gcpCloudSqlTargetFingerprint(
        credential.projectId,
        credential.instanceId,
      ),
      identityDigest({
        version: 2,
        projectId: credential.projectId,
        projectNumber: credential.projectNumber,
        workloadIdentityPoolId: credential.workloadIdentityPoolId,
        workloadIdentityProviderId: credential.workloadIdentityProviderId,
        instanceId: credential.instanceId,
        readServiceAccountEmail: credential.readServiceAccountEmail,
        writeServiceAccountEmail: credential.writeServiceAccountEmail,
        schemaServiceAccountEmail: credential.schemaServiceAccountEmail,
        workloadIdentitySubject: credential.workloadIdentitySubject,
      }),
    ]);
  return {
    externalAccountId:
      `gcp-wif-v2:r${readPrincipal}:w${writePrincipal}:s${schemaPrincipal}:n${instance}:i${integration}`,
    readPrincipal,
    writePrincipal: writePrincipal === "none" ? null : writePrincipal,
    schemaPrincipal: schemaPrincipal === "none" ? null : schemaPrincipal,
    instance,
  };
}

export type GcpCloudSqlPrincipalClaim = {
  principalFingerprint: string;
  targetFingerprint: string;
  accessKind: "read" | "write" | "schema";
};

export function gcpCloudSqlPrincipalClaims(
  identity: Awaited<ReturnType<typeof gcpCloudSqlIntegrationIdentity>>,
): GcpCloudSqlPrincipalClaim[] {
  return [
    {
      principalFingerprint: identity.readPrincipal,
      targetFingerprint: identity.instance,
      accessKind: "read" as const,
    },
    ...(identity.writePrincipal
      ? [{
        principalFingerprint: identity.writePrincipal,
        targetFingerprint: identity.instance,
        accessKind: "write" as const,
      }]
      : []),
    ...(identity.schemaPrincipal
      ? [{
        principalFingerprint: identity.schemaPrincipal,
        targetFingerprint: identity.instance,
        accessKind: "schema" as const,
      }]
      : []),
  ];
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function validDnsName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\.$/, "").toLowerCase();
  if (
    normalized.length === 0
    || normalized.length > 253
    || normalized.includes("*")
    || normalized.split(".").some((label) => (
      label.length === 0
      || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    ))
  ) {
    return null;
  }
  return normalized;
}

function validIpv4(value: unknown): value is string {
  return typeof value === "string"
    && value.split(".").length === 4
    && value.split(".").every((part) => (
      /^(?:0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255
    ));
}

type DnsTarget = {
  name: string;
  connectionType:
    | "PUBLIC"
    | "PRIVATE_SERVICES_ACCESS"
    | "PRIVATE_SERVICE_CONNECT";
  recordManager: string;
};

function validConnectionType(
  value: unknown,
): value is DnsTarget["connectionType"] {
  return value === "PUBLIC"
    || value === "PRIVATE_SERVICES_ACCESS"
    || value === "PRIVATE_SERVICE_CONNECT";
}

function dnsTargets(
  connectSettings: JsonObject,
  instanceDetails: JsonObject,
): DnsTarget[] {
  const rows = [connectSettings.dnsNames, instanceDetails.dnsNames]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .flatMap((value) => {
      const row = object(value);
      const name = validDnsName(row?.name);
      const connectionType = row?.connectionType;
      if (
        !row
        || !name
        || row.dnsScope !== "INSTANCE"
        || !validConnectionType(connectionType)
      ) {
        return [];
      }
      return [{
        name,
        connectionType,
        recordManager: typeof row.recordManager === "string"
          ? row.recordManager
          : "",
      }];
    });
  const deduplicated = new Map(rows.map((row) => (
    [`${row.connectionType}:${row.name}`, row]
  )));
  return [...deduplicated.values()].sort((left, right) => {
    const leftManaged = left.recordManager === "CLOUD_SQL_AUTOMATION" ? 0 : 1;
    const rightManaged = right.recordManager === "CLOUD_SQL_AUTOMATION" ? 0 : 1;
    return leftManaged - rightManaged || left.name.localeCompare(right.name);
  });
}

function caMode(
  connectSettings: JsonObject,
  ipConfiguration: JsonObject,
) {
  const values = [connectSettings.serverCaMode, ipConfiguration.serverCaMode]
    .filter((value): value is string => typeof value === "string");
  const normalized = new Set(values.map((value) => (
    value === "CA_MODE_UNSPECIFIED" ? "GOOGLE_MANAGED_INTERNAL_CA" : value
  )));
  if (
    normalized.size !== 1
    || ![...normalized].every((value) => (
      value === "GOOGLE_MANAGED_INTERNAL_CA"
      || value === "GOOGLE_MANAGED_CAS_CA"
      || value === "CUSTOMER_MANAGED_CAS_CA"
    ))
  ) {
    throw new Error("Cloud SQL server CA mode is unavailable or inconsistent");
  }
  return [...normalized][0];
}

export function gcpConnectionTarget(input: {
  connectSettings: unknown;
  instanceDetails: unknown;
  networkMode: GcpCloudSqlNetworkMode;
}): {
  host: string;
  sslmode: ManagedSslMode;
  tlsServerCaPem: string;
  instanceConnectionName: string;
} {
  const connectSettings = object(input.connectSettings);
  const instanceDetails = object(input.instanceDetails);
  const settings = object(instanceDetails?.settings);
  const ipConfiguration = object(settings?.ipConfiguration);
  if (!connectSettings || !instanceDetails || !ipConfiguration) {
    throw new Error("Cloud SQL connection settings are incomplete");
  }
  const selectedCaMode = caMode(connectSettings, ipConfiguration);
  const instanceConnectionName = instanceDetails.connectionName;
  if (
    typeof instanceConnectionName !== "string"
    || instanceConnectionName.length > 300
    || !/^[a-z][a-z0-9:.-]{4,298}:[a-z0-9-]{1,100}:[A-Za-z0-9][A-Za-z0-9_.-]{0,98}$/
      .test(instanceConnectionName)
  ) {
    throw new Error("Cloud SQL instance connection name is unavailable");
  }
  const ca = object(connectSettings.serverCaCert)
    ?? object(instanceDetails.serverCaCert);
  const cert = ca?.cert;
  if (
    typeof cert !== "string"
    || cert.length > 64 * 1_024
    || !cert.startsWith("-----BEGIN CERTIFICATE-----")
    || !cert.trimEnd().endsWith("-----END CERTIFICATE-----")
    || cert.includes("\u0000")
  ) {
    throw new Error("Cloud SQL server CA is unavailable");
  }

  const addressSource = Array.isArray(connectSettings.ipAddresses)
    ? connectSettings.ipAddresses
    : instanceDetails.ipAddresses;
  const addresses = Array.isArray(addressSource)
    ? addressSource.flatMap((value) => {
      const row = object(value);
      return row ? [row] : [];
    })
    : [];
  const targets = dnsTargets(connectSettings, instanceDetails);
  const selectedMode = input.networkMode;

  if (
    selectedCaMode !== "GOOGLE_MANAGED_INTERNAL_CA"
    || selectedMode === "PRIVATE_SERVICE_CONNECT"
  ) {
    let dns = targets.find((item) => item.connectionType === selectedMode)?.name;
    if (!dns && selectedMode === "PRIVATE_SERVICE_CONNECT") {
      const legacyDns = validDnsName(connectSettings.dnsName);
      if (
        connectSettings.pscEnabled === true
        && legacyDns?.endsWith(".sql.goog")
      ) {
        dns = legacyDns;
      }
    }
    if (!dns) {
      throw new Error(
        "Cloud SQL has no instance-scoped DNS name for the selected network",
      );
    }
    const customSans = [
      connectSettings.customSubjectAlternativeNames,
      ipConfiguration.customSubjectAlternativeNames,
    ].flatMap((value) => Array.isArray(value) ? value : [])
      .map(validDnsName)
      .filter((value): value is string => Boolean(value));
    if (
      selectedCaMode === "CUSTOMER_MANAGED_CAS_CA"
      && customSans.length > 0
      && !customSans.includes(dns)
      && !dns.endsWith(".sql.goog")
      && !dns.endsWith(".sql-psa.goog")
      && !dns.endsWith(".sql-psc.goog")
    ) {
      throw new Error("Cloud SQL custom DNS name is not present in the certificate SANs");
    }
    return {
      host: dns,
      sslmode: "verify-full",
      tlsServerCaPem: cert,
      instanceConnectionName,
    };
  }

  const addressType = selectedMode === "PUBLIC" ? "PRIMARY" : "PRIVATE";
  const address = addresses.find((item) => (
    item.type === addressType && validIpv4(item.ipAddress)
  ));
  if (!address || !validIpv4(address.ipAddress)) {
    throw new Error("Cloud SQL has no address for the selected network");
  }
  return {
    host: address.ipAddress,
    sslmode: "verify-ca",
    tlsServerCaPem: cert,
    instanceConnectionName,
  };
}

export function normalizeGcpUpstreamStatus(status: number) {
  if (status === 401 || status === 403) return 424;
  return status >= 500 ? 502 : status;
}
