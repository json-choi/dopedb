// Tenant-scoped Analysis Article projection helpers shared by API routes.
import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "./db";
import {
  workspaceAnalysisArticle,
  workspaceConnectionGrant,
} from "./schema";
import { publicAnalysisArticle } from "./workspace-analysis-articles";

type ArticleRow = typeof workspaceAnalysisArticle.$inferSelect;

function projection(article: ArticleRow) {
  return publicAnalysisArticle({
    id: article.id,
    projectEnvironmentId: article.projectEnvironmentId,
    environmentRevision: article.environmentRevision,
    connectionId: article.connectionId,
    connectionRevision: article.connectionRevision,
    definition: article.definition,
    ownerMemberId: article.ownerMemberId,
    updatedByMemberId: article.updatedByMemberId,
    revision: article.revision,
    latestSuccessfulRunId: article.latestSuccessfulRunId,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  });
}

export async function listAccessibleAnalysisArticles(input: {
  organizationId: string;
  memberId: string;
  articleId?: string;
  projectEnvironmentId?: string;
}) {
  const rows = await db.select().from(workspaceAnalysisArticle).where(and(
    eq(workspaceAnalysisArticle.organizationId, input.organizationId),
    input.articleId ? eq(workspaceAnalysisArticle.id, input.articleId) : undefined,
    input.projectEnvironmentId
      ? eq(workspaceAnalysisArticle.projectEnvironmentId, input.projectEnvironmentId)
      : undefined,
    isNull(workspaceAnalysisArticle.deletedAt),
  )).orderBy(desc(workspaceAnalysisArticle.updatedAt), desc(workspaceAnalysisArticle.id));
  if (rows.length === 0) return [];
  const requiredConnectionIds = [...new Set(rows.map((article) => article.connectionId))];
  const grants = await db.select({
    connectionId: workspaceConnectionGrant.connectionId,
  }).from(workspaceConnectionGrant).where(and(
    eq(workspaceConnectionGrant.organizationId, input.organizationId),
    eq(workspaceConnectionGrant.memberId, input.memberId),
    inArray(workspaceConnectionGrant.connectionId, requiredConnectionIds),
  ));
  const granted = new Set(grants.map((grant) => grant.connectionId));
  return rows
    .filter((article) => granted.has(article.connectionId))
    .map(projection);
}

export async function accessibleAnalysisArticle(input: {
  organizationId: string;
  articleId: string;
  memberId: string;
}) {
  const rows = await listAccessibleAnalysisArticles({
    ...input,
    articleId: input.articleId,
  });
  return rows[0] ?? null;
}
