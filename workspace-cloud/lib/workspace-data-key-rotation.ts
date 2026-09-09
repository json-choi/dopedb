// Owner-approved, resumable workspace DEK rotation. Each request owns a short
// database claim, advances a bounded batch, and can be safely retried after a
// lost response because already re-encrypted backups no longer match the job.
import "server-only";

import { and, asc, count, desc, eq, isNull, max, ne, or, sql } from "drizzle-orm";
import { randomBytes, timingSafeEqual } from "node:crypto";

import { db } from "./db";
import { atomicD1 } from "./d1/atomic";
import { backupEnvelopeStorage } from "./d1/backup-chunks";
import { workspaceMemberAuthority } from "./d1/member-authority";
import { utcNow, uuidDefault } from "./d1/schema/values";

const ownerAuthority = (organizationId: string, authority: WorkspaceDataKeyRotationAuthority) =>
  workspaceMemberAuthority(organizationId, { ...authority, role: "owner" }, ["owner"]);
const claimExpiry = sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${`+${70} seconds`})`;
import {
  openWorkspaceMetadataBackupWithKms,
  sealWorkspaceMetadataBackupWithDataKey,
  snapshotHash,
  WORKSPACE_DATA_KEY_REFERENCE,
  workspaceDataKeyVersion,
} from "./workspace-backup";
import {
  ensureActiveWorkspaceDataKey,
  withWorkspaceDataKey,
  workspaceDataKeyById,
  type WorkspaceKmsSession,
} from "./workspace-data-key";
import {
  workspaceDataKey,
  workspaceDataKeyRotation,
  workspaceMetadataBackup,
} from "./schema";
import { wrapWorkspaceDataKey } from "./workspace-kms";
import { WorkspaceKmsError } from "./workspace-kms-core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const WORKSPACE_DATA_KEY_ROTATION_BATCH = 8;

export type WorkspaceDataKeyRotationAuthority = {
  sessionId: string;
  userId: string;
  membershipId: string;
};

type ClaimedRotation = {
  rotationId: string;
  claimId: string;
};

function sameHash(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function runningRotation(organizationId: string) {
  return db.query.workspaceDataKeyRotation.findFirst({
    where: and(
      eq(workspaceDataKeyRotation.organizationId, organizationId),
      eq(workspaceDataKeyRotation.status, "running"),
    ),
    orderBy: [desc(workspaceDataKeyRotation.createdAt)],
  });
}

async function claimRunningRotation(input: {
  organizationId: string;
  authority: WorkspaceDataKeyRotationAuthority;
}): Promise<ClaimedRotation | null> {
  const claimId = crypto.randomUUID();
  const result = await db.execute<{ rotationId: string }>(sql`
    UPDATE workspace_data_key_rotation SET claim_id = ${claimId}, claim_expires_at = ${claimExpiry}, updated_at = ${utcNow}
    WHERE organization_id = ${input.organizationId} AND status = 'running'
      AND (claim_id IS NULL OR claim_expires_at <= ${utcNow})
      AND EXISTS (${ownerAuthority(input.organizationId, input.authority)})
    RETURNING id AS rotationId
  `);
  const rotationId = result.rows[0]?.rotationId;
  return typeof rotationId === "string" && UUID.test(rotationId)
    ? { rotationId, claimId }
    : null;
}

async function startRotation(input: {
  organizationId: string;
  authority: WorkspaceDataKeyRotationAuthority;
  kms: WorkspaceKmsSession;
  idempotencyKey: string;
}): Promise<ClaimedRotation | null> {
  const active = await ensureActiveWorkspaceDataKey({
    organizationId: input.organizationId,
    actorUserId: input.authority.userId,
    kms: input.kms,
  });
  const [maximum] = await db.select({ value: max(workspaceDataKey.version) })
    .from(workspaceDataKey)
    .where(eq(workspaceDataKey.organizationId, input.organizationId));
  const version = Number(maximum.value ?? active.version) + 1;
  if (!Number.isSafeInteger(version) || version < 2 || version > 2_147_483_647) {
    throw new WorkspaceKmsError("integrity", 409);
  }
  const dataKeyId = crypto.randomUUID();
  const rotationId = crypto.randomUUID();
  const claimId = crypto.randomUUID();
  const plaintextKey = randomBytes(32);
  try {
    const wrapped = await wrapWorkspaceDataKey({
      configuration: input.kms.configuration,
      accessToken: input.kms.accessToken,
      workspaceId: input.organizationId,
      dataKeyId,
      version,
      plaintextKey,
    });
    const result = await atomicD1({
      scope: sql`SELECT '{}' AS payload FROM workspace_data_key key
        WHERE key.id = ${active.id} AND key.organization_id = ${input.organizationId}
          AND key.version = ${active.version} AND key.retired_at IS NULL AND key.destroyed_at IS NULL
          AND EXISTS (${ownerAuthority(input.organizationId, input.authority)})
          AND NOT EXISTS (SELECT 1 FROM workspace_data_key_rotation WHERE organization_id = ${input.organizationId} AND status = 'running')
          AND NOT EXISTS (SELECT 1 FROM workspace_data_key_rotation WHERE organization_id = ${input.organizationId} AND idempotency_key = ${input.idempotencyKey})
          AND ${version} = (SELECT max(version) + 1 FROM workspace_data_key WHERE organization_id = ${input.organizationId})`,
      statements: (scope) => [
        sql`UPDATE workspace_data_key SET retired_at = ${utcNow} WHERE id = ${active.id} AND EXISTS (${scope})`,
        sql`INSERT INTO workspace_data_key (id, organization_id, version, key_reference, kms_key_version, wrapped_key, created_by_user_id)
          SELECT ${dataKeyId}, ${input.organizationId}, ${version}, ${input.kms.configuration.keyName},
            ${wrapped.kmsKeyVersion}, ${wrapped.wrappedKey}, ${input.authority.userId} FROM (${scope})`,
        sql`INSERT INTO workspace_data_key_rotation (id, organization_id, from_data_key_id, to_data_key_id,
            idempotency_key, status, claim_id, claim_expires_at, created_by_user_id)
          SELECT ${rotationId}, ${input.organizationId}, ${active.id}, ${dataKeyId}, ${input.idempotencyKey},
            'running', ${claimId}, ${claimExpiry}, ${input.authority.userId} FROM (${scope})`,
        sql`UPDATE workspace_profile SET encryption_key_ref = ${`workspace-data-key:${dataKeyId}`}, updated_at = ${utcNow}
          WHERE organization_id = ${input.organizationId} AND EXISTS (${scope})`,
        sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
          SELECT ${input.organizationId}, ${input.authority.userId}, 'workspace.data_key.rotation.start',
            'workspace_data_key_rotation', ${rotationId}, json_object('fromVersion', ${active.version}, 'toVersion', ${version}), ${uuidDefault}
          FROM (${scope})`,
      ],
    });
    return result.matched ? { rotationId, claimId } : null;
  } finally {
    plaintextKey.fill(0);
  }
}

