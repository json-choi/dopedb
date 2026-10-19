// Public HTTPS envelopes shared with Desktop. Route handlers construct responses
// through these exact validators, while the same versioned JSON fixture is decoded
// by Rust so independently deployed clients cannot drift silently.

import {
  DIRECT_FAILURE_CODES,
  DIRECT_LEVELS,
  DIRECT_PRINCIPAL_STATES,
  DIRECT_REVOCATION_KINDS,
  DIRECT_VERIFIER_KINDS,
  isDirectEngine,
  isValidDirectVerifier,
  isValidPrincipalMarker,
  isValidPrincipalName,
  parseDirectScope,
  verifierKindForEngine,
  type DirectEngine,
  type DirectFailureCode,
  type DirectLevel,
  type DirectPrincipalState,
  type DirectRevocationKind,
  type DirectVerifierKind,
} from "./workspace-direct-access-core";

export const CONTROL_PLANE_CONTRACTS_SCHEMA_VERSION = 1 as const;
export const MANAGED_LEASE_CONTRACT_VERSION = "access-v6" as const;

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
  schemaOwner?: string;
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
  ], ["tlsServerCaPem", "connector", "schemaOwner"]);
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
    || (lease.schemaOwner !== undefined && (lease.provider !== "gcpCloudSql"
      || lease.accessMode !== "schema" || lease.engine !== "postgres"
      || typeof lease.schemaOwner !== "string"
      || !/^[A-Za-z_][A-Za-z0-9_.@-]{0,62}$/.test(lease.schemaOwner)
      || /^(pg_|cloudsql|postgres$)/i.test(lease.schemaOwner)))
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
      ...(typeof lease.schemaOwner === "string" ? { schemaOwner: lease.schemaOwner } : {}),
      accessMode: lease.accessMode,
      expiresAt: lease.expiresAt,
    },
  };
}

// ---- Direct shared databases -------------------------------------------------
// Members upload only a public verifier; an administrator device receives a work list
// and answers with receipts. No payload below ever carries a password, a username
// beyond the server-generated principal name, or an administrator credential.

const WORKSPACE_ROLES = ["viewer", "analyst", "editor", "admin", "owner"] as const;
const CONNECTION_CAPABILITIES = ["view", "read", "use", "manage"] as const;
const GRANT_ORIGINS = ["explicit", "team"] as const;
const ACCESS_MODES = ["view", "read", "write", "manage"] as const;
const WORK_ACTIONS = ["apply", "drop", "idle"] as const;
const REVOCATION_STATES = ["pending", "applied", "cancelled"] as const;
const MAX_MEMBERS = 1_000;
const MAX_GRANTS_PER_MEMBER = 1_000;
const MAX_WORK_ITEMS = 1_000;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export type DirectProvisioningStatus = Readonly<{
  state: DirectPrincipalState | "not_requested";
  level: DirectLevel;
  principalName: string | null;
  lastSyncedAt: string | null;
  failureCode: DirectFailureCode | null;
}>;

export type WorkspaceMemberGrantEntry = Readonly<{
  connectionId: string;
  capability: (typeof CONNECTION_CAPABILITIES)[number];
  origin: (typeof GRANT_ORIGINS)[number];
  effectiveAccessMode: (typeof ACCESS_MODES)[number];
  provisioning?: DirectProvisioningStatus;
}>;

export type WorkspaceMemberGrants = Readonly<{
  workspaceId: string;
  members: ReadonlyArray<Readonly<{
    memberId: string;
    role: (typeof WORKSPACE_ROLES)[number];
    revocationPending: boolean;
    grants: readonly WorkspaceMemberGrantEntry[];
  }>>;
}>;

export type DirectVerifierRequest = Readonly<{
  verifierKind: DirectVerifierKind;
  verifier: string;
}>;

export type DirectWorkListItem = Readonly<{
  principalId: string;
  memberId: string;
  principalName: string;
  marker: string;
  verifierKind: DirectVerifierKind;
  verifier: string;
  verifierVersion: number;
  appliedVerifierVersion: number;
  appliedLevel: DirectLevel;
  desiredLevel: DirectLevel;
  state: DirectPrincipalState;
  serverRoleOid: string | null;
  claimExpiresAt: string | null;
  action: (typeof WORK_ACTIONS)[number];
}>;

export type DirectRevocationEntry = Readonly<{
  id: string;
  connectionId: string;
  memberId: string;
  principalName: string | null;
  kind: DirectRevocationKind;
  targetLevel: "none" | "read";
  state: (typeof REVOCATION_STATES)[number];
  createdAt: string;
}>;

export type DirectWorkList = Readonly<{
  connectionId: string;
  engine: DirectEngine;
  scope: readonly string[];
  scopeRevision: number;
  writeCeiling: boolean;
  serverFingerprint: string | null;
  items: readonly DirectWorkListItem[];
  revocations: readonly DirectRevocationEntry[];
}>;

export type DirectReceiptRequest = Readonly<{
  principalId: string;
  deviceId: string;
  from: "applying" | "drop_pending";
  to: "ready" | "failed" | "dropped";
  appliedLevel: DirectLevel;
  appliedVerifierVersion: number;
  scopeRevisionApplied: number | null;
  serverRoleOid: string | null;
  serverFingerprint: string | null;
  failureCode: DirectFailureCode | null;
}>;

