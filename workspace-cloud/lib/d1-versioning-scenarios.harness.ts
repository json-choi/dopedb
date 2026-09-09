import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { commitConnectionCreate, commitConnectionMutation, conflictConnectionCandidate,
  listConnectionConflicts, resolveConnectionConflict, type MutationAuthority } from "./workspace-versioning-store";
import { claimRevocationGate } from "./revocation-gates";
import { parseConnectionVersionPayload } from "./workspace-versioning";
import { restoreWorkspaceSnapshot } from "./workspace-snapshot-restore";
import type { WorkspaceMetadataSnapshot } from "./workspace-backup-core";

export async function verifyD1ConnectionVersioning(db: D1Database, organizationId: string, authority: MutationAuthority) {
  const connectionId = randomUUID();
  const payload = parseConnectionVersionPayload({ name: "Initial fixture", engine: "postgres", provider: "generic",
    driverId: null, host: "fixture.invalid", port: 5432, database: "fixture", sslmode: "verify-full",
    readonlyDefault: true, allowWrites: false, env: null, schemaGroup: null, deleted: false }, { credentialMode: "member_local" });
  const created = await commitConnectionCreate({ organizationId, connectionId, authority, input: payload });
  expect(created?.contentRevision).toBe(1);
  const update = async (name: string, expectedContentRevision: number) => {
    const claim = await claimRevocationGate({ kind: "connection", organizationId, connectionId });
    expect(claim).not.toBeNull();
    return commitConnectionMutation({ organizationId, connectionId, authority, expectedContentRevision,
      expectedAuthorityRevision: claim!.connectionRevision!, claimId: claim!.claimId,
      mutation: { kind: "update", ...payload, name, databaseName: payload.database,
        environment: payload.env, schemaGroup: payload.schemaGroup, payload: { ...payload, name } } });
  };
  expect((await update("Server fixture", 1))?.contentRevision).toBe(2);
  const conflictId = await conflictConnectionCandidate({ organizationId, connectionId, authority,
    expectedRevision: 1, payload: { ...payload, name: "Candidate fixture" } });
  const [review] = await listConnectionConflicts({ organizationId, membershipId: authority.membershipId });
  expect(review.id).toBe(conflictId);
  expect(review.server.revision).toBe(2);
  expect(review.candidate.payload.name).toBe("Candidate fixture");
  expect(review.currentMatchesServer).toBe(true);
  expect(await resolveConnectionConflict({ organizationId, conflictId, authority, resolution: "candidate" })).toBeNull();
  expect((await update("Candidate fixture", 2))?.contentRevision).toBe(3);
  const resolved = await Promise.all(Array.from({ length: 4 }, () => resolveConnectionConflict({
    organizationId, conflictId, authority, resolution: "candidate",
  })));
  expect(resolved.filter((value) => value?.created)).toHaveLength(1);
  expect(resolved.every((value) => value?.resolution === "candidate")).toBe(true);
  expect(await resolveConnectionConflict({ organizationId, conflictId, authority, resolution: "server" }))
    .toEqual({ resolution: "candidate", created: false });
  expect(await listConnectionConflicts({ organizationId, membershipId: authority.membershipId })).toEqual([]);
  await expect(db.prepare("UPDATE workspace_resource_version SET payload_hash = ? WHERE resource_id = ?")
    .bind("0".repeat(64), connectionId).run()).rejects.toThrow();
  const deletedClaim = await claimRevocationGate({ kind: "connection", organizationId, connectionId });
  const deleted = await commitConnectionMutation({ organizationId, connectionId, authority, expectedContentRevision: 3,
    expectedAuthorityRevision: deletedClaim!.connectionRevision!, claimId: deletedClaim!.claimId,
    mutation: { kind: "delete", payload: { ...payload, name: "Candidate fixture", deleted: true } } });
  expect(deleted?.contentRevision).toBe(4);
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_resource_version WHERE resource_id = ? AND branch = 'main'")
    .bind(connectionId).first("count")).toBe(4);
  const backupId = randomUUID();
  await db.prepare("INSERT INTO workspace_metadata_backup (id, organization_id, source_revision, key_reference, key_version, ciphertext, snapshot_hash) VALUES (?, ?, 1, 'dopedb-workspace-backup-hkdf-sha256', 'v1', 'fixture', ?)")
    .bind(backupId, organizationId, "1".repeat(64)).run();
  const { deleted: _deleted, ...template } = payload;
  const snapshot: WorkspaceMetadataSnapshot = { version: 1,
    workspace: { organizationId, lifecycleState: "active", residencyRegion: null, revision: 1 },
    connections: [connectionId, ...Array.from({ length: 65 }, () => randomUUID())]
      .map((id) => ({ ...template, id, contentRevision: 1 })),
  };
  const restore = { organizationId, backupId, expectedRevision: 1, sourceRevision: 1,
    authority: { ...authority, role: "owner" as const }, snapshot };
  const restored = await restoreWorkspaceSnapshot(restore);
  expect(restored).toEqual({ revision: 2, restored: 65, conflictIds: [expect.any(String)] });
  expect(await restoreWorkspaceSnapshot(restore)).toBeNull();
  const [restoredConflict] = await listConnectionConflicts({ organizationId, membershipId: authority.membershipId });
  expect(restoredConflict.candidate.payload).toEqual(payload);
  const rollbackId = randomUUID();
  await db.exec("CREATE TRIGGER fixture_restore_failure BEFORE INSERT ON workspace_resource_version BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  try {
    await expect(restoreWorkspaceSnapshot({ ...restore, expectedRevision: 2,
      snapshot: { ...snapshot, connections: [{ ...template, id: rollbackId, contentRevision: 1 }] } })).rejects.toThrow();
    expect(await db.prepare("SELECT revision FROM workspace_profile WHERE organization_id = ?").bind(organizationId).first("revision"))
      .toBe(2);
    expect(await db.prepare("SELECT count(*) AS count FROM workspace_connection WHERE id = ?").bind(rollbackId).first("count"))
      .toBe(0);
  } finally {
    await db.exec("DROP TRIGGER fixture_restore_failure");
  }
}
