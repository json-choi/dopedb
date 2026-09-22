// Workspace-scoped shared connection collection. Templates intentionally exclude
// credentials; role and membership are resolved server-side on every request.
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../../../../../../lib/db";
import { env } from "../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../lib/http";
import {
  workspaceConnection,
  workspaceConnectionGrant,
  workspaceProviderIntegration,
  workspaceProviderResource,
} from "../../../../../../lib/schema";
import {
  authorizeWorkspace,
} from "../../../../../../lib/workspace-authorization";
import {
  accessModeForConnectionGrant,
  type WorkspaceConnectionCapability,
} from "../../../../../../lib/workspace-permissions";
import {
  parseSharedConnection,
  providerResourceSupportsSchema,
  providerResourceSupportsWrite,
  publicConnection,
} from "../../../../../../lib/workspace-connections";
import {
  connectionVersionPayload,
  parseExpectedRevision,
} from "../../../../../../lib/workspace-versioning";
import { commitConnectionCreate, type MutationAuthority } from "../../../../../../lib/workspace-versioning-store";

type RouteContext = { params: Promise<{ workspaceId: string }> };

function mutationAuthority(authorization: {
  role: string; session: { session: { id: string }; user: { id: string } }; membership: { id: string };
}): MutationAuthority {
  return { sessionId: authorization.session.session.id, userId: authorization.session.user.id,
    membershipId: authorization.membership.id, role: authorization.role as "admin" | "owner" };
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const rows = await db
    .select({
      connection: workspaceConnection,
      capability: workspaceConnectionGrant.capability,
      capabilityManifest: workspaceProviderResource.capabilityManifest,
      providerMetadata: workspaceProviderResource.redactedMetadata,
      grantedScope: workspaceProviderIntegration.grantedScope,
      activeIntegrationId: workspaceProviderIntegration.id,
    })
    .from(workspaceConnectionGrant)
    .innerJoin(
      workspaceConnection,
      and(
        eq(workspaceConnection.organizationId, workspaceConnectionGrant.organizationId),
        eq(workspaceConnection.id, workspaceConnectionGrant.connectionId),
      ),
    )
    .leftJoin(
      workspaceProviderIntegration,
      and(
        eq(workspaceProviderIntegration.id, workspaceConnection.providerIntegrationId),
        eq(workspaceProviderIntegration.organizationId, workspaceConnection.organizationId),
        eq(workspaceProviderIntegration.provider, workspaceConnection.provider),
        eq(workspaceProviderIntegration.status, "active"),
        eq(workspaceProviderIntegration.refreshPhase, "idle"),
        isNull(workspaceProviderIntegration.revokedAt),
        isNull(workspaceProviderIntegration.revocationPendingAt),
        isNull(workspaceProviderIntegration.revocationClaimId),
      ),
    )
    .leftJoin(
      workspaceProviderResource,
      and(
        eq(workspaceProviderResource.organizationId, workspaceConnection.organizationId),
        eq(workspaceProviderResource.id, workspaceConnection.providerResourceId),
        eq(workspaceProviderResource.provider, workspaceConnection.provider),
      ),
    )
    .where(and(
      eq(workspaceConnectionGrant.organizationId, workspaceId),
      eq(workspaceConnectionGrant.memberId, authorization.membership.id),
      or(
        eq(workspaceConnection.credentialMode, "managed"),
        and(
          eq(workspaceConnection.credentialMode, "member_local"),
          eq(workspaceConnection.readonlyDefault, true),
          eq(workspaceConnection.allowWrites, false),
        ),
      ),
      isNull(workspaceConnection.deletedAt),
      isNull(workspaceConnection.revocationPendingAt),
    ))
    .orderBy(desc(workspaceConnection.updatedAt));
  return privateJson({
    workspaceId,
    role: authorization.role,
    accessMode: authorization.accessMode,
    connections: rows.map(({ connection, capability, capabilityManifest, providerMetadata, grantedScope, activeIntegrationId }) => {
      const accessMode = accessModeForConnectionGrant(
        authorization.role,
        capability as WorkspaceConnectionCapability,
      );
      return publicConnection(
        { ...connection, providerMetadata },
        authorization.role,
        accessMode,
        providerResourceSupportsWrite(capabilityManifest),
        Boolean(activeIntegrationId) && providerResourceSupportsSchema({
          provider: connection.provider,
          engine: connection.engine,
          capabilityManifest,
          grantedScope,
        }),
      );
    }),
  });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (authorization.role !== "admin" && authorization.role !== "owner") {
    return jsonError("Workspace access denied", 403);
  }
  let expectedRevision: number | null;
  try {
    expectedRevision = parseExpectedRevision(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid expected revision", 400);
  }
  if (expectedRevision === null) return jsonError("Expected revision is required", 428);
  if (expectedRevision !== 0) return jsonError("New connections require expected revision 0", 409);
  let input;
  try {
    const body = await boundedJsonBody(request, 64 * 1_024);
    if (!body.ok) {
      return jsonError(
        body.reason === "too_large" ? "Connection template is too large" : "Invalid connection template",
        body.reason === "too_large" ? 413 : 400,
      );
    }
    input = parseSharedConnection(body.value);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid connection template", 400);
  }
  const connectionId = crypto.randomUUID();
  const created = await commitConnectionCreate({
    organizationId: workspaceId, connectionId, authority: mutationAuthority(authorization),
    input: connectionVersionPayload(input),
  });
  if (!created) return jsonError("Connection changed concurrently. Retry creation.", 409);
  return privateJson({
    connection: publicConnection(created, authorization.role, authorization.accessMode),
  }, { status: 201 });
}
