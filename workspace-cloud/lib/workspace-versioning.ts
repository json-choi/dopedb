// Canonical, secret-free connection version payloads and strict optimistic revision
// parsing. Route handlers persist these immutable values; this module never touches DB.
import { createHash } from "node:crypto";

import {
  parseSharedConnection,
  type SharedConnectionCredentialMode,
} from "./workspace-connections";

type ConnectionInput = ReturnType<typeof parseSharedConnection>;

export type ConnectionVersionPayload = ConnectionInput & {
  deleted: boolean;
};

export type ConnectionLeaseRevocationScope = "none" | "write" | "all";

export const EXPECTED_REVISION_HEADER = "x-dopedb-expected-revision";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Existing read credentials do not gain write authority when the administrator
 * enables the write policy. A downgrade must retire only write credentials;
 * identity, transport, and deletion changes still invalidate every lease.
 */
export function connectionLeaseRevocationScope(
  current: ConnectionVersionPayload,
  next: ConnectionVersionPayload,
): ConnectionLeaseRevocationScope {
  const currentAtNextWritePolicy = {
    ...current,
    allowWrites: next.allowWrites,
  };
  if (canonicalHash(currentAtNextWritePolicy) !== canonicalHash(next)) return "all";
  if (current.allowWrites === next.allowWrites || next.allowWrites) return "none";
  return "write";
}

export function connectionVersionPayload(
  connection: ConnectionInput,
  deleted = false,
): ConnectionVersionPayload {
  return { ...connection, deleted };
}

export function parseConnectionVersionPayload(
  value: unknown,
  options: { credentialMode: SharedConnectionCredentialMode },
): ConnectionVersionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Connection version must be an object");
  }
  const { deleted, ...connection } = value as Record<string, unknown>;
  if (typeof deleted !== "boolean") {
    throw new Error("Connection version deletion state is invalid");
  }
  return connectionVersionPayload(
    parseSharedConnection(connection, options),
    deleted,
  );
}

export function persistedConnectionVersionPayload(
  row: {
    name: string; engine: string; provider: string; driverId: string | null;
    host: string; port: number; databaseName: string; sslmode: string;
    readonlyDefault: boolean; allowWrites: boolean; environment: string | null;
    schemaGroup: string | null;
  },
  deleted = false,
): ConnectionVersionPayload {
  return {
    name: row.name,
    engine: row.engine as ConnectionInput["engine"],
    provider: row.provider as ConnectionInput["provider"],
    driverId: row.driverId,
    host: row.host,
    port: row.port,
    database: row.databaseName,
    sslmode: row.sslmode,
    readonlyDefault: row.readonlyDefault,
    allowWrites: row.allowWrites,
    env: row.environment,
    schemaGroup: row.schemaGroup,
    deleted,
  };
}

export function parseExpectedRevision(request: Request): number | null {
  const dedicated = request.headers.get(EXPECTED_REVISION_HEADER);
  if (dedicated === null) return null;
  const dedicatedMatch = dedicated === null ? null : /^([0-9]+)$/.exec(dedicated.trim());
  if (dedicated !== null && !dedicatedMatch) {
    throw new Error(`${EXPECTED_REVISION_HEADER} must be a non-negative revision`);
  }
  const revision = Number(dedicatedMatch![1]);
  if (!Number.isSafeInteger(revision)) throw new Error("Invalid expected revision");
  return revision;
}
