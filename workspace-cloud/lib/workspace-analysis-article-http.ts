import { inD1Strings } from "./d1/json";
// Tenant-scoped Analysis Article projection helpers shared by API routes. Listings can
// return a title-only summary so large HTML or SQL bodies never ride along with them.
import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "./db";
import {
  workspaceAnalysisArticle,
  workspaceConnectionGrant,
} from "./schema";
import {
  analysisArticleSources,
  publicAnalysisArticle,
  type AnalysisArticleSource,
} from "./workspace-analysis-articles";
import { displayText } from "./workspace-analysis-validation";

type ArticleRow = typeof workspaceAnalysisArticle.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AnalysisArticleSummary = Readonly<{
  id: string;
  projectEnvironmentId: string;
  environmentRevision: number;
  connectionId: string;
  connectionRevision: number;
  definition: Readonly<{ version: 3; source: AnalysisArticleSource; title: string }>;
  ownerMemberId: string;
  updatedByMemberId: string;
  revision: number;
  latestSuccessfulRunId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type ArticleListInput = {
  organizationId: string;
  memberId: string;
  articleId?: string;
  projectEnvironmentId?: string;
};

function articleListFilter(input: ArticleListInput) {
  return and(
    eq(workspaceAnalysisArticle.organizationId, input.organizationId),
    input.articleId ? eq(workspaceAnalysisArticle.id, input.articleId) : undefined,
    input.projectEnvironmentId
      ? eq(workspaceAnalysisArticle.projectEnvironmentId, input.projectEnvironmentId)
      : undefined,
    isNull(workspaceAnalysisArticle.deletedAt),
  );
}

async function grantedConnectionIds(input: ArticleListInput, connectionIds: readonly string[]) {
  const grants = await db.select({
    connectionId: workspaceConnectionGrant.connectionId,
  }).from(workspaceConnectionGrant).where(and(
    eq(workspaceConnectionGrant.organizationId, input.organizationId),
    eq(workspaceConnectionGrant.memberId, input.memberId),
    inD1Strings(workspaceConnectionGrant.connectionId, [...new Set(connectionIds)]),
  ));
  return new Set(grants.map((grant) => grant.connectionId));
}

function positiveRevision(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** Fails closed per Article: one malformed stored row is omitted, not fatal to the list. */
function summaryProjection(row: {
  id: string;
  projectEnvironmentId: string;
  environmentRevision: number;
  connectionId: string;
  connectionRevision: number;
  version: unknown;
  source: unknown;
  title: unknown;
  ownerMemberId: string;
  updatedByMemberId: string;
  revision: number;
  latestSuccessfulRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AnalysisArticleSummary | null {
  const title = displayText(row.title, 160);
  if (row.version !== 3 || title === null
    || !analysisArticleSources.includes(row.source as AnalysisArticleSource)
    || !positiveRevision(row.environmentRevision) || !positiveRevision(row.connectionRevision)
    || !positiveRevision(row.revision) || !row.ownerMemberId || !row.updatedByMemberId
    || !(row.latestSuccessfulRunId === null || UUID.test(row.latestSuccessfulRunId))
    || Number.isNaN(row.createdAt.valueOf()) || Number.isNaN(row.updatedAt.valueOf())) {
    return null;
  }
  return {
    id: row.id,
    projectEnvironmentId: row.projectEnvironmentId,
    environmentRevision: row.environmentRevision,
    connectionId: row.connectionId,
    connectionRevision: row.connectionRevision,
    definition: { version: 3, source: row.source as AnalysisArticleSource, title },
    ownerMemberId: row.ownerMemberId,
    updatedByMemberId: row.updatedByMemberId,
    revision: row.revision,
    latestSuccessfulRunId: row.latestSuccessfulRunId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Title-and-identity listing. Only the title, source, and version are extracted from
 * the stored definition, so HTML and SQL are neither read from D1 nor sanitized here.
 */
export async function listAccessibleAnalysisArticleSummaries(input: ArticleListInput) {
  const definition = workspaceAnalysisArticle.definition;
  const rows = await db.select({
    id: workspaceAnalysisArticle.id,
    projectEnvironmentId: workspaceAnalysisArticle.projectEnvironmentId,
    environmentRevision: workspaceAnalysisArticle.environmentRevision,
    connectionId: workspaceAnalysisArticle.connectionId,
    connectionRevision: workspaceAnalysisArticle.connectionRevision,
    version: sql<unknown>`json_extract(${definition}, '$.version')`,
    source: sql<unknown>`json_extract(${definition}, '$.source')`,
    title: sql<unknown>`json_extract(${definition}, '$.title')`,
    ownerMemberId: workspaceAnalysisArticle.ownerMemberId,
    updatedByMemberId: workspaceAnalysisArticle.updatedByMemberId,
    revision: workspaceAnalysisArticle.revision,
    latestSuccessfulRunId: workspaceAnalysisArticle.latestSuccessfulRunId,
    createdAt: workspaceAnalysisArticle.createdAt,
    updatedAt: workspaceAnalysisArticle.updatedAt,
  }).from(workspaceAnalysisArticle).where(articleListFilter(input))
    .orderBy(desc(workspaceAnalysisArticle.updatedAt), desc(workspaceAnalysisArticle.id));
  if (rows.length === 0) return [];
  const granted = await grantedConnectionIds(input, rows.map((row) => row.connectionId));
  return rows.flatMap((row) => {
    if (!granted.has(row.connectionId)) return [];
    const summary = summaryProjection(row);
    return summary ? [summary] : [];
  });
}

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

export async function listAccessibleAnalysisArticles(input: ArticleListInput) {
  const rows = await db.select().from(workspaceAnalysisArticle).where(articleListFilter(input))
    .orderBy(desc(workspaceAnalysisArticle.updatedAt), desc(workspaceAnalysisArticle.id));
  if (rows.length === 0) return [];
  const granted = await grantedConnectionIds(input, rows.map((article) => article.connectionId));
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
