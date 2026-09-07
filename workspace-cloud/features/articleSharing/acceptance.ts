// One durable statement accepts an exact-email invitation and grants DB read access.
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../../lib/db";
import { articlePath, liveArticleSql, loadArticleSharing, type SharingIdentity } from "./store";

type InvitationIdentity = {
  id: string; workspaceId: string; articleId: string; inviterUserId: string;
  acceptedAt: string | null; acceptedByUserId: string | null;
};

async function invitationForRecipient(id: string, identity: SharingIdentity) {
  const result = await db.execute<InvitationIdentity>(sql`
    SELECT invitation."id", invitation."organization_id" AS "workspaceId", invitation."article_id" AS "articleId",
      inviter."user_id" AS "inviterUserId", invitation."accepted_at"::text AS "acceptedAt",
      invitation."accepted_by_user_id" AS "acceptedByUserId"
    FROM "workspace_control"."workspace_article_invitation" invitation
    JOIN "workspace_control"."session" session ON session."id" = ${identity.sessionId}
      AND session."user_id" = ${identity.userId} AND session."expires_at" > now()
    JOIN "workspace_control"."user" recipient ON recipient."id" = session."user_id"
      AND recipient."email_verified" AND lower(recipient."email") = invitation."recipient_email"
    JOIN "workspace_control"."member" inviter ON inviter."organization_id" = invitation."organization_id"
      AND inviter."id" = invitation."inviter_member_id" AND inviter."revocation_pending_at" IS NULL
      AND inviter."revocation_claim_id" IS NULL AND inviter."role" IN ('admin', 'owner')
    JOIN "workspace_control"."workspace_connection_grant" manager_grant
      ON manager_grant."organization_id" = invitation."organization_id"
      AND manager_grant."connection_id" = invitation."connection_id"
      AND manager_grant."member_id" = inviter."id" AND manager_grant."capability" = 'manage'
    WHERE invitation."id" = ${id}::uuid AND invitation."revoked_at" IS NULL
      AND (invitation."expires_at" > now() OR invitation."accepted_by_user_id" = ${identity.userId})
  `);
  return result.rows[0] ?? null;
}

export async function inspectArticleInvitation(id: string, identity: SharingIdentity) {
  const invitation = await invitationForRecipient(id, identity);
  if (!invitation) return null;
  if (invitation.acceptedAt) {
    const access = await loadArticleSharing(invitation, identity);
    return access && invitation.acceptedByUserId === identity.userId
      ? { title: access.title, workspaceName: access.workspaceName, connectionName: access.connectionName,
        credentialMode: access.credentialMode, accepted: true, path: articlePath(invitation) }
      : null;
  }
  const result = await db.execute<{
    title: string; workspaceName: string; connectionName: string; credentialMode: string;
  }>(sql`
    WITH resource AS (${liveArticleSql(invitation)})
    SELECT resource."title", resource."workspaceName", resource."connectionName", resource."credentialMode"
    FROM resource JOIN "workspace_control"."workspace_article_invitation" invitation
      ON invitation."id" = ${id}::uuid AND invitation."connection_id" = resource."connectionId"
      AND invitation."connection_revision" = resource."connectionRevision"
  `);
  const resource = result.rows[0];
  return resource ? { ...resource, accepted: false, path: articlePath(invitation) } : null;
}

