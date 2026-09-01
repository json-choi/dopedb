// Mutation surface for one shared template. UUID lookup is always intersected with
// the authenticated organization to prevent cross-workspace identifier access.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../../../../../../lib/db";
import { env } from "../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
  privateRevisionMutationJson,
  privateRevisionMutationResponse,
} from "../../../../../../../lib/http";
import { revokeActiveLeases } from "../../../../../../../lib/provider-integrations";
import {
  claimRevocationGate,
  clearRevocationGate,
  releaseRevocationGateClaim,
} from "../../../../../../../lib/revocation-gates";
import {
  workspaceConnection,
  workspaceProviderResource,
} from "../../../../../../../lib/schema";
import {
  authorizeWorkspaceConnection,
  authorizeWorkspaceConnectionAction,
} from "../../../../../../../lib/workspace-authorization";
import {
  parseSharedConnection,
  providerResourceSupportsSchema,
  providerResourceSupportsWrite,
  publicConnection,
} from "../../../../../../../lib/workspace-connections";
import { hasWorkspaceCapability } from "../../../../../../../lib/workspace-permissions";
import {
  connectionLeaseRevocationScope,
  connectionVersionPayload,
  parseExpectedRevision,
  persistedConnectionVersionPayload,
} from "../../../../../../../lib/workspace-versioning";
import {
  conflictConnectionCandidate,
  commitConnectionMutation,
  type MutationAuthority,
} from "../../../../../../../lib/workspace-versioning-store";

type RouteContext = { params: Promise<{ workspaceId: string; connectionId: string }> };

const MANAGED_CONNECTION_RECOVERY_REQUIRED =
  "managed_connection_recovery_required";

function mutationAuthority(authorization: {
  role: string;
  session: { session: { id: string }; user: { id: string } };
  membership: { id: string };
}): MutationAuthority {
  return {
    sessionId: authorization.session.session.id,
    userId: authorization.session.user.id,
    membershipId: authorization.membership.id,
    role: authorization.role,
  };
}