export async function beginOrClaimWorkspaceDataKeyRotation(input: {
  organizationId: string;
  authority: WorkspaceDataKeyRotationAuthority;
  kms: WorkspaceKmsSession;
  idempotencyKey: string;
}) {
  if (!UUID.test(input.organizationId) || !UUID.test(input.idempotencyKey)) {
    throw new WorkspaceKmsError("integrity", 409);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const replay = await db.query.workspaceDataKeyRotation.findFirst({
      where: and(
        eq(workspaceDataKeyRotation.organizationId, input.organizationId),
        eq(workspaceDataKeyRotation.idempotencyKey, input.idempotencyKey),
      ),
    });
    if (replay?.status === "completed") {
      return { claim: null, busy: false, replayed: true };
    }
    if (await runningRotation(input.organizationId)) {
      return {
        claim: await claimRunningRotation(input),
        busy: true,
        replayed: false,
      };
    }
    const started = await startRotation(input);
    if (started) return { claim: started, busy: false, replayed: false };
  }
  return { claim: await claimRunningRotation(input), busy: true, replayed: false };
}

async function releaseRotationClaim(input: {
  organizationId: string;
  rotationId: string;
  claimId: string;
}) {
  await db.update(workspaceDataKeyRotation).set({
    claimId: null,
    claimExpiresAt: null,
    updatedAt: new Date(),
  }).where(and(
    eq(workspaceDataKeyRotation.id, input.rotationId),
    eq(workspaceDataKeyRotation.organizationId, input.organizationId),
    eq(workspaceDataKeyRotation.claimId, input.claimId),
    eq(workspaceDataKeyRotation.status, "running"),
  ));
}

