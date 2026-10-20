// Workspace-scoped shared connection collection. Templates intentionally exclude
// credentials; role and membership are resolved server-side on every request.
import { and, desc, eq, isNull, ne } from "drizzle-orm";
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
  workspaceDirectEndpoint,
  workspaceDirectPrincipal,
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
import type { DirectFailureCode, DirectLevel, DirectPrincipalState } from "../../../../../../lib/workspace-direct-access-core";
import {
  parseSharedConnection,
  providerResourceSupportsSchema,
  providerResourceSupportsWrite,
  publicConnection,
  type DirectConnectionView,
} from "../../../../../../lib/workspace-connections";
import { sharedConnectionListable } from "../../../../../../lib/workspace-member-grants";
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
    membershipId: authorization.membership.id, role: authorization.role };
}

function directPrincipalView(row: {
  principalState: string | null; principalAppliedLevel: string | null; principalName: string | null;
  principalLastSyncedAt: Date | null; principalFailureCode: string | null;
}): DirectConnectionView["principal"] {
  if (row.principalState === null || row.principalName === null) return null;
  return {
    state: row.principalState as DirectPrincipalState,
    appliedLevel: (row.principalAppliedLevel ?? "none") as DirectLevel,
    principalName: row.principalName,
    lastSyncedAt: row.principalLastSyncedAt,
    failureCode: row.principalFailureCode as DirectFailureCode | null,
  };
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
      writeCeiling: workspaceDirectEndpoint.writeCeiling,
      principalState: workspaceDirectPrincipal.state,
      principalAppliedLevel: workspaceDirectPrincipal.appliedLevel,
      principalName: workspaceDirectPrincipal.principalName,
      principalLastSyncedAt: workspaceDirectPrincipal.lastSyncedAt,
      principalFailureCode: workspaceDirectPrincipal.failureCode,
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
    .leftJoin(
      workspaceDirectEndpoint,
      and(
        eq(workspaceDirectEndpoint.organizationId, workspaceConnection.organizationId),
        eq(workspaceDirectEndpoint.connectionId, workspaceConnection.id),
      ),
    )
    .leftJoin(
      workspaceDirectPrincipal,
      and(
        eq(workspaceDirectPrincipal.organizationId, workspaceConnection.organizationId),
        eq(workspaceDirectPrincipal.connectionId, workspaceConnection.id),
        eq(workspaceDirectPrincipal.memberId, authorization.membership.id),
        ne(workspaceDirectPrincipal.state, "dropped"),
      ),
    )
    .where(and(
      eq(workspaceConnectionGrant.organizationId, workspaceId),
      eq(workspaceConnectionGrant.memberId, authorization.membership.id),
      sharedConnectionListable,
    ))
    .orderBy(desc(workspaceConnection.updatedAt));
  return privateJson({
    workspaceId,
    role: authorization.role,
    accessMode: authorization.accessMode,
    connections: rows.map(({ connection, capability, capabilityManifest, providerMetadata, grantedScope, activeIntegrationId, writeCeiling, ...principal }) => {
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
          database: connection.databaseName,
        }),
        connection.provisioningMode === "provisioned"
          ? { writeCeiling: writeCeiling ?? false, principal: directPrincipalView(principal) }
          : null,
      );
    }),
  });
}

/** A client may name the connection it publishes so a local connection keeps its identity. */
function splitClientId(value: unknown): { id: string | null; template: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("id" in value)) {
    return { id: null, template: value };
  }
  const { id, ...template } = value as Record<string, unknown>;
  if (typeof id !== "string" || !isUuid(id)) throw new Error("Invalid connection id");
  return { id: id.toLowerCase(), template };
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  // Editors and above create team connections; administrators manage the rest of the workspace.
  const authorization = await authorizeWorkspace(request, workspaceId, "write");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  let expectedRevision: number | null;
  try {
    expectedRevision = parseExpectedRevision(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid expected revision", 400);
  }
  if (expectedRevision === null) return jsonError("Expected revision is required", 428);
  if (expectedRevision !== 0) return jsonError("New connections require expected revision 0", 409);
  let input;
  let clientId: string | null;
  try {
    const body = await boundedJsonBody(request, 64 * 1_024);
    if (!body.ok) {
      return jsonError(
        body.reason === "too_large" ? "Connection template is too large" : "Invalid connection template",
        body.reason === "too_large" ? 413 : 400,
      );
    }
    const split = splitClientId(body.value);
    clientId = split.id;
    input = parseSharedConnection(split.template);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid connection template", 400);
  }
  const connectionId = clientId ?? crypto.randomUUID();
  if (clientId) {
    // A retry of the same publication by the same creator returns the connection it created.
    const existing = await db.query.workspaceConnection.findFirst({
      where: and(
        eq(workspaceConnection.id, connectionId),
        eq(workspaceConnection.organizationId, workspaceId),
        eq(workspaceConnection.createdByUserId, authorization.session.user.id),
        isNull(workspaceConnection.deletedAt),
      ),
    });
    if (existing) {
      return privateJson({
        connection: publicConnection(existing, authorization.role, accessModeForConnectionGrant(authorization.role, "manage")),
      });
    }
  }
  // The creator holds the manage grant, so the response carries the manage-grant access mode.
  const creatorAccess = accessModeForConnectionGrant(authorization.role, "manage");
  let created;
  try {
    created = await commitConnectionCreate({
      organizationId: workspaceId, connectionId, authority: mutationAuthority(authorization),
      input: connectionVersionPayload(input),
    });
  } catch (error) {
    // A caller-chosen id that another connection already owns reads as a plain conflict.
    if (clientId) return jsonError("Connection id is unavailable.", 409);
    throw error;
  }
  if (!created) return jsonError("Connection changed concurrently. Retry creation.", 409);
  return privateJson({
    connection: publicConnection(created, authorization.role, creatorAccess),
  }, { status: 201 });
}
