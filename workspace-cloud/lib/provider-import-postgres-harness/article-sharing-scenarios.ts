import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { ProviderImportPostgresHarness } from "./fixture";
import type { AnalysisLifecycleScenarioResult } from "./analysis-lifecycle-scenarios";
import type { AuthorityProviderScenarioResult } from "./authority-provider-scenarios";

export async function runArticleSharingScenarios(
  fixture: ProviderImportPostgresHarness,
  provider: AuthorityProviderScenarioResult,
  analysis: AnalysisLifecycleScenarioResult,
) {
  const { sql, organizationId, authority, memberId } = fixture;
  const { createArticleInvitation, loadArticleSharing, revokeArticleInvitation, parseInvitationEmail } = await import("../../features/articleSharing/store");
  const { acceptArticleInvitation, inspectArticleInvitation } = await import("../../features/articleSharing/acceptance");
  const { accessModeForConnectionGrant, hasWorkspaceConnectionCapability } = await import("../workspace-permissions");
  const scope = { workspaceId: organizationId, articleId: analysis.articleId };
  const recipient = { userId: randomUUID(), sessionId: randomUUID() };
  const email = `article-reader-${recipient.userId}@dopedb.invalid`;
  const connectionId = provider.imported.connection.id;
  expect(parseInvitationEmail(`  ${email.toUpperCase()}  `)).toBe(email);
  expect(parseInvitationEmail("recipient\n@dopedb.invalid")).toBeNull();
  expect(hasWorkspaceConnectionCapability("read", "use")).toBe(false);
  expect(hasWorkspaceConnectionCapability("read", "read")).toBe(true);
  for (const role of ["viewer", "analyst", "editor", "admin", "owner"] as const) {
    expect(accessModeForConnectionGrant(role, "read")).toBe("read");
  }
  const sharing = await loadArticleSharing(scope, authority);
  expect(sharing).toMatchObject({ canInvite: true, articleId: scope.articleId });
  expect(JSON.stringify(sharing)).not.toContain(analysis.revisedArticle.definition.query.sql);
  await expect(createArticleInvitation({ ...scope, workspaceId: fixture.otherOrganizationId }, authority, email)).resolves.toBeNull();
  await sql`INSERT INTO "workspace_control"."user" ("id", "name", "email", "email_verified") VALUES (${recipient.userId}, 'Article reader', ${email}, false)`;
  await sql`INSERT INTO "workspace_control"."session" ("id", "user_id", "token", "expires_at") VALUES (${recipient.sessionId}, ${recipient.userId}, ${randomUUID()}, now() + interval '1 hour')`;
  const invite = async () => {
    const link = await createArticleInvitation(scope, authority, email);
    expect(link).not.toBeNull();
    expect(link!.url).toContain(`/article-invitations/${link!.id}`);
    return link!;
  };
  const membership = async () => (await sql<{ id: string; role: string; capability: string }[]>`
    SELECT member."id", member."role", grant_row."capability" FROM "workspace_control"."member" member
    LEFT JOIN "workspace_control"."workspace_connection_grant" grant_row
      ON grant_row."organization_id" = member."organization_id" AND grant_row."member_id" = member."id"
      AND grant_row."connection_id" = ${connectionId}::uuid
    WHERE member."organization_id" = ${organizationId} AND member."user_id" = ${recipient.userId}
  `)[0];
  try {
    const first = await invite();
    await expect(inspectArticleInvitation(first.id, authority)).resolves.toBeNull();
    await expect(acceptArticleInvitation(first.id, recipient)).resolves.toBeNull();
    expect(await membership()).toBeUndefined();
    await sql`UPDATE "workspace_control"."user" SET "email_verified" = true WHERE "id" = ${recipient.userId}`;
    await expect(inspectArticleInvitation(first.id, recipient)).resolves.toMatchObject({ accepted: false, title: sharing!.title });
    const accepted = await Promise.all([acceptArticleInvitation(first.id, recipient), acceptArticleInvitation(first.id, recipient)]);
    expect(accepted.some(Boolean)).toBe(true);
    expect(await membership()).toMatchObject({ role: "analyst", capability: "read" });
    await expect(acceptArticleInvitation(first.id, recipient)).resolves.toMatchObject({ path: `/open-article/${organizationId}/${scope.articleId}` });
    const [audit] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM "workspace_control"."workspace_audit_event"
      WHERE "organization_id" = ${organizationId} AND "action" = 'analysis.invitation.accept' AND "redacted_summary"->>'invitationId' = ${first.id}`;
    expect(audit.count).toBe(1);
    await expect(createArticleInvitation(scope, recipient, email)).resolves.toBeNull();
    await expect(revokeArticleInvitation(scope, authority, first.id)).resolves.toBeNull();

    // A pre-existing Editor still receives only read; a pre-existing higher grant is preserved.
    await sql`UPDATE "workspace_control"."member" SET "role" = 'editor' WHERE "organization_id" = ${organizationId} AND "user_id" = ${recipient.userId}`;
    await expect(acceptArticleInvitation((await invite()).id, recipient)).resolves.not.toBeNull();
    expect(await membership()).toMatchObject({ role: "editor", capability: "read" });
    const actorFixture = fixture.authState.fixture;
    fixture.authState.fixture = { session: { id: recipient.sessionId }, user: { id: recipient.userId, email } };
    try {
      const route = await import("../../app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/route");
      const leaseRoute = await import("../../app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/lease/route");
      const { MANAGED_LEASE_CONTRACT_VERSION } = await import("../control-plane-contracts");
      const context = { params: Promise.resolve({ workspaceId: organizationId, connectionId }) };
      for (const action of ["read", "write", "schema"] as const) {
        const headers = { authorization: fixture.authState.bearer, "content-type": "application/json", "x-dopedb-managed-lease-contract": MANAGED_LEASE_CONTRACT_VERSION };
        const response = await route.POST(new Request("https://dopedb.invalid/action", { method: "POST", headers, body: JSON.stringify({ action }) }), context);
        expect(response.status).toBe(action === "read" ? 200 : 403);
        if (action !== "read") {
          expect(await response.json()).toMatchObject({ error: "Connection grant denied" });
          const lease = await leaseRoute.POST(new Request("https://dopedb.invalid/lease", { method: "POST", headers, body: JSON.stringify({ accessMode: action }) }), context);
          expect(lease.status).toBe(403);
          expect(await lease.json()).toMatchObject({ error: "Connection grant denied" });
        }
      }
    } finally { fixture.authState.fixture = actorFixture; }
    await sql`UPDATE "workspace_control"."workspace_connection_grant" SET "capability" = 'use'
      WHERE "organization_id" = ${organizationId} AND "member_id" = ${(await membership()).id}`;
    await expect(acceptArticleInvitation((await invite()).id, recipient)).resolves.not.toBeNull();
    expect(await membership()).toMatchObject({ role: "editor", capability: "use" });

    const expired = await invite();
    await sql`UPDATE "workspace_control"."workspace_article_invitation" SET "created_at" = now() - interval '3 days', "expires_at" = now() - interval '1 day' WHERE "id" = ${expired.id}::uuid`;
    await expect(acceptArticleInvitation(expired.id, recipient)).resolves.toBeNull();
    const cancelled = await invite();
    await expect(revokeArticleInvitation(scope, authority, cancelled.id)).resolves.not.toBeNull();
    await expect(acceptArticleInvitation(cancelled.id, recipient)).resolves.toBeNull();
    const changed = await invite();
    await sql`UPDATE "workspace_control"."workspace_article_invitation" SET "connection_revision" = "connection_revision" + 1 WHERE "id" = ${changed.id}::uuid`;
    await expect(acceptArticleInvitation(changed.id, recipient)).resolves.toBeNull();
    const removedManager = await invite();
    await sql`UPDATE "workspace_control"."workspace_connection_grant" SET "capability" = 'use' WHERE "organization_id" = ${organizationId} AND "connection_id" = ${connectionId}::uuid AND "member_id" = ${memberId}`;
    await expect(acceptArticleInvitation(removedManager.id, recipient)).resolves.toBeNull();
    await sql`UPDATE "workspace_control"."workspace_connection_grant" SET "capability" = 'manage' WHERE "organization_id" = ${organizationId} AND "connection_id" = ${connectionId}::uuid AND "member_id" = ${memberId}`;

    await sql`DELETE FROM "workspace_control"."member" WHERE "organization_id" = ${organizationId} AND "user_id" = ${recipient.userId}`;
    await expect(acceptArticleInvitation(first.id, recipient)).resolves.toBeNull();
    expect(await membership()).toBeUndefined();
    const revokedSession = await invite();
    await sql`UPDATE "workspace_control"."session" SET "expires_at" = now() - interval '1 minute' WHERE "id" = ${recipient.sessionId}`;
    await expect(acceptArticleInvitation(revokedSession.id, recipient)).resolves.toBeNull();
    expect(await membership()).toBeUndefined();
  } finally {
    await sql`DELETE FROM "workspace_control"."workspace_article_invitation" WHERE "organization_id" = ${organizationId} AND "recipient_email" = ${email}`;
    await sql`DELETE FROM "workspace_control"."user" WHERE "id" = ${recipient.userId}`;
  }
}
