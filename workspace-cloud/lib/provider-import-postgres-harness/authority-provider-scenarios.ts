import { randomUUID } from "node:crypto";

import { expect } from "vitest";

import type { ProviderImportPostgresHarness } from "./fixture";

export async function runAuthorityProviderScenarios(
  fixture: ProviderImportPostgresHarness,
) {
  const {
    authState,
    authority,
    importProviderReceipt,
    insertReceipt,
    integrationId,
    knowledgeAuthority,
    memberId,
    organizationId,
    projectStore,
    receiptId,
    removableMemberId,
    resourceId,
    revocationGateLockKey,
    sessionId,
    sql,
    suffix,
    userId,
  } = fixture;

  // Authorization and browser cookies are mutually exclusive authority
  // sources. A syntactically valid but unverifiable Bearer value must not
  // fall through to an otherwise valid browser session, including on the
  // route that issues the clear runner capability.
  const sessionToken = `harness-token-${suffix}`;
  authState.bearer = `Bearer ${sessionToken}`;
  authState.cookie = `better-auth.session_token=harness-cookie-${suffix}`;
  authState.fixture = {
    session: { id: sessionId, token: sessionToken, userId },
    user: { id: userId },
  };
  const { authoritativeSession, authoritativeSessionHeaders } = await import(
    "../authoritative-session"
  );
  const cookieOnlyRequest = new Request("https://dopedb.invalid", {
    headers: { cookie: authState.cookie },
  });
  expect(await authoritativeSession(cookieOnlyRequest)).toMatchObject({
    user: { id: userId },
  });
  const invalidBearerWithCookie = new Request("https://dopedb.invalid", {
    headers: {
      authorization: "Bearer invalid-native-session",
      cookie: authState.cookie,
    },
  });
  const isolatedHeaders = authoritativeSessionHeaders(invalidBearerWithCookie);
  expect(isolatedHeaders.get("authorization")).toBe("Bearer invalid-native-session");
  expect(isolatedHeaders.get("cookie")).toBeNull();
  await expect(authoritativeSession(invalidBearerWithCookie)).resolves.toBeNull();
  await expect(authoritativeSession(new Request("https://dopedb.invalid", {
    headers: { authorization: authState.bearer, cookie: "ambient=ignored" },
  }))).resolves.toMatchObject({ user: { id: userId } });

  const previousAuthOrigin = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = "https://dopedb.invalid";
  try {
    const rejectedWorkspaceId = randomUUID();
    const [runnerRoute, leaseRoute] = await Promise.all([
      import("../../app/api/v1/workspaces/[workspaceId]/analyses/runners/route"),
      import("../../app/api/v1/workspaces/[workspaceId]/analyses/leases/route"),
    ]);
    const rejectedRegistration = await runnerRoute.POST(new Request(
      `https://dopedb.invalid/api/v1/workspaces/${rejectedWorkspaceId}/analyses/runners`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer invalid-native-session",
          cookie: authState.cookie,
          "content-type": "application/json",
          "x-dopedb-analysis-runner-capability-version": "1",
        },
        body: JSON.stringify({
          deviceId: randomUUID(),
          displayName: "Cookie fallback attempt",
          backgroundAllowed: false,
        }),
      },
    ), { params: Promise.resolve({ workspaceId: rejectedWorkspaceId }) });
    expect(rejectedRegistration.status).toBe(401);
    expect(await rejectedRegistration.text()).not.toContain("runnerCapability");

    const rejectedClaim = await leaseRoute.POST(new Request(
      `https://dopedb.invalid/api/v1/workspaces/${rejectedWorkspaceId}/analyses/leases`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer invalid-native-session",
          cookie: authState.cookie,
          "content-type": "application/json",
          "x-dopedb-analysis-runner-capability": "a".repeat(64),
        },
        body: JSON.stringify({
          runnerId: randomUUID(),
          deviceId: randomUUID(),
          background: false,
        }),
      },
    ), { params: Promise.resolve({ workspaceId: rejectedWorkspaceId }) });
    expect(rejectedClaim.status).toBe(401);
  } finally {
    if (previousAuthOrigin === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previousAuthOrigin;
  }
  const projectName = `Harness Project ${suffix}`;
  const createdProject = await projectStore.insertKnowledgeProject({
    organizationId,
    name: projectName,
    environments: [
      { name: "Prod", riskClass: "production" },
      { name: "Dev", riskClass: "development" },
    ],
    authority: knowledgeAuthority,
  });
  expect(createdProject).toMatchObject({
    name: projectName,
    revision: 1,
    environments: [
      { name: "Dev", riskClass: "development", revision: 1 },
      { name: "Prod", riskClass: "production", revision: 1 },
    ],
  });
  if (!createdProject) throw new Error("Project Knowledge creation failed");
  await expect(projectStore.insertKnowledgeProject({
    organizationId,
    name: projectName,
    environments: [{ name: "Main", riskClass: "custom" }],
    authority: knowledgeAuthority,
  })).resolves.toBeNull();
  const appendedProject = await projectStore.appendKnowledgeEnvironment({
    organizationId,
    projectId: createdProject.id,
    expectedProjectRevision: 1,
    name: "Stage",
    riskClass: "staging",
    authority: knowledgeAuthority,
  });
  expect(appendedProject).toMatchObject({
    id: createdProject.id,
    revision: 2,
    environments: [
      { name: "Dev", riskClass: "development", revision: 1 },
      { name: "Prod", riskClass: "production", revision: 1 },
      { name: "Stage", riskClass: "staging", revision: 1 },
    ],
  });
  await expect(projectStore.appendKnowledgeEnvironment({
    organizationId,
    projectId: createdProject.id,
    expectedProjectRevision: 1,
    name: "Test",
    riskClass: "test",
    authority: knowledgeAuthority,
  })).resolves.toBeNull();
  await expect(projectStore.appendKnowledgeEnvironment({
    organizationId,
    projectId: createdProject.id,
    expectedProjectRevision: 2,
    name: "Prod",
    riskClass: "production",
    authority: knowledgeAuthority,
  })).resolves.toBeNull();
  await expect(projectStore.insertKnowledgeProject({
    organizationId,
    name: `Invalid subject ${suffix}`,
    environments: [{ name: "Main", riskClass: "custom" }],
    authority: {
      ...knowledgeAuthority,
      subject: { membershipId: memberId, userId: `not-${userId}` },
    },
  })).resolves.toBeNull();

  const memberGateKey = revocationGateLockKey({
    kind: "member",
    organizationId,
    memberId,
    userId,
  });
  let releaseMemberRevocation!: () => void;
  let memberRevocationReady!: () => void;
  const memberRevocationRelease = new Promise<void>((resolve) => {
    releaseMemberRevocation = resolve;
  });
  const memberRevocationStarted = new Promise<void>((resolve) => {
    memberRevocationReady = resolve;
  });
  const memberRevocation = sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${memberGateKey}, 0))`;
    await tx`
      UPDATE "workspace_control"."member"
      SET "revocation_pending_at" = now()
      WHERE "id" = ${memberId} AND "organization_id" = ${organizationId}
    `;
    memberRevocationReady();
    await memberRevocationRelease;
  });
  await memberRevocationStarted;
  const revokedMemberWrite = projectStore.insertKnowledgeProject({
    organizationId,
    name: `Revoked race ${suffix}`,
    environments: [{ name: "Main", riskClass: "custom" }],
    authority: knowledgeAuthority,
  });
  releaseMemberRevocation();
  await memberRevocation;
  await expect(revokedMemberWrite).resolves.toBeNull();
  await sql`
    UPDATE "workspace_control"."member"
    SET "revocation_pending_at" = NULL
    WHERE "id" = ${memberId} AND "organization_id" = ${organizationId}
  `;

  const deletionRaceReceiptId = randomUUID();
  await sql`
    INSERT INTO "workspace_control"."workspace_deletion_receipt"
      ("id", "organization_id", "requested_by_user_id", "requested_at", "purge_after")
    VALUES (${deletionRaceReceiptId}::uuid, ${organizationId}, ${userId}, now(),
            now() + interval '7 days')
  `;
  let releaseDeletionPending!: () => void;
  let deletionPendingReady!: () => void;
  const deletionPendingRelease = new Promise<void>((resolve) => {
    releaseDeletionPending = resolve;
  });
  const deletionPendingStarted = new Promise<void>((resolve) => {
    deletionPendingReady = resolve;
  });
  const deletionPending = sql.begin(async (tx) => {
    await tx`
      UPDATE "workspace_control"."workspace_profile"
      SET "lifecycle_state" = 'deletion_pending',
          "deletion_receipt_id" = ${deletionRaceReceiptId}::uuid,
          "deletion_requested_at" = now(),
          "purge_after" = now() + interval '7 days'
      WHERE "organization_id" = ${organizationId}
    `;
    await tx`
      UPDATE "workspace_control"."member" member
      SET "revocation_pending_at" = profile."deletion_requested_at"
      FROM "workspace_control"."workspace_profile" profile
      WHERE member."id" = ${memberId}
        AND member."organization_id" = ${organizationId}
        AND profile."organization_id" = member."organization_id"
    `;
    deletionPendingReady();
    await deletionPendingRelease;
  });
  await deletionPendingStarted;
  const deletingWorkspaceWrite = projectStore.insertKnowledgeProject({
    organizationId,
    name: `Deletion race ${suffix}`,
    environments: [{ name: "Main", riskClass: "custom" }],
    authority: knowledgeAuthority,
  });
  releaseDeletionPending();
  await deletionPending;
  await expect(deletingWorkspaceWrite).resolves.toBeNull();
  await sql.begin(async (tx) => {
    await tx`
      UPDATE "workspace_control"."workspace_profile"
      SET "lifecycle_state" = 'active', "deletion_receipt_id" = NULL,
          "deletion_requested_at" = NULL, "purge_after" = NULL
      WHERE "organization_id" = ${organizationId}
    `;
    await tx`
      UPDATE "workspace_control"."member"
      SET "revocation_pending_at" = NULL
      WHERE "id" = ${memberId} AND "organization_id" = ${organizationId}
    `;
    await tx`
      UPDATE "workspace_control"."workspace_deletion_receipt"
      SET "status" = 'cancelled', "cancelled_at" = now()
      WHERE "id" = ${deletionRaceReceiptId}::uuid
    `;
  });
  await insertReceipt(receiptId);

  const input = {
    organizationId,
    integrationId,
    receiptId,
    idempotencyKey: `harness-key-${suffix}`,
    connectionId: null,
    name: "Harness Neon",
    productionApproved: false,
    authority,
  };
  const [left, right] = await Promise.all([
    importProviderReceipt(input),
    importProviderReceipt(input),
  ]);
  expect(left.kind).toBe("imported");
  expect(right).toEqual(left);
  if (left.kind !== "imported") {
    throw new Error("Concurrent import did not return its durable connection");
  }
  await expect(importProviderReceipt(input)).resolves.toEqual(left);

  const durable = await sql<{
    connections: number;
    grants: number;
    versions: number;
    audits: number;
    requests: number;
    consumedReceipts: number;
  }[]>`
    SELECT
      (SELECT count(*)::int FROM "workspace_control"."workspace_connection"
        WHERE "organization_id" = ${organizationId}) AS "connections",
      (SELECT count(*)::int FROM "workspace_control"."workspace_connection_grant"
        WHERE "organization_id" = ${organizationId}) AS "grants",
      (SELECT count(*)::int FROM "workspace_control"."workspace_resource_version"
        WHERE "organization_id" = ${organizationId}) AS "versions",
      (SELECT count(*)::int FROM "workspace_control"."workspace_audit_event"
        WHERE "organization_id" = ${organizationId}) AS "audits",
      (SELECT count(*)::int FROM "workspace_control"."workspace_provider_import_request"
        WHERE "organization_id" = ${organizationId}) AS "requests",
      (SELECT count(*)::int FROM "workspace_control"."workspace_provider_discovery_receipt"
        WHERE "organization_id" = ${organizationId} AND "consumed_at" IS NOT NULL)
        AS "consumedReceipts"
  `;
  expect(durable[0]).toEqual({
    connections: 1,
    grants: 1,
    versions: 1,
    audits: 1,
    requests: 1,
    consumedReceipts: 1,
  });

  const connectionGrantRoute = await import(
    "../../app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/grants/route"
  );
  const grantResponse = await connectionGrantRoute.POST(new Request(
    `https://dopedb.invalid/api/v1/workspaces/${organizationId}/connections/${left.connection.id}/grants`,
    {
      method: "POST",
      headers: { authorization: authState.bearer, "content-type": "application/json" },
      body: JSON.stringify({ memberId: removableMemberId, capability: "manage" }),
    },
  ), { params: Promise.resolve({
    workspaceId: organizationId, connectionId: left.connection.id,
  }) });
  expect(grantResponse.status).toBe(200);
  await expect(grantResponse.json()).resolves.toEqual({
    memberId: removableMemberId, capability: "manage",
  });

  const developmentEnvironment = createdProject.environments.find(
    (environment) => environment.name === "Dev",
  );
  if (!developmentEnvironment) throw new Error("Development Environment is missing");
  await sql`
    INSERT INTO "workspace_control"."knowledge_environment_connection"
      ("organization_id", "project_environment_id", "environment_revision",
       "connection_id", "connection_revision", "role", "alias")
    VALUES (${organizationId}, ${developmentEnvironment.id}::uuid,
      ${developmentEnvironment.revision}, ${left.connection.id}::uuid,
      ${left.connection.contentRevision}, 'primary', 'Harness')
  `;

  return {
    createdProject,
    developmentEnvironment,
    importInput: input,
    imported: left,
  };
}

export type AuthorityProviderScenarioResult =
  Awaited<ReturnType<typeof runAuthorityProviderScenarios>>;
