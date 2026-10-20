// Strict parsing and public serialization for shared connection templates. Secret-
// bearing fields are rejected rather than silently discarded to surface client bugs.
import type { WorkspaceRoleName } from "./workspace-permissions";
import { parseNeonResource } from "./providers/neon-core";
import { accessModeAllowsWrite } from "./workspace-permissions";
import { connectionEnvironmentLabel } from "./knowledge/environment-kind";
import {
  isDirectEngine,
  parseDirectScope,
  type DirectEngine,
  type DirectFailureCode,
  type DirectLevel,
  type DirectPrincipalState,
} from "./workspace-direct-access-core";

// SQLite paths identify files on one machine and are not meaningful team endpoints;
// the one shareable SQLite engine is Cloudflare D1, accepted only by its exact identity.
const engines = ["postgres", "mysql", "mongodb", "bigquery", "sqlite"] as const;
const providers = ["auto", "generic", "neon", "planetScale", "gcpCloudSql", "cloudflareD1"] as const;
const allowedKeys = new Set([
  "name", "engine", "provider", "driverId", "host", "port", "database",
  "sslmode", "readonlyDefault", "allowWrites", "env", "schemaGroup", "mongoOptions",
]);
const forbiddenKeys = new Set([
  "password", "secret", "secretRef", "token", "connectionString", "connectionUrl",
  "url", "username", "extraParams", "certificate", "privateKey",
]);

/**
 * The only driver options a MongoDB template shares. Every other driver parameter
 * (TLS files, read preference, credentials) stays member-local or is refused.
 */
export type MongoTemplateOptions = {
  srv: boolean;
  authSource?: string;
  replicaSet?: string;
};

const mongoOptionKeys = new Set(["srv", "authSource", "replicaSet"]);
const mongoAuthSource = /^[A-Za-z0-9_.$-]{1,64}$/;
const mongoReplicaSet = /^[A-Za-z0-9_.-]{1,128}$/;
/** `mongodb+srv` ignores the port, so the template pins the driver default. */
export const MONGO_SRV_PORT = 27017;

