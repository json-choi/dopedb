// Pure rules for direct shared databases: exact public-verifier shapes, server-generated
// principal identity, the closed state/failure vocabularies, and the effective-level
// projection. No storage and no secrets: a verifier is a public derivative of the
// member's password and is the only credential-shaped value the control plane accepts.
import {
  accessModeAllowsWrite,
  accessModeForConnectionGrant,
  isWorkspaceConnectionCapability,
  isWorkspaceRole,
} from "./workspace-permissions";

export const DIRECT_ENGINES = ["postgres", "mysql"] as const;
export type DirectEngine = (typeof DIRECT_ENGINES)[number];
export const DIRECT_VERIFIER_KINDS = ["scram-sha-256", "caching_sha2"] as const;
export type DirectVerifierKind = (typeof DIRECT_VERIFIER_KINDS)[number];
export const DIRECT_LEVELS = ["none", "read", "write"] as const;
export type DirectLevel = (typeof DIRECT_LEVELS)[number];
export const DIRECT_PRINCIPAL_STATES = [
  "requested", "applying", "ready", "failed", "drop_pending", "dropped",
] as const;
export type DirectPrincipalState = (typeof DIRECT_PRINCIPAL_STATES)[number];
export const DIRECT_FAILURE_CODES = [
  "marker_mismatch", "oid_mismatch", "owns_objects", "unexpected_membership",
  "grantor_insufficient", "version_unsupported", "endpoint_changed",
  "permission_denied", "network", "name_conflict", "credential_missing",
] as const;
export type DirectFailureCode = (typeof DIRECT_FAILURE_CODES)[number];
export const DIRECT_REVOCATION_KINDS = [
  "member_removed", "grant_lowered", "role_lowered", "team_read_off",
  "db_deleted", "self_leave", "account_deleted",
] as const;
export type DirectRevocationKind = (typeof DIRECT_REVOCATION_KINDS)[number];

export const DIRECT_CLAIM_LEASE_SECONDS = 120;
export const DIRECT_SCOPE_MAX_ENTRIES = 32;
const DIRECT_SCOPE_MAX_BYTES = { postgres: 63, mysql: 64 } as const;

// 16-byte salt (24 base64 chars, last data char carries 4 bits) and two 32-byte keys
// (44 chars, last data char carries 2 bits). Length matches the database CHECK.
const SCRAM_SHA_256 = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{21}[AQgw]==\$[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=:[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/u;
// $A$005$ + 20 salt characters + 43-character sha256-crypt digest (5000 rounds), all from the
// crypt alphabet so no quoting character can appear (identical to the Rust validator).
const CACHING_SHA2 = /^\$A\$005\$[./0-9A-Za-z]{63}$/u;
const PRINCIPAL_NAME = /^dopedb_[0-9a-f]{20}$/u;
const MARKER = /^[A-Za-z0-9_-]{43}$/u;

export function isDirectEngine(value: unknown): value is DirectEngine {
  return typeof value === "string" && (DIRECT_ENGINES as readonly string[]).includes(value);
}

export function verifierKindForEngine(engine: DirectEngine): DirectVerifierKind {
  return engine === "postgres" ? "scram-sha-256" : "caching_sha2";
}

export function isValidDirectVerifier(kind: unknown, verifier: unknown): verifier is string {
  if (typeof verifier !== "string") return false;
  if (kind === "scram-sha-256") return SCRAM_SHA_256.test(verifier);
  if (kind === "caching_sha2") return CACHING_SHA2.test(verifier);
  return false;
}

export function isValidPrincipalName(value: unknown): value is string {
  return typeof value === "string" && PRINCIPAL_NAME.test(value);
}

export function isValidPrincipalMarker(value: unknown): value is string {
  return typeof value === "string" && MARKER.test(value);
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** `dopedb_` plus 20 random hex characters; the only role name the Desktop will touch. */
export function generatePrincipalName() {
  return `dopedb_${Array.from(randomBytes(10), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** 32 random bytes as base64url: the ownership marker stored on the database role. */
export function generatePrincipalMarker() {
  let binary = "";
  for (const byte of randomBytes(32)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Closed principal state machine. Mirrors the database trigger so a stale
 * compare-and-swap is rejected before it reaches storage; storage stays authoritative.
 */
export const DIRECT_PRINCIPAL_TRANSITIONS: Readonly<Record<DirectPrincipalState, readonly DirectPrincipalState[]>> = {
  requested: ["applying", "drop_pending", "dropped"],
  applying: ["ready", "failed", "requested", "drop_pending"],
  ready: ["applying", "requested", "drop_pending"],
  failed: ["requested", "applying", "drop_pending", "dropped"],
  drop_pending: ["dropped", "failed"],
  dropped: [],
};

export function isDirectTransitionAllowed(from: DirectPrincipalState, to: DirectPrincipalState) {
  return from === to || DIRECT_PRINCIPAL_TRANSITIONS[from].includes(to);
}

/**
 * Level a member should hold on a direct database. Reuses the existing
 * grant projection (role x capability) and only adds the endpoint write ceiling:
 * view and unknown values are absent, read is read, write/manage need the ceiling.
 */
export function directDesiredLevel(input: {
  role: string;
  capability: string;
  writeCeiling: boolean;
  memberPresent?: boolean;
  revocationPending?: boolean;
  connectionDeleted?: boolean;
}): DirectLevel {
  if (
    input.memberPresent === false
    || input.revocationPending
    || input.connectionDeleted
    || !isWorkspaceRole(input.role)
    || !isWorkspaceConnectionCapability(input.capability)
  ) return "none";
  const accessMode = accessModeForConnectionGrant(input.role, input.capability);
  if (accessMode === "view") return "none";
  return accessModeAllowsWrite(accessMode) && input.writeCeiling ? "write" : "read";
}

const PG_RESERVED_SCHEMA = /^(pg_|information_schema$)/iu;
const MYSQL_SYSTEM_SCHEMAS = new Set(["mysql", "information_schema", "performance_schema", "sys"]);

/** Bounded, duplicate-free scope of PostgreSQL schemas or MySQL databases. */
export function parseDirectScope(engine: DirectEngine, value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DIRECT_SCOPE_MAX_ENTRIES) {
    throw new Error("Invalid direct scope");
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      typeof entry !== "string"
      || entry.length < 1
      || (engine === "postgres"
        ? new TextEncoder().encode(entry).length > DIRECT_SCOPE_MAX_BYTES.postgres
        : [...entry].length > DIRECT_SCOPE_MAX_BYTES.mysql)
      || /[\u0000-\u001f\u007f"`'\\%]/u.test(entry)
      || entry !== entry.trim()
      || seen.has(entry)
      || (engine === "postgres" ? PG_RESERVED_SCHEMA.test(entry) : MYSQL_SYSTEM_SCHEMAS.has(entry.toLowerCase()))
    ) throw new Error("Invalid direct scope");
    seen.add(entry);
  }
  return [...seen];
}
