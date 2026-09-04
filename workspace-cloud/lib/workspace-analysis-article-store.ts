// Atomic persistence for Analysis Article definitions. Every mutation binds the
// active session to one Environment revision and one exact connection revision
// before it writes projection, history, and audit atomically.
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "./db";
import { revocationGateLockKey } from "./revocation-gates";
import {
  knowledgeEnvironmentConnection,
  knowledgeProject,
  knowledgeProjectEnvironment,
  workspaceAnalysisArticle,
  workspaceAnalysisArticleRevision,
  workspaceAuditEvent,
  workspaceConnection,
  workspaceConnectionGrant,
} from "./schema";
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
    definition: row.definition,
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
    article."id"::text AS "id",
    article."project_environment_id"::text AS "projectEnvironmentId",
    article."environment_revision" AS "environmentRevision",
    article."connection_id"::text AS "connectionId",
    article."connection_revision" AS "connectionRevision",
    article."definition" AS "definition",
    article."owner_member_id" AS "ownerMemberId",
    article."updated_by_member_id" AS "updatedByMemberId",
    article."revision" AS "revision",
    article."latest_successful_run_id"::text AS "latestSuccessfulRunId",
    article."created_at" AS "createdAt",
    article."updated_at" AS "updatedAt"`;
}

function memberLockKey(input: {
  organizationId: string;
  authority: AnalysisArticleMutationAuthority;
}) {
  return revocationGateLockKey({
    kind: "member",
    organizationId: input.organizationId,
    memberId: input.authority.membershipId,
    userId: input.authority.userId,
  });
}

export async function commitAnalysisArticleCreate(input: {
  organizationId: string;
  article: SharedAnalysisArticleCreate;
  authority: AnalysisArticleMutationAuthority;
}): Promise<StoredAnalysisArticle | null> {
  const payload = analysisArticleVersionPayload({
    ...input.article,
    ownerMemberId: input.authority.membershipId,
  });
  const requestId = crypto.randomUUID();
  const result = await db.execute<RawRow>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${memberLockKey(input)}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id", member."role"
      FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
        ON member."id" = ${input.authority.membershipId}
       AND member."organization_id" = ${input.organizationId}
       AND member."user_id" = ${input.authority.userId}
      JOIN ${knowledgeProjectEnvironment} environment
        ON environment."organization_id" = member."organization_id"
       AND environment."id" = ${input.article.projectEnvironmentId}::uuid
       AND environment."revision" = ${input.article.environmentRevision}
      JOIN ${knowledgeProject} project
        ON project."organization_id" = environment."organization_id"
       AND project."id" = environment."project_id"
       AND project."deleted_at" IS NULL
      JOIN authority_lock ON TRUE
      WHERE session."id" = ${input.authority.sessionId}
        AND session."user_id" = ${input.authority.userId}
        AND session."expires_at" > now()
        AND member."role" = ${input.authority.role}
        AND member."role" IN ('editor', 'admin', 'owner')
        AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member, project, environment
    ), connection_authority AS MATERIALIZED (
      SELECT connection."id"
      FROM ${knowledgeEnvironmentConnection} binding
      JOIN ${workspaceConnection} connection
        ON binding."organization_id" = ${input.organizationId}
       AND binding."project_environment_id" = ${input.article.projectEnvironmentId}::uuid
       AND binding."environment_revision" = ${input.article.environmentRevision}
       AND binding."connection_id" = ${input.article.connectionId}::uuid
       AND binding."revoked_at" IS NULL
       AND connection."organization_id" = binding."organization_id"
       AND connection."id" = binding."connection_id"
       AND connection."revision" = binding."connection_revision"
       AND connection."content_revision" = ${input.article.connectionRevision}
       AND connection."deleted_at" IS NULL
       AND connection."revocation_pending_at" IS NULL
      JOIN ${workspaceConnectionGrant} connection_grant
        ON connection_grant."organization_id" = connection."organization_id"
       AND connection_grant."connection_id" = connection."id"
       AND connection_grant."member_id" = ${input.authority.membershipId}
       AND connection_grant."capability" IN ('use', 'manage')
      JOIN authority ON TRUE
      FOR UPDATE OF binding, connection, connection_grant
    ), inserted AS MATERIALIZED (
      INSERT INTO ${workspaceAnalysisArticle} AS inserted_article
        ("id", "organization_id", "project_environment_id", "environment_revision",
         "connection_id", "connection_revision", "definition", "owner_member_id",
         "updated_by_member_id", "revision")
      SELECT ${input.article.id}::uuid, ${input.organizationId},
        ${input.article.projectEnvironmentId}::uuid, ${input.article.environmentRevision},
        ${input.article.connectionId}::uuid, ${input.article.connectionRevision},
        ${JSON.stringify(input.article.definition)}::jsonb, authority."id",
        authority."id", 1
      FROM authority
      WHERE (SELECT count(*) FROM connection_authority) = 1
      RETURNING inserted_article.*
    ), revision AS MATERIALIZED (
      INSERT INTO ${workspaceAnalysisArticleRevision}
        ("organization_id", "article_id", "revision", "base_revision", "operation",
         "payload", "payload_hash", "created_by_user_id", "created_by_member_id")
      SELECT ${input.organizationId}, inserted."id", 1, 0, 'create',
        ${JSON.stringify(payload)}::jsonb, ${canonicalHash(payload)},
        ${input.authority.userId}, ${input.authority.membershipId}
      FROM inserted
      RETURNING "article_id"
    ), audit AS MATERIALIZED (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_article.create',
        'analysis_article', inserted."id"::text,
        jsonb_build_object(
          'environmentId', inserted."project_environment_id",
          'environmentRevision', inserted."environment_revision",
          'connectionId', inserted."connection_id",
          'queryCount', 1,
          'revision', 1
        ), ${requestId}::uuid
      FROM inserted JOIN revision ON revision."article_id" = inserted."id"
      RETURNING "resource_id"
    )
    SELECT ${articleColumns()}
    FROM inserted article
    JOIN audit ON audit."resource_id" = article."id"::text
  `);
  return returnedAnalysisArticle(result.rows[0]);
}

