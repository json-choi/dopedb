// Strict parsing and public serialization for shared connection templates. Secret-
// bearing fields are rejected rather than silently discarded to surface client bugs.
import type { WorkspaceRoleName } from "./workspace-permissions";
import { parseNeonResource } from "./providers/neon-core";

// SQLite paths identify files on one machine and are not meaningful team endpoints.
const engines = ["postgres", "mysql", "mongodb", "bigquery"] as const;
const providers = ["auto", "generic", "neon", "planetScale", "gcpCloudSql"] as const;
const allowedKeys = new Set([
  "name", "engine", "provider", "driverId", "host", "port", "database",
  "sslmode", "readonlyDefault", "allowWrites", "env", "schemaGroup",
]);
const forbiddenKeys = new Set([
  "password", "secret", "secretRef", "token", "connectionString", "connectionUrl",
  "url", "username", "extraParams", "certificate", "privateKey",
]);

export type SharedConnectionInput = {
  name: string;
  engine: (typeof engines)[number];
  provider: (typeof providers)[number];
  driverId: string | null;
  host: string;
  port: number;
  database: string;
  sslmode: string;
  readonlyDefault: boolean;
  allowWrites: boolean;
  env: string | null;
  schemaGroup: string | null;
};

export type SharedConnectionCredentialMode = "member_local" | "managed";

function text(value: unknown, max: number, required = false): string | null {
  if (value == null && !required) return null;
  if (typeof value !== "string") throw new Error("Expected text");
  const normalized = value.trim();
  if (
    (required && !normalized) ||
    normalized.length > max ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("Invalid text value");
  }
  return normalized || null;
}

export function providerResourceSupportsWrite(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  return manifest.importReadOnly === true
    && manifest.managedLease === true
    && manifest.write === true;
}

/** Managed schema leases are enabled only where the adapter can retain durable
 * object ownership outside the disposable member credential. */
export function providerResourceSupportsSchema(input: {
  provider: string;
  engine: string;
  capabilityManifest: unknown;
}): boolean {
  return (input.provider === "neon" || input.provider === "gcpCloudSql")
    && input.engine === "postgres"
    && providerResourceSupportsWrite(input.capabilityManifest);
}

const neonBranchStates = ["init", "resetting", "ready", "archived", "unknown"] as const;

function safeProviderTargetText(value: unknown, maxLength: number) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)
    ? value
    : null;
}

function publicProviderTarget(row: {
  provider: string;
  providerResource?: unknown;
  providerMetadata?: unknown;
}) {
  if (row.provider !== "neon" || row.providerResource === undefined) return null;
  let resource;
  try {
    resource = parseNeonResource(row.providerResource);
  } catch {
    return null;
  }
  const metadata = row.providerMetadata
    && typeof row.providerMetadata === "object"
    && !Array.isArray(row.providerMetadata)
    ? row.providerMetadata as Record<string, unknown>
    : {};
  const currentState = neonBranchStates.includes(
    metadata.branchState as typeof neonBranchStates[number],
  ) ? metadata.branchState as typeof neonBranchStates[number] : null;
  const pendingState = metadata.branchPendingState === null
    ? null
    : neonBranchStates.includes(
      metadata.branchPendingState as typeof neonBranchStates[number],
    )
      ? metadata.branchPendingState as typeof neonBranchStates[number]
      : null;
  return {
    provider: "neon" as const,
    projectId: resource.project,
    branchId: resource.branch,
    branchName: safeProviderTargetText(metadata.branchName, 256),
    currentState,
    pendingState,
    default: typeof metadata.branchDefault === "boolean"
      ? metadata.branchDefault
      : null,
    protected: typeof metadata.branchProtected === "boolean"
      ? metadata.branchProtected
      : null,
  };
}

