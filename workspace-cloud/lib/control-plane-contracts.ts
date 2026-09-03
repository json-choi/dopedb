// Public HTTPS envelopes shared with Desktop. Route handlers construct responses
// through these exact validators, while the same versioned JSON fixture is decoded
// by Rust so independently deployed clients cannot drift silently.

export const CONTROL_PLANE_CONTRACTS_SCHEMA_VERSION = 1 as const;
export const LEGACY_MANAGED_LEASE_CONTRACT_VERSION = "access-v3" as const;
export const PREVIOUS_MANAGED_LEASE_CONTRACT_VERSION = "access-v4" as const;
export const MANAGED_LEASE_CONTRACT_VERSION = "access-v5" as const;

export type ManagedAccessMode = "read" | "write" | "schema";

export type ManagedLeaseRequest = Readonly<{
  accessMode: ManagedAccessMode;
}>;

export type WorkspaceSyncCollections = Readonly<{
  connections: boolean;
  analyses: boolean;
}>;

export type WorkspaceSyncPage = Readonly<{
  workspaceId: string;
  previousCursor: number | null;
  nextCursor: number;
  hasMore: boolean;
  reset: boolean;
  refresh: WorkspaceSyncCollections;
  tombstones: WorkspaceSyncCollections;
}>;

export type ManagedLeaseConnector = Readonly<{
  kind: "gcpCloudSqlAuthProxy";
  instanceConnectionName: string;
  accessToken: string;
  networkMode: "PUBLIC" | "PRIVATE_SERVICES_ACCESS" | "PRIVATE_SERVICE_CONNECT";
}>;

export type ManagedLease = Readonly<{
  id: string;
  provider: "neon" | "planetScale" | "gcpCloudSql" | "generic";
  engine: "postgres" | "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslmode: "verify-ca" | "verify-full";
  tlsServerCaPem?: string;
  connector?: ManagedLeaseConnector;
  accessMode: ManagedAccessMode;
  expiresAt: string;
}>;

export type ManagedLeaseResponse = Readonly<{ lease: ManagedLease }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RFC3339_INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;
const MANAGED_WHITESPACE = /[\s\u0085]/u;
const MANAGED_ACCESS_MODES = ["read", "write", "schema"] as const;
const MANAGED_LEASE_PROVIDERS = [
  "neon",
  "planetScale",
  "gcpCloudSql",
  "generic",
] as const;
const MANAGED_LEASE_ENGINES = ["postgres", "mysql"] as const;
const MANAGED_LEASE_SSL_MODES = ["verify-ca", "verify-full"] as const;
const MANAGED_CONNECTOR_NETWORK_MODES = [
  "PUBLIC",
  "PRIVATE_SERVICES_ACCESS",
  "PRIVATE_SERVICE_CONNECT",
] as const;

function isStringLiteral<const Literals extends readonly string[]>(
  value: unknown,
  literals: Literals,
): value is Literals[number] {
  return typeof value === "string"
    && (literals as readonly string[]).includes(value);
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  return required.every((field) => Object.prototype.hasOwnProperty.call(record, field))
    && Object.keys(record).every((field) => allowed.has(field))
    ? record
    : null;
}

function validRfc3339Instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = RFC3339_INSTANT.exec(value);
  if (!match) return false;
  const [, date, hour, minute, second, offsetHour, offsetMinute] = match;
  const dateTimestamp = Date.parse(`${date}T00:00:00Z`);
  return Number(hour) <= 23
    && Number(minute) <= 59
    && Number(second) <= 59
    && (offsetHour === undefined || Number(offsetHour) <= 23)
    && (offsetMinute === undefined || Number(offsetMinute) <= 59)
    && !Number.isNaN(dateTimestamp)
    && new Date(dateTimestamp).toISOString().slice(0, 10) === date
    && !Number.isNaN(Date.parse(value));
}

function syncCollections(value: unknown) {
  const record = exactRecord(value, ["connections", "analyses"]);
  return record
    && typeof record.connections === "boolean"
    && typeof record.analyses === "boolean"
    ? {
        connections: record.connections,
        analyses: record.analyses,
      }
    : null;
}

export function parseWorkspaceSyncPage(value: unknown): WorkspaceSyncPage {
  const record = exactRecord(value, [
    "workspaceId",
    "previousCursor",
    "nextCursor",
    "hasMore",
    "reset",
    "refresh",
    "tombstones",
  ]);
  const refresh = syncCollections(record?.refresh);
  const tombstones = syncCollections(record?.tombstones);
  const previousCursor = record?.previousCursor;
  const nextCursor = record?.nextCursor;
  if (
    !record
    || typeof record.workspaceId !== "string"
    || !UUID.test(record.workspaceId)
    || !(previousCursor === null
      || (typeof previousCursor === "number"
        && Number.isSafeInteger(previousCursor)
        && previousCursor >= 0))
    || typeof nextCursor !== "number"
    || !Number.isSafeInteger(nextCursor)
    || nextCursor < 0
    || typeof record.hasMore !== "boolean"
    || typeof record.reset !== "boolean"
    || !refresh
    || !tombstones
    || (previousCursor === null && (record.reset || record.hasMore))
    || (record.reset && (
      previousCursor === null
      || nextCursor === previousCursor
      || record.hasMore
      || !refresh.connections
      || !refresh.analyses
    ))
    || (!record.reset && previousCursor !== null && nextCursor < previousCursor)
    || (record.hasMore && (previousCursor === null || nextCursor <= previousCursor))
    || (previousCursor === null && (!refresh.connections || !refresh.analyses))
    || (tombstones.connections && !refresh.connections)
    || (tombstones.analyses && !refresh.analyses)
  ) {
    throw new Error("Invalid workspace sync contract");
  }
  return {
    workspaceId: record.workspaceId,
    previousCursor,
    nextCursor,
    hasMore: record.hasMore,
    reset: record.reset,
    refresh,
    tombstones,
  };
}

