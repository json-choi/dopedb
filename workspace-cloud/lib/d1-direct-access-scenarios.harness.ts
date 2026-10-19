// Direct shared database storage: database-owned triggers, the derived work list,
// compare-and-swap receipts, revocation items and team-read materialization.
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { MemberAuthority } from "./d1/member-authority";
import { claimRevocationGate, clearRevocationGate } from "./revocation-gates";
import { publicConnection } from "./workspace-connections";
import {
  claimDirectWork,
  createDirectRevocations,
  directLoweringTargets,
  directRoleLowering,
  findDirectLoweringBlockers,
  listDirectWorkItems,
  listPendingDirectRevocations,
  settleDirectReceipt,
  settleDirectRevocation,
  submitDirectVerifier,
  type DirectReceipt,
} from "./workspace-direct-access-store";
import { removeConnectionGrant } from "./workspace-grant-store";
import { listWorkspaceMemberGrants } from "./workspace-member-grants";
import { accessModeForConnectionGrant } from "./workspace-permissions";
import { setWorkspaceTeamRead } from "./workspace-team-read-store";

const PG_VERIFIER = "SCRAM-SHA-256$4096:Y0ea1poJCyWCd+yPum+ZQQ==$h7BOWJYfmpnYU9QEagtbeT58Pku9IfWsqPsXwgzbHYs=:s+rNM0M7MbUlI1EDLJs+ei56p3ONXezfDdbGJoCFPAY=";
const MYSQL_VERIFIER = "$A$005$abcdefghijklmnopqrstC/R0iWNjUF5epeXWrOjr.xOnYKQJsftGfUKPxxb58oQ";

