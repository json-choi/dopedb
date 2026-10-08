// Wire contracts for the owner-only Backups & deletion section. Every control-plane
// body is validated here before it reaches the cache or a command decision, so a
// malformed answer becomes an explicit failure instead of an empty list or a wrong
// deletion state. Documented refusals are classified by their exact server sentence.
import { errDetails } from "../../../ipc/types";
import type { WorkspaceAdminSettingsSection } from "../navigationRequest";
import { WorkspaceAdminRequestError } from "../requests";

export const DELETION_BLOCKER_KINDS = [
  "providerIntegrations",
  "credentialLeases",
  "providerOperations",
  "keyRotations",
  "memberRevocations",
] as const;

export type DeletionBlockerKind = (typeof DELETION_BLOCKER_KINDS)[number];
export type DeletionBlockers = Record<DeletionBlockerKind, number>;

export interface LifecycleStatus {
  workspaceName: string;
  revision: number;
  lifecycleState: "active" | "deletion_pending";
  deletionReceiptId: string | null;
  deletionRequestedAt: string | null;
  purgeAfter: string | null;
  retentionDays: number;
  backupRetentionDays: number;
  backupCount: number;
  tombstonedBackupCount: number;
  blockers: DeletionBlockers;
  canScheduleDeletion: boolean;
}

export interface WorkspaceBackup {
  id: string;
  sourceRevision: number;
  keyReference: string;
  keyVersion: string;
  snapshotHash: string;
  createdAt: string;
}

export interface KeyRotationRun {
  id: string;
  status: "running" | "completed";
  fromVersion: number | null;
  toVersion: number;
  processedBackups: number;
  remainingBackups: number;
  createdAt: string;
  completedAt: string | null;
}

export interface KeyRotationStatus {
  activeVersion: number | null;
  backupCount: number;
  rotation: KeyRotationRun | null;
}

export interface KeyRotationStep {
  status: KeyRotationStatus;
  /** Another request holds the 70 second rotation claim; this one changed nothing. */
  busy: boolean;
  /** This request id already finished its rotation. */
  replayed: boolean;
}

export interface RestoreResult {
  restored: number;
  conflictIds: string[];
}

export interface DeletionScheduled {
  result: "scheduled" | "replayed";
  status: LifecycleStatus;
}