export function workspaceSyncPage(value: WorkspaceSyncPage) {
  return parseWorkspaceSyncPage(value);
}

export function parseManagedLeaseRequest(value: unknown): ManagedLeaseRequest {
  const record = exactRecord(value, ["accessMode"]);
  if (!record || !isStringLiteral(record.accessMode, MANAGED_ACCESS_MODES)) {
    throw new Error("Invalid managed lease request contract");
  }
  return { accessMode: record.accessMode };
}

function managedLeaseConnector(value: unknown): ManagedLeaseConnector | undefined {
  if (value === undefined) return undefined;
  const record = exactRecord(value, [
    "kind",
    "instanceConnectionName",
    "accessToken",
    "networkMode",
  ]);
  if (
    !record
    || record.kind !== "gcpCloudSqlAuthProxy"
    || typeof record.instanceConnectionName !== "string"
    || record.instanceConnectionName.length === 0
    || record.instanceConnectionName.length > 300
    || typeof record.accessToken !== "string"
    || record.accessToken.length === 0
    || record.accessToken.length > 64 * 1024
    || MANAGED_WHITESPACE.test(record.accessToken)
    || !isStringLiteral(record.networkMode, MANAGED_CONNECTOR_NETWORK_MODES)
  ) {
    throw new Error("Invalid managed connector contract");
  }
  return {
    kind: record.kind,
    instanceConnectionName: record.instanceConnectionName,
    accessToken: record.accessToken,
    networkMode: record.networkMode,
  };
}

export function managedLeaseResponse(value: unknown): ManagedLeaseResponse {
  const envelope = exactRecord(value, ["lease"]);
  const lease = exactRecord(envelope?.lease, [
    "id",
    "provider",
    "engine",
    "host",
    "port",
    "database",
    "username",
    "password",
    "sslmode",
    "accessMode",
    "expiresAt",
  ], ["tlsServerCaPem", "connector"]);
  if (!envelope || !lease) throw new Error("Invalid managed lease response contract");
  const connector = managedLeaseConnector(lease.connector);
  if (
    typeof lease.id !== "string"
    || !UUID.test(lease.id)
    || !isStringLiteral(lease.provider, MANAGED_LEASE_PROVIDERS)
    || !isStringLiteral(lease.engine, MANAGED_LEASE_ENGINES)
    || typeof lease.host !== "string"
    || lease.host.length === 0
    || lease.host.length > 512
    || lease.host.includes("://")
    || MANAGED_WHITESPACE.test(lease.host)
    || typeof lease.port !== "number"
    || !Number.isInteger(lease.port)
    || lease.port < 1
    || lease.port > 65_535
    || typeof lease.database !== "string"
    || lease.database.length === 0
    || lease.database.length > 512
    || typeof lease.username !== "string"
    || lease.username.length === 0
    || lease.username.length > 512
    || typeof lease.password !== "string"
    || lease.password.length === 0
    || lease.password.length > 64 * 1024
    || !isStringLiteral(lease.sslmode, MANAGED_LEASE_SSL_MODES)
    || (lease.tlsServerCaPem !== undefined && typeof lease.tlsServerCaPem !== "string")
    || !isStringLiteral(lease.accessMode, MANAGED_ACCESS_MODES)
    || (lease.accessMode === "schema" && (
      (lease.provider !== "neon" && lease.provider !== "gcpCloudSql")
      || lease.engine !== "postgres"
    ))
    || !validRfc3339Instant(lease.expiresAt)
    || (lease.provider === "gcpCloudSql") !== Boolean(connector)
    || (lease.provider === "gcpCloudSql" && lease.tlsServerCaPem !== undefined)
    || (lease.provider !== "gcpCloudSql" && (
      lease.sslmode !== "verify-full"
      || lease.tlsServerCaPem !== undefined
    ))
  ) {
    throw new Error("Invalid managed lease response contract");
  }
  return {
    lease: {
      id: lease.id,
      provider: lease.provider,
      engine: lease.engine,
      host: lease.host,
      port: lease.port,
      database: lease.database,
      username: lease.username,
      password: lease.password,
      sslmode: lease.sslmode,
      ...(typeof lease.tlsServerCaPem === "string"
        ? { tlsServerCaPem: lease.tlsServerCaPem }
        : {}),
      ...(connector ? { connector } : {}),
      accessMode: lease.accessMode,
      expiresAt: lease.expiresAt,
    },
  };
}
