// Authenticated Article handoff and email-bound invitation administration.
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../../lib/db";
import { env } from "../../lib/env";

export type SharingIdentity = { userId: string; sessionId: string };
export type SharingScope = { workspaceId: string; articleId: string };
export type ArticleInvitation = {
  id: string; recipientEmail: string; expiresAt: string;
  acceptedAt: string | null; revokedAt: string | null;
};
export type ArticleSharing = {
  workspaceId: string; articleId: string; projectEnvironmentId: string;
  title: string; workspaceName: string; connectionName: string; credentialMode: string;
  canInvite: boolean; url: string; invitations: ArticleInvitation[];
};

export function articlePath(scope: SharingScope) {
  return `/open-article/${scope.workspaceId}/${scope.articleId}`;
}
export function invitationUrl(id: string) {
  return `${env.appOrigin()}/article-invitations/${id}`;
}

// Sharing is pinned to the current Project binding and public connection revision.
// The browser receives titles and handoff identity only, never a definition or rows.
export function liveArticleSql(scope: SharingScope, lock = false) {
  return sql`
    SELECT article."id" AS "articleId", article."organization_id" AS "workspaceId",
      article."project_environment_id" AS "projectEnvironmentId",
      article."connection_id" AS "connectionId", article."connection_revision" AS "connectionRevision",
      article."definition"->>'title' AS "title", organization."name" AS "workspaceName",
      connection."name" AS "connectionName", connection."credential_mode" AS "credentialMode"
    FROM "workspace_control"."workspace_analysis_article" article
    JOIN "workspace_control"."organization" organization ON organization."id" = article."organization_id"
    JOIN "workspace_control"."workspace_profile" profile
      ON profile."organization_id" = article."organization_id" AND profile."lifecycle_state" = 'active'
    JOIN "workspace_control"."knowledge_project_environment" environment
      ON environment."organization_id" = article."organization_id"
      AND environment."id" = article."project_environment_id" AND environment."revision" = article."environment_revision"
    JOIN "workspace_control"."knowledge_project" project
      ON project."organization_id" = environment."organization_id" AND project."id" = environment."project_id"
      AND project."deleted_at" IS NULL
    JOIN "workspace_control"."knowledge_environment_connection" binding
      ON binding."organization_id" = article."organization_id"
      AND binding."project_environment_id" = article."project_environment_id"
      AND binding."environment_revision" = article."environment_revision"
      AND binding."connection_id" = article."connection_id" AND binding."revoked_at" IS NULL
    JOIN "workspace_control"."workspace_connection" connection
      ON connection."organization_id" = article."organization_id" AND connection."id" = article."connection_id"
      AND connection."content_revision" = article."connection_revision"
      AND connection."content_revision" = binding."connection_revision"
      AND connection."deleted_at" IS NULL AND connection."revocation_pending_at" IS NULL
      AND connection."revocation_claim_id" IS NULL
    WHERE article."organization_id" = ${scope.workspaceId} AND article."id" = ${scope.articleId}::uuid
      AND article."deleted_at" IS NULL
    ${lock ? sql`FOR UPDATE OF article, profile, environment, project, binding, connection` : sql``}
  `;
}

function actorSql(scope: SharingScope, identity: SharingIdentity, manage: boolean) {
  return sql`
    SELECT member."id", member."role", grant_row."capability" FROM resource
    JOIN "workspace_control"."session" session ON session."id" = ${identity.sessionId}
      AND session."user_id" = ${identity.userId} AND session."expires_at" > now()
    JOIN "workspace_control"."member" member ON member."organization_id" = ${scope.workspaceId}
      AND member."user_id" = session."user_id" AND member."revocation_pending_at" IS NULL
      AND member."revocation_claim_id" IS NULL AND member."role" IN ('viewer', 'analyst', 'editor', 'admin', 'owner')
    JOIN "workspace_control"."workspace_connection_grant" grant_row
      ON grant_row."organization_id" = ${scope.workspaceId} AND grant_row."member_id" = member."id"
      AND grant_row."connection_id" = resource."connectionId"
    ${manage ? sql`WHERE member."role" IN ('admin', 'owner') AND grant_row."capability" = 'manage'
      FOR UPDATE OF session, member, grant_row` : sql``}
  `;
}