/** A successful response whose body does not match the documented contract. */
export class LifecycleResponseError extends Error {
  constructor(response: string) {
    super(`The workspace service returned an unexpected ${response} response.`);
    this.name = "LifecycleResponseError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_VERSION = /^v[1-9][0-9]*$/;
const SHA256_HEX = /^[a-f0-9]{64}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isVersion(value: unknown): value is number {
  return isCount(value) && value >= 1;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNullable<T>(value: unknown, guard: (value: unknown) => value is T): value is T | null {
  return value === null || guard(value);
}

function readBlockers(value: unknown): DeletionBlockers | null {
  const row = record(value);
  if (!row) return null;
  const blockers = {} as DeletionBlockers;
  for (const kind of DELETION_BLOCKER_KINDS) {
    const count = row[kind];
    if (!isCount(count)) return null;
    blockers[kind] = count;
  }
  return blockers;
}

export function readLifecycleStatus(value: unknown): LifecycleStatus | null {
  const row = record(value);
  if (!row) return null;
  const {
    workspaceName,
    revision,
    lifecycleState,
    deletionReceiptId,
    deletionRequestedAt,
    purgeAfter,
    retentionDays,
    backupRetentionDays,
    backupCount,
    tombstonedBackupCount,
    canScheduleDeletion,
  } = row;
  const blockers = readBlockers(row.blockers);
  if (
    !blockers
    || typeof workspaceName !== "string"
    || !isCount(revision)
    || (lifecycleState !== "active" && lifecycleState !== "deletion_pending")
    || !isNullable(deletionReceiptId, isUuid)
    || !isNullable(deletionRequestedAt, isTimestamp)
    || !isNullable(purgeAfter, isTimestamp)
    || !isCount(retentionDays)
    || !isCount(backupRetentionDays)
    || !isCount(backupCount)
    || !isCount(tombstonedBackupCount)
    || typeof canScheduleDeletion !== "boolean"
  ) {
    return null;
  }
  return {
    workspaceName,
    revision,
    lifecycleState: lifecycleState === "deletion_pending" ? "deletion_pending" : "active",
    deletionReceiptId,
    deletionRequestedAt,
    purgeAfter,
    retentionDays,
    backupRetentionDays,
    backupCount,
    tombstonedBackupCount,
    blockers,
    canScheduleDeletion,
  };
}

export function parseLifecycleStatus(value: unknown): LifecycleStatus {
  const status = readLifecycleStatus(value);
  if (!status) throw new LifecycleResponseError("lifecycle");
  return status;
}

function readBackup(value: unknown): WorkspaceBackup | null {
  const row = record(value);
  if (
    !row
    || !isUuid(row.id)
    || !isVersion(row.sourceRevision)
    || typeof row.keyReference !== "string"
    || typeof row.keyVersion !== "string"
    || !KEY_VERSION.test(row.keyVersion)
    || typeof row.snapshotHash !== "string"
    || !SHA256_HEX.test(row.snapshotHash)
    || !isTimestamp(row.createdAt)
  ) {
    return null;
  }
  return {
    id: row.id,
    sourceRevision: row.sourceRevision,
    keyReference: row.keyReference,
    keyVersion: row.keyVersion,
    snapshotHash: row.snapshotHash,
    createdAt: row.createdAt,
  };
}

/** Newest first, exactly as listed; the envelope must name the requested workspace. */
export function parseBackupList(value: unknown, workspaceId: string): WorkspaceBackup[] {
  const body = record(value);
  if (
    !body
    || typeof body.workspaceId !== "string"
    || body.workspaceId.toLowerCase() !== workspaceId.toLowerCase()
    || !Array.isArray(body.backups)
  ) {
    throw new LifecycleResponseError("backup list");
  }
  const backups: WorkspaceBackup[] = [];
  for (const item of body.backups) {
    const backup = readBackup(item);
    if (!backup) throw new LifecycleResponseError("backup list");
    backups.push(backup);
  }
  return backups;
}

function readRotationRun(value: unknown): KeyRotationRun | null {
  const row = record(value);
  if (
    !row
    || !isUuid(row.id)
    || (row.status !== "running" && row.status !== "completed")
    || !isNullable(row.fromVersion, isVersion)
    || !isVersion(row.toVersion)
    || !isCount(row.processedBackups)
    || !isCount(row.remainingBackups)
    || !isTimestamp(row.createdAt)
    || !isNullable(row.completedAt, isTimestamp)
  ) {
    return null;
  }
  return {
    id: row.id,
    status: row.status === "completed" ? "completed" : "running",
    fromVersion: row.fromVersion,
    toVersion: row.toVersion,
    processedBackups: row.processedBackups,
    remainingBackups: row.remainingBackups,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

function readKeyRotationStatus(value: unknown): KeyRotationStatus | null {
  const row = record(value);
  if (!row || !isNullable(row.activeVersion, isVersion) || !isCount(row.backupCount)) {
    return null;
  }
  if (row.rotation === null) {
    return { activeVersion: row.activeVersion, backupCount: row.backupCount, rotation: null };
  }
  const rotation = readRotationRun(row.rotation);
  return rotation
    ? { activeVersion: row.activeVersion, backupCount: row.backupCount, rotation }
    : null;
}

export function parseKeyRotationStatus(value: unknown): KeyRotationStatus {
  const status = readKeyRotationStatus(value);
  if (!status) throw new LifecycleResponseError("key rotation");
  return status;
}

/** One rotation request: the status fields plus whether it was busy or a replay. */
export function readKeyRotationStep(value: unknown): KeyRotationStep | null {
  const row = record(value);
  const status = readKeyRotationStatus(value);
  if (!row || !status || typeof row.busy !== "boolean") return null;
  if (row.replayed !== undefined && typeof row.replayed !== "boolean") return null;
  return { status, busy: row.busy, replayed: row.replayed === true };
}

export function readRestoreResult(value: unknown): RestoreResult | null {
  const row = record(value);
  if (!row || !isCount(row.restored) || !Array.isArray(row.conflictIds)) return null;
  const conflictIds: string[] = [];
  for (const id of row.conflictIds) {
    if (!isUuid(id)) return null;
    conflictIds.push(id);
  }
  return { restored: row.restored, conflictIds };
}

export function readDeletionScheduled(value: unknown): DeletionScheduled | null {
  const row = record(value);
  const status = readLifecycleStatus(row?.status);
  if (!row || !status || (row.result !== "scheduled" && row.result !== "replayed")) {
    return null;
  }
  return { result: row.result === "replayed" ? "replayed" : "scheduled", status };
}

/** The lifecycle status a deletion refusal carries (409 and the 503 retry case). */
export function lifecycleStatusInRefusal(error: unknown): LifecycleStatus | null {
  return error instanceof WorkspaceAdminRequestError
    ? readLifecycleStatus(record(error.body)?.status)
    : null;
}

/** The control plane's own key version label for a data-key version. */
export function keyVersionLabel(version: number): string {
  return `v${version}`;
}

export type BlockerDestination = Extract<
  WorkspaceAdminSettingsSection,
  "workspace-providers" | "workspace-members"
>;

/** Where each deletion prerequisite is resolved; key rotation finishes on this page. */
export const BLOCKER_RESOLUTION: Record<DeletionBlockerKind, BlockerDestination | null> = {
  providerIntegrations: "workspace-providers",
  credentialLeases: "workspace-providers",
  providerOperations: "workspace-providers",
  keyRotations: null,
  memberRevocations: "workspace-members",
};

export function outstandingBlockers(blockers: DeletionBlockers) {
  return DELETION_BLOCKER_KINDS
    .filter((kind) => blockers[kind] > 0)
    .map((kind) => ({ kind, count: blockers[kind] }));
}

export type LifecycleFailure =
  | "unexpectedResponse"
  | "ownerRequired"
  | "workspaceNotFound"
  | "metadataUnavailable"
  | "connectionLimit"
  | "backupChanged"
  | "keyIntegrity"
  | "encryptionUnavailable"
  | "backupNotFound"
  | "backupCleanupPending"
  | "restoreIntegrity"
  | "restoreChanged"
  | "decryptionUnavailable"
  | "keyServiceUnavailable"
  | "keyServiceNotConfigured"
  | "rotationUnavailable"
  | "deletionRefused"
  | "deletionCleanupPending"
  | "confirmationRequired";

const DOCUMENTED_REFUSALS = new Map<string, LifecycleFailure>([
  ["Workspace owner access is required", "ownerRequired"],
  ["Workspace access denied", "ownerRequired"],
  ["Workspace not found", "workspaceNotFound"],
  ["Workspace metadata is unavailable", "metadataUnavailable"],
  ["Workspace backup connection limit exceeded", "connectionLimit"],
  ["Workspace metadata changed concurrently. Retry backup.", "backupChanged"],
  ["Workspace backup key integrity validation failed", "keyIntegrity"],
  ["Workspace backup encryption is unavailable", "encryptionUnavailable"],
  ["Backup not found", "backupNotFound"],
  [
    "Backup deletion was recorded, but retention cleanup could not be scheduled. Retry this request.",
    "backupCleanupPending",
  ],
  ["Backup integrity validation failed", "restoreIntegrity"],
  ["Workspace metadata changed concurrently. Retry restore.", "restoreChanged"],
  ["Workspace backup decryption is unavailable", "decryptionUnavailable"],
  ["Workspace key service is unavailable", "keyServiceUnavailable"],
  ["Workspace key service is not configured", "keyServiceNotConfigured"],
  ["Workspace key rotation is unavailable", "rotationUnavailable"],
  [
    "Workspace deletion prerequisites changed or confirmation did not match",
    "deletionRefused",
  ],
  [
    "Workspace deletion was recorded, but retention cleanup could not be scheduled. Retry this request.",
    "deletionCleanupPending",
  ],
  ["Exact workspace name confirmation is required", "confirmationRequired"],
]);

export function classifyLifecycleFailure(error: unknown): LifecycleFailure | null {
  if (error instanceof LifecycleResponseError) return "unexpectedResponse";
  if (!(error instanceof WorkspaceAdminRequestError) || error.serverMessage === null) {
    return null;
  }
  return DOCUMENTED_REFUSALS.get(error.serverMessage) ?? null;
}

/** The command may have run: the user should look at the current state before retrying. */
export function lifecycleOutcomeUnknown(error: unknown): boolean {
  return error instanceof LifecycleResponseError || errDetails(error).kind === "timeout";
}
