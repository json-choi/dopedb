// Validates control-plane bodies for Database access before they reach the cache.
// A body this Desktop cannot interpret safely becomes one typed error instead of a
// partially rendered list, so the screen shows an explicit incompatible state.
import {
  isConnectionCapability,
  type ConflictPayload,
  type ConflictVersion,
  type ConnectionConflict,
  type GrantSnapshot,
  type MemberGrant,
  type SharedDatabase,
} from "./domain";

/** The control plane answered with a body this Desktop cannot interpret safely. */
export class AccessResponseError extends Error {
  constructor(response: string) {
    super(`The workspace service returned an incompatible ${response} response.`);
    this.name = "AccessResponseError";
  }
}

const VERSION_OPERATIONS = new Set<ConflictVersion["operation"]>([
  "create",
  "update",
  "delete",
  "restore",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function parseSharedDatabases(value: unknown): SharedDatabase[] {
  const body = record(value);
  if (!body || !Array.isArray(body.connections)) throw new AccessResponseError("database list");
  return body.connections.map((item) => {
    const row = record(item);
    if (
      !row
      || typeof row.id !== "string"
      || typeof row.name !== "string"
      || typeof row.engine !== "string"
      || typeof row.accessMode !== "string"
      || (row.credentialMode !== "managed" && row.credentialMode !== "member_local")
      || typeof row.allowWrites !== "boolean"
      || typeof row.writeAvailable !== "boolean"
    ) {
      throw new AccessResponseError("database list");
    }
    return {
      id: row.id,
      name: row.name,
      engine: row.engine,
      accessMode: row.accessMode,
      credentialMode: row.credentialMode,
      allowWrites: row.allowWrites,
      writeAvailable: row.writeAvailable,
    };
  });
}

export function parseGrantSnapshot(value: unknown, connectionId: string): GrantSnapshot {
  const body = record(value);
  if (
    !body
    || !Array.isArray(body.grants)
    || typeof body.actorMemberId !== "string"
    || typeof body.teamReadEnabled !== "boolean"
  ) {
    throw new AccessResponseError("member access");
  }
  const grants = body.grants.map((item): MemberGrant => {
    const row = record(item);
    const capability = row?.capability;
    const origin = row?.origin;
    if (
      !row
      || typeof row.memberId !== "string"
      || typeof row.email !== "string"
      || typeof row.role !== "string"
      || (capability !== null && !isConnectionCapability(capability))
      || (origin !== null && origin !== undefined && origin !== "explicit" && origin !== "team")
    ) {
      throw new AccessResponseError("member access");
    }
    return {
      memberId: row.memberId,
      name: typeof row.name === "string" ? row.name : "",
      email: row.email,
      role: row.role,
      capability,
      origin: capability === null ? null : origin ?? "explicit",
    };
  });
  return {
    connectionId,
    actorMemberId: body.actorMemberId,
    teamReadEnabled: body.teamReadEnabled,
    grants,
  };
}

export function parseTeamReadResult(value: unknown): boolean {
  const body = record(value);
  if (!body || typeof body.teamReadEnabled !== "boolean") {
    throw new AccessResponseError("team read access");
  }
  return body.teamReadEnabled;
}

function parseConflictPayload(value: unknown): ConflictPayload | null {
  const payload = record(value);
  if (!payload) return null;
  const driverId = nullableText(payload.driverId);
  const env = nullableText(payload.env);
  const schemaGroup = nullableText(payload.schemaGroup);
  const port = finiteInteger(payload.port);
  if (
    typeof payload.name !== "string"
    || typeof payload.engine !== "string"
    || typeof payload.provider !== "string"
    || driverId === undefined
    || typeof payload.host !== "string"
    || port === null
    || typeof payload.database !== "string"
    || typeof payload.sslmode !== "string"
    || typeof payload.readonlyDefault !== "boolean"
    || typeof payload.allowWrites !== "boolean"
    || env === undefined
    || schemaGroup === undefined
    || typeof payload.deleted !== "boolean"
  ) {
    return null;
  }
  return {
    name: payload.name,
    engine: payload.engine,
    provider: payload.provider,
    driverId,
    host: payload.host,
    port,
    database: payload.database,
    sslmode: payload.sslmode,
    readonlyDefault: payload.readonlyDefault,
    allowWrites: payload.allowWrites,
    env,
    schemaGroup,
    deleted: payload.deleted,
  };
}

function parseConflictVersion(value: unknown): ConflictVersion | null {
  const version = record(value);
  const revision = finiteInteger(version?.revision);
  const operation = version?.operation;
  const payload = parseConflictPayload(version?.payload);
  if (
    !version
    || typeof version.id !== "string"
    || revision === null
    || !VERSION_OPERATIONS.has(operation as ConflictVersion["operation"])
    || !payload
  ) {
    return null;
  }
  return {
    id: version.id,
    revision,
    operation: operation as ConflictVersion["operation"],
    payload,
  };
}

export function parseConnectionConflicts(value: unknown): ConnectionConflict[] {
  const body = record(value);
  if (!body || !Array.isArray(body.conflicts)) throw new AccessResponseError("conflict list");
  return body.conflicts.map((item) => {
    const row = record(item);
    const expectedRevision = finiteInteger(row?.expectedRevision);
    const current = parseConflictVersion(row?.current);
    const server = parseConflictVersion(row?.server);
    const candidate = parseConflictVersion(row?.candidate);
    if (
      !row
      || typeof row.id !== "string"
      || typeof row.connectionId !== "string"
      || typeof row.connectionName !== "string"
      || typeof row.createdAt !== "string"
      || expectedRevision === null
      || !current
      || !server
      || !candidate
      || typeof row.currentMatchesServer !== "boolean"
      || typeof row.currentMatchesCandidate !== "boolean"
    ) {
      throw new AccessResponseError("conflict list");
    }
    return {
      id: row.id,
      connectionId: row.connectionId,
      connectionName: row.connectionName,
      expectedRevision,
      createdAt: row.createdAt,
      current,
      server,
      candidate,
      currentMatchesServer: row.currentMatchesServer,
      currentMatchesCandidate: row.currentMatchesCandidate,
    };
  });
}
