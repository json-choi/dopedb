// Per-template grant administration. Workspace membership is necessary but never
// sufficient for target-database access; every mutation rechecks the live grant.
import { and, asc, eq, isNull } from "drizzle-orm";
import { increaseConnectionGrant, removeConnectionGrant } from "../../../../../../../../lib/workspace-grant-store";
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
} from "../../../../../../../../lib/revocation-gates";
import {
  member,
  user,
  workspaceConnectionGrant,
} from "../../../../../../../../lib/schema";
import { authorizeWorkspaceConnection } from "../../../../../../../../lib/workspace-authorization";

type RouteContext = { params: Promise<{ workspaceId: string; connectionId: string }> };
type GrantCapability = "view" | "read" | "use" | "manage";

function validMemberId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

async function liveManageGrant(request: Request, workspaceId: string, connectionId: string) {
  return authorizeWorkspaceConnection(request, workspaceId, connectionId, "manage");
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
    || !["view", "read", "use", "manage"].includes(body.capability)) {
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
  const result = { rows: await increaseConnectionGrant({ organizationId: workspaceId, connectionId, memberId: body.memberId, capability,
    authority: { sessionId: authorization.session.session.id, userId: authorization.session.user.id,
      membershipId: authorization.membership.id, role: authorization.role },
  }) };
  if (!result.rows[0]) return jsonError("Access changed or needs a lower level. Remove the current grant before granting less access.", 409);
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
    result = { rows: await removeConnectionGrant({ organizationId: workspaceId, connectionId, memberId: target.id,
      userId: target.userId, claimId: claim.claimId,
      authority: { sessionId: authorization.session.session.id, userId: authorization.session.user.id,
        membershipId: authorization.membership.id, role: authorization.role },
    }) };
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
