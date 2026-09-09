import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { scheduleWorkspaceDeletion, cancelWorkspaceDeletion, workspaceLifecycleStatus, cleanupWorkspaceRetention } from "./workspace-lifecycle";
import { purgeDueWorkspace } from "./workspace-retention-purge";
import { commitConnectionCreate } from "./workspace-versioning-store";
import { parseConnectionVersionPayload } from "./workspace-versioning";

export async function verifyD1Retention(db: D1Database, userId: string, sessionId: string) {
  const organizationId = randomUUID(); const membershipId = randomUUID();
  await db.batch([
    db.prepare("INSERT INTO organization (id, name, slug) VALUES (?, 'Retention fixture', ?)").bind(organizationId, organizationId),
    db.prepare("INSERT INTO workspace_profile (organization_id, encryption_key_ref) VALUES (?, 'fixture')").bind(organizationId),
    db.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, ?, 'owner')").bind(membershipId, organizationId, userId),
  ]);
  const authority = { sessionId, userId, membershipId, role: "owner" as const, capability: "manage" as const };
  const connectionId = randomUUID();
  expect(await commitConnectionCreate({ organizationId, connectionId, authority,
    input: parseConnectionVersionPayload({ name: "Retained", engine: "postgres", provider: "generic", driverId: null,
      host: "db.invalid.test", port: 5432, database: "fixture", sslmode: "require", readonlyDefault: true,
      allowWrites: false, env: null, schemaGroup: null, deleted: false }, { credentialMode: "member_local" }) })).not.toBeNull();
  await expect(db.prepare("DELETE FROM organization WHERE id = ?").bind(organizationId).run()).rejects.toThrow();
  expect((await workspaceLifecycleStatus(organizationId))?.canScheduleDeletion).toBe(true);
  const requestId = randomUUID();
  expect(await scheduleWorkspaceDeletion({ organizationId, authority, requestId, confirmation: "Wrong" })).toBeNull();
  expect(await scheduleWorkspaceDeletion({ organizationId, authority, requestId, confirmation: "Retention fixture" })).toBe("scheduled");
  expect(await scheduleWorkspaceDeletion({ organizationId, authority, requestId, confirmation: "Retention fixture" })).toBe("replayed");
  expect(await purgeDueWorkspace(organizationId, requestId)).toBe(false);
  expect(await cancelWorkspaceDeletion({ organizationId, authority, requestId })).toBe("cancelled");
  expect(await cancelWorkspaceDeletion({ organizationId, authority, requestId })).toBe("replayed");
  const dueRequest = randomUUID();
  expect(await scheduleWorkspaceDeletion({ organizationId, authority, requestId: dueRequest, confirmation: "Retention fixture" })).toBe("scheduled");
  const requestedAt = new Date(Date.now() - 8 * 86_400_000).toISOString();
  const purgeAfter = new Date(Date.now() - 86_400_000).toISOString();
  await db.batch([
    db.prepare("UPDATE workspace_profile SET deletion_requested_at = ?, purge_after = ? WHERE organization_id = ?").bind(requestedAt, purgeAfter, organizationId),
    db.prepare("UPDATE workspace_deletion_receipt SET requested_at = ?, purge_after = ? WHERE id = ?").bind(requestedAt, purgeAfter, dueRequest),
    db.prepare("UPDATE member SET revocation_pending_at = ?, revocation_claim_id = ?, revocation_claimed_at = ? WHERE id = ?")
      .bind(requestedAt, randomUUID(), new Date().toISOString(), membershipId),
  ]);
  expect(await purgeDueWorkspace(organizationId, dueRequest)).toBe(false);
  await db.prepare("UPDATE member SET revocation_claim_id = NULL, revocation_claimed_at = NULL WHERE id = ?").bind(membershipId).run();
  // A failure late in the purge restores evidence and the pending receipt.
  await db.exec(`CREATE TRIGGER fixture_retention_failure BEFORE DELETE ON organization WHEN OLD.id = '${organizationId}' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END;`);
  await expect(purgeDueWorkspace(organizationId, dueRequest)).rejects.toThrow();
  expect(await db.prepare("SELECT status FROM workspace_deletion_receipt WHERE id = ?").bind(dueRequest).first("status")).toBe("pending");
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_resource_version WHERE organization_id = ?").bind(organizationId).first("count")).toBe(1);
  await db.exec("DROP TRIGGER fixture_retention_failure;");
  const cleanup = await Promise.all([cleanupWorkspaceRetention(), cleanupWorkspaceRetention()]);
  expect(cleanup.reduce((sum, item) => sum + item.workspacesPurged, 0)).toBe(1);
  expect(await db.prepare("SELECT status FROM workspace_deletion_receipt WHERE id = ?").bind(dueRequest).first("status")).toBe("purged");
  expect(await db.prepare("SELECT count(*) AS count FROM organization WHERE id = ?").bind(organizationId).first("count")).toBe(0);
  await expect(db.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, ?, 'owner')")
    .bind(randomUUID(), organizationId, userId).run()).rejects.toThrow();
}