export async function acceptArticleInvitation(id: string, identity: SharingIdentity) {
  const invitation = await invitationForRecipient(id, identity);
  if (!invitation) return null;
  // A consumed invitation is a receipt. It must never recreate removed membership or grants.
  if (invitation.acceptedAt) {
    const current = await inspectArticleInvitation(id, identity);
    return current?.accepted ? { path: current.path } : null;
  }
  const result = await db.execute<{ id: string }>(sql`
    WITH lock_keys AS MATERIALIZED (
      SELECT ${`member:${invitation.workspaceId}:${identity.userId}`} AS lock_key
      UNION SELECT ${`member:${invitation.workspaceId}:${invitation.inviterUserId}`}
    ), locks AS MATERIALIZED (
      SELECT count(*) FROM (
        SELECT pg_advisory_xact_lock(hashtextextended(lock_key, 0))
        FROM (SELECT lock_key FROM lock_keys ORDER BY lock_key) ordered_keys
      ) acquired
    ), resource AS MATERIALIZED (
      SELECT live.* FROM locks CROSS JOIN LATERAL (${liveArticleSql(invitation, true)}) live
    ), authority AS MATERIALIZED (
      SELECT invitation."id", recipient."id" AS "userId", resource."connectionId"
      FROM resource JOIN "workspace_control"."workspace_article_invitation" invitation
        ON invitation."organization_id" = resource."workspaceId" AND invitation."article_id" = resource."articleId"
        AND invitation."connection_id" = resource."connectionId" AND invitation."connection_revision" = resource."connectionRevision"
      JOIN "workspace_control"."session" session ON session."id" = ${identity.sessionId}
        AND session."user_id" = ${identity.userId} AND session."expires_at" > now()
      JOIN "workspace_control"."user" recipient ON recipient."id" = session."user_id"
        AND recipient."email_verified" AND lower(recipient."email") = invitation."recipient_email"
      JOIN "workspace_control"."member" inviter ON inviter."organization_id" = invitation."organization_id"
        AND inviter."id" = invitation."inviter_member_id" AND inviter."user_id" = ${invitation.inviterUserId}
        AND inviter."revocation_pending_at" IS NULL AND inviter."revocation_claim_id" IS NULL
        AND inviter."role" IN ('admin', 'owner')
      JOIN "workspace_control"."workspace_connection_grant" manager_grant
        ON manager_grant."organization_id" = invitation."organization_id" AND manager_grant."member_id" = inviter."id"
        AND manager_grant."connection_id" = resource."connectionId" AND manager_grant."capability" = 'manage'
      WHERE invitation."id" = ${id}::uuid AND invitation."accepted_at" IS NULL
        AND invitation."revoked_at" IS NULL AND invitation."expires_at" > now()
        AND (EXISTS (SELECT 1 FROM "workspace_control"."member"
          WHERE "organization_id" = ${invitation.workspaceId} AND "user_id" = recipient."id")
          OR (SELECT count(*) FROM "workspace_control"."member" WHERE "organization_id" = ${invitation.workspaceId}) < 100)
      FOR UPDATE OF invitation, session, recipient, inviter, manager_grant
    ), joined AS (
      INSERT INTO "workspace_control"."member" AS target ("organization_id", "user_id", "role")
      SELECT ${invitation.workspaceId}, authority."userId", 'analyst' FROM authority
      ON CONFLICT ("organization_id", "user_id") DO UPDATE
        SET "role" = CASE WHEN target."role" = 'viewer' THEN 'analyst' ELSE target."role" END
        WHERE target."revocation_pending_at" IS NULL AND target."revocation_claim_id" IS NULL
          AND target."role" IN ('viewer', 'analyst', 'editor', 'admin', 'owner')
      RETURNING "id"
    ), granted AS (
      INSERT INTO "workspace_control"."workspace_connection_grant" AS target
        ("organization_id", "connection_id", "member_id", "capability")
      SELECT ${invitation.workspaceId}, authority."connectionId", joined."id", 'read' FROM joined JOIN authority ON TRUE
      ON CONFLICT ("organization_id", "connection_id", "member_id") DO UPDATE
        SET "capability" = CASE WHEN target."capability" = 'view' THEN 'read' ELSE target."capability" END,
          "updated_at" = now()
      RETURNING "member_id"
    ), accepted AS (
      UPDATE "workspace_control"."workspace_article_invitation" target
      SET "accepted_at" = now(), "accepted_by_user_id" = ${identity.userId}
      FROM authority JOIN granted ON TRUE WHERE target."id" = authority."id"
      RETURNING target."id"
    ), audit AS (
      INSERT INTO "workspace_control"."workspace_audit_event"
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id", "redacted_summary", "request_id")
      SELECT ${invitation.workspaceId}, ${identity.userId}, 'analysis.invitation.accept', 'analysisArticle', ${invitation.articleId},
        jsonb_build_object('invitationId', accepted."id", 'memberId', granted."member_id", 'minimumCapability', 'read'),
        gen_random_uuid() FROM accepted JOIN granted ON TRUE RETURNING "id"
    ) SELECT accepted."id" FROM accepted JOIN audit ON TRUE
  `);
  return result.rows[0] ? { path: articlePath(invitation) } : null;
}