function oneOf<const Literals extends readonly string[]>(value: unknown, literals: Literals): Literals[number] {
  if (!isStringLiteral(value, literals)) throw new Error("Invalid direct access contract");
  return value;
}

function uuidField(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Invalid direct access contract");
  return value;
}

function boundedText(value: unknown, max: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("Invalid direct access contract");
  }
  return value;
}

function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function safeInteger(value: unknown, min: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > MAX_SAFE) {
    throw new Error("Invalid direct access contract");
  }
  return value;
}

function direct<T>(value: unknown, required: readonly string[], optional: readonly string[], build: (record: Record<string, unknown>) => T): T {
  const record = exactRecord(value, required, optional);
  if (!record) throw new Error("Invalid direct access contract");
  return build(record);
}

export function parseDirectProvisioningStatus(value: unknown): DirectProvisioningStatus {
  return direct(value, ["state", "level", "principalName", "lastSyncedAt", "failureCode"], [], (record) => {
    const state = oneOf(record.state, [...DIRECT_PRINCIPAL_STATES, "not_requested"] as const);
    const principalName = nullable(record.principalName, (name) => {
      if (!isValidPrincipalName(name)) throw new Error("Invalid direct access contract");
      return name;
    });
    const failureCode = nullable(record.failureCode, (code) => oneOf(code, DIRECT_FAILURE_CODES));
    const lastSyncedAt = nullable(record.lastSyncedAt, (instant) => {
      if (!validRfc3339Instant(instant)) throw new Error("Invalid direct access contract");
      return instant;
    });
    const level = oneOf(record.level, DIRECT_LEVELS);
    if (
      (state === "not_requested") !== (principalName === null)
      || (state === "failed") !== (failureCode !== null)
      || ((state === "not_requested" || state === "dropped") && level !== "none")
      || (state === "ready" && level === "none")
    ) throw new Error("Invalid direct access contract");
    return { state, level, principalName, lastSyncedAt, failureCode };
  });
}

export function parseWorkspaceMemberGrants(value: unknown): WorkspaceMemberGrants {
  return direct(value, ["workspaceId", "members"], [], (record) => {
    if (!Array.isArray(record.members) || record.members.length > MAX_MEMBERS) {
      throw new Error("Invalid direct access contract");
    }
    const seen = new Set<string>();
    const members = record.members.map((entry) => direct(entry, ["memberId", "role", "revocationPending", "grants"], [], (member) => {
      const memberId = boundedText(member.memberId, 128);
      if (seen.has(memberId) || typeof member.revocationPending !== "boolean"
        || !Array.isArray(member.grants) || member.grants.length > MAX_GRANTS_PER_MEMBER) {
        throw new Error("Invalid direct access contract");
      }
      seen.add(memberId);
      const connections = new Set<string>();
      const grants = member.grants.map((grant) => direct(grant,
        ["connectionId", "capability", "origin", "effectiveAccessMode"], ["provisioning"], (item) => {
          const connectionId = uuidField(item.connectionId);
          if (connections.has(connectionId)) throw new Error("Invalid direct access contract");
          connections.add(connectionId);
          const capability = oneOf(item.capability, CONNECTION_CAPABILITIES);
          const origin = oneOf(item.origin, GRANT_ORIGINS);
          if (origin === "team" && capability !== "view" && capability !== "read") {
            throw new Error("Invalid direct access contract");
          }
          return {
            connectionId,
            capability,
            origin,
            effectiveAccessMode: oneOf(item.effectiveAccessMode, ACCESS_MODES),
            ...(item.provisioning === undefined
              ? {}
              : { provisioning: parseDirectProvisioningStatus(item.provisioning) }),
          };
        }));
      return {
        memberId,
        role: oneOf(member.role, WORKSPACE_ROLES),
        revocationPending: member.revocationPending,
        grants,
      };
    }));
    return { workspaceId: uuidField(record.workspaceId), members };
  });
}

export function parseDirectVerifierRequest(value: unknown): DirectVerifierRequest {
  return direct(value, ["verifierKind", "verifier"], [], (record) => {
    const verifierKind = oneOf(record.verifierKind, DIRECT_VERIFIER_KINDS);
    if (!isValidDirectVerifier(verifierKind, record.verifier)) throw new Error("Invalid direct access contract");
    return { verifierKind, verifier: record.verifier };
  });
}

function parseRevocationEntry(value: unknown): DirectRevocationEntry {
  return direct(value, ["id", "connectionId", "memberId", "principalName", "kind", "targetLevel", "state", "createdAt"], [], (record) => {
    if (!validRfc3339Instant(record.createdAt)) throw new Error("Invalid direct access contract");
    return {
      id: uuidField(record.id),
      connectionId: uuidField(record.connectionId),
      memberId: boundedText(record.memberId, 128),
      principalName: nullable(record.principalName, (name) => {
        if (!isValidPrincipalName(name)) throw new Error("Invalid direct access contract");
        return name;
      }),
      kind: oneOf(record.kind, DIRECT_REVOCATION_KINDS),
      targetLevel: oneOf(record.targetLevel, ["none", "read"] as const),
      state: oneOf(record.state, REVOCATION_STATES),
      createdAt: record.createdAt,
    };
  });
}

