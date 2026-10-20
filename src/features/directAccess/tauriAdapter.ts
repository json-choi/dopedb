// The only frontend owner of the ten `direct_access_*` Tauri command names. Every
// command names the signed-in account beside the exact workspace and shared
// database it acts on; secrets leave only as input fields and are never returned.
import { invoke } from "../../ipc/core";
import type { ConnectionId } from "../connections/domain";
import type { AccountId, WorkspaceId } from "../workspaces/domain";
import type {
  DirectEndpointPrefill,
  DirectPreflightInput,
  DirectPreflightReport,
  DirectRegisterInput,
  DirectRegisteredDatabase,
  DirectRevocationEntry,
  DirectRevocationOutcome,
  DirectRevokeApplyRequest,
  DirectScope,
  DirectStatus,
  DirectSyncReport,
} from "./domain";

/** Endpoint (never credentials) of one saved connection, to prefill the add flow. */
export function prefillDirectEndpoint(
  connectionId: ConnectionId,
): Promise<DirectEndpointPrefill> {
  return invoke("direct_access_prefill_from_connection", { connectionId });
}

/** Probes a candidate endpoint with the administrator credential; stores nothing. */
export function preflightDirectDatabase(
  input: DirectPreflightInput,
): Promise<DirectPreflightReport> {
  return invoke("direct_access_preflight", { input });
}

/** Registers the team connection and keeps the administrator credential on this device. */
export function registerDirectDatabase(
  input: DirectRegisterInput,
): Promise<DirectRegisteredDatabase> {
  return invoke("direct_access_register", { input });
}

/** First connect of a member: creates their password on this device and uploads its verifier. */
export function requestDirectMemberAccount(
  scope: DirectScope,
  sshAlias: string | null = null,
): Promise<DirectStatus> {
  return invoke("direct_access_member_request", { input: { ...scope, sshAlias } });
}

export function readDirectStatus(scope: DirectScope): Promise<DirectStatus> {
  return invoke("direct_access_status", { input: scope });
}

/** Runs one administrator-device pass now (apply requests, revocations, drift). */
export function syncDirectDatabaseNow(scope: DirectScope): Promise<DirectSyncReport> {
  return invoke("direct_access_sync_now", { input: scope });
}

/**
 * Revokes the affected principals on the database, then commits the access-lowering
 * mutation. Without an administrator credential nothing proceeds: the outcome lists
 * `blockedNoCredential`, and the caller may retry with `credentials` or record intent.
 */
export function applyDirectRevocation(
  request: DirectRevokeApplyRequest,
): Promise<DirectRevocationOutcome> {
  return invoke("direct_access_revoke_apply", { request });
}

/** Pending revocation items of the workspace. */
export function listDirectRevocations(
  accountId: AccountId,
  workspaceId: WorkspaceId,
): Promise<DirectRevocationEntry[]> {
  return invoke("direct_access_revocations", { input: { accountId, workspaceId } });
}

export function cancelDirectRevocation(
  accountId: AccountId,
  workspaceId: WorkspaceId,
  revocationId: string,
): Promise<void> {
  return invoke("direct_access_revocation_cancel", {
    input: { accountId, workspaceId, revocationId },
  });
}

/** Deletes this device's administrator credential for the database. */
export function forgetDirectAdminCredential(scope: DirectScope): Promise<void> {
  return invoke("direct_access_forget_admin_credential", { input: scope });
}
