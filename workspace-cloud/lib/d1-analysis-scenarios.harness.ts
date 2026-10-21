// Exercises Article storage and reruns with a read-only source grant, keeping
// Workspace authorship and source database authority as independent boundaries.
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { commitAnalysisArticleCreate, commitAnalysisArticleMutation, commitAnalysisArticleDelete } from "./workspace-analysis-article-store";
import { parseSharedAnalysisArticleCreate } from "./workspace-analysis-articles";
import type { MemberAuthority } from "./d1/member-authority";
import { verifyD1AnalysisRunners } from "./d1-runner-scenarios.harness";
import { verifyD1AnalysisRuns } from "./d1-analysis-run-scenarios.harness";
import { EXPECTED_REVISION_HEADER } from "./workspace-versioning";
import { POST as createArticle } from "../app/api/v1/workspaces/[workspaceId]/analyses/route";

export async function verifyD1AnalysisArticles(db: D1Database, organizationId: string, connectionId: string, authority: MemberAuthority) {
  const binding = await db.prepare("SELECT project_environment_id AS id, environment_revision AS revision, connection_revision AS connectionRevision FROM knowledge_environment_connection WHERE organization_id = ? AND connection_id = ? AND revoked_at IS NULL")
    .bind(organizationId, connectionId).first<{ id: string; revision: number; connectionRevision: number }>();
  const article = parseSharedAnalysisArticleCreate({ id: randomUUID(), projectEnvironmentId: binding!.id,
    environmentRevision: binding!.revision, connectionId, connectionRevision: binding!.connectionRevision,
    definition: { version: 3, source: "human", title: "Fixture analysis", html: "<h2>Fixture</h2><p>One exact query.</p>",
      query: { id: "fixture_rows", title: "Fixture rows", sql: "SELECT count(*) AS count FROM fixture", maxRows: 5, maxBytes: 16384,
        columns: [{ name: "count", type: "number", nullable: false, role: "measure", sensitivity: "internal", masking: "none" }] } } });
  const grant = await db.prepare("SELECT id, capability, origin, created_at, updated_at FROM workspace_connection_grant WHERE organization_id = ? AND connection_id = ? AND member_id = ?")
    .bind(organizationId, connectionId, authority.membershipId)
    .first<{ id: string; capability: string; origin: string; created_at: string; updated_at: string }>();
  if (!grant) throw new Error("Missing Article fixture source grant");
  const setCapability = (capability: string) => db.prepare("UPDATE workspace_connection_grant SET capability = ? WHERE id = ?")
    .bind(capability, grant.id).run();
  await setCapability("read");
  expect(await commitAnalysisArticleCreate({ organizationId, authority,
    article: { ...article, connectionRevision: article.connectionRevision + 1 } })).toBeNull();
  expect(await commitAnalysisArticleCreate({ organizationId, authority,
    article: { ...article, environmentRevision: article.environmentRevision + 1 } })).toBeNull();
  const previousOrigin = process.env.BETTER_AUTH_URL;
  let created: { revision: number; definition: unknown } | undefined;
  try {
    process.env.BETTER_AUTH_URL = "https://workspace.dopedb.dev";
    await db.prepare("UPDATE member SET role = 'editor' WHERE id = ?").bind(authority.membershipId).run();
    const token = await db.prepare("SELECT token FROM session WHERE id = ?").bind(authority.sessionId).first<string>("token");
    const response = await createArticle(new Request("https://workspace.dopedb.dev/api/fixture", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", [EXPECTED_REVISION_HEADER]: "0" },
      body: JSON.stringify(article),
    }), { params: Promise.resolve({ workspaceId: organizationId }) });
    expect(response.status).toBe(201);
    created = (await response.json()).article;
  } finally {
    await db.prepare("UPDATE member SET role = ? WHERE id = ?").bind(authority.role, authority.membershipId).run();
    if (previousOrigin === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previousOrigin;
  }
  expect(created?.revision).toBe(1);
  expect(created?.definition).toEqual(article.definition);

  async function expectDenied(actor: MemberAuthority) {
    const deniedArticle = { ...article, id: randomUUID() };
    expect(await commitAnalysisArticleCreate({ organizationId, article: deniedArticle, authority: actor })).toBeNull();
    expect(await commitAnalysisArticleMutation({ organizationId, article, authority: actor, expectedRevision: 1,
      ownerMemberId: authority.membershipId, operation: "update" })).toBeNull();
    expect(await db.prepare("SELECT count(*) AS count FROM workspace_analysis_article WHERE id = ?")
      .bind(deniedArticle.id).first("count")).toBe(0);
    expect(await db.prepare("SELECT count(*) AS count FROM workspace_audit_event WHERE resource_id = ?")
      .bind(deniedArticle.id).first("count")).toBe(0);
  }
  await setCapability("view");
  await expectDenied(authority);
  await db.prepare("DELETE FROM workspace_connection_grant WHERE id = ?").bind(grant.id).run();
  await expectDenied(authority);
  await db.prepare("INSERT INTO workspace_connection_grant (id, organization_id, connection_id, member_id, capability, origin, created_at, updated_at) VALUES (?, ?, ?, ?, 'read', ?, ?, ?)")
    .bind(grant.id, organizationId, connectionId, authority.membershipId, grant.origin, grant.created_at, grant.updated_at).run();
  for (const role of ["viewer", "analyst"]) {
    await db.prepare("UPDATE member SET role = ? WHERE id = ?").bind(role, authority.membershipId).run();
    await expectDenied({ ...authority, role });
  }
  await db.prepare("UPDATE member SET role = ? WHERE id = ?").bind(authority.role, authority.membershipId).run();
  expect(await db.prepare("SELECT revision FROM workspace_analysis_article WHERE id = ?")
    .bind(article.id).first("revision")).toBe(1);
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_analysis_article_revision WHERE article_id = ?")
    .bind(article.id).first("count")).toBe(1);
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_audit_event WHERE resource_id = ?")
    .bind(article.id).first("count")).toBe(1);
  await verifyD1AnalysisRunners(db, organizationId, article.id, authority);
  await verifyD1AnalysisRuns(db, organizationId, article, authority);
  const mutations = await Promise.all(Array.from({ length: 4 }, () => commitAnalysisArticleMutation({ organizationId,
    article, authority, expectedRevision: 1, ownerMemberId: authority.membershipId, operation: "update" })));
  expect(mutations.filter(Boolean)).toHaveLength(1);
  expect(mutations.find(Boolean)?.revision).toBe(2);
  expect(await db.prepare("SELECT capability FROM workspace_connection_grant WHERE id = ?")
    .bind(grant.id).first("capability")).toBe("read");
  await db.prepare("UPDATE knowledge_environment_connection SET revoked_at = ? WHERE connection_id = ?")
    .bind(new Date().toISOString(), connectionId).run();
  expect(await commitAnalysisArticleMutation({ organizationId, article, authority, expectedRevision: 2,
    ownerMemberId: authority.membershipId, operation: "update" })).toBeNull();
  // Source revocation blocks execution changes but cannot prevent orphan cleanup.
  const activePublications = db.prepare("SELECT count(*) AS count FROM workspace_analysis_publication WHERE article_id = ? AND revoked_at IS NULL")
    .bind(article.id);
  // Editing cleared the successful-run pin, but the earlier public page is still live and revocable.
  expect(await activePublications.first("count")).toBe(1);
  const deleted = await commitAnalysisArticleDelete({ organizationId, article, authority, expectedRevision: 2,
    ownerMemberId: authority.membershipId });
  expect(deleted?.revision).toBe(3);
  expect(deleted?.revokedPublicationSlugs).toHaveLength(1);
  expect(await activePublications.first("count")).toBe(0);
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_audit_event WHERE action = 'analysis_publication.revoke' AND json_extract(redacted_summary, '$.reason') = 'article_deleted' AND json_extract(redacted_summary, '$.articleId') = ?")
    .bind(article.id).first("count")).toBe(1);
  expect(await commitAnalysisArticleDelete({ organizationId, article, authority, expectedRevision: 2,
    ownerMemberId: authority.membershipId })).toBeNull();
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_analysis_article_revision WHERE article_id = ?")
    .bind(article.id).first("count")).toBe(3);
  await expect(db.prepare("UPDATE workspace_analysis_article_revision SET payload_hash = ? WHERE article_id = ?")
    .bind("0".repeat(64), article.id).run()).rejects.toThrow();
  await db.prepare("UPDATE knowledge_environment_connection SET revoked_at = NULL WHERE connection_id = ?").bind(connectionId).run();
  await setCapability(grant.capability);
}
