import { randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { eq } from "drizzle-orm";
import * as kmsApi from "./workspace-kms";
import { ensureActiveWorkspaceDataKey, type WorkspaceKmsSession } from "./workspace-data-key";
import { beginOrClaimWorkspaceDataKeyRotation, advanceWorkspaceDataKeyRotation } from "./workspace-data-key-rotation";
import { insertWorkspaceBackup, tombstoneWorkspaceBackup } from "./workspace-backup-store";
import { createWorkspaceD1 } from "./d1/database";
import { workspaceConnection } from "./d1/schema";
import { sealWorkspaceMetadataBackupWithDataKey, openWorkspaceMetadataBackupWithKms } from "./workspace-backup";
import { snapshotHash, type WorkspaceMetadataSnapshot } from "./workspace-backup-core";
import { readBackupEnvelope } from "./d1/backup-chunks";

export async function verifyD1Backups(db: D1Database, userId: string, sessionId: string) {
  const organizationId = randomUUID(); const membershipId = randomUUID();
  await db.batch([
    db.prepare("INSERT INTO organization (id, name, slug) VALUES (?, 'Backup fixture', ?)").bind(organizationId, organizationId),
    db.prepare("INSERT INTO workspace_profile (organization_id, encryption_key_ref) VALUES (?, 'fixture')").bind(organizationId),
    db.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, ?, 'owner')").bind(membershipId, organizationId, userId),
  ]);
  const authority = { userId, sessionId, membershipId, role: "owner" as const };
  const kms: WorkspaceKmsSession = { accessToken: "fixture-token", configuration: {
    keyName: "projects/dopedb-fixture/locations/global/keyRings/workspace/cryptoKeys/backup",
    workloadIdentityAudience: "fixture", serviceAccountEmail: "fixture",
  } };
  const wrap = vi.spyOn(kmsApi, "wrapWorkspaceDataKey").mockImplementation(async (input) => ({
    kmsKeyVersion: `${input.configuration.keyName}/cryptoKeyVersions/1`, wrappedKey: input.plaintextKey.toString("base64"),
  }));
  const unwrap = vi.spyOn(kmsApi, "unwrapWorkspaceDataKey").mockImplementation(async (input) => Buffer.from(input.wrappedKey, "base64"));
  try {
    const keys = await Promise.all(Array.from({ length: 4 }, () => ensureActiveWorkspaceDataKey({ organizationId, actorUserId: userId, kms })));
    expect(new Set(keys.map((key) => key.id)).size).toBe(1);
    const key = keys[0];
    // Maximum connection count plus UTF-8 names exceeds a D1 row. The public
    // snapshot contract must survive without reducing its supported capacity.
    await db.batch(Array.from({ length: 1_000 }, () => db.prepare(`INSERT INTO workspace_connection
      (id, organization_id, name, engine, provider, host, port, database_name, sslmode)
      VALUES (?, ?, 'Backup connection', 'postgres', 'generic', 'db.invalid.test', 5432, ?, 'require')`)
      .bind(randomUUID(), organizationId, "한".repeat(1_000))));
    const { orm } = createWorkspaceD1(db);
    const rows = await orm.select().from(workspaceConnection).where(eq(workspaceConnection.organizationId, organizationId));
    const snapshot: WorkspaceMetadataSnapshot = { version: 1,
      workspace: { organizationId, lifecycleState: "active", residencyRegion: null, revision: 1 },
      connections: rows.map((row) => ({ id: row.id, contentRevision: row.contentRevision, name: row.name,
        engine: "postgres", provider: "generic", driverId: null, host: row.host, port: row.port,
        database: row.databaseName, sslmode: row.sslmode, readonlyDefault: true, allowWrites: false, env: null, schemaGroup: null })),
    };
    const backupId = randomUUID();
    const ciphertext = sealWorkspaceMetadataBackupWithDataKey(Buffer.from(key.wrappedKey!, "base64"), key, backupId, snapshot);
    expect(ciphertext.length).toBeGreaterThan(2_000_000);
    const input = { organizationId, backupId, authority, revision: 1, lifecycleState: "active", residencyRegion: null,
      connections: rows.map((row) => ({ id: row.id, content_revision: row.contentRevision, name: row.name,
        engine: row.engine, provider: row.provider, driver_id: row.driverId, host: row.host, port: row.port,
        database_name: row.databaseName, sslmode: row.sslmode, readonly_default: row.readonlyDefault,
        allow_writes: row.allowWrites, environment: row.environment, schema_group: row.schemaGroup,
        credential_mode: row.credentialMode, provider_integration_id: row.providerIntegrationId, provider_resource: row.providerResource })),
      sealed: { dataKeyId: key.id, keyReference: "dopedb-workspace-data-key", keyVersion: "v1", ciphertext }, snapshotHash: snapshotHash(snapshot),
    };
    expect(await insertWorkspaceBackup({ ...input, revision: 2 })).toBeNull();
    expect((await insertWorkspaceBackup(input))?.id).toBe(backupId);
    const manifest = await db.prepare("SELECT ciphertext FROM workspace_metadata_backup WHERE id = ?").bind(backupId).first<string>("ciphertext");
    expect(manifest).toMatch(/^d1-chunks:v1:/);
    expect(await readBackupEnvelope(organizationId, backupId, manifest!)).toBe(ciphertext);
    await expect(readBackupEnvelope(randomUUID(), backupId, manifest!)).rejects.toThrow();
    await expect(db.prepare("UPDATE workspace_backup_chunk SET ciphertext = 'altered' WHERE backup_id = ?").bind(backupId).run()).rejects.toThrow();
    await expect(db.prepare("DELETE FROM workspace_backup_chunk WHERE backup_id = ?").bind(backupId).run()).rejects.toThrow();
    const idempotencyKey = randomUUID();
    const rotations = await Promise.all(Array.from({ length: 4 }, () => beginOrClaimWorkspaceDataKeyRotation({ organizationId, authority, kms, idempotencyKey })));
    const claims = rotations.flatMap((value) => value.claim ? [value.claim] : []);
    expect(claims).toHaveLength(1);
    await expect(advanceWorkspaceDataKeyRotation({ organizationId, authority, kms, claim: { ...claims[0], claimId: randomUUID() } })).rejects.toThrow();
    expect(await advanceWorkspaceDataKeyRotation({ organizationId, authority, kms, claim: claims[0] }))
      .toEqual({ status: "completed", processedBackups: 1, remaining: 0 });
    expect((await beginOrClaimWorkspaceDataKeyRotation({ organizationId, authority, kms, idempotencyKey })).replayed).toBe(true);
    const rotated = await db.prepare("SELECT ciphertext, data_key_id AS dataKeyId, key_reference AS keyReference, key_version AS keyVersion FROM workspace_metadata_backup WHERE id = ?")
      .bind(backupId).first<{ ciphertext: string; dataKeyId: string; keyReference: string; keyVersion: string }>();
    expect(rotated!.keyVersion).toBe("v2");
    const opened = await openWorkspaceMetadataBackupWithKms(kms, { workspaceId: organizationId, backupId, ciphertext: rotated!.ciphertext, binding: rotated! });
    expect(snapshotHash(opened)).toBe(snapshotHash(snapshot));
    expect(await db.prepare("SELECT wrapped_key FROM workspace_data_key WHERE id = ?").bind(key.id).first("wrapped_key")).toBeNull();
    expect(await db.prepare("SELECT count(*) AS count FROM workspace_backup_chunk WHERE manifest = ?").bind(manifest).first("count")).toBe(0);
    const tombstone = await tombstoneWorkspaceBackup({ organizationId, backupId, authority, retentionDays: 7 });
    expect(tombstone?.purgeAfter).toBeTruthy();
    expect(await tombstoneWorkspaceBackup({ organizationId, backupId, authority, retentionDays: 7 })).toEqual(tombstone);
    expect(await db.prepare("SELECT count(*) AS count FROM workspace_audit_event WHERE resource_id = ? AND action = 'workspace.backup.delete'")
      .bind(backupId).first("count")).toBe(1);
    await db.prepare("DELETE FROM workspace_metadata_backup WHERE id = ?").bind(backupId).run();
    expect(await db.prepare("SELECT count(*) AS count FROM workspace_backup_chunk WHERE backup_id = ?").bind(backupId).first("count")).toBe(0);
  } finally { wrap.mockRestore(); unwrap.mockRestore(); }
}
