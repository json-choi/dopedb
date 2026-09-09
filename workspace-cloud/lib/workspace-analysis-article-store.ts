// Atomic persistence for Analysis Article definitions. Every mutation binds the
// active session to one Environment revision and one exact connection revision
// before it writes projection, history, and audit atomically.
import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { utcNow } from "./d1/schema/values";
import { workspaceMemberAuthority } from "./d1/member-authority";
import {
  analysisArticleVersionPayload,
  type SharedAnalysisArticleCreate,
} from "./workspace-analysis-articles";
import { canonicalHash } from "./workspace-versioning";

export type AnalysisArticleMutationAuthority = Readonly<{
  sessionId: string;
  userId: string;
  membershipId: string;
  role: string;
}>;

export type StoredAnalysisArticle = Readonly<{
  id: string;
  projectEnvironmentId: string;
  environmentRevision: number;
  connectionId: string;
  connectionRevision: number;
  definition: unknown;
  ownerMemberId: string;
  updatedByMemberId: string;
  revision: number;
  latestSuccessfulRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

type RawRow = Record<string, unknown>;

function safeRevision(value: unknown) {
  const revision = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

export function returnedAnalysisArticle(row: RawRow | undefined): StoredAnalysisArticle | null {
  if (!row) return null;
  const environmentRevision = safeRevision(row.environmentRevision);
  const revision = safeRevision(row.revision);
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt));
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt));
  if (typeof row.id !== "string" || typeof row.projectEnvironmentId !== "string"
    || environmentRevision === null || revision === null
    || typeof row.connectionId !== "string" || safeRevision(row.connectionRevision) === null
    || typeof row.ownerMemberId !== "string" || typeof row.updatedByMemberId !== "string"
    || !(row.latestSuccessfulRunId === null || typeof row.latestSuccessfulRunId === "string")
    || Number.isNaN(createdAt.valueOf()) || Number.isNaN(updatedAt.valueOf())) return null;
  return {
    id: row.id,
    projectEnvironmentId: row.projectEnvironmentId,
    environmentRevision,
    connectionId: row.connectionId,
    connectionRevision: safeRevision(row.connectionRevision)!,
    definition: typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition,
    ownerMemberId: row.ownerMemberId,
    updatedByMemberId: row.updatedByMemberId,
    revision,
    latestSuccessfulRunId: row.latestSuccessfulRunId as string | null,
    createdAt,
    updatedAt,
  };
}

function articleColumns() {
  return sql`
    article."id" AS "id",
    article."project_environment_id" AS "projectEnvironmentId",
    article."environment_revision" AS "environmentRevision",
    article."connection_id" AS "connectionId",
    article."connection_revision" AS "connectionRevision",
    article."definition" AS "definition",
    article."owner_member_id" AS "ownerMemberId",
    article."updated_by_member_id" AS "updatedByMemberId",
    article."revision" AS "revision",
    article."latest_successful_run_id" AS "latestSuccessfulRunId",
    article."created_at" AS "createdAt",
    article."updated_at" AS "updatedAt"`;
}

const editorRoles = ["editor", "admin", "owner"] as const;
type ArticleInput = { organizationId: string; article: SharedAnalysisArticleCreate; authority: AnalysisArticleMutationAuthority };

function connectionScope(input: ArticleInput) {
  return sql`SELECT 1 FROM knowledge_project_environment environment
    JOIN knowledge_project project ON project.organization_id = environment.organization_id
      AND project.id = environment.project_id AND project.deleted_at IS NULL
    JOIN knowledge_environment_connection binding ON binding.organization_id = environment.organization_id
      AND binding.project_environment_id = environment.id AND binding.environment_revision = environment.revision
      AND binding.connection_id = ${input.article.connectionId} AND binding.revoked_at IS NULL
    JOIN workspace_connection connection ON connection.organization_id = binding.organization_id
      AND connection.id = binding.connection_id AND connection.content_revision = binding.connection_revision
      AND connection.content_revision = ${input.article.connectionRevision} AND connection.deleted_at IS NULL
      AND connection.revocation_pending_at IS NULL AND connection.revocation_claim_id IS NULL
    JOIN workspace_connection_grant connection_grant ON connection_grant.organization_id = connection.organization_id
      AND connection_grant.connection_id = connection.id AND connection_grant.member_id = ${input.authority.membershipId}
      AND connection_grant.capability IN ('use', 'manage')
    WHERE environment.organization_id = ${input.organizationId} AND environment.id = ${input.article.projectEnvironmentId}
      AND environment.revision = ${input.article.environmentRevision}`;
}