export function parseDirectRevocationEntry(value: unknown): DirectRevocationEntry {
  return parseRevocationEntry(value);
}

function parseWorkListItem(value: unknown, engine: DirectEngine): DirectWorkListItem {
  return direct(value, [
    "principalId", "memberId", "principalName", "marker", "verifierKind", "verifier", "verifierVersion",
    "appliedVerifierVersion", "appliedLevel", "desiredLevel", "state", "serverRoleOid", "claimExpiresAt", "action",
  ], [], (record) => {
    const verifierKind = oneOf(record.verifierKind, DIRECT_VERIFIER_KINDS);
    const verifierVersion = safeInteger(record.verifierVersion, 1);
    const appliedVerifierVersion = safeInteger(record.appliedVerifierVersion, 0);
    if (
      verifierKind !== verifierKindForEngine(engine)
      || !isValidDirectVerifier(verifierKind, record.verifier)
      || !isValidPrincipalName(record.principalName)
      || !isValidPrincipalMarker(record.marker)
      || appliedVerifierVersion > verifierVersion
    ) throw new Error("Invalid direct access contract");
    return {
      principalId: uuidField(record.principalId),
      memberId: boundedText(record.memberId, 128),
      principalName: record.principalName,
      marker: record.marker,
      verifierKind,
      verifier: record.verifier as string,
      verifierVersion,
      appliedVerifierVersion,
      appliedLevel: oneOf(record.appliedLevel, DIRECT_LEVELS),
      desiredLevel: oneOf(record.desiredLevel, DIRECT_LEVELS),
      state: oneOf(record.state, DIRECT_PRINCIPAL_STATES),
      serverRoleOid: nullable(record.serverRoleOid, (oid) => boundedText(oid, 64)),
      claimExpiresAt: nullable(record.claimExpiresAt, (instant) => {
        if (!validRfc3339Instant(instant)) throw new Error("Invalid direct access contract");
        return instant;
      }),
      action: oneOf(record.action, WORK_ACTIONS),
    };
  });
}

export function parseDirectWorkList(value: unknown): DirectWorkList {
  return direct(value, [
    "connectionId", "engine", "scope", "scopeRevision", "writeCeiling", "serverFingerprint", "items", "revocations",
  ], [], (record) => {
    if (!isDirectEngine(record.engine) || typeof record.writeCeiling !== "boolean"
      || !Array.isArray(record.items) || record.items.length > MAX_WORK_ITEMS
      || !Array.isArray(record.revocations) || record.revocations.length > MAX_WORK_ITEMS) {
      throw new Error("Invalid direct access contract");
    }
    const engine = record.engine;
    return {
      connectionId: uuidField(record.connectionId),
      engine,
      scope: parseDirectScope(engine, record.scope),
      scopeRevision: safeInteger(record.scopeRevision, 1),
      writeCeiling: record.writeCeiling,
      serverFingerprint: nullable(record.serverFingerprint, (fingerprint) => boundedText(fingerprint, 128)),
      items: record.items.map((item) => parseWorkListItem(item, engine)),
      revocations: record.revocations.map(parseRevocationEntry),
    };
  });
}

export function parseDirectReceiptRequest(value: unknown): DirectReceiptRequest {
  return direct(value, [
    "principalId", "deviceId", "from", "to", "appliedLevel", "appliedVerifierVersion",
    "scopeRevisionApplied", "serverRoleOid", "serverFingerprint", "failureCode",
  ], [], (record) => {
    const from = oneOf(record.from, ["applying", "drop_pending"] as const);
    const to = oneOf(record.to, ["ready", "failed", "dropped"] as const);
    const appliedLevel = oneOf(record.appliedLevel, DIRECT_LEVELS);
    const failureCode = nullable(record.failureCode, (code) => oneOf(code, DIRECT_FAILURE_CODES));
    const serverRoleOid = nullable(record.serverRoleOid, (oid) => boundedText(oid, 64));
    const serverFingerprint = nullable(record.serverFingerprint, (fingerprint) => boundedText(fingerprint, 128));
    if (
      !(from === "applying" ? to === "ready" || to === "failed" : to === "dropped" || to === "failed")
      || (to === "failed") !== (failureCode !== null)
      || (to === "ready" && (appliedLevel === "none" || serverRoleOid === null || serverFingerprint === null))
      || (to === "dropped" && appliedLevel !== "none")
    ) throw new Error("Invalid direct access contract");
    return {
      principalId: uuidField(record.principalId),
      deviceId: boundedText(record.deviceId, 128),
      from,
      to,
      appliedLevel,
      appliedVerifierVersion: safeInteger(record.appliedVerifierVersion, 0),
      scopeRevisionApplied: nullable(record.scopeRevisionApplied, (revision) => safeInteger(revision, 1)),
      serverRoleOid,
      serverFingerprint,
      failureCode,
    };
  });
}