function mongoName(value: unknown, pattern: RegExp, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Invalid MongoDB ${label}`);
  return value;
}

/** Strict, key-order-stable parse; returns null when the template carries no options. */
export function parseMongoOptions(value: unknown): MongoTemplateOptions | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid MongoDB options");
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!mongoOptionKeys.has(key)) throw new Error(`Unknown MongoDB option '${key}'`);
  }
  if (typeof body.srv !== "boolean") throw new Error("Invalid MongoDB srv option");
  const authSource = mongoName(body.authSource, mongoAuthSource, "authSource");
  const replicaSet = mongoName(body.replicaSet, mongoReplicaSet, "replicaSet");
  return {
    srv: body.srv,
    ...(authSource === undefined ? {} : { authSource }),
    ...(replicaSet === undefined ? {} : { replicaSet }),
  };
}

/** Canonical JSON text for the `mongo_options` column; null when absent. */
export function serializeMongoOptions(options: MongoTemplateOptions | undefined): string | null {
  return options ? JSON.stringify(options) : null;
}

/** Rebuild options from the persisted JSON column; a corrupt value reads as absent. */
export function storedMongoOptions(value: unknown): MongoTemplateOptions | null {
  try {
    return parseMongoOptions(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return null;
  }
}

const d1AccountId = /^[0-9a-fA-F]{32}$/;
const d1DatabaseId = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Cloudflare D1 shares account and database identifiers only; Wrangler auth is member-local. */
function validCloudflareD1Identity(body: Record<string, unknown>, host: string, database: string, allowWrites: boolean) {
  return body.engine === "sqlite"
    && body.provider === "cloudflareD1"
    && body.port === 443
    && body.sslmode === "require"
    && !allowWrites
    && d1AccountId.test(host)
    && d1DatabaseId.test(database)
    && (body.driverId === null || body.driverId === undefined || body.driverId === "cloudflare-d1-wrangler")
    && (body.schemaGroup === null || body.schemaGroup === undefined);
}

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
  /** MongoDB only; omitted otherwise so existing version payload hashes stay stable. */
  mongoOptions?: MongoTemplateOptions;
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
  grantedScope?: string | null;
  database?: string;
}): boolean {
  return (input.provider === "neon" || input.provider === "gcpCloudSql")
    && input.engine === "postgres"
    && providerResourceSupportsWrite(input.capabilityManifest)
    && !providerSchemaSetupRequired(input.provider, input.grantedScope ?? null, input.database);
}

/** Cloud SQL schema access needs its own verified service account. The stored
 * scopes are emitted only after provider setup validates those identities. */
export function providerSchemaSetupRequired(provider: string, grantedScope: string | null, database?: string): boolean {
  return provider === "gcpCloudSql"
    && !grantedScope?.split(/\s+/).some((scope) => scope === "cloudsql.schema"
      || (database !== undefined && scope === `cloudsql.schema:${encodeURIComponent(database)}`));
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

function validHost(value: unknown) {
  const host = text(value, 512, true)!;
  if (/[@/?#\s]/.test(host) || host.includes("://")) {
    throw new Error("Host must not contain credentials or a connection URL");
  }
  return host;
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
  const host = validHost(body.host);
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
  if (engine === "sqlite" && (
    credentialMode !== "member_local"
    || !validCloudflareD1Identity(body, host, database, allowWrites)
  )) {
    throw new Error("Only a Cloudflare D1 identity can be shared as SQLite");
  }
  if (body.provider === "cloudflareD1" && engine !== "sqlite") {
    throw new Error("Invalid Cloudflare D1 shared connection boundary");
  }
  const mongoOptions = parseMongoOptions(body.mongoOptions);
  if (mongoOptions && engine !== "mongodb") {
    throw new Error("Only MongoDB templates accept MongoDB options");
  }
  if (mongoOptions?.srv && (body.port !== MONGO_SRV_PORT || /[,:]/.test(host))) {
    throw new Error("SRV hosts are a single DNS name on the default port");
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
    env: connectionEnvironmentLabel(text(body.env, 32)),
    schemaGroup: text(body.schemaGroup, 120),
    ...(mongoOptions ? { mongoOptions } : {}),
  };
}

/** Member-visible status of the caller's own database principal on a direct database. */
export type PublicDirectProvisioning = {
  state: DirectPrincipalState | "not_requested";
  level: DirectLevel;
  principalName: string | null;
  lastSyncedAt: string | null;
  failureCode: DirectFailureCode | null;
};

/** Direct-endpoint facts and the caller's receipt, supplied only for provisioned rows. */
export type DirectConnectionView = {
  writeCeiling: boolean;
  principal: {
    state: DirectPrincipalState;
    appliedLevel: DirectLevel;
    principalName: string;
    lastSyncedAt: Date | null;
    failureCode: DirectFailureCode | null;
  } | null;
};

export function publicDirectProvisioning(direct: DirectConnectionView): PublicDirectProvisioning {
  const principal = direct.principal;
  return {
    state: principal?.state ?? "not_requested",
    level: principal?.appliedLevel ?? "none",
    principalName: principal?.principalName ?? null,
    lastSyncedAt: principal?.lastSyncedAt?.toISOString() ?? null,
    failureCode: principal?.failureCode ?? null,
  };
}

function mongoOptionsField(value: unknown) {
  const mongoOptions = storedMongoOptions(value);
  return mongoOptions ? { mongoOptions } : {};
}

/**
 * Whether a member-credential connection may be written by this member. The template
 * carries no write authority; the member's connection grant (`use` or `manage`) with an
 * editor-or-above role is the only ceiling, plus a direct database's endpoint ceiling.
 * BigQuery and Cloudflare D1 authenticate through read-only official CLI sessions, and
 * DopeDB reads MongoDB through typed queries only, so none of them write.
 */
function memberCredentialWrite(
  row: { credentialMode: string; engine: string; provider: string },
  accessMode: "view" | "read" | "write" | "manage",
  direct: DirectConnectionView | null,
) {
  if (
    row.credentialMode === "managed" || row.engine === "bigquery" || row.engine === "mongodb"
    || row.provider === "cloudflareD1"
  ) return false;
  return accessModeAllowsWrite(accessMode) && (direct ? direct.writeCeiling : true);
}

export function publicConnection(
  row: {
    id: string; name: string; engine: string; provider: string; driverId: string | null;
    host: string; port: number; databaseName: string; sslmode: string;
    readonlyDefault: boolean; allowWrites: boolean; environment: string | null;
    schemaGroup: string | null; credentialMode: string; contentRevision: number; updatedAt: Date;
    providerResource?: unknown; providerMetadata?: unknown; mongoOptions?: unknown;
  },
  role: WorkspaceRoleName,
  accessMode: "view" | "read" | "write" | "manage",
  writeAvailable = false,
  schemaAccessAvailable = false,
  direct: DirectConnectionView | null = null,
) {
  const managed = row.credentialMode === "managed";
  // A direct database stays member_local on the wire; its write ceiling lives on the
  // endpoint and applies on top of the same grant-derived access mode.
  const effectiveWrite = direct
    ? direct.writeCeiling && accessModeAllowsWrite(accessMode)
    : managed
      && writeAvailable
      && row.allowWrites
      && accessModeAllowsWrite(accessMode);
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
    // The member's own credential may attempt writes when their grant and role allow it (and a
    // direct database's ceiling does); Safety approval still gates every statement on the device.
    // Additive so a Desktop that predates it keeps reading `allowWrites` alone.
    memberWrite: memberCredentialWrite(row, accessMode, direct),
    writeAvailable: managed && writeAvailable,
    schemaAccessAvailable: managed && writeAvailable && schemaAccessAvailable,
    env: row.environment,
    schemaGroup: row.schemaGroup,
    revision: row.contentRevision,
    updatedAt: row.updatedAt.toISOString(),
    role,
    accessMode,
    credentialMode: managed ? "managed" : "member_local",
    // BigQuery and Cloudflare D1 authenticate through each member's own official CLI.
    credentialsRequired: !managed && !direct && row.engine !== "bigquery" && row.engine !== "sqlite",
    ...(row.engine === "mongodb" ? mongoOptionsField(row.mongoOptions) : {}),
    provisioning: direct ? publicDirectProvisioning(direct) : null,
    providerTarget: publicProviderTarget(row),
  };
}

const directKeys = new Set([
  "name", "engine", "host", "port", "database", "sslmode", "env", "schemaGroup",
  "scope", "writeCeiling",
]);
const directSslModes: Record<DirectEngine, readonly string[]> = {
  postgres: ["verify-full", "require"],
  mysql: ["VERIFY_IDENTITY", "REQUIRED"],
};

export type DirectEndpointInput = {
  connection: SharedConnectionInput;
  scope: string[];
  writeCeiling: boolean;
};

/**
 * Strict input for registering a direct shared database. The shared record is the
 * same secretless member-local template (generic provider, read-only default);
 * credentials, usernames and URLs are rejected, never discarded.
 */
export function parseDirectEndpoint(value: unknown): DirectEndpointInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Direct endpoint must be an object");
  }
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (forbiddenKeys.has(key)) throw new Error(`Secret-bearing field '${key}' is not accepted`);
    if (!directKeys.has(key)) throw new Error(`Unknown direct endpoint field '${key}'`);
  }
  if (!isDirectEngine(body.engine)) throw new Error("Direct databases support PostgreSQL and MySQL");
  const engine = body.engine;
  if (!Number.isInteger(body.port) || Number(body.port) < 1 || Number(body.port) > 65535) {
    throw new Error("Invalid port");
  }
  const sslmode = body.sslmode === undefined ? directSslModes[engine][0] : body.sslmode;
  if (typeof sslmode !== "string" || !directSslModes[engine].includes(sslmode)) {
    throw new Error("Invalid direct sslmode");
  }
  const host = validHost(body.host);
  const database = text(body.database, 1024, true)!;
  if (/[?#\r\n]/.test(database)) throw new Error("Invalid database name");
  if (body.writeCeiling !== undefined && typeof body.writeCeiling !== "boolean") {
    throw new Error("Invalid write ceiling");
  }
  return {
    connection: {
      name: text(body.name, 120, true)!,
      engine,
      provider: "generic",
      driverId: null,
      host,
      port: Number(body.port),
      database,
      sslmode,
      readonlyDefault: true,
      allowWrites: false,
      env: connectionEnvironmentLabel(text(body.env, 32)),
      schemaGroup: text(body.schemaGroup, 120),
    },
    scope: parseDirectScope(engine, body.scope),
    writeCeiling: body.writeCeiling === true,
  };
}
