import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { commitAnalysisArticleCreate, commitAnalysisArticleMutation, commitAnalysisArticleDelete } from "./workspace-analysis-article-store";
import { parseSharedAnalysisArticleCreate } from "./workspace-analysis-articles";
import type { MemberAuthority } from "./d1/member-authority";
import { verifyD1AnalysisRunners } from "./d1-runner-scenarios.harness";
import { verifyD1AnalysisRuns } from "./d1-analysis-run-scenarios.harness";

export async function verifyD1AnalysisArticles(db: D1Database, organizationId: string, connectionId: string, authority: MemberAuthority) {
  const binding = await db.prepare("SELECT project_environment_id AS id, environment_revision AS revision, connection_revision AS connectionRevision FROM knowledge_environment_connection WHERE organization_id = ? AND connection_id = ? AND revoked_at IS NULL")
    .bind(organizationId, connectionId).first<{ id: string; revision: number; connectionRevision: number }>();
  const article = parseSharedAnalysisArticleCreate({ id: randomUUID(), projectEnvironmentId: binding!.id,
    environmentRevision: binding!.revision, connectionId, connectionRevision: binding!.connectionRevision,
    definition: { version: 3, source: "human", title: "Fixture analysis", html: "<h2>Fixture</h2><p>One exact query.</p>",
      query: { id: "fixture_rows", title: "Fixture rows", sql: "SELECT count(*) AS count FROM fixture", maxRows: 5, maxBytes: 16384,
        columns: [{ name: "count", type: "number", nullable: false, role: "measure", sensitivity: "internal", masking: "none" }] } } });
  expect(await commitAnalysisArticleCreate({ organizationId, authority,
    article: { ...article, connectionRevision: article.connectionRevision + 1 } })).toBeNull();
  const created = await commitAnalysisArticleCreate({ organizationId, article, authority });
  expect(created?.revision).toBe(1);
  expect(created?.definition).toEqual(article.definition);
  await verifyD1AnalysisRunners(db, organizationId, article.id, authority);
  await verifyD1AnalysisRuns(db, organizationId, article, authority);
  const mutations = await Promise.all(Array.from({ length: 4 }, () => commitAnalysisArticleMutation({ organizationId,
    article, authority, expectedRevision: 1, ownerMemberId: authority.membershipId, operation: "update" })));
  expect(mutations.filter(Boolean)).toHaveLength(1);
  expect(mutations.find(Boolean)?.revision).toBe(2);
  await db.prepare("UPDATE knowledge_environment_connection SET revoked_at = ? WHERE connection_id = ?")
    .bind(new Date().toISOString(), connectionId).run();
  expect(await commitAnalysisArticleMutation({ organizationId, article, authority, expectedRevision: 2,
    ownerMemberId: authority.membershipId, operation: "update" })).toBeNull();
  // Source revocation blocks execution changes but cannot prevent orphan cleanup.
  const deleted = await commitAnalysisArticleDelete({ organizationId, article, authority, expectedRevision: 2,
    ownerMemberId: authority.membershipId });
  expect(deleted?.revision).toBe(3);
  expect(await commitAnalysisArticleDelete({ organizationId, article, authority, expectedRevision: 2,
    ownerMemberId: authority.membershipId })).toBeNull();
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_analysis_article_revision WHERE article_id = ?")
    .bind(article.id).first("count")).toBe(3);
  await expect(db.prepare("UPDATE workspace_analysis_article_revision SET payload_hash = ? WHERE article_id = ?")
    .bind("0".repeat(64), article.id).run()).rejects.toThrow();
  await db.prepare("UPDATE knowledge_environment_connection SET revoked_at = NULL WHERE connection_id = ?").bind(connectionId).run();
}