async function commitArticleChange(input: ArticleInput, options: {
  scope: SQL; mutation: (scope: SQL) => SQL; ownerMemberId: string; revision: number;
  operation: "create" | "update" | "propose" | "delete";
}) {
  const payload = analysisArticleVersionPayload({ ...input.article, ownerMemberId: options.ownerMemberId,
    ...(options.operation === "delete" ? { deleted: true } : {}) });
  const summary = options.operation === "create" ? {
    environmentId: input.article.projectEnvironmentId, environmentRevision: input.article.environmentRevision,
    connectionId: input.article.connectionId, queryCount: 1, revision: options.revision,
  } : { environmentId: input.article.projectEnvironmentId, revision: options.revision, ownerMemberId: options.ownerMemberId,
    ...(options.operation === "delete" ? {} : { connectionId: input.article.connectionId }) };
  const result = await atomicD1({
    scope: options.scope,
    statements: (scope) => [
      options.mutation(scope),
      sql`INSERT INTO workspace_analysis_article_revision (organization_id, article_id, revision, base_revision, operation,
          payload, payload_hash, created_by_user_id, created_by_member_id)
        SELECT ${input.organizationId}, ${input.article.id}, ${options.revision}, ${options.revision - 1}, ${options.operation},
          ${JSON.stringify(payload)}, ${canonicalHash(payload)}, ${input.authority.userId}, ${input.authority.membershipId} FROM (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, ${`analysis_article.${options.operation}`}, 'analysis_article',
          ${input.article.id}, ${JSON.stringify(summary)}, ${crypto.randomUUID()} FROM (${scope})`,
      sql`SELECT ${articleColumns()} FROM workspace_analysis_article article CROSS JOIN (${scope})
        WHERE article.id = ${input.article.id}`,
    ],
  });
  return returnedAnalysisArticle(result.rows[3][0]);
}

export async function commitAnalysisArticleCreate(input: ArticleInput): Promise<StoredAnalysisArticle | null> {
  return commitArticleChange(input, {
    ownerMemberId: input.authority.membershipId, revision: 1, operation: "create",
    scope: sql`SELECT '{}' AS payload WHERE EXISTS (${workspaceMemberAuthority(input.organizationId, input.authority, editorRoles)})
      AND (SELECT count(*) FROM (${connectionScope(input)})) = 1`,
    mutation: (scope) => sql`INSERT INTO workspace_analysis_article (id, organization_id, project_environment_id, environment_revision,
        connection_id, connection_revision, definition, owner_member_id, updated_by_member_id, revision)
      SELECT ${input.article.id}, ${input.organizationId}, ${input.article.projectEnvironmentId}, ${input.article.environmentRevision},
        ${input.article.connectionId}, ${input.article.connectionRevision}, ${JSON.stringify(input.article.definition)},
        ${input.authority.membershipId}, ${input.authority.membershipId}, 1 FROM (${scope})`,
  });
}

export type AnalysisArticleMutationOperation = "propose" | "update";

export async function commitAnalysisArticleMutation(input: ArticleInput & {
  expectedRevision: number; ownerMemberId: string; operation: AnalysisArticleMutationOperation;
}): Promise<StoredAnalysisArticle | null> {
  return commitArticleChange(input, {
    ownerMemberId: input.ownerMemberId, revision: input.expectedRevision + 1, operation: input.operation,
    scope: sql`SELECT '{}' AS payload FROM workspace_analysis_article article
      JOIN (${workspaceMemberAuthority(input.organizationId, input.authority, editorRoles)}) actor
        ON article.owner_member_id = actor.id OR actor.role IN ('admin', 'owner')
      JOIN member owner ON owner.organization_id = article.organization_id AND owner.id = ${input.ownerMemberId}
        AND owner.role IN ('editor', 'admin', 'owner') AND owner.revocation_pending_at IS NULL AND owner.revocation_claim_id IS NULL
      WHERE article.organization_id = ${input.organizationId} AND article.id = ${input.article.id}
        AND article.project_environment_id = ${input.article.projectEnvironmentId}
        AND article.revision = ${input.expectedRevision} AND article.deleted_at IS NULL
        AND (SELECT count(*) FROM (${connectionScope(input)})) = 1`,
    mutation: (scope) => sql`UPDATE workspace_analysis_article SET project_environment_id = ${input.article.projectEnvironmentId},
        environment_revision = ${input.article.environmentRevision}, connection_id = ${input.article.connectionId},
        connection_revision = ${input.article.connectionRevision}, definition = ${JSON.stringify(input.article.definition)},
        owner_member_id = ${input.ownerMemberId}, updated_by_member_id = ${input.authority.membershipId},
        revision = revision + 1, updated_at = ${utcNow}, latest_successful_run_id = NULL, deleted_at = NULL
      WHERE id = ${input.article.id} AND EXISTS (${scope})`,
  });
}

/** Cleanup remains possible after the original Environment or connection was revoked. */
export async function commitAnalysisArticleDelete(input: ArticleInput & {
  expectedRevision: number; ownerMemberId: string;
}): Promise<StoredAnalysisArticle | null> {
  return commitArticleChange(input, {
    ownerMemberId: input.ownerMemberId, revision: input.expectedRevision + 1, operation: "delete",
    scope: sql`SELECT '{}' AS payload FROM workspace_analysis_article article
      JOIN (${workspaceMemberAuthority(input.organizationId, input.authority, editorRoles)}) actor
        ON article.owner_member_id = actor.id OR actor.role IN ('admin', 'owner')
      WHERE article.organization_id = ${input.organizationId} AND article.id = ${input.article.id}
        AND article.project_environment_id = ${input.article.projectEnvironmentId}
        AND article.environment_revision = ${input.article.environmentRevision} AND article.owner_member_id = ${input.ownerMemberId}
        AND article.revision = ${input.expectedRevision} AND article.deleted_at IS NULL`,
    mutation: (scope) => sql`UPDATE workspace_analysis_article SET updated_by_member_id = ${input.authority.membershipId},
        revision = revision + 1, latest_successful_run_id = NULL, deleted_at = ${utcNow}, updated_at = ${utcNow}
      WHERE id = ${input.article.id} AND EXISTS (${scope})`,
  });
}