export function parseSharedConnection(
  value: unknown,
  options: { credentialMode?: SharedConnectionCredentialMode } = {},
): SharedConnectionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Connection template must be an object");
  }
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (forbiddenKeys.has(key)) throw new Error(`Secret-bearing field '${key}' is not accepted`);
    if (!allowedKeys.has(key)) throw new Error(`Unknown connection field '${key}'`);
  }
  if (!engines.includes(body.engine as (typeof engines)[number])) throw new Error("Invalid engine");
  if (!providers.includes(body.provider as (typeof providers)[number])) throw new Error("Invalid provider");
  if (!Number.isInteger(body.port) || Number(body.port) < 1 || Number(body.port) > 65535) {
    throw new Error("Invalid port");
  }
  const credentialMode = options.credentialMode ?? "member_local";
  if (body.readonlyDefault !== undefined && body.readonlyDefault !== true) {
    throw new Error("Shared connections must open read-only by default");
  }
  if (body.allowWrites !== undefined && typeof body.allowWrites !== "boolean") {
    throw new Error("Invalid shared connection write policy");
  }
  const allowWrites = body.allowWrites === true;
  const engine = body.engine as SharedConnectionInput["engine"];
  if (engine === "bigquery" && credentialMode !== "member_local") {
    throw new Error("BigQuery uses member-local Google Cloud CLI authentication");
  }
  if (credentialMode === "member_local" && allowWrites) {
    throw new Error("Member-local shared connections cannot delegate write authority");
  }
  const host = text(body.host, 512, true)!;
  if (/[@/?#\s]/.test(host) || host.includes("://")) {
    throw new Error("Host must not contain credentials or a connection URL");
  }
  const database = text(body.database, 1024) ?? "";
  if (/[?#\r\n]/.test(database)) throw new Error("Invalid database name");
  if (engine === "bigquery") {
    if (
      body.provider !== "generic"
      || body.port !== 443
      || body.sslmode !== "require"
      || allowWrites
      || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(host)
      || !/^[A-Za-z0-9_]{1,1024}$/.test(database)
      || (body.driverId !== null && body.driverId !== "google-bq-cli")
      || (body.schemaGroup !== null && body.schemaGroup !== undefined)
    ) {
      throw new Error("Invalid BigQuery shared connection boundary");
    }
  }
  return {
    name: text(body.name, 120, true)!,
    engine,
    provider: body.provider as SharedConnectionInput["provider"],
    driverId: text(body.driverId, 160),
    host,
    port: Number(body.port),
    database,
    sslmode: text(body.sslmode, 64, true)!,
    readonlyDefault: true,
    allowWrites,
    env: text(body.env, 32),
    schemaGroup: text(body.schemaGroup, 120),
  };
}

export function publicConnection(
  row: {
    id: string; name: string; engine: string; provider: string; driverId: string | null;
    host: string; port: number; databaseName: string; sslmode: string;
    readonlyDefault: boolean; allowWrites: boolean; environment: string | null;
    schemaGroup: string | null; credentialMode: string; contentRevision: number; updatedAt: Date;
    providerResource?: unknown; providerMetadata?: unknown;
  },
  role: WorkspaceRoleName,
  accessMode: "view" | "read" | "write" | "manage",
  writeAvailable = false,
) {
  const managed = row.credentialMode === "managed";
  const effectiveWrite = managed
    && writeAvailable
    && row.allowWrites
    && (accessMode === "write" || accessMode === "manage");
  return {
    id: row.id,
    name: row.name,
    engine: row.engine,
    provider: row.provider,
    driverId: row.driverId,
    host: row.host,
    port: row.port,
    database: row.databaseName,
    sslmode: row.sslmode,
    readonlyDefault: true,
    allowWrites: effectiveWrite,
    writeAvailable: managed && writeAvailable,
    env: row.environment,
    schemaGroup: row.schemaGroup,
    revision: row.contentRevision,
    updatedAt: row.updatedAt.toISOString(),
    role,
    accessMode,
    credentialMode: managed ? "managed" : "member_local",
    credentialsRequired: !managed && row.engine !== "bigquery",
    providerTarget: publicProviderTarget(row),
  };
}