export async function loadArticleSharing(scope: SharingScope, identity: SharingIdentity): Promise<ArticleSharing | null> {
  const result = await db.execute<Omit<ArticleSharing, "url">>(sql`
    WITH resource AS MATERIALIZED (${liveArticleSql(scope)}), actor AS MATERIALIZED (${actorSql(scope, identity, false)})
    SELECT resource."workspaceId", resource."articleId", resource."projectEnvironmentId", resource."title",
      resource."workspaceName", resource."connectionName", resource."credentialMode",
      (actor."role" IN ('admin', 'owner') AND actor."capability" = 'manage') AS "canInvite",
      CASE WHEN actor."role" IN ('admin', 'owner') AND actor."capability" = 'manage' THEN (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', invitation."id", 'recipientEmail', invitation."recipient_email",
          'expiresAt', to_char(invitation."expires_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'acceptedAt', to_char(invitation."accepted_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'revokedAt', to_char(invitation."revoked_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ) ORDER BY invitation."created_at" DESC), '[]'::jsonb)
        FROM (SELECT * FROM "workspace_control"."workspace_article_invitation"
          WHERE "organization_id" = ${scope.workspaceId} AND "article_id" = ${scope.articleId}::uuid
          ORDER BY "created_at" DESC LIMIT 50) invitation
      ) ELSE '[]'::jsonb END AS "invitations"
    FROM resource JOIN actor ON TRUE
  `);
  const sharing = result.rows[0];
  if (!sharing) return null;
  return { ...sharing, url: `${env.appOrigin()}${articlePath(scope)}` };
}

export function parseInvitationEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}

export async function createArticleInvitation(scope: SharingScope, identity: SharingIdentity, email: string) {
  const result = await db.execute<{ id: string }>(sql`
    WITH member_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${`member:${scope.workspaceId}:${identity.userId}`}, 0))
    ), resource AS MATERIALIZED (
      SELECT live.* FROM member_lock CROSS JOIN LATERAL (${liveArticleSql(scope, true)}) live
    ), actor AS MATERIALIZED (${actorSql(scope, identity, true)}), created AS (
      INSERT INTO "workspace_control"."workspace_article_invitation"
        ("organization_id", "article_id", "connection_id", "connection_revision", "inviter_member_id", "recipient_email", "expires_at")
      SELECT ${scope.workspaceId}, ${scope.articleId}::uuid, resource."connectionId", resource."connectionRevision",
        actor."id", ${email}, now() + interval '48 hours' FROM resource JOIN actor ON TRUE
      WHERE (SELECT count(*) FROM "workspace_control"."workspace_article_invitation"
        WHERE "organization_id" = ${scope.workspaceId} AND "article_id" = ${scope.articleId}::uuid
          AND "accepted_at" IS NULL AND "revoked_at" IS NULL AND "expires_at" > now()) < 50
      RETURNING "id"
    ), audit AS (
      INSERT INTO "workspace_control"."workspace_audit_event"
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id", "redacted_summary", "request_id")
      SELECT ${scope.workspaceId}, ${identity.userId}, 'analysis.invitation.create', 'analysisArticle', ${scope.articleId},
        jsonb_build_object('invitationId', created."id", 'capability', 'read'), gen_random_uuid() FROM created
      RETURNING "id"
    ) SELECT created."id" FROM created JOIN audit ON TRUE
  `);
  const created = result.rows[0];
  return created ? { id: created.id, url: invitationUrl(created.id) } : null;
}

export async function revokeArticleInvitation(scope: SharingScope, identity: SharingIdentity, id: string) {
  const result = await db.execute<{ id: string }>(sql`
    WITH resource AS MATERIALIZED (${liveArticleSql(scope, true)}), actor AS MATERIALIZED (${actorSql(scope, identity, true)}), revoked AS (
      UPDATE "workspace_control"."workspace_article_invitation" invitation SET "revoked_at" = now()
      FROM actor WHERE invitation."organization_id" = ${scope.workspaceId} AND invitation."article_id" = ${scope.articleId}::uuid
        AND invitation."id" = ${id}::uuid AND invitation."accepted_at" IS NULL
      RETURNING invitation."id"
    ), audit AS (
      INSERT INTO "workspace_control"."workspace_audit_event"
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id", "redacted_summary", "request_id")
      SELECT ${scope.workspaceId}, ${identity.userId}, 'analysis.invitation.revoke', 'analysisArticle', ${scope.articleId},
        jsonb_build_object('invitationId', revoked."id"), gen_random_uuid() FROM revoked RETURNING "id"
    ) SELECT revoked."id" FROM revoked JOIN audit ON TRUE
  `);
  return result.rows[0] ?? null;
}
