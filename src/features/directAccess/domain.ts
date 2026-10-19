// Direct shared database wire values. Every shape mirrors the Rust serde types in
// `src-tauri/src/features/direct_access` (camelCase fields, closed snake_case enums);
// secrets only travel inward, as the `password` of an input, and are never returned.
import type { ConnectionId } from "../connections/domain";
import type { AccountId, WorkspaceId } from "../workspaces/domain";
import type { WorkspaceAdminOperation } from "../workspaceAdmin/domain";

export type DirectEngine = "postgres" | "mysql";

/** Closed categorical reasons a principal or a probe can fail. */
export const DIRECT_FAILURE_CODES = [
  "marker_mismatch",
  "oid_mismatch",
  "owns_objects",
  "unexpected_membership",
  "grantor_insufficient",
  "version_unsupported",
  "endpoint_changed",
  "permission_denied",
  "network",
  "name_conflict",
  "credential_missing",
] as const;
export type DirectFailureCode = (typeof DIRECT_FAILURE_CODES)[number];

export type DirectLevel = "none" | "read" | "write";

export type DirectProvisioningState =
  | "not_requested"
  | "requested"
  | "applying"
  | "ready"
  | "failed"
  | "drop_pending"
  | "dropped";

/** The caller's own principal on one shared database. */
export interface DirectProvisioningStatus {
  state: DirectProvisioningState;
  level: DirectLevel;
  principalName: string | null;
  lastSyncedAt: string | null;
  failureCode: DirectFailureCode | null;
}

/** Own principal status plus whether this device can act as an administrator device. */
export interface DirectStatus {
  provisioning: DirectProvisioningStatus;
  adminCredentialOnDevice: boolean;
}

/** Exact account, workspace and shared database a command acts on. */
export interface DirectScope {
  accountId: AccountId;
  workspaceId: WorkspaceId;
  connectionId: ConnectionId;
}

/** Where the database lives, without any credential. */
export interface DirectEndpoint {
  engine: DirectEngine;
  host: string;
  port: number;
  database: string;
  sslmode: string;
  /** A device-local `~/.ssh/config` Host alias; never sent to the server. */
  sshAlias: string | null;
}

/** Endpoint of one of the caller's saved connections. */
export type DirectEndpointPrefill = DirectEndpoint;

export interface DirectAdminCredential {
  username: string;
  password: string;
}

export type DirectPreflightWarning = "public_create" | "grantor_insufficient";

export interface DirectNamespaceFacts {
  name: string;
  /** The administrator may grant on every existing object of the namespace. */
  grantable: boolean;
  /** PUBLIC may create objects here, which would give members object ownership. */
  publicCreate: boolean;
}

export interface DirectPreflightInput {
  accountId: AccountId;
  endpoint: DirectEndpoint;
  credential: DirectAdminCredential;
  /** Namespaces chosen so far; when present the report includes the exact plan. */
  scope: string[] | null;
  writeCeiling: boolean;
}

/** A probe failure is data (`failureCode`), not an error. */
export interface DirectPreflightReport {
  engine: DirectEngine;
  serverVersion: string | null;
  versionSupported: boolean;
  canCreatePrincipal: boolean;
  namespaces: DirectNamespaceFacts[];
  warnings: DirectPreflightWarning[];
  failureCode: DirectFailureCode | null;
  planRead: string[];
  planWrite: string[];
}

export interface DirectRegisterInput {
  accountId: AccountId;
  workspaceId: WorkspaceId;
  name: string;
  env: string | null;
  schemaGroup: string | null;
  endpoint: DirectEndpoint;
  credential: DirectAdminCredential;
  scope: string[];
  writeCeiling: boolean;
}

export interface DirectRegisteredDatabase {
  connectionId: ConnectionId;
}

export type DirectSyncSkip = "no_credential" | "busy" | "unreachable";

export interface DirectSyncReport {
  skipped: DirectSyncSkip | null;
  failureCode: DirectFailureCode | null;
  claimed: number;
  applied: number;
  failed: number;
  revocationsApplied: number;
  revocationsPending: number;
}

export type DirectRevocationKind =
  | "member_removed"
  | "grant_lowered"
  | "role_lowered"
  | "team_read_off"
  | "db_deleted"
  | "self_leave"
  | "account_deleted";

export type DirectRevocationState = "pending" | "applied" | "cancelled";

/** One recorded access-lowering intent waiting for an administrator device. */
export interface DirectRevocationEntry {
  id: string;
  connectionId: string;
  memberId: string;
  principalName: string | null;
  kind: DirectRevocationKind;
  targetLevel: DirectLevel;
  state: DirectRevocationState;
  createdAt: string;
}

export interface DirectRevocationTarget {
  connectionId: ConnectionId;
  memberIds: string[];
}

/** A credential typed for this action only. */
export interface DirectInlineCredential {
  connectionId: ConnectionId;
  username: string;
  password: string;
  sshAlias: string | null;
  /** Saved to the keychain only after it proved it can reach the database. */
  saveToKeychain: boolean;
}

export interface DirectRevokeApplyRequest {
  accountId: AccountId;
  workspaceId: WorkspaceId;
  kind: DirectRevocationKind;
  /** `none` or `read`; never `write`. */
  targetLevel: Exclude<DirectLevel, "write">;
  targets: DirectRevocationTarget[];
  /** The access-lowering change, committed only after every principal was revoked. */
  mutation: WorkspaceAdminOperation;
  credentials?: DirectInlineCredential[];
}

export interface DirectRevocationRef {
  revocationId: string;
  connectionId: string;
  memberId: string;
}

export interface DirectRevocationFailure {
  connectionId: string;
  memberId: string;
  failureCode: DirectFailureCode;
}

export type DirectMutationState =
  | "not_attempted"
  | "done"
  | "revocation_required"
  | "rejected";

export interface DirectRevocationOutcome {
  applied: DirectRevocationRef[];
  pending: DirectRevocationRef[];
  /** Connections whose administrator credential is missing on this device. */
  blockedNoCredential: string[];
  failed: DirectRevocationFailure[];
  mutation: DirectMutationState;
}

/** A provisioned connection whose caller principal cannot open it yet. */
export function directProvisioningPending(status: DirectProvisioningStatus): boolean {
  return status.state === "requested" || status.state === "applying";
}

/** SSL modes the control plane accepts per engine; the first entry is the verified default. */
export const DIRECT_SSL_MODES = {
  postgres: ["verify-full", "require"],
  mysql: ["VERIFY_IDENTITY", "REQUIRED"],
} as const satisfies Record<DirectEngine, readonly string[]>;

export const DIRECT_DEFAULT_PORT = { postgres: 5432, mysql: 3306 } as const satisfies Record<
  DirectEngine,
  number
>;

/** `require` / `REQUIRED` encrypt but do not verify the server, so a MITM can read the credential. */
export function directSslmodeUnverified(sslmode: string): boolean {
  return sslmode === "require" || sslmode === "REQUIRED";
}

/** Any DopeDB-owned failure code carried in a native error message, or null. */
export function directFailureCodeOf(error: unknown): DirectFailureCode | null {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message: unknown }).message)
    : "";
  const match = /stopped: ([a-z_]+)/u.exec(message);
  return DIRECT_FAILURE_CODES.find((code) => code === match?.[1]) ?? null;
}