export async function verifyD1DirectAccess(
  db: D1Database,
  authority: MemberAuthority & { organizationId: string },
) {
  const { organizationId } = authority;
  const run = (query: string, ...values: unknown[]) => db.prepare(query).bind(...values).run();
  const rejects = async (query: string, ...values: unknown[]) => {
    await expect(run(query, ...values)).rejects.toThrow();
  };
  const connectionId = randomUUID();
  const insertConnection = (id: string, credentialMode: string, provisioning: string, engine = "postgres") => run(
    `INSERT INTO workspace_connection (id, organization_id, name, engine, provider, host, port, database_name, sslmode,
      credential_mode, provisioning_mode) VALUES (?, ?, 'Direct', ?, 'generic', 'db.example.test', 5432, 'orders', 'verify-full', ?, ?)`,
    id, organizationId, engine, credentialMode, provisioning);

  // A provisioned row must stay member-local; the mode never changes after insert.
  await expect(insertConnection(randomUUID(), "managed", "provisioned")).rejects.toThrow();
  await expect(insertConnection(randomUUID(), "member_local", "other")).rejects.toThrow();
  await insertConnection(connectionId, "member_local", "provisioned");
  await rejects("UPDATE workspace_connection SET provisioning_mode = 'none' WHERE id = ?", connectionId);
  await rejects("UPDATE workspace_connection SET credential_mode = 'managed' WHERE id = ?", connectionId);
  const plainId = randomUUID();
  await insertConnection(plainId, "member_local", "none");
  await rejects("UPDATE workspace_connection SET provisioning_mode = 'provisioned' WHERE id = ?", plainId);

  const endpoint = (id: string, engine: string, scope: unknown) => run(
    `INSERT INTO workspace_direct_endpoint (organization_id, connection_id, engine, scope, write_ceiling) VALUES (?, ?, ?, ?, 1)`,
    organizationId, id, engine, JSON.stringify(scope));
  await rejects("INSERT INTO workspace_direct_endpoint (organization_id, connection_id, engine, scope) VALUES (?, ?, 'postgres', '[\"public\"]')", organizationId, plainId);
  await expect(endpoint(connectionId, "mysql", ["app"])).rejects.toThrow();
  for (const scope of [[], ["a", "a"], [""], ["bad\nname"], [1], "public", ["x".repeat(129)], Array.from({ length: 65 }, (_, i) => `s${i}`)]) {
    await expect(endpoint(connectionId, "postgres", scope), JSON.stringify(scope).slice(0, 40)).rejects.toThrow();
  }

  const newMember = async (role: string, pending = false) => {
    const memberUser = randomUUID();
    const memberId = randomUUID();
    await db.batch([
      db.prepare("INSERT INTO user (id, name, email) VALUES (?, 'Direct fixture', ?)").bind(memberUser, `${memberUser}@invalid.test`),
      db.prepare("INSERT INTO member (id, organization_id, user_id, role, revocation_pending_at) VALUES (?, ?, ?, ?, ?)")
        .bind(memberId, organizationId, memberUser, role, pending ? new Date().toISOString() : null),
    ]);
    return { memberId, userId: memberUser };
  };
  const analyst = await newMember("analyst");
  // No receipt may exist before the endpoint does.
  await rejects(`INSERT INTO workspace_direct_principal (organization_id, connection_id, member_id, user_id, principal_name, marker, verifier_kind, verifier)
    VALUES (?, ?, ?, ?, 'dopedb_0123456789abcdef0123', ?, 'scram-sha-256', ?)`, organizationId, connectionId, analyst.memberId, analyst.userId, "A".repeat(43), PG_VERIFIER);
  await endpoint(connectionId, "postgres", ["public", "analytics"]);
  await rejects("UPDATE workspace_direct_endpoint SET engine = 'mysql' WHERE connection_id = ?", connectionId);
  await rejects("UPDATE workspace_direct_endpoint SET scope = '[\"public\"]' WHERE connection_id = ?", connectionId);
  await run("UPDATE workspace_direct_endpoint SET scope = '[\"public\"]', scope_revision = 2 WHERE connection_id = ?", connectionId);
  await run("UPDATE workspace_direct_endpoint SET scope = '[\"public\",\"analytics\"]', scope_revision = 3 WHERE connection_id = ?", connectionId);

  // Receipts: wrong verifier kind or malformed verifier never reaches storage.
  expect(await submitDirectVerifier({ organizationId, connectionId, ...analyst, verifierKind: "scram-sha-256", verifier: PG_VERIFIER.slice(0, -2) })).toBeNull();
  await expect(submitDirectVerifier({ organizationId, connectionId, ...analyst, verifierKind: "caching_sha2", verifier: MYSQL_VERIFIER })).rejects.toThrow();
  const editor = await newMember("editor");
  const viewer = await newMember("viewer");
  const pending = await newMember("owner", true);
  const orphan = await newMember("analyst");
  // The acting administrator manages this connection (needed to declare revocations).
  await run("INSERT INTO workspace_connection_grant (organization_id, connection_id, member_id, capability) VALUES (?, ?, ?, 'manage')",
    organizationId, connectionId, authority.membershipId);
  const grants: [typeof analyst, string, string][] = [
    [analyst, "read", "team"], [editor, "use", "explicit"], [viewer, "view", "team"], [pending, "manage", "explicit"],
  ];
  for (const [member, capability, origin] of grants) {
    await run("INSERT INTO workspace_connection_grant (organization_id, connection_id, member_id, capability, origin) VALUES (?, ?, ?, ?, ?)",
      organizationId, connectionId, member.memberId, capability, origin);
  }
  const principals = new Map<string, string>();
  for (const member of [analyst, editor, viewer, pending, orphan]) {
    const submitted = await submitDirectVerifier({ organizationId, connectionId, ...member, verifierKind: "scram-sha-256", verifier: PG_VERIFIER });
    expect(submitted).not.toBeNull();
    principals.set(member.memberId, submitted!.principalId);
  }
  const row = async (memberId: string) => db.prepare("SELECT * FROM workspace_direct_principal WHERE id = ?").bind(principals.get(memberId)).first<Record<string, unknown>>();
  const created = (await row(analyst.memberId))!;
  expect(created).toMatchObject({ state: "requested", applied_level: "none", verifier_version: 1 });
  expect(created.principal_name).toMatch(/^dopedb_[0-9a-f]{20}$/u);
  expect(created.marker).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  // Live per member: a second request revises the verifier instead of adding a role.
  expect(await submitDirectVerifier({ organizationId, connectionId, ...analyst, verifierKind: "scram-sha-256", verifier: PG_VERIFIER })).toEqual({ principalId: principals.get(analyst.memberId) });
  expect((await row(analyst.memberId))!.verifier_version).toBe(2);
  await rejects("UPDATE workspace_direct_principal SET principal_name = 'dopedb_ffffffffffffffffffff' WHERE id = ?", principals.get(analyst.memberId));
  await rejects("UPDATE workspace_direct_principal SET marker = ? WHERE id = ?", "B".repeat(43), principals.get(analyst.memberId));
  await rejects("UPDATE workspace_direct_principal SET state = 'ready' WHERE id = ?", principals.get(analyst.memberId));
  await rejects("UPDATE workspace_direct_principal SET state = 'failed' WHERE id = ?", principals.get(analyst.memberId));
  await rejects("DELETE FROM workspace_direct_principal WHERE id = ?", principals.get(analyst.memberId));

  // Desired level is derived from role x grant x ceiling; absent for gone/pending/ungranted members.
  const items = new Map((await listDirectWorkItems({ organizationId, connectionId })).map((item) => [item.memberId, item]));
  expect(items.get(analyst.memberId)).toMatchObject({ desiredLevel: "read", action: "apply" });
  expect(items.get(editor.memberId)).toMatchObject({ desiredLevel: "write", action: "apply" });
  expect(items.get(viewer.memberId)).toMatchObject({ desiredLevel: "none", action: "drop" });
  expect(items.get(pending.memberId)).toMatchObject({ desiredLevel: "none", action: "drop" });
  expect(items.get(orphan.memberId)).toMatchObject({ desiredLevel: "none", action: "drop" });
  await run("UPDATE workspace_direct_endpoint SET write_ceiling = 0 WHERE connection_id = ?", connectionId);
  expect((await listDirectWorkItems({ organizationId, connectionId })).find((item) => item.memberId === editor.memberId)?.desiredLevel).toBe("read");
  await run("UPDATE workspace_direct_endpoint SET write_ceiling = 1 WHERE connection_id = ?", connectionId);

  // Claim lease and compare-and-swap settlement; the direction is derived, never supplied.
  const principalId = principals.get(editor.memberId)!;
  const claim = async (deviceId: string, id = principalId) =>
    (await claimDirectWork({ organizationId, connectionId, deviceId, actorUserId: authority.userId, principalIds: [id] })).length === 1;
  expect(await claim("device-a")).toBe(true);
  expect(await claim("device-b")).toBe(false);
  expect(await claim("device-a")).toBe(true);
  expect((await listDirectWorkItems({ organizationId, connectionId })).find((item) => item.principalId === principalId)?.action).toBe("idle");
  const receipt: DirectReceipt = {
    principalId, deviceId: "device-b", from: "applying", to: "ready", appliedLevel: "write",
    appliedVerifierVersion: 1, scopeRevisionApplied: 3, serverRoleOid: "16421", serverFingerprint: "16384", failureCode: null,
  };
  const settle = (input: Partial<DirectReceipt>, id = principalId) =>
    settleDirectReceipt({ organizationId, connectionId, actorUserId: authority.userId, receipt: { ...receipt, principalId: id, ...input } });
  expect(await settle({})).toBe(false);
  expect(await settle({ deviceId: "device-a", appliedVerifierVersion: 9 })).toBe(false);
  expect(await settle({ deviceId: "device-a", to: "failed", failureCode: null })).toBe(false);
  expect(await settle({ deviceId: "device-a", serverFingerprint: null })).toBe(false);
  expect(await settle({ deviceId: "device-a" })).toBe(true);
  expect(await settle({ deviceId: "device-a" })).toBe(false);
  expect(await db.prepare("SELECT server_fingerprint FROM workspace_direct_endpoint WHERE connection_id = ?").bind(connectionId).first("server_fingerprint")).toBe("16384");
  expect(await row(editor.memberId)).toMatchObject({ state: "ready", applied_level: "write", server_role_oid: "16421", claim_expires_at: null });
  expect((await listDirectWorkItems({ organizationId, connectionId })).find((item) => item.principalId === principalId)).toMatchObject({ action: "idle", appliedLevel: "write" });
  // A different server fingerprint (restored or repointed database) is refused for every principal.
  const analystPrincipal = principals.get(analyst.memberId)!;
  expect(await claim("device-a", analystPrincipal)).toBe(true);
  expect(await settle({ deviceId: "device-a", appliedLevel: "read", serverFingerprint: "99999", serverRoleOid: "1", appliedVerifierVersion: 2 }, analystPrincipal)).toBe(false);
  expect(await settle({ deviceId: "device-a", to: "failed", failureCode: "oid_mismatch", appliedLevel: "none", serverRoleOid: null, serverFingerprint: null, appliedVerifierVersion: 0 }, analystPrincipal)).toBe(true);
  expect(await row(analyst.memberId)).toMatchObject({ state: "failed", failure_code: "oid_mismatch" });
  expect((await listDirectWorkItems({ organizationId, connectionId })).find((item) => item.principalId === analystPrincipal)?.action).toBe("idle");
  // Re-requesting a failed receipt makes it eligible again.
  await submitDirectVerifier({ organizationId, connectionId, ...analyst, verifierKind: "scram-sha-256", verifier: PG_VERIFIER });
  expect(await row(analyst.memberId)).toMatchObject({ state: "requested", failure_code: null });
  // Drop path: a demoted member is dropped, then the receipt is terminal.
  const viewerPrincipal = principals.get(viewer.memberId)!;
  expect(await claim("device-a", viewerPrincipal)).toBe(true);
  expect(await row(viewer.memberId)).toMatchObject({ state: "drop_pending" });
  expect(await settle({ deviceId: "device-a", from: "drop_pending", to: "ready" }, viewerPrincipal)).toBe(false);
  expect(await settle({ deviceId: "device-a", from: "drop_pending", to: "dropped", appliedLevel: "write", serverRoleOid: null }, viewerPrincipal)).toBe(false);
  expect(await settle({ deviceId: "device-a", from: "drop_pending", to: "dropped", appliedLevel: "none", serverRoleOid: null, serverFingerprint: null, appliedVerifierVersion: 0, scopeRevisionApplied: null }, viewerPrincipal)).toBe(true);
  await rejects("UPDATE workspace_direct_principal SET state = 'requested' WHERE id = ?", viewerPrincipal);
  await run("DELETE FROM workspace_direct_principal WHERE id = ?", viewerPrincipal);

  // Revocation items: deduplicated while pending, cap the derived level, settle exactly once.
  const declare = (memberIds: string[], kind: "grant_lowered" | "member_removed", targetLevel: "none" | "read") =>
    createDirectRevocations({ organizationId, connectionId, authority, memberIds, kind, targetLevel });
  await expect(createDirectRevocations({ organizationId, connectionId: plainId, authority, memberIds: [editor.memberId],
    kind: "grant_lowered", targetLevel: "read" })).resolves.toBeNull();
  const lowered = (await declare([editor.memberId, orphan.memberId], "grant_lowered", "read"))!;
  expect(lowered).toHaveLength(2);
  expect(await declare([editor.memberId, viewer.memberId], "grant_lowered", "read")).toEqual(
    lowered.filter((item) => item.memberId === editor.memberId));
  const editorItem = lowered.find((item) => item.memberId === editor.memberId)!;
  const workOf = async (member: { memberId: string }) =>
    (await listDirectWorkItems({ organizationId, connectionId })).find((item) => item.memberId === member.memberId)!;
  await rejects("DELETE FROM workspace_direct_revocation WHERE id = ?", editorItem.id);
  // A pending item caps desired access and cannot be undone by a re-grant before it is settled.
  expect(await workOf(editor)).toMatchObject({ desiredLevel: "read", appliedLevel: "write", action: "apply" });
  const removal = (await declare([editor.memberId], "member_removed", "none"))![0];
  expect(await workOf(editor)).toMatchObject({ desiredLevel: "none", action: "drop" });
  expect(await settleDirectRevocation({ organizationId, connectionId, revocationId: removal.id, actorUserId: authority.userId, to: "cancelled" })).toBe(true);
  expect(await workOf(editor)).toMatchObject({ desiredLevel: "read" });
  // The guard refuses lowering while the principal still holds the higher level.
  const editorTarget = (level: "none" | "read") => directLoweringTargets.grant(connectionId, editor.memberId, level);
  expect((await findDirectLoweringBlockers(organizationId, editorTarget("none"))).map((item) => item.memberId)).toEqual([editor.memberId]);
  expect(await findDirectLoweringBlockers(organizationId, editorTarget("read"))).toHaveLength(1);
  expect(await findDirectLoweringBlockers(organizationId, directLoweringTargets.connection(organizationId, connectionId))).not.toHaveLength(0);
  expect(await settleDirectRevocation({ organizationId, connectionId, revocationId: editorItem.id, actorUserId: authority.userId, to: "applied" })).toBe(false);
  // The same guard sits inside the atomic mutations: removing the grant is refused.
  const gate = await claimRevocationGate({ kind: "member", organizationId, memberId: editor.memberId, userId: editor.userId });
  const removeGrant = () => removeConnectionGrant({ organizationId, connectionId, authority, memberId: editor.memberId,
    userId: editor.userId, claimId: gate!.claimId });
  expect(await removeGrant()).toEqual([]);
  await clearRevocationGate(gate!);
  // A role change that lowers the level is detected per connection (editor -> analyst loses write).
  expect(await directRoleLowering({ organizationId, memberId: editor.memberId, previousRole: "editor", role: "analyst" }))
    .toEqual([{ connectionId, level: "read" }]);
  expect(await directRoleLowering({ organizationId, memberId: editor.memberId, previousRole: "editor", role: "admin" })).toEqual([]);
  // After the device lowers the principal (receipt), lowering to read passes and the item settles.
  expect(await claim("device-a")).toBe(true);
  expect(await settle({ deviceId: "device-a", appliedLevel: "read", appliedVerifierVersion: 1 })).toBe(true);
  expect(await findDirectLoweringBlockers(organizationId, editorTarget("read"))).toEqual([]);
  expect(await findDirectLoweringBlockers(organizationId, editorTarget("none"))).toHaveLength(1);
  expect(await settleDirectRevocation({ organizationId, connectionId, revocationId: editorItem.id, actorUserId: authority.userId, to: "applied" })).toBe(true);
  expect(await settleDirectRevocation({ organizationId, connectionId, revocationId: editorItem.id, actorUserId: authority.userId, to: "cancelled" })).toBe(false);
  expect(await workOf(editor)).toMatchObject({ desiredLevel: "write", appliedLevel: "read", action: "apply" });
  // A never-applied principal never blocks, and its item settles at once.
  expect(await findDirectLoweringBlockers(organizationId, directLoweringTargets.grant(connectionId, orphan.memberId))).toEqual([]);
  expect(await settleDirectRevocation({ organizationId, connectionId: plainId, revocationId: lowered.find((item) => item.memberId === orphan.memberId)!.id,
    actorUserId: authority.userId, to: "applied" })).toBe(false);
  expect(await settleDirectRevocation({ organizationId, connectionId, revocationId: lowered.find((item) => item.memberId === orphan.memberId)!.id,
    actorUserId: authority.userId, to: "applied" })).toBe(true);
  expect(await listPendingDirectRevocations({ organizationId, connectionId })).toEqual([]);
  await rejects("UPDATE workspace_direct_revocation SET kind = 'member_removed' WHERE id = ?", editorItem.id);
  await rejects("UPDATE workspace_direct_revocation SET state = 'pending' WHERE id = ?", editorItem.id);

  // Self-leave and account deletion record their own items in the same transaction.
  await run("DELETE FROM member WHERE id = ?", orphan.memberId);
  await run("DELETE FROM user WHERE id = ?", pending.userId);
  expect((await listPendingDirectRevocations({ organizationId, connectionId })).map((item) => [item.memberId, item.kind, item.targetLevel]).sort())
    .toEqual([[orphan.memberId, "self_leave", "none"], [pending.memberId, "account_deleted", "none"]].sort());
  expect(await workOf(orphan)).toMatchObject({ desiredLevel: "none", action: "drop" });

  // The aggregate reports the same effective mode publicConnection derives, per member.
  const aggregate = await listWorkspaceMemberGrants(organizationId);
  const record = (await db.prepare(`SELECT id, name, engine, provider, driver_id AS driverId, host, port, database_name AS databaseName,
      sslmode, readonly_default AS readonlyDefault, allow_writes AS allowWrites, environment, schema_group AS schemaGroup,
      credential_mode AS credentialMode, content_revision AS contentRevision, updated_at AS updatedAt
    FROM workspace_connection WHERE id = ?`).bind(connectionId).first<Record<string, unknown>>())!;
  const shared = { ...record, readonlyDefault: true, allowWrites: false, updatedAt: new Date(String(record.updatedAt)) } as Parameters<typeof publicConnection>[0];
  for (const [member, role, expected] of [[analyst, "analyst", "read"], [editor, "editor", "write"], [viewer, "viewer", "view"]] as const) {
    const entry = aggregate.members.find((item) => item.memberId === member.memberId)?.grants.find((grant) => grant.connectionId === connectionId)!;
    expect(entry.effectiveAccessMode).toBe(expected);
    const direct = { writeCeiling: true, principal: null };
    const connection = publicConnection(shared, role, accessModeForConnectionGrant(role, entry.capability), false, false, direct);
    expect(connection.accessMode).toBe(entry.effectiveAccessMode);
    expect(connection.allowWrites).toBe(expected === "write");
    expect(entry.provisioning).toMatchObject({ state: expect.any(String) });
  }
  expect(aggregate.members.find((item) => item.memberId === analyst.memberId)!.grants.find((grant) => grant.connectionId === connectionId))
    .toMatchObject({ origin: "team", capability: "read", provisioning: { state: "requested", level: "none" } });
  expect(aggregate.members.find((item) => item.memberId === editor.memberId)!.grants.find((grant) => grant.connectionId === connectionId))
    .toMatchObject({ origin: "explicit", effectiveAccessMode: "write", provisioning: { state: "ready", level: "read" } });
  expect(aggregate.members.find((item) => item.memberId === pending.memberId)).toBeUndefined();

  // Team read now materializes ordinary read grants on a provisioned database.
  const late = await newMember("analyst");
  expect(await setWorkspaceTeamRead({ organizationId, connectionId, authority, enabled: true })).toBe(true);
  expect(await db.prepare("SELECT capability, origin FROM workspace_connection_grant WHERE connection_id = ? AND member_id = ?")
    .bind(connectionId, late.memberId).first()).toEqual({ capability: "read", origin: "team" });
  const joiner = await newMember("viewer");
  expect(await db.prepare("SELECT capability, origin FROM workspace_connection_grant WHERE connection_id = ? AND member_id = ?")
    .bind(connectionId, joiner.memberId).first()).toEqual({ capability: "view", origin: "team" });

  // Deleting the shared record cascades its receipts; a live receipt alone cannot be deleted.
  await run("DELETE FROM workspace_connection WHERE id = ?", connectionId);
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_direct_principal WHERE connection_id = ?").bind(connectionId).first("count")).toBe(0);
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_direct_endpoint WHERE connection_id = ?").bind(connectionId).first("count")).toBe(0);
}
