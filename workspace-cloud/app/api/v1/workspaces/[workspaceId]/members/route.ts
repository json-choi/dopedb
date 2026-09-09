// Admin-only membership management. Better Auth remains the source of truth for
// invitation acceptance and role changes; this route adds strict role choices and audit.
import { and, desc, eq, isNull } from "drizzle-orm";
import { auth } from "../../../../../../lib/auth";
import { changeWorkspaceMemberRole } from "../../../../../../lib/workspace-member-store";
import { db } from "../../../../../../lib/db";
import { env } from "../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../lib/http";
import { revokeActiveLeases } from "../../../../../../lib/provider-integrations";
import {
  localizedWorkspacePath,
  workspaceLocaleFromCookieHeader,
} from "../../../../../../lib/workspace-locale";
import {
  claimRevocationGate,
  clearRevocationGate,
  releaseRevocationGateClaim,
  renewRevocationGateClaim,
} from "../../../../../../lib/revocation-gates";
import {
  invitation,
  member,
  user,
  workspaceAnalysisArticle,
  workspaceAuditEvent,
} from "../../../../../../lib/schema";
import { removeMemberAfterAnalysisRunnerCleanup } from "../../../../../../lib/workspace-analysis-runner-store";
import { authorizeWorkspace } from "../../../../../../lib/workspace-authorization";

type RouteContext = { params: Promise<{ workspaceId: string }> };
const assignableRoles = ["viewer", "analyst", "editor", "admin"] as const;
type AssignableRole = (typeof assignableRoles)[number];

function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === "string" && assignableRoles.includes(value as AssignableRole);
}

