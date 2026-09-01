// Per-template grant administration. Workspace membership is necessary but never
// sufficient for target-database access; every mutation rechecks the live grant.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../../../../../../../lib/db";
import { env } from "../../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../../../lib/http";
import { revokeActiveLeases } from "../../../../../../../../lib/provider-integrations";
import {
  claimRevocationGate,
  clearRevocationGate,
  releaseRevocationGateClaim,
  renewRevocationGateClaim,
  revocationGateLockKey,
} from "../../../../../../../../lib/revocation-gates";
import {
  member,
  user,
  workspaceConnectionGrant,
} from "../../../../../../../../lib/schema";
import { authorizeWorkspaceConnection } from "../../../../../../../../lib/workspace-authorization";

type RouteContext = { params: Promise<{ workspaceId: string; connectionId: string }> };
type GrantCapability = "view" | "use" | "manage";

function validMemberId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

async function liveManageGrant(request: Request, workspaceId: string, connectionId: string) {
  return authorizeWorkspaceConnection(request, workspaceId, connectionId, "manage");
}

function memberGateKey(workspaceId: string, userId: string, memberId: string) {
  return revocationGateLockKey({
    kind: "member",
    organizationId: workspaceId,
    userId,
    memberId,
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) {
    return jsonError("Invalid workspace or connection id", 400);
  }
  const authorization = await liveManageGrant(request, workspaceId, connectionId);
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const grants = await db.select({
    memberId: member.id,
    userId: member.userId,
    name: user.name,
    email: user.email,
    role: member.role,
    capability: workspaceConnectionGrant.capability,
  }).from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      workspaceConnectionGrant,
      and(
        eq(workspaceConnectionGrant.organizationId, member.organizationId),
        eq(workspaceConnectionGrant.connectionId, connectionId),
        eq(workspaceConnectionGrant.memberId, member.id),
      ),
    )
    .where(and(
      eq(member.organizationId, workspaceId),
      isNull(member.revocationPendingAt),
      isNull(member.revocationClaimId),
    ))
    .orderBy(asc(user.name), asc(user.email));
  return privateJson({
    workspaceId,
    connectionId,
    actorMemberId: authorization.membership.id,
    grants,
  });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) return jsonError("Invalid workspace or connection id", 400);
  const parsed = await boundedJsonBody(request, 1_024);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large" ? "Connection grant is too large" : "Invalid connection grant",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as { memberId?: unknown; capability?: unknown } | null;
  if (!validMemberId(body?.memberId)
    || typeof body?.capability !== "string"
    || !["view", "use", "manage"].includes(body.capability)) {
    return jsonError("Invalid connection grant", 400);
  }
  const authorization = await liveManageGrant(request, workspaceId, connectionId);
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const capability = body.capability as GrantCapability;
  if (
    body.memberId === authorization.membership.id
    && capability !== "manage"
  ) {
    return jsonError("A manager cannot reduce their own connection grant", 409);
  }
  const result = await db.execute<{ capability: GrantCapability }>(sql`
    WITH lock_keys AS MATERIALIZED (
      SELECT ${memberGateKey(
        workspaceId,
        authorization.session.user.id,
        authorization.membership.id,
      )} AS lock_key
      UNION
      SELECT concat('member:', ${workspaceId}::text, ':', member."user_id")
      FROM "workspace_control"."member" member
      WHERE member."organization_id" = ${workspaceId} AND member."id" = ${body.memberId}
    ), locks AS MATERIALIZED (
      SELECT count(*) AS lock_count FROM (
        SELECT pg_advisory_xact_lock(hashtextextended(lock_key, 0))
        FROM (SELECT lock_key FROM lock_keys ORDER BY lock_key) ordered_locks
      ) acquired_locks
    ), actor AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
        ON member."id" = ${authorization.membership.id} AND member."organization_id" = ${workspaceId}
        AND member."user_id" = ${authorization.session.user.id}
      JOIN "workspace_control"."workspace_connection_grant" manager_grant
        ON manager_grant."organization_id" = ${workspaceId} AND manager_grant."connection_id" = ${connectionId}::uuid
        AND manager_grant."member_id" = member."id" AND manager_grant."capability" = 'manage'
      JOIN locks ON TRUE
      WHERE session."id" = ${authorization.session.session.id} AND session."user_id" = ${authorization.session.user.id}
        AND session."expires_at" > now() AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member, manager_grant
    ), target AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."member" member
      JOIN actor ON TRUE
      WHERE member."organization_id" = ${workspaceId} AND member."id" = ${body.memberId}
        AND member."revocation_pending_at" IS NULL AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF member
    ), granted AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_connection_grant"
        ("organization_id", "connection_id", "member_id", "capability")
      SELECT ${workspaceId}, ${connectionId}::uuid, target."id", ${capability} FROM target
      ON CONFLICT ("organization_id", "connection_id", "member_id")
      DO UPDATE SET "capability" = EXCLUDED."capability", "updated_at" = now()
      RETURNING "capability"
    ), audit AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_audit_event"
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id", "redacted_summary", "request_id")
      SELECT ${workspaceId}, ${authorization.session.user.id}, 'connection.grant.update', 'connection', ${connectionId},
        jsonb_build_object('memberId', ${body.memberId}, 'capability', granted."capability"), ${crypto.randomUUID()}::uuid
      FROM granted
      RETURNING "resource_id"
    ) SELECT "capability" FROM granted JOIN audit ON TRUE
  `);
  if (!result.rows[0]) return jsonError("Connection grant changed concurrently. Retry.", 409);
  return privateJson({ memberId: body.memberId, capability: result.rows[0].capability });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, connectionId } = await context.params;
  const memberId = new URL(request.url).searchParams.get("memberId");
  if (!isUuid(workspaceId) || !isUuid(connectionId) || !validMemberId(memberId)) {
    return jsonError("Invalid workspace, connection, or member id", 400);
  }
  const authorization = await liveManageGrant(request, workspaceId, connectionId);
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (memberId === authorization.membership.id) return jsonError("A manager cannot remove their own connection grant", 409);
  const target = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, workspaceId),
      eq(member.id, memberId),
      isNull(member.revocationPendingAt),
      isNull(member.revocationClaimId),
    ),
    columns: { id: true, userId: true },
  });
  if (!target) return jsonError("Connection grant changed concurrently. Retry.", 409);
  const claim = await claimRevocationGate({
    kind: "member",
    organizationId: workspaceId,
    memberId: target.id,
    userId: target.userId,
  });
  if (!claim) return jsonError("Connection grant changed concurrently. Retry.", 409);
  if (!claim.firstPending) {
    await releaseRevocationGateClaim(claim).catch(() => false);
    return jsonError("Another membership access change is already in progress", 409);
  }
  try {
    const revocation = await revokeActiveLeases({
      organizationId: workspaceId,
      connectionId,
      userId: target.userId,
    });
    if (revocation.deferred > 0) {
      await renewRevocationGateClaim(claim).catch(() => null);
      return jsonError("Active database access could not be revoked. Retry grant removal.", 409);
    }
  } catch (error) {
    await clearRevocationGate(claim).catch(() => false);
    throw error;
  }
  let result: { rows: { memberId: string }[] };
  try {
    result = await db.execute<{ memberId: string }>(sql`
    WITH lock_keys AS MATERIALIZED (
      SELECT ${memberGateKey(
        workspaceId,
        authorization.session.user.id,
        authorization.membership.id,
      )} AS lock_key
      UNION
      SELECT ${memberGateKey(workspaceId, target.userId, target.id)}
    ), locks AS MATERIALIZED (
      SELECT count(*) AS lock_count FROM (
        SELECT pg_advisory_xact_lock(hashtextextended(lock_key, 0))
        FROM (SELECT lock_key FROM lock_keys ORDER BY lock_key) ordered_locks
      ) acquired_locks
    ), actor AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member ON member."id" = ${authorization.membership.id}
        AND member."organization_id" = ${workspaceId} AND member."user_id" = ${authorization.session.user.id}
      JOIN "workspace_control"."workspace_connection_grant" manager_grant ON manager_grant."organization_id" = ${workspaceId}
        AND manager_grant."connection_id" = ${connectionId}::uuid AND manager_grant."member_id" = member."id" AND manager_grant."capability" = 'manage'
      JOIN locks ON TRUE
      WHERE session."id" = ${authorization.session.session.id} AND session."user_id" = ${authorization.session.user.id}
        AND session."expires_at" > now() AND member."revocation_pending_at" IS NULL AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member, manager_grant
    ), target AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."member" member
      JOIN actor ON TRUE
      WHERE member."organization_id" = ${workspaceId} AND member."id" = ${target.id}
        AND member."revocation_pending_at" IS NOT NULL
        AND member."revocation_claim_id" = ${claim.claimId}::uuid
      FOR UPDATE OF member
    ), revoked AS MATERIALIZED (
      DELETE FROM "workspace_control"."workspace_connection_grant" target_grant
      USING actor, target
      WHERE target_grant."organization_id" = ${workspaceId} AND target_grant."connection_id" = ${connectionId}::uuid
        AND target_grant."member_id" = target."id"
      RETURNING target_grant."member_id" AS "memberId"
    ), audit AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_audit_event"
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id", "redacted_summary", "request_id")
      SELECT ${workspaceId}, ${authorization.session.user.id}, 'connection.grant.revoke', 'connection', ${connectionId},
        jsonb_build_object('memberId', revoked."memberId"), ${crypto.randomUUID()}::uuid FROM revoked
      RETURNING "resource_id"
    ) SELECT "memberId" FROM revoked JOIN audit ON TRUE
    `);
  } catch (error) {
    await clearRevocationGate(claim).catch(() => false);
    throw error;
  }
  if (!result.rows[0]) {
    await clearRevocationGate(claim).catch(() => false);
    return jsonError("Connection grant changed concurrently. Retry.", 409);
  }
  await clearRevocationGate(claim).catch(() => false);
  return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
}
