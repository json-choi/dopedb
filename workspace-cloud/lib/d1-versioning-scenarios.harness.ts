import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { commitConnectionCreate, commitConnectionMutation, conflictConnectionCandidate,
  listConnectionConflicts, resolveConnectionConflict, type MutationAuthority } from "./workspace-versioning-store";
import { claimRevocationGate } from "./revocation-gates";
import { parseConnectionVersionPayload } from "./workspace-versioning";
import { restoreWorkspaceSnapshot } from "./workspace-snapshot-restore";
import type { WorkspaceMetadataSnapshot } from "./workspace-backup-core";
import { publicConnection } from "./workspace-connections";
import { accessModeForConnectionGrant } from "./workspace-permissions";

export async function verifyD1ConnectionVersioning(db: D1Database, organizationId: string, authority: MutationAuthority) {
  const connectionId = randomUUID();
  const payload = parseConnectionVersionPayload({ name: "Initial fixture", engine: "postgres", provider: "generic",
    driverId: null, host: "fixture.invalid", port: 5432, database: "fixture", sslmode: "verify-full",
    readonlyDefault: true, allowWrites: false, env: null, schemaGroup: null, deleted: false }, { credentialMode: "member_local" });
  const created = await commitConnectionCreate({ organizationId, connectionId, authority, input: payload });
  expect(created?.contentRevision).toBe(1);
  await verifyTeamConnectionCreation(db, organizationId, authority, payload);
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
  // MongoDB template options persist through create, update and snapshot restore.
  const mongoId = randomUUID();
  const mongo = parseConnectionVersionPayload({ name: "Atlas fixture", engine: "mongodb", provider: "generic",
    driverId: null, host: "cluster0.fixture.invalid", port: 27017, database: "fixture", sslmode: "require",
    readonlyDefault: true, allowWrites: false, env: null, schemaGroup: null,
    mongoOptions: { srv: true, authSource: "admin" }, deleted: false }, { credentialMode: "member_local" });
  const createdMongo = await commitConnectionCreate({ organizationId, connectionId: mongoId, authority, input: mongo });
  expect(createdMongo?.mongoOptions).toEqual({ srv: true, authSource: "admin" });
  const mongoClaim = await claimRevocationGate({ kind: "connection", organizationId, connectionId: mongoId });
  const nextOptions = { srv: true, authSource: "admin", replicaSet: "fixture-shard-0" };
  const updatedMongo = await commitConnectionMutation({ organizationId, connectionId: mongoId, authority,
    expectedContentRevision: 1, expectedAuthorityRevision: mongoClaim!.connectionRevision!, claimId: mongoClaim!.claimId,
    mutation: { kind: "update", ...mongo, databaseName: mongo.database, environment: mongo.env,
      mongoOptions: nextOptions, payload: { ...mongo, mongoOptions: nextOptions } } });
  expect(updatedMongo?.mongoOptions).toEqual(nextOptions);
  const restoredMongoId = randomUUID();
  const { deleted: _mongoDeleted, ...mongoTemplate } = mongo;
  expect(await restoreWorkspaceSnapshot({ ...restore, expectedRevision: 2,
    snapshot: { ...snapshot, connections: [{ ...mongoTemplate, id: restoredMongoId, contentRevision: 1 }] } }))
    .toEqual({ revision: 3, restored: 1, conflictIds: [] });
  expect(JSON.parse(String(await db.prepare("SELECT mongo_options FROM workspace_connection WHERE id = ?")
    .bind(restoredMongoId).first("mongo_options")))).toEqual({ srv: true, authSource: "admin" });
}

/**
 * Team connection creation: an editor or above creates one, a viewer or analyst cannot, and the
 * new connection opens to the team by default (read for analysts and above, view for viewers)
 * while its creator and every administrator or owner hold manage. A member writes with their own
 * credential only when their grant and role allow it.
 */
async function verifyTeamConnectionCreation(
  db: D1Database, organizationId: string, owner: MutationAuthority, template: ReturnType<typeof parseConnectionVersionPayload>,
) {
  const newMember = async (role: string) => {
    const userId = randomUUID(); const membershipId = randomUUID(); const sessionId = randomUUID();
    await db.batch([
      db.prepare("INSERT INTO user (id, name, email) VALUES (?, 'Create fixture', ?)").bind(userId, `${userId}@invalid.test`),
      db.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)").bind(membershipId, organizationId, userId, role),
      db.prepare("INSERT INTO session (id, token, user_id, expires_at) VALUES (?, ?, ?, ?)")
        .bind(sessionId, randomUUID(), userId, new Date(Date.now() + 60_000).toISOString()),
    ]);
    return { sessionId, userId, membershipId, role };
  };
  const [viewer, analyst, editor] = [await newMember("viewer"), await newMember("analyst"), await newMember("editor")];
  const input = { ...template, name: "Editor created" };
  for (const denied of [viewer, analyst]) {
    expect(await commitConnectionCreate({ organizationId, connectionId: randomUUID(), authority: denied, input })).toBeNull();
  }
  // An editor creates it under a caller-chosen id; the id is unique across the database.
  const connectionId = randomUUID();
  const created = await commitConnectionCreate({ organizationId, connectionId, authority: editor, input });
  expect(created?.id).toBe(connectionId);
  await expect(commitConnectionCreate({ organizationId, connectionId, authority: editor, input })).rejects.toThrow();
  expect(await db.prepare("SELECT team_read_enabled FROM workspace_connection WHERE id = ?").bind(connectionId).first("team_read_enabled")).toBe(1);
  const grants = Object.fromEntries((await db.prepare("SELECT member_id, capability, origin FROM workspace_connection_grant WHERE connection_id = ?")
    .bind(connectionId).all<{ member_id: string; capability: string; origin: string }>()).results
    .map((row) => [row.member_id, `${row.capability}/${row.origin}`]));
  expect(grants).toMatchObject({
    [editor.membershipId]: "manage/explicit", [owner.membershipId]: "manage/explicit",
    [analyst.membershipId]: "read/team", [viewer.membershipId]: "view/team",
  });
  // A teammate who joins later is opened to the same default.
  const late = await newMember("analyst");
  expect(await db.prepare("SELECT capability || '/' || origin AS grant FROM workspace_connection_grant WHERE connection_id = ? AND member_id = ?")
    .bind(connectionId, late.membershipId).first("grant")).toBe("read/team");
  // Member-credential writes follow the grant and role, never a template flag.
  const row = { ...created!, credentialMode: "member_local" };
  const view = (role: "analyst" | "editor", capability: "read" | "manage") =>
    publicConnection(row, role, accessModeForConnectionGrant(role, capability));
  expect([view("analyst", "read").memberWrite, view("editor", "manage").memberWrite]).toEqual([false, true]);
  expect(view("editor", "manage").allowWrites).toBe(false);
  expect(await db.prepare("SELECT allow_writes FROM workspace_connection WHERE id = ?").bind(connectionId).first("allow_writes")).toBe(0);
  // Leave the shared fixture as the following scenarios expect it: only the owner remains.
  await db.batch([viewer, analyst, editor, late].map((member) =>
    db.prepare("DELETE FROM member WHERE id = ?").bind(member.membershipId)));
}