async function abandonMemberClaim(
  claim: Awaited<ReturnType<typeof claimRevocationGate>>,
) {
  if (!claim) return;
  await (claim.firstPending
    ? clearRevocationGate(claim)
    : releaseRevocationGateClaim(claim)).catch(() => false);
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const [members, invitations] = await Promise.all([
    db.select({
      id: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      createdAt: member.createdAt,
    }).from(member).innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, workspaceId)).orderBy(desc(member.createdAt)),
    db.select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    }).from(invitation).where(and(
      eq(invitation.organizationId, workspaceId),
      eq(invitation.status, "pending"),
    )).orderBy(desc(invitation.createdAt)),
  ]);
  const locale = workspaceLocaleFromCookieHeader(request.headers.get("cookie"));
  return privateJson({
    workspaceId,
    members,
    invitations: invitations.map((item) => ({
      ...item,
      inviteUrl: `${env.appOrigin()}${localizedWorkspacePath(
        `/accept-invitation/${encodeURIComponent(item.id)}`,
        locale,
      )}`,
    })),
  });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const parsed = await boundedJsonBody(request, 1_024);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large" ? "Member invitation is too large" : "Invalid member invitation",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) return jsonError("Invalid email", 400);
  if (!isAssignableRole(body?.role)) return jsonError("Invalid assignable workspace role", 400);

  const created = await auth.api.createInvitation({
    headers: request.headers,
    body: { email, role: body.role, organizationId: workspaceId, resend: true },
  });
  await db.insert(workspaceAuditEvent).values({
    organizationId: workspaceId,
    actorUserId: authorization.session.user.id,
    action: "member.invite",
    resourceType: "invitation",
    resourceId: created.id,
    redactedSummary: { role: body.role, emailDomain: email.split("@")[1] },
    requestId: crypto.randomUUID(),
  });
  const locale = workspaceLocaleFromCookieHeader(request.headers.get("cookie"));
  return privateJson({
    invitation: {
      ...created,
      inviteUrl: `${env.appOrigin()}${localizedWorkspacePath(
        `/accept-invitation/${encodeURIComponent(created.id)}`,
        locale,
      )}`,
    },
  }, { status: 201 });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const parsed = await boundedJsonBody(request, 1_024);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large" ? "Member update is too large" : "Invalid member role update",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as { memberId?: unknown; role?: unknown } | null;
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  if (!isUuid(memberId) || !isAssignableRole(body?.role)) {
    return jsonError("Invalid member role update", 400);
  }
  const existing = await db.query.member.findFirst({
    where: and(eq(member.id, memberId), eq(member.organizationId, workspaceId)),
  });
  if (!existing) return jsonError("Member not found", 404);
  if (existing.id === authorization.membership.id) {
    return jsonError("Your own workspace membership cannot be changed here", 403);
  }
  const claim = await claimRevocationGate({
    kind: "member",
    organizationId: workspaceId,
    memberId,
    userId: existing.userId,
  });
  if (!claim) {
    return jsonError("Another member access change is already in progress", 409);
  }
  if (claim.kind !== "member" || !claim.memberRole) {
    await (
      claim.firstPending
        ? clearRevocationGate(claim)
        : releaseRevocationGateClaim(claim)
    ).catch(() => false);
    return jsonError("Member access changed concurrently. Retry the update.", 409);
  }
  if (claim.memberRole === "owner") {
    await (
      claim.firstPending
        ? clearRevocationGate(claim)
        : releaseRevocationGateClaim(claim)
    ).catch(() => false);
    return jsonError("Owner role cannot be changed here", 403);
  }
  const canOwnSharedContent = body.role === "editor" || body.role === "admin";
  if (!canOwnSharedContent) {
    const ownedArticle = await db.query.workspaceAnalysisArticle.findFirst({
      where: and(
        eq(workspaceAnalysisArticle.organizationId, workspaceId),
        eq(workspaceAnalysisArticle.ownerMemberId, existing.id),
        isNull(workspaceAnalysisArticle.deletedAt),
      ),
      columns: { id: true },
    });
    if (ownedArticle) {
      await abandonMemberClaim(claim);
      return jsonError(
        "Transfer this member's active Analysis Articles before changing their role",
        409,
      );
    }
  }
  let revocation = { revoked: 0, deferred: 0 };
  try {
    if (claim.memberRole !== body.role || !claim.firstPending) {
      revocation = await revokeActiveLeases({
        organizationId: workspaceId,
        userId: claim.userId,
      });
    }
  } catch (error) {
    await releaseRevocationGateClaim(claim).catch(() => false);
    throw error;
  }
  if (revocation.deferred > 0) {
    await releaseRevocationGateClaim(claim).catch(() => false);
    return jsonError(
      "Active database access could not be revoked; retry after its lease expires",
      409,
    );
  }
  const renewedClaim = await renewRevocationGateClaim(claim);
  if (!renewedClaim) {
    return jsonError("Member access changed concurrently. Retry the update.", 409);
  }
  if (
    renewedClaim.kind !== "member"
    || renewedClaim.memberRole !== claim.memberRole
  ) {
    await abandonMemberClaim(renewedClaim);
    return jsonError("Member access changed concurrently. Retry the update.", 409);
  }
  const result = { rows: await changeWorkspaceMemberRole({ organizationId: workspaceId, memberId,
    authority: { sessionId: authorization.session.session.id, userId: authorization.session.user.id,
      membershipId: authorization.membership.id, role: authorization.role },
    userId: renewedClaim.userId, claimId: renewedClaim.claimId, previousRole: renewedClaim.memberRole!, role: body.role,
    revokedLeases: revocation.revoked, deferredRevocations: revocation.deferred,
  }).catch(async (error) => {
    await abandonMemberClaim(renewedClaim);
    throw error;
  }) };
  const updated = result.rows[0];
  if (!updated) {
    await abandonMemberClaim(renewedClaim);
    return jsonError("Member access changed concurrently. Retry the update.", 409);
  }
  return privateJson({ member: updated });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const parsed = await boundedJsonBody(request, 1_024);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large" ? "Member removal is too large" : "Invalid member removal",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as {
    memberId?: unknown;
    invitationId?: unknown;
  } | null;

  if (typeof body?.invitationId === "string" && isUuid(body.invitationId)) {
    const existing = await db.query.invitation.findFirst({
      where: and(
        eq(invitation.id, body.invitationId),
        eq(invitation.organizationId, workspaceId),
        eq(invitation.status, "pending"),
      ),
    });
    if (!existing) return jsonError("Invitation not found", 404);
    await auth.api.cancelInvitation({
      headers: request.headers,
      body: { invitationId: existing.id },
    });
    await db.insert(workspaceAuditEvent).values({
      organizationId: workspaceId,
      actorUserId: authorization.session.user.id,
      action: "member.invite.cancel",
      resourceType: "invitation",
      resourceId: existing.id,
      redactedSummary: { emailDomain: existing.email.split("@")[1] },
      requestId: crypto.randomUUID(),
    });
    return privateJson({ status: true });
  }

  if (typeof body?.memberId === "string" && isUuid(body.memberId)) {
    const existing = await db.query.member.findFirst({
      where: and(eq(member.id, body.memberId), eq(member.organizationId, workspaceId)),
    });
    if (!existing) return jsonError("Member not found", 404);
    if (existing.id === authorization.membership.id) {
      return jsonError("Your own workspace membership cannot be changed here", 403);
    }
    const claim = await claimRevocationGate({
      kind: "member",
      organizationId: workspaceId,
      memberId: existing.id,
      userId: existing.userId,
    });
    if (!claim) {
      return jsonError("Another member access change is already in progress", 409);
    }
    if (claim.kind !== "member" || !claim.memberRole) {
      await (
        claim.firstPending
          ? clearRevocationGate(claim)
          : releaseRevocationGateClaim(claim)
      ).catch(() => false);
      return jsonError("Member access changed concurrently. Retry removal.", 409);
    }
    if (claim.memberRole === "owner") {
      await (
        claim.firstPending
          ? clearRevocationGate(claim)
          : releaseRevocationGateClaim(claim)
      ).catch(() => false);
      return jsonError("Owner cannot be removed", 403);
    }
    const ownedArticle = await db.query.workspaceAnalysisArticle.findFirst({
      where: and(
        eq(workspaceAnalysisArticle.organizationId, workspaceId),
        eq(workspaceAnalysisArticle.ownerMemberId, existing.id),
        isNull(workspaceAnalysisArticle.deletedAt),
      ),
      columns: { id: true },
    });
    if (ownedArticle) {
      await abandonMemberClaim(claim);
      return jsonError(
        "Delete this member's active Analysis Articles before removing them",
        409,
      );
    }
    let revocation;
    try {
      revocation = await revokeActiveLeases({
        organizationId: workspaceId,
        userId: claim.userId,
      });
    } catch (error) {
      await releaseRevocationGateClaim(claim).catch(() => false);
      throw error;
    }
    if (revocation.deferred > 0) {
      await releaseRevocationGateClaim(claim).catch(() => false);
      return jsonError(
        "Active database access could not be revoked; retry after its lease expires",
        409,
      );
    }
    const renewedClaim = await renewRevocationGateClaim(claim);
    if (!renewedClaim) {
      return jsonError("Member access changed concurrently. Retry removal.", 409);
    }
    if (
      renewedClaim.kind !== "member"
      || renewedClaim.memberRole !== claim.memberRole
    ) {
      await abandonMemberClaim(renewedClaim);
      return jsonError("Member access changed concurrently. Retry removal.", 409);
    }
    const removed = await removeMemberAfterAnalysisRunnerCleanup({
      organizationId: workspaceId,
      target: {
        memberId: existing.id,
        userId: renewedClaim.userId,
        role: renewedClaim.memberRole,
        claimId: renewedClaim.claimId,
      },
      externalLeaseRevocation: revocation,
      authority: {
        sessionId: authorization.session.session.id,
        userId: authorization.session.user.id,
        membershipId: authorization.membership.id,
        role: authorization.role,
      },
    }).catch(async (error) => {
      await abandonMemberClaim(renewedClaim);
      throw error;
    });
    if (!removed) {
      await abandonMemberClaim(renewedClaim);
      return jsonError("Member access changed concurrently. Retry removal.", 409);
    }
    return privateJson({ status: true });
  }

  return jsonError("Member or invitation id is required", 400);
}
