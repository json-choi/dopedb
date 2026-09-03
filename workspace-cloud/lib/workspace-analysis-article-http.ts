// Tenant-scoped Analysis Article projection helpers shared by API routes.
import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "./db";
import {
  workspaceAnalysisArticle,
  workspaceAnalysisArticleConnection,
  workspaceAnalysisArticleGraph,
  workspaceConnectionGrant,
} from "./schema";
import {
  publicAnalysisArticle,
  type AnalysisArticleConnection,
} from "./workspace-analysis-articles";

type ArticleRow = typeof workspaceAnalysisArticle.$inferSelect;

function projection(
  article: ArticleRow,
  connections: readonly AnalysisArticleConnection[],
  graphRevisionIds: readonly string[],
) {
  return publicAnalysisArticle({
    id: article.id,
    projectEnvironmentId: article.projectEnvironmentId,
    environmentRevision: article.environmentRevision,
    sourceKnowledgeGrantId: article.sourceKnowledgeGrantId,
    graphRevisionIds,
    connections,
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
  const articleIds = rows.map((article) => article.id);
  const revisionByArticle = new Map(rows.map((article) => [article.id, article.revision]));
  const [allConnectionRows, allGraphRows] = await Promise.all([
    db.select().from(workspaceAnalysisArticleConnection).where(and(
      eq(workspaceAnalysisArticleConnection.organizationId, input.organizationId),
      inArray(workspaceAnalysisArticleConnection.articleId, articleIds),
    )),
    db.select().from(workspaceAnalysisArticleGraph).where(and(
      eq(workspaceAnalysisArticleGraph.organizationId, input.organizationId),
      inArray(workspaceAnalysisArticleGraph.articleId, articleIds),
    )),
  ]);
  const connectionRows = allConnectionRows.filter(
    (row) => revisionByArticle.get(row.articleId) === row.articleRevision,
  );
  const graphRows = allGraphRows.filter(
    (row) => revisionByArticle.get(row.articleId) === row.articleRevision,
  );
  const requiredConnectionIds = [...new Set(connectionRows.map((row) => row.connectionId))];
  const grants = requiredConnectionIds.length === 0 ? [] : await db.select({
    connectionId: workspaceConnectionGrant.connectionId,
  }).from(workspaceConnectionGrant).where(and(
    eq(workspaceConnectionGrant.organizationId, input.organizationId),
    eq(workspaceConnectionGrant.memberId, input.memberId),
    inArray(workspaceConnectionGrant.connectionId, requiredConnectionIds),
  ));
  const granted = new Set(grants.map((grant) => grant.connectionId));
  return rows.flatMap((article) => {
    const connections = connectionRows
      .filter((row) => row.articleId === article.id)
      .map((row) => ({
        connectionId: row.connectionId,
        connectionRevision: row.connectionRevision,
        role: row.role,
        alias: row.alias,
      }));
    if (connections.length === 0 || connections.some((connection) => !granted.has(connection.connectionId))) {
      return [];
    }
    const graphRevisionIds = graphRows
      .filter((row) => row.articleId === article.id)
      .map((row) => row.graphRevisionId);
    return [projection(article, connections, graphRevisionIds)];
  });
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
