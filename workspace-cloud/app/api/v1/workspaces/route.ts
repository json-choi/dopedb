import { and, eq, isNull } from "drizzle-orm";
import { auth } from "../../../../lib/auth";
import { betterAuthErrorResponse } from "../../../../lib/better-auth-errors";
import { authoritativeSession } from "../../../../lib/authoritative-session";
import { db } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import {
  boundedJsonBody,
  isSafeDisplayText,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../lib/http";
import { acceptPendingWorkspaceInvitations } from "../../../../lib/pending-invitations";
import {
  isPersonalKnowledgeMetadata,
  isPersonalKnowledgeOrganization,
} from "../../../../lib/knowledge/personal-scope";
import { member, organization, workspaceProfile } from "../../../../lib/schema";

export async function GET(request: Request) {
  const session = await authoritativeSession(request);
  if (!session) return jsonError("Unauthorized", 401);
  await acceptPendingWorkspaceInvitations({
    api: auth.api,
    headers: request.headers,
    user: session.user,
    activeOrganizationId: session.session.activeOrganizationId,
  });
  const workspaces = await db.select({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    logo: organization.logo,
    metadata: organization.metadata,
    createdAt: organization.createdAt,
    role: member.role,
  }).from(member).innerJoin(
    organization,
    eq(organization.id, member.organizationId),
  ).innerJoin(
    workspaceProfile,
    eq(workspaceProfile.organizationId, member.organizationId),
  ).where(and(
    eq(member.userId, session.user.id),
    isNull(member.revocationPendingAt),
    eq(workspaceProfile.lifecycleState, "active"),
  ));
  // Scheduled deletion suspends every ordinary membership, so these workspaces are
  // not part of `workspaces`. Only the Owner whose pending marker matches the
  // deletion receipt may still inspect or cancel it, mirroring the lifecycle gate.
  const deletionPending = await db.select({
    id: organization.id,
    name: organization.name,
    metadata: organization.metadata,
    deletionRequestedAt: workspaceProfile.deletionRequestedAt,
    purgeAfter: workspaceProfile.purgeAfter,
  }).from(member).innerJoin(
    organization,
    eq(organization.id, member.organizationId),
  ).innerJoin(
    workspaceProfile,
    eq(workspaceProfile.organizationId, member.organizationId),
  ).where(and(
    eq(member.userId, session.user.id),
    eq(member.role, "owner"),
    isNull(member.revocationClaimId),
    eq(workspaceProfile.lifecycleState, "deletion_pending"),
    eq(member.revocationPendingAt, workspaceProfile.deletionRequestedAt),
  ));
  const visible = (workspace: { id: string; metadata: string | null }) => (
    !isPersonalKnowledgeOrganization(session.user.id, workspace.id)
    && !isPersonalKnowledgeMetadata(workspace.metadata)
  );
  return privateJson({
    workspaces: workspaces.filter(visible),
    deletionPending: deletionPending.filter(visible).map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      deletionRequestedAt: workspace.deletionRequestedAt,
      purgeAfter: workspace.purgeAfter,
    })),
  });
}

export async function POST(request: Request) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const session = await authoritativeSession(request);
  if (!session) return jsonError("Unauthorized", 401);
  const parsed = await boundedJsonBody(request, 1_024);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large" ? "Workspace request is too large" : "Invalid workspace request",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || !isSafeDisplayText(name, 120)) {
    return jsonError("Workspace name must be 1–120 single-line characters", 400);
  }
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "workspace";
  const slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
  let workspace: Awaited<ReturnType<typeof auth.api.createOrganization>>;
  try {
    workspace = await auth.api.createOrganization({
      headers: request.headers,
      body: { name, slug },
    });
  } catch (error) {
    return betterAuthErrorResponse(error, "Workspace could not be created");
  }
  return privateJson({ workspace }, { status: 201 });
}