export type AnalysisArticleMutationOperation =
  | "propose"
  | "update";

export async function commitAnalysisArticleMutation(input: {
  organizationId: string;
  article: SharedAnalysisArticleCreate;
  expectedRevision: number;
  ownerMemberId: string;
  authority: AnalysisArticleMutationAuthority;
  operation: AnalysisArticleMutationOperation;
}): Promise<StoredAnalysisArticle | null> {
  const payload = analysisArticleVersionPayload({
    ...input.article,
    ownerMemberId: input.ownerMemberId,
  });
  const requestId = crypto.randomUUID();
  const result = await db.execute<RawRow>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${memberLockKey(input)}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id", member."role"
      FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
        ON member."id" = ${input.authority.membershipId}
       AND member."organization_id" = ${input.organizationId}
       AND member."user_id" = ${input.authority.userId}
      JOIN ${knowledgeProjectEnvironment} environment
        ON environment."organization_id" = member."organization_id"
       AND environment."id" = ${input.article.projectEnvironmentId}::uuid
       AND environment."revision" = ${input.article.environmentRevision}
      JOIN ${knowledgeProject} project
        ON project."organization_id" = environment."organization_id"
       AND project."id" = environment."project_id"
       AND project."deleted_at" IS NULL
      JOIN authority_lock ON TRUE
      WHERE session."id" = ${input.authority.sessionId}
        AND session."user_id" = ${input.authority.userId}
        AND session."expires_at" > now()
        AND member."role" = ${input.authority.role}
        AND member."role" IN ('editor', 'admin', 'owner')
        AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member, project, environment
    ), target_owner AS MATERIALIZED (
      SELECT owner."id"
      FROM "workspace_control"."member" owner
      JOIN authority ON TRUE
      WHERE owner."organization_id" = ${input.organizationId}
        AND owner."id" = ${input.ownerMemberId}
        AND owner."role" IN ('editor', 'admin', 'owner')
        AND owner."revocation_pending_at" IS NULL
        AND owner."revocation_claim_id" IS NULL
      FOR UPDATE OF owner
    ), current AS MATERIALIZED (
      SELECT article."id", article."organization_id"
      FROM ${workspaceAnalysisArticle} article
      JOIN authority ON TRUE
      JOIN target_owner ON TRUE
      WHERE article."organization_id" = ${input.organizationId}
        AND article."id" = ${input.article.id}::uuid
        AND article."project_environment_id" = ${input.article.projectEnvironmentId}::uuid
        AND article."revision" = ${input.expectedRevision}
        AND article."deleted_at" IS NULL
        AND (article."owner_member_id" = authority."id" OR authority."role" IN ('admin', 'owner'))
      FOR UPDATE OF article
    ), connection_authority AS MATERIALIZED (
      SELECT connection."id"
      FROM ${knowledgeEnvironmentConnection} binding
      JOIN ${workspaceConnection} connection
        ON binding."organization_id" = ${input.organizationId}
       AND binding."project_environment_id" = ${input.article.projectEnvironmentId}::uuid
       AND binding."environment_revision" = ${input.article.environmentRevision}
       AND binding."connection_id" = ${input.article.connectionId}::uuid
       AND binding."revoked_at" IS NULL
       AND connection."organization_id" = binding."organization_id"
       AND connection."id" = binding."connection_id"
       AND connection."revision" = binding."connection_revision"
       AND connection."content_revision" = ${input.article.connectionRevision}
       AND connection."deleted_at" IS NULL AND connection."revocation_pending_at" IS NULL
      JOIN ${workspaceConnectionGrant} connection_grant
        ON connection_grant."organization_id" = connection."organization_id"
       AND connection_grant."connection_id" = connection."id"
       AND connection_grant."member_id" = ${input.authority.membershipId}
       AND connection_grant."capability" IN ('use', 'manage')
      JOIN current ON TRUE
      FOR UPDATE OF binding, connection, connection_grant
    ), updated AS MATERIALIZED (
      UPDATE ${workspaceAnalysisArticle} article
      SET "project_environment_id" = ${input.article.projectEnvironmentId}::uuid,
        "environment_revision" = ${input.article.environmentRevision},
        "connection_id" = ${input.article.connectionId}::uuid,
        "connection_revision" = ${input.article.connectionRevision},
        "definition" = ${JSON.stringify(input.article.definition)}::jsonb,
        "owner_member_id" = ${input.ownerMemberId},
        "updated_by_member_id" = ${input.authority.membershipId},
        "revision" = article."revision" + 1, "updated_at" = now(),
        -- Every mutation creates a new immutable Article revision. A run from
        -- the previous revision must never authorize a public HTML publication.
        "latest_successful_run_id" = NULL,
        "deleted_at" = NULL
      FROM current
      WHERE article."organization_id" = current."organization_id"
        AND article."id" = current."id"
        AND (SELECT count(*) FROM connection_authority) = 1
      RETURNING article.*
    ), revision AS MATERIALIZED (
      INSERT INTO ${workspaceAnalysisArticleRevision}
        ("organization_id", "article_id", "revision", "base_revision", "operation",
         "payload", "payload_hash", "created_by_user_id", "created_by_member_id")
      SELECT ${input.organizationId}, updated."id", updated."revision", ${input.expectedRevision},
        ${input.operation}, ${JSON.stringify(payload)}::jsonb, ${canonicalHash(payload)},
        ${input.authority.userId}, ${input.authority.membershipId}
      FROM updated
      RETURNING "article_id"
    ), audit AS MATERIALIZED (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${input.organizationId}, ${input.authority.userId},
        ${`analysis_article.${input.operation}`}, 'analysis_article', updated."id"::text,
        jsonb_build_object(
          'environmentId', updated."project_environment_id",
          'revision', updated."revision",
          'ownerMemberId', updated."owner_member_id",
          'connectionId', updated."connection_id"
        ), ${requestId}::uuid
      FROM updated JOIN revision ON revision."article_id" = updated."id"
      RETURNING "resource_id"
    )
    SELECT ${articleColumns()}
    FROM updated article
    JOIN audit ON audit."resource_id" = article."id"::text
  `);
  const article = returnedAnalysisArticle(result.rows[0]);
  if (article && article.revision !== input.expectedRevision + 1) {
    throw new Error("Analysis Article revision did not advance exactly once");
  }
  return article;
}

/**
 * Deletion is a workspace cleanup action, not a database execution. It keeps
 * optimistic Article ownership and session checks atomic while deliberately
 * avoiding Environment, connection, Knowledge, mapping, and runner authority.
 * Otherwise a revoked source could make an orphaned Article
 * impossible for its owner or a workspace administrator to remove.
 */
export async function commitAnalysisArticleDelete(input: {
  organizationId: string;
  article: SharedAnalysisArticleCreate;
  expectedRevision: number;
  ownerMemberId: string;
  authority: AnalysisArticleMutationAuthority;
}): Promise<StoredAnalysisArticle | null> {
  const payload = analysisArticleVersionPayload({
    ...input.article,
    ownerMemberId: input.ownerMemberId,
    deleted: true,
  });
  const requestId = crypto.randomUUID();
  const result = await db.execute<RawRow>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${memberLockKey(input)}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id", member."role"
      FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
        ON member."id" = ${input.authority.membershipId}
       AND member."organization_id" = ${input.organizationId}
       AND member."user_id" = ${input.authority.userId}
      JOIN authority_lock ON TRUE
      WHERE session."id" = ${input.authority.sessionId}
        AND session."user_id" = ${input.authority.userId}
        AND session."expires_at" > now()
        AND member."role" = ${input.authority.role}
        AND member."role" IN ('editor', 'admin', 'owner')
        AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member
    ), current AS MATERIALIZED (
      SELECT article."id", article."organization_id"
      FROM ${workspaceAnalysisArticle} article
      JOIN authority ON TRUE
      WHERE article."organization_id" = ${input.organizationId}
        AND article."id" = ${input.article.id}::uuid
        AND article."project_environment_id" = ${input.article.projectEnvironmentId}::uuid
        AND article."environment_revision" = ${input.article.environmentRevision}
        AND article."owner_member_id" = ${input.ownerMemberId}
        AND article."revision" = ${input.expectedRevision}
        AND article."deleted_at" IS NULL
        AND (article."owner_member_id" = authority."id"
          OR authority."role" IN ('admin', 'owner'))
      FOR UPDATE OF article
    ), updated AS MATERIALIZED (
      UPDATE ${workspaceAnalysisArticle} article
      SET "updated_by_member_id" = authority."id",
        "revision" = article."revision" + 1,
        "latest_successful_run_id" = NULL,
        "deleted_at" = now(),
        "updated_at" = now()
      FROM current CROSS JOIN authority
      WHERE article."organization_id" = current."organization_id"
        AND article."id" = current."id"
      RETURNING article.*
    ), revision AS MATERIALIZED (
      INSERT INTO ${workspaceAnalysisArticleRevision}
        ("organization_id", "article_id", "revision", "base_revision", "operation",
         "payload", "payload_hash", "created_by_user_id", "created_by_member_id")
      SELECT ${input.organizationId}, updated."id", updated."revision", ${input.expectedRevision},
        'delete', ${JSON.stringify(payload)}::jsonb, ${canonicalHash(payload)},
        ${input.authority.userId}, authority."id"
      FROM updated CROSS JOIN authority
      RETURNING "article_id"
    ), audit AS MATERIALIZED (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_article.delete',
        'analysis_article', updated."id"::text,
        jsonb_build_object(
          'environmentId', updated."project_environment_id",
          'revision', updated."revision",
          'ownerMemberId', updated."owner_member_id"
        ), ${requestId}::uuid
      FROM updated JOIN revision ON revision."article_id" = updated."id"
      RETURNING "resource_id"
    )
    SELECT ${articleColumns()}
    FROM updated article
    JOIN audit ON audit."resource_id" = article."id"::text
  `);
  const article = returnedAnalysisArticle(result.rows[0]);
  if (article && article.revision !== input.expectedRevision + 1) {
    throw new Error("Analysis Article deletion revision did not advance exactly once");
  }
  return article;
}
