// Account administration wire contracts: the signed-in account's sessions, the owned
// workspaces whose deletion is scheduled, and the lifecycle fields the cancellation
// needs. Parsers are strict and pure; a malformed row fails the whole read.
import { workspaceId, type WorkspaceId } from "../../workspaces/domain";

export type AccountSessionClient = "browser" | "desktop";

/** One session of the signed-in account. Session tokens never leave the server. */
export interface AccountSession {
  id: string;
  current: boolean;
  client: AccountSessionClient;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
}

/** An owned workspace whose members are suspended until deletion is cancelled. */
export interface DeletionPendingWorkspace {
  id: WorkspaceId;
  name: string;
  deletionRequestedAt: string | null;
  purgeAfter: string | null;
}

export interface WorkspaceLifecycleSnapshot {
  lifecycleState: "active" | "deletion_pending";
  deletionReceiptId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isTimestampOrNull(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function invalid(subject: string): Error {
  return new Error(`The workspace service returned an incompatible ${subject}.`);
}

function parseAccountSession(value: unknown): AccountSession {
  const row = record(value);
  if (!row) throw invalid("session");
  const { id, current, client, createdAt, updatedAt, expiresAt, ipAddress } = row;
  if (
    !isUuid(id)
    || typeof current !== "boolean"
    || (client !== "browser" && client !== "desktop")
    || !isTimestamp(createdAt)
    || !isTimestamp(updatedAt)
    || !isTimestamp(expiresAt)
    || (ipAddress !== null && !isText(ipAddress, 256))
  ) {
    throw invalid("session");
  }
  return { id, current, client, createdAt, updatedAt, expiresAt, ipAddress };
}

/** `{ sessions }`, ordered by the server from the most recent activity. */
export function parseAccountSessions(value: unknown): AccountSession[] {
  const sessions = record(value)?.sessions;
  if (!Array.isArray(sessions)) throw invalid("session list");
  return sessions.map(parseAccountSession);
}

function parseDeletionPendingWorkspace(value: unknown): DeletionPendingWorkspace {
  const row = record(value);
  if (!row) throw invalid("workspace");
  const { id, name, deletionRequestedAt, purgeAfter } = row;
  if (
    !isUuid(id)
    || !isText(name, 512)
    || !isTimestampOrNull(deletionRequestedAt)
    || !isTimestampOrNull(purgeAfter)
  ) {
    throw invalid("workspace");
  }
  return { id: workspaceId(id), name, deletionRequestedAt, purgeAfter };
}

/** The `deletionPending` half of `{ workspaces, deletionPending }`. */
export function parseDeletionPendingWorkspaces(value: unknown): DeletionPendingWorkspace[] {
  const body = record(value);
  if (!body || !Array.isArray(body.workspaces) || !Array.isArray(body.deletionPending)) {
    throw invalid("workspace list");
  }
  return body.deletionPending.map(parseDeletionPendingWorkspace);
}

/** Only the lifecycle fields a cancellation depends on. */
export function parseWorkspaceLifecycleSnapshot(value: unknown): WorkspaceLifecycleSnapshot {
  const body = record(value);
  const state = body?.lifecycleState;
  const receipt = body?.deletionReceiptId;
  if (
    (state !== "active" && state !== "deletion_pending")
    || (receipt !== null && !isUuid(receipt))
  ) {
    throw invalid("workspace lifecycle");
  }
  return { lifecycleState: state, deletionReceiptId: receipt };
}
