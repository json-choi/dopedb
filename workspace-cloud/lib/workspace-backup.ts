// Server-only workspace snapshot encryption. Plaintext exists only between a DB read
// and envelope operation or restore validation, and is never returned from a route.
import "server-only";

import {
  openWorkspaceSnapshot,
  sealWorkspaceSnapshot,
  snapshotHash,
  WORKSPACE_DATA_KEY_REFERENCE,
  workspaceDataKeyVersion,
  type WorkspaceMetadataSnapshot,
} from "./workspace-backup-core";
import {
  createWorkspaceKmsSession,
  ensureActiveWorkspaceDataKey,
  withWorkspaceDataKey,
  workspaceDataKeyById,
  type WorkspaceDataKeyRow,
  type WorkspaceKmsSession,
} from "./workspace-data-key";
import { WorkspaceKmsError } from "./workspace-kms-core";

export {
  snapshotHash,
  WORKSPACE_DATA_KEY_REFERENCE,
  workspaceDataKeyVersion,
  type WorkspaceMetadataSnapshot,
};

export type WorkspaceBackupKeyBinding = {
  dataKeyId: string | null;
  keyReference: string;
  keyVersion: string;
};

export function sealWorkspaceMetadataBackupWithDataKey(
  key: Buffer,
  row: WorkspaceDataKeyRow,
  backupId: string,
  snapshot: WorkspaceMetadataSnapshot,
) {
  return sealWorkspaceSnapshot(key, row.organizationId, backupId, snapshot);
}

export async function sealWorkspaceMetadataBackup(input: {
  request: Request;
  workspaceId: string;
  actorUserId: string;
  backupId: string;
  snapshot: WorkspaceMetadataSnapshot;
}) {
  const kms = await createWorkspaceKmsSession(input.request);
  const dataKey = await ensureActiveWorkspaceDataKey({
    organizationId: input.workspaceId,
    actorUserId: input.actorUserId,
    kms,
  });
  const ciphertext = await withWorkspaceDataKey(kms, dataKey, (key) =>
    sealWorkspaceMetadataBackupWithDataKey(key, dataKey, input.backupId, input.snapshot));
  return {
    ciphertext,
    dataKeyId: dataKey.id,
    keyReference: WORKSPACE_DATA_KEY_REFERENCE,
    keyVersion: workspaceDataKeyVersion(dataKey.version),
  };
}

export async function openWorkspaceMetadataBackupWithKms(
  kms: WorkspaceKmsSession,
  input: {
    workspaceId: string;
    backupId: string;
    ciphertext: string;
    binding: WorkspaceBackupKeyBinding;
  },
) {
  const { binding } = input;
  if (
    !binding.dataKeyId
    || binding.keyReference !== WORKSPACE_DATA_KEY_REFERENCE
    || !/^v[1-9][0-9]*$/.test(binding.keyVersion)
  ) throw new WorkspaceKmsError("integrity", 409);
  const dataKey = await workspaceDataKeyById(input.workspaceId, binding.dataKeyId);
  if (!dataKey || workspaceDataKeyVersion(dataKey.version) !== binding.keyVersion) {
    throw new WorkspaceKmsError("integrity", 409);
  }
  return withWorkspaceDataKey(kms, dataKey, (key) =>
    openWorkspaceSnapshot(key, input.workspaceId, input.backupId, input.ciphertext));
}

export async function openWorkspaceMetadataBackup(input: {
  request: Request;
  workspaceId: string;
  backupId: string;
  ciphertext: string;
  binding: WorkspaceBackupKeyBinding;
}) {
  const kms = await createWorkspaceKmsSession(input.request);
  return openWorkspaceMetadataBackupWithKms(kms, input);
}