async function abandonClaim(claim: Awaited<ReturnType<typeof claimRevocationGate>> & {}) {
  if (!claim) return;
  await (claim.firstPending ? clearRevocationGate(claim) : releaseRevocationGateClaim(claim)).catch(() => false);
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) {
    return jsonError("Invalid workspace or connection id", 400);
  }
  const parsed = await boundedJsonBody(request, 256);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large" ? "Connection action is too large" : "Invalid connection action",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as { action?: unknown } | null;
  if (body?.action !== "read" && body?.action !== "write" && body?.action !== "schema") {
    return jsonError("Action must be read, write, or schema", 400);
  }
  const authorization = await authorizeWorkspaceConnectionAction(
    request,
    workspaceId,
    connectionId,
    body.action === "schema" ? "manage" : "use",
  );
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const connection = authorization.connection;
  if (connection.revocationPendingAt) {
    return jsonError("Connection access is changing. Retry shortly.", 409);
  }
  if (connection.credentialMode === "member_local" && (
    !connection.readonlyDefault || connection.allowWrites
  )) {
    return jsonError("Shared connection template is unsafe", 409);
  }
  if (connection.credentialMode === "managed" && (
    !connection.providerIntegrationId
    || connection.integrationStatus !== "active"
    || connection.integrationProvider !== connection.provider
    || connection.integrationRevokedAt
    || connection.integrationRevocationPendingAt
    || connection.integrationRevocationClaimId
  )) {
    return jsonError(
      "Shared connection template is unsafe",
      409,
      MANAGED_CONNECTION_RECOVERY_REQUIRED,
    );
  }
  if (connection.credentialMode !== "member_local" && connection.credentialMode !== "managed") {
    return jsonError("Shared connection template is unsafe", 409);
  }
  if (body.action !== "read" && (
    connection.credentialMode !== "managed"
    || !connection.allowWrites
    || !hasWorkspaceCapability(authorization.role, "write")
    || !providerResourceSupportsWrite(connection.providerCapabilityManifest)
  )) {
    return jsonError("Managed write access is not allowed for this member and connection", 403);
  }
  if (body.action === "schema" && (
    !hasWorkspaceCapability(authorization.role, "manage")
    || authorization.accessMode !== "manage"
    || !providerResourceSupportsSchema({
      provider: connection.integrationProvider ?? "",
      engine: connection.engine,
      capabilityManifest: connection.providerCapabilityManifest,
    })
  )) {
    return jsonError(
      "Managed schema access requires connection manage permission and a supported provider",
      403,
    );
  }
  return privateJson({
    allowed: true,
    action: body.action,
    role: authorization.role,
    accessMode: authorization.accessMode,
    revision: connection.contentRevision,
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) {
    return jsonError("Invalid workspace or connection id", 400);
  }
  const authorization = await authorizeWorkspaceConnection(
    request, workspaceId, connectionId, "manage",
  );
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const authority = mutationAuthority(authorization);
  let expectedRevision: number | null;
  try {
    expectedRevision = parseExpectedRevision(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid expected revision", 400);
  }
  if (expectedRevision === null) return jsonError("Expected revision is required", 428);
  const existing = await db.query.workspaceConnection.findFirst({
    where: and(
      eq(workspaceConnection.id, connectionId),
      eq(workspaceConnection.organizationId, workspaceId),
      isNull(workspaceConnection.deletedAt),
    ),
    columns: {
      id: true,
      name: true,
      engine: true,
      provider: true,
      driverId: true,
      host: true,
      port: true,
      databaseName: true,
      sslmode: true,
      readonlyDefault: true,
      credentialMode: true,
      allowWrites: true,
      environment: true,
      schemaGroup: true,
      providerResourceId: true,
      revision: true,
      contentRevision: true,
    },
  });
  if (!existing) return jsonError("Connection not found", 404);
  let input;
  try {
    const body = await boundedJsonBody(request, 64 * 1_024);
    if (!body.ok) {
      return jsonError(
        body.reason === "too_large" ? "Connection template is too large" : "Invalid connection template",
        body.reason === "too_large" ? 413 : 400,
      );
    }
    input = parseSharedConnection(body.value, {
      credentialMode: existing.credentialMode === "managed" ? "managed" : "member_local",
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid connection template", 400);
  }
  if (existing.credentialMode === "managed" && input.engine !== existing.engine) {
    return jsonError(
      "Switch to member-local credentials before changing a managed database engine",
      409,
    );
  }
  if (
    input.allowWrites !== existing.allowWrites
    && !hasWorkspaceCapability(authorization.role, "manage")
  ) {
    return jsonError("Workspace administrator permission is required to change write access", 403);
  }
  const providerResource = existing.credentialMode === "managed"
    && existing.providerResourceId
    ? await db.query.workspaceProviderResource.findFirst({
        where: and(
          eq(workspaceProviderResource.id, existing.providerResourceId),
          eq(workspaceProviderResource.organizationId, workspaceId),
          eq(workspaceProviderResource.provider, existing.provider),
        ),
        columns: { capabilityManifest: true },
      })
    : null;
  const writeAvailable = providerResourceSupportsWrite(
    providerResource?.capabilityManifest,
  );
  if (input.allowWrites && !writeAvailable) {
    return jsonError("This managed provider connection has no write credential", 409);
  }
  const normalized = {
    ...input,
    provider: (existing.credentialMode === "managed" ? existing.provider : input.provider) as typeof input.provider,
  };
  const normalizedPayload = connectionVersionPayload(normalized);
  if (expectedRevision !== existing.contentRevision) {
    const conflictId = await conflictConnectionCandidate({
      organizationId: workspaceId,
      connectionId,
      expectedRevision,
      payload: normalizedPayload,
      authority,
    }).catch(() => null);
    if (!conflictId) return jsonError("Connection changed concurrently. Retry the update.", 409);
    return privateJson({ error: "Connection conflict", conflictId }, { status: 409 });
  }
  const claim = await claimRevocationGate({
    kind: "connection",
    organizationId: workspaceId,
    connectionId,
  });
  if (!claim) {
    return jsonError("Another connection access change is already in progress", 409);
  }
  const expectedClaimRevision = existing.revision + (claim.firstPending ? 1 : 0);
  if (claim.connectionRevision !== expectedClaimRevision) {
    await (
      claim.firstPending
        ? clearRevocationGate(claim)
        : releaseRevocationGateClaim(claim)
    ).catch(() => false);
    return jsonError("Connection changed concurrently. Retry the update.", 409);
  }
  const leaseRevocationScope = connectionLeaseRevocationScope(
    persistedConnectionVersionPayload(existing),
    normalizedPayload,
  );
  let revocation = { revoked: 0, deferred: 0 };
  if (leaseRevocationScope !== "none") {
    try {
      revocation = await revokeActiveLeases({
        organizationId: workspaceId,
        connectionId,
        ...(leaseRevocationScope === "write" ? { mutationOnly: true } : {}),
      });
    } catch (error) {
      await abandonClaim(claim);
      throw error;
    }
  }
  if (revocation.deferred > 0) {
    await abandonClaim(claim);
    return jsonError(
      leaseRevocationScope === "write"
        ? "Active data or schema change access cannot be revoked until its short-lived credential expires. Retry shortly."
        : "Active database access could not be revoked. Retry the update.",
      409,
    );
  }
  const updated = await commitConnectionMutation({
    organizationId: workspaceId, connectionId, expectedContentRevision: existing.contentRevision,
    expectedAuthorityRevision: expectedClaimRevision, claimId: claim.claimId, authority,
    requireWorkspaceManager: input.allowWrites !== existing.allowWrites,
    mutation: {
      kind: "update", payload: normalizedPayload, name: normalized.name,
      engine: normalized.engine, provider: normalized.provider, driverId: normalized.driverId,
      host: normalized.host, port: normalized.port, databaseName: normalized.database, sslmode: normalized.sslmode,
      readonlyDefault: normalized.readonlyDefault, allowWrites: normalized.allowWrites,
      environment: normalized.env, schemaGroup: normalized.schemaGroup,
    },
  }).catch(async (error) => {
    await abandonClaim(claim);
    throw error;
  });
  if (!updated) {
    await abandonClaim(claim);
    return jsonError("Connection access changed concurrently. Retry the update.", 409);
  }
  return privateRevisionMutationJson(request, {
    connection: publicConnection(
      updated,
      authorization.role,
      authorization.accessMode,
      writeAvailable,
    ),
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) {
    return jsonError("Invalid workspace or connection id", 400);
  }
  const authorization = await authorizeWorkspaceConnection(
    request, workspaceId, connectionId, "manage",
  );
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const authority = mutationAuthority(authorization);
  let expectedRevision: number | null;
  try {
    expectedRevision = parseExpectedRevision(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid expected revision", 400);
  }
  if (expectedRevision === null) return jsonError("Expected revision is required", 428);
  const existing = await db.query.workspaceConnection.findFirst({
    where: and(
      eq(workspaceConnection.id, connectionId),
      eq(workspaceConnection.organizationId, workspaceId),
      isNull(workspaceConnection.deletedAt),
    ),
  });
  if (!existing) return jsonError("Connection not found", 404);
  const deletedPayload = persistedConnectionVersionPayload(existing, true);
  if (expectedRevision !== existing.contentRevision) {
    const conflictId = await conflictConnectionCandidate({
      organizationId: workspaceId,
      connectionId,
      expectedRevision,
      payload: deletedPayload,
      authority,
      operation: "delete",
    }).catch(() => null);
    if (!conflictId) return jsonError("Connection changed concurrently. Retry deletion.", 409);
    return privateJson({ error: "Connection conflict", conflictId }, { status: 409 });
  }
  const claim = await claimRevocationGate({
    kind: "connection",
    organizationId: workspaceId,
    connectionId,
  });
  if (!claim) {
    return jsonError("Another connection access change is already in progress", 409);
  }
  if (claim.kind !== "connection" || claim.connectionRevision === undefined) {
    await abandonClaim(claim);
    return jsonError("Connection access changed concurrently. Retry deletion.", 409);
  }
  const expectedClaimRevision = existing.revision + (claim.firstPending ? 1 : 0);
  if (claim.connectionRevision !== expectedClaimRevision) {
    await (claim.firstPending ? clearRevocationGate(claim) : releaseRevocationGateClaim(claim)).catch(() => false);
    return jsonError("Connection changed concurrently. Retry deletion.", 409);
  }
  let revocation;
  try {
    revocation = await revokeActiveLeases({
      organizationId: workspaceId,
      connectionId,
    });
  } catch (error) {
    await abandonClaim(claim);
    throw error;
  }
  if (revocation.deferred > 0) {
    await abandonClaim(claim);
    return jsonError("Active database access could not be revoked. Retry deletion.", 409);
  }
  const deleted = await commitConnectionMutation({
    organizationId: workspaceId, connectionId, expectedContentRevision: existing.contentRevision,
    expectedAuthorityRevision: expectedClaimRevision, claimId: claim.claimId, authority,
    mutation: { kind: "delete", payload: deletedPayload },
  }).catch(async (error) => {
    await abandonClaim(claim);
    throw error;
  });
  if (!deleted) {
    await abandonClaim(claim);
    return jsonError("Connection access changed concurrently. Retry deletion.", 409);
  }
  return privateRevisionMutationResponse(request, null, {
    status: 204,
  });
}