async function finishRotationBatch(input: {
  organizationId: string;
  rotationId: string;
  claimId: string;
  processed: number;
  authority: WorkspaceDataKeyRotationAuthority;
}) {
  const result = await atomicD1({
    scope: sql`SELECT json_object('from', rotation.from_data_key_id, 'to', rotation.to_data_key_id,
        'remaining', (SELECT count(*) FROM workspace_metadata_backup backup
          WHERE backup.organization_id = ${input.organizationId} AND backup.data_key_id IS NOT rotation.to_data_key_id)) AS payload
      FROM workspace_data_key_rotation rotation
      WHERE rotation.id = ${input.rotationId} AND rotation.organization_id = ${input.organizationId}
        AND rotation.status = 'running' AND rotation.claim_id = ${input.claimId} AND rotation.claim_expires_at > ${utcNow}
        AND EXISTS (${ownerAuthority(input.organizationId, input.authority)})`,
    statements: (scope) => [
      sql`UPDATE workspace_data_key_rotation SET processed_backups = processed_backups + ${input.processed},
          status = CASE WHEN (SELECT json_extract(payload, '$.remaining') FROM (${scope})) = 0 THEN 'completed' ELSE 'running' END,
          claim_id = NULL, claim_expires_at = NULL, updated_at = ${utcNow},
          completed_at = CASE WHEN (SELECT json_extract(payload, '$.remaining') FROM (${scope})) = 0 THEN ${utcNow} ELSE NULL END
        WHERE id = ${input.rotationId} AND EXISTS (${scope})
        RETURNING status, processed_backups AS processedBackups`,
      sql`UPDATE workspace_data_key SET wrapped_key = NULL, destroyed_at = ${utcNow}
        WHERE organization_id = ${input.organizationId}
          AND id = (SELECT json_extract(payload, '$.from') FROM (${scope}) WHERE json_extract(payload, '$.remaining') = 0)
          AND NOT EXISTS (SELECT 1 FROM workspace_metadata_backup backup WHERE backup.organization_id = ${input.organizationId} AND backup.data_key_id = workspace_data_key.id)`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'workspace.data_key.rotation.complete',
          'workspace_data_key_rotation', ${input.rotationId}, json_object('processedBackups', rotation.processed_backups), ${uuidDefault}
        FROM workspace_data_key_rotation rotation WHERE rotation.id = ${input.rotationId}
          AND EXISTS (SELECT 1 FROM (${scope}) WHERE json_extract(payload, '$.remaining') = 0)`,
      sql`SELECT rotation.status, rotation.processed_backups AS processedBackups, json_extract(scope.payload, '$.remaining') AS remaining
        FROM workspace_data_key_rotation rotation JOIN (${scope}) scope ON TRUE WHERE rotation.id = ${input.rotationId}`,
    ],
  });
  const row = result.rows[3]?.[0];
  if (!row) throw new WorkspaceKmsError("unavailable", 503);
  return {
    status: row.status === "completed" ? "completed" as const : "running" as const,
    processedBackups: Number(row.processedBackups),
    remaining: Number(row.remaining),
  };
}

export async function advanceWorkspaceDataKeyRotation(input: {
  organizationId: string;
  authority: WorkspaceDataKeyRotationAuthority;
  kms: WorkspaceKmsSession;
  claim: ClaimedRotation;
}) {
  const rotation = await db.query.workspaceDataKeyRotation.findFirst({
    where: and(
      eq(workspaceDataKeyRotation.id, input.claim.rotationId),
      eq(workspaceDataKeyRotation.organizationId, input.organizationId),
      eq(workspaceDataKeyRotation.status, "running"),
      eq(workspaceDataKeyRotation.claimId, input.claim.claimId),
    ),
  });
  if (!rotation || rotation.claimExpiresAt!.valueOf() <= Date.now()) {
    throw new WorkspaceKmsError("unavailable", 409);
  }
  const target = await workspaceDataKeyById(input.organizationId, rotation.toDataKeyId);
  if (!target || target.retiredAt || target.destroyedAt) {
    throw new WorkspaceKmsError("integrity", 409);
  }
  const backups = await db.select().from(workspaceMetadataBackup).where(and(
    eq(workspaceMetadataBackup.organizationId, input.organizationId),
    or(
      isNull(workspaceMetadataBackup.dataKeyId),
      ne(workspaceMetadataBackup.dataKeyId, target.id),
    ),
  )).orderBy(
    asc(workspaceMetadataBackup.createdAt),
    asc(workspaceMetadataBackup.id),
  ).limit(WORKSPACE_DATA_KEY_ROTATION_BATCH);

  let processed = 0;
  try {
    await withWorkspaceDataKey(input.kms, target, async (targetKey) => {
      for (const backup of backups) {
        const snapshot = await openWorkspaceMetadataBackupWithKms(input.kms, {
          workspaceId: input.organizationId,
          backupId: backup.id,
          ciphertext: backup.ciphertext,
          binding: {
            dataKeyId: backup.dataKeyId,
            keyReference: backup.keyReference,
            keyVersion: backup.keyVersion,
          },
        });
        if (
          snapshot.workspace.revision !== backup.sourceRevision
          || !sameHash(snapshotHash(snapshot), backup.snapshotHash)
        ) throw new WorkspaceKmsError("integrity", 409);
        const ciphertext = sealWorkspaceMetadataBackupWithDataKey(
          targetKey,
          target,
          backup.id,
          snapshot,
        );
        const storage = backupEnvelopeStorage(ciphertext);
        const updated = await atomicD1({
          scope: sql`SELECT '{}' AS payload FROM workspace_metadata_backup backup
            WHERE backup.id = ${backup.id} AND backup.organization_id = ${input.organizationId}
              AND backup.data_key_id IS ${backup.dataKeyId} AND backup.key_reference = ${backup.keyReference}
              AND backup.key_version = ${backup.keyVersion} AND backup.ciphertext = ${backup.ciphertext}
              AND backup.snapshot_hash = ${backup.snapshotHash}
              AND EXISTS (${ownerAuthority(input.organizationId, input.authority)})
              AND EXISTS (SELECT 1 FROM workspace_data_key_rotation claimed
                WHERE claimed.id = ${rotation.id} AND claimed.organization_id = ${input.organizationId}
                  AND claimed.status = 'running' AND claimed.claim_id = ${input.claim.claimId}
                  AND claimed.claim_expires_at > ${utcNow})`,
          statements: (scope) => [
            sql`UPDATE workspace_metadata_backup SET data_key_id = ${target.id},
                key_reference = ${WORKSPACE_DATA_KEY_REFERENCE}, key_version = ${workspaceDataKeyVersion(target.version)},
                ciphertext = ${storage.value}, reencrypted_at = ${utcNow}, reencrypted_by_rotation_id = ${rotation.id}
              WHERE id = ${backup.id} AND EXISTS (${scope})`,
            ...storage.statements(input.organizationId, backup.id, scope),
          ],
        });
        if (updated.matched) processed += 1;
      }
    });
    return await finishRotationBatch({
      organizationId: input.organizationId,
      rotationId: input.claim.rotationId,
      claimId: input.claim.claimId,
      processed,
      authority: input.authority,
    });
  } catch (error) {
    await releaseRotationClaim({
      organizationId: input.organizationId,
      rotationId: input.claim.rotationId,
      claimId: input.claim.claimId,
    });
    throw error;
  }
}

export async function workspaceDataKeyRotationStatus(organizationId: string) {
  const [active, latest, backupCount] = await Promise.all([
    db.query.workspaceDataKey.findFirst({
      where: and(
        eq(workspaceDataKey.organizationId, organizationId),
        isNull(workspaceDataKey.retiredAt),
        isNull(workspaceDataKey.destroyedAt),
      ),
      orderBy: [desc(workspaceDataKey.version)],
    }),
    db.query.workspaceDataKeyRotation.findFirst({
      where: eq(workspaceDataKeyRotation.organizationId, organizationId),
      orderBy: [desc(workspaceDataKeyRotation.createdAt)],
    }),
    db.select({ value: count() }).from(workspaceMetadataBackup)
      .where(eq(workspaceMetadataBackup.organizationId, organizationId)),
  ]);
  const remaining = latest?.status === "running"
    ? await db.select({ value: count() }).from(workspaceMetadataBackup).where(and(
        eq(workspaceMetadataBackup.organizationId, organizationId),
        or(
          isNull(workspaceMetadataBackup.dataKeyId),
          ne(workspaceMetadataBackup.dataKeyId, latest.toDataKeyId),
        ),
      ))
    : [{ value: 0 }];
  const fromKey = latest?.fromDataKeyId
    ? await workspaceDataKeyById(organizationId, latest.fromDataKeyId)
    : null;
  const toKey = latest?.toDataKeyId
    ? await workspaceDataKeyById(organizationId, latest.toDataKeyId)
    : null;
  return {
    activeVersion: active?.version ?? null,
    backupCount: Number(backupCount[0]?.value ?? 0),
    rotation: latest && toKey ? {
      id: latest.id,
      status: latest.status === "completed" ? "completed" as const : "running" as const,
      fromVersion: fromKey?.version ?? null,
      toVersion: toKey.version,
      processedBackups: latest.processedBackups,
      remainingBackups: Number(remaining[0]?.value ?? 0),
      createdAt: latest.createdAt.toISOString(),
      completedAt: latest.completedAt?.toISOString() ?? null,
    } : null,
  };
}
