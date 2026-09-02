// Native-client-only one-time credential issuance. The provider secret is returned
// over HTTPS exactly once and is absent from all database and audit writes.
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import {
  LEGACY_MANAGED_LEASE_CONTRACT_VERSION,
  managedLeaseResponse,
  MANAGED_LEASE_CONTRACT_VERSION,
  PREVIOUS_MANAGED_LEASE_CONTRACT_VERSION,
  parseManagedLeaseRequest,
} from "../../../../../../../../lib/control-plane-contracts";
import { db } from "../../../../../../../../lib/db";
import { env } from "../../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  privateJson,
} from "../../../../../../../../lib/http";
import {
  activeProviderIntegration,
  issueManagedLease,
  parseManagedProviderResource,
  revokeActiveLeases,
} from "../../../../../../../../lib/provider-integrations";
import { vercelOidcToken } from "../../../../../../../../lib/providers/gcp-cloud-sql";
import { ProviderRequestError } from "../../../../../../../../lib/providers/provider-types";
import type { VaultManagedResource } from "../../../../../../../../lib/providers/vault";
import { consumeRateLimit } from "../../../../../../../../lib/rate-limit";
import { managedLeaseStillDeliverable } from "../../../../../../../../lib/revocation-gates";
import {
  workspaceAuditEvent,
  workspaceConnection,
  workspaceCredentialLease,
  workspaceProviderResource,
} from "../../../../../../../../lib/schema";
import { authorizeWorkspaceConnection } from "../../../../../../../../lib/workspace-authorization";
import {
  providerResourceSupportsSchema,
  providerResourceSupportsWrite,
} from "../../../../../../../../lib/workspace-connections";
import { hasWorkspaceCapability } from "../../../../../../../../lib/workspace-permissions";
import { kickWorkspaceBackgroundTask } from "../../../../../../../../lib/workspace-background-scheduler";
import { logManagedDatabaseAccessFailure } from "../../../../../../../../lib/workspace-server-log";

type RouteContext = {
  params: Promise<{ workspaceId: string; connectionId: string }>;
};

// Leaves room for the 45-second provider-authority gate to fail closed and for
// the pending reservation to be retired before the platform stops the request.
export const maxDuration = 60;

function consumeLeaseBudget(
  organizationId: string,
  userId: string,
  connectionId: string,
) {
  return consumeRateLimit({
    namespace: "workspace-lease",
    // One busy connection must not consume the admission budget of every other
    // database that the same member explicitly opens in this Workspace.
    discriminator: `${organizationId}:${userId}:${connectionId}`,
    limit: 5,
  });
}

function consumeLeaseReleaseBudget(organizationId: string, userId: string) {
  return consumeRateLimit({
    namespace: "workspace-lease-release",
    discriminator: `${organizationId}:${userId}`,
    limit: 30,
  });
}

function nestedDatabaseCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return null;
    const code = "code" in current ? current.code : null;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

export async function POST(request: Request, context: RouteContext) {
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return jsonError("Desktop bearer authentication is required", 401);
  }
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) {
    return jsonError("Invalid workspace or connection id", 400);
  }
  const managedLeaseContract = request.headers.get(
    "x-dopedb-managed-lease-contract",
  );
  if (
    managedLeaseContract !== MANAGED_LEASE_CONTRACT_VERSION
    && managedLeaseContract !== PREVIOUS_MANAGED_LEASE_CONTRACT_VERSION
    && managedLeaseContract !== LEGACY_MANAGED_LEASE_CONTRACT_VERSION
  ) {
    return jsonError(
      "Update DopeDB to use managed database access safely",
      426,
    );
  }
  const parsedBody = await boundedJsonBody(request, 256);
  if (!parsedBody.ok) {
    return jsonError(
      parsedBody.reason === "too_large"
        ? "Managed access request is too large"
        : "Managed access mode must be read, write, or schema",
      parsedBody.reason === "too_large" ? 413 : 400,
    );
  }
  let requestedAccessMode: "read" | "write" | "schema";
  try {
    requestedAccessMode = parseManagedLeaseRequest(parsedBody.value).accessMode;
  } catch {
    return jsonError("Managed access mode must be read, write, or schema", 400);
  }
  const authorization = await authorizeWorkspaceConnection(
    request, workspaceId, connectionId, "use",
  );
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (
    requestedAccessMode === "schema"
    && managedLeaseContract !== MANAGED_LEASE_CONTRACT_VERSION
  ) {
    return jsonError("Update DopeDB to use managed schema access safely", 426);
  }
  const connection = await db.query.workspaceConnection.findFirst({
    where: and(
      eq(workspaceConnection.id, connectionId),
      eq(workspaceConnection.organizationId, workspaceId),
      isNull(workspaceConnection.deletedAt),
    ),
    columns: {
      id: true,
      engine: true,
      provider: true,
      host: true,
      port: true,
      databaseName: true,
      sslmode: true,
      allowWrites: true,
      credentialMode: true,
      providerIntegrationId: true,
      providerResourceId: true,
      revision: true,
    },
  });
  if (
    !connection
    || connection.credentialMode !== "managed"
    || !connection.providerIntegrationId
    || !connection.providerResourceId
  ) {
    return jsonError("Managed database access is not available", 409);
  }
  const integration = await activeProviderIntegration(
    workspaceId,
    connection.providerIntegrationId,
  );
  if (!integration) return jsonError("Provider integration not found", 404);
  const expectedConnectionProvider = integration.provider === "vault"
    ? "generic"
    : integration.provider;
  if (connection.provider !== expectedConnectionProvider) {
    return jsonError("Managed database provider does not match the connection", 409);
  }
  if (
    integration.provider === "vault"
    && managedLeaseContract !== MANAGED_LEASE_CONTRACT_VERSION
  ) {
    return jsonError(
      "Update DopeDB to use brokered database access safely",
      426,
    );
  }
  const canonicalResource = await db.query.workspaceProviderResource.findFirst({
    where: and(
      eq(workspaceProviderResource.id, connection.providerResourceId),
      eq(workspaceProviderResource.organizationId, workspaceId),
      eq(workspaceProviderResource.provider, integration.provider),
    ),
    columns: { resource: true, redactedMetadata: true, capabilityManifest: true },
  });
  if (!canonicalResource) {
    // A legacy JSON-only managed connection remains cleanup-capable, but never
    // becomes issuance-capable after receipt-bound canonical resources exist.
    return jsonError("Managed database access requires a canonical provider resource", 409);
  }
  let resource;
  try {
    resource = parseManagedProviderResource(
      integration.provider,
      canonicalResource.resource,
    );
  } catch {
    return jsonError("Managed database resource is invalid", 409);
  }
  if (resource.engine !== connection.engine) {
    return jsonError("Managed database engine does not match the connection", 409);
  }
  if (integration.provider === "vault") {
    const target = resource as VaultManagedResource;
    if (
      target.host !== connection.host
      || target.port !== connection.port
      || target.database !== connection.databaseName
      || target.sslmode !== connection.sslmode
    ) {
      return jsonError("Brokered database target does not match the connection", 409);
    }
  }
  const metadata = canonicalResource.redactedMetadata
    && typeof canonicalResource.redactedMetadata === "object"
    && !Array.isArray(canonicalResource.redactedMetadata)
    ? canonicalResource.redactedMetadata as Record<string, unknown>
    : null;
  const production = metadata?.production;
  const safeMigrations = metadata?.safeMigrations;
  if (
    typeof production !== "boolean"
    || (
      integration.provider === "planetScale"
      && resource.engine === "mysql"
      && typeof safeMigrations !== "boolean"
    )
    || (
      integration.provider === "planetScale"
      && production
      && resource.engine === "mysql"
      && safeMigrations !== true
    )
  ) {
    return jsonError("Managed database policy is invalid", 409);
  }
  if (requestedAccessMode !== "read" && (
    !connection.allowWrites
    || !hasWorkspaceCapability(authorization.role, "write")
    || !providerResourceSupportsWrite(canonicalResource.capabilityManifest)
  )) {
    return jsonError("Managed write access is not allowed for this member and connection", 403);
  }
  if (requestedAccessMode === "schema" && (
    authorization.connectionCapability !== "manage"
    || !hasWorkspaceCapability(authorization.role, "manage")
    || !providerResourceSupportsSchema({
      provider: integration.provider,
      engine: resource.engine,
      capabilityManifest: canonicalResource.capabilityManifest,
    })
  )) {
    return jsonError(
      "Managed schema access requires connection manage permission and a supported provider",
      403,
    );
  }
  const [activeCount] = await db.select({ value: count() })
    .from(workspaceCredentialLease)
    .where(and(
      eq(workspaceCredentialLease.organizationId, workspaceId),
      eq(workspaceCredentialLease.connectionId, connectionId),
      eq(workspaceCredentialLease.userId, authorization.session.user.id),
      isNull(workspaceCredentialLease.revokedAt),
      gt(workspaceCredentialLease.expiresAt, new Date()),
    ));
  if (activeCount.value >= 5) {
    return jsonError("Too many active database sessions. Retry after leases expire.", 429);
  }
  if (!await consumeLeaseBudget(
    workspaceId,
    authorization.session.user.id,
    connectionId,
  )) {
    return jsonError("Managed database access is being opened too quickly. Retry shortly.", 429);
  }
  const accessMode = requestedAccessMode;
  try {
    const lease = await issueManagedLease({
      organizationId: workspaceId,
      connectionId,
      userId: authorization.session.user.id,
      memberId: authorization.membership.id,
      sessionId: authorization.session.session.id,
      role: authorization.role,
      connectionRevision: connection.revision,
      connectionProvider: connection.provider,
      providerResourceId: connection.providerResourceId,
      engine: resource.engine,
      production,
      safeMigrations: typeof safeMigrations === "boolean" ? safeMigrations : null,
      accessMode,
      integration,
      resource,
      oidcToken: vercelOidcToken(request),
    });
    try {
      await db.insert(workspaceAuditEvent).values({
        organizationId: workspaceId,
        actorUserId: authorization.session.user.id,
        action: "credential.lease.issue",
        resourceType: "connection",
        resourceId: connectionId,
        redactedSummary: {
          provider: integration.provider,
          providerAuditId: lease.providerAuditId,
          leaseId: lease.leaseId,
          externalCredentialId: lease.externalCredentialId,
          externalCredentialKind: lease.externalCredentialKind,
          accessMode,
          expiresAt: lease.expiresAt,
        },
        requestId: crypto.randomUUID(),
      });
    } catch {
      await revokeActiveLeases({
        organizationId: workspaceId,
        leaseId: lease.leaseId,
        userId: authorization.session.user.id,
        connectionId,
      });
      return jsonError("Database access could not be audited", 500);
    }
    // This is the final secret-delivery boundary. The durable predicate itself
    // revalidates the exact live session, membership/grant, connection revision,
    // canonical resource and integration generation in one database snapshot.
    const deliverable = await managedLeaseStillDeliverable({
      leaseId: lease.leaseId,
      organizationId: workspaceId,
      memberId: authorization.membership.id,
      userId: authorization.session.user.id,
      sessionId: authorization.session.session.id,
      role: authorization.role,
      connectionId,
      connectionRevision: connection.revision,
      providerResourceId: connection.providerResourceId,
      engine: resource.engine,
      integrationId: integration.id,
      integrationGeneration: integration.generation,
      connectionProvider: connection.provider,
      provider: integration.provider,
      accessMode,
    }, lease, lease.providerAuditId);
    if (!deliverable) {
      await revokeActiveLeases({
        organizationId: workspaceId,
        leaseId: lease.leaseId,
        userId: authorization.session.user.id,
        connectionId,
      });
      return jsonError("Workspace database authority changed. Retry with current access.", 409);
    }
    const cleanupScheduled = await kickWorkspaceBackgroundTask({
      task: "credential",
      notBefore: new Date(lease.expiresAt),
    });
    if (env.workspaceBackgroundSchedulerEnabled() && !cleanupScheduled) {
      await revokeActiveLeases({
        organizationId: workspaceId,
        leaseId: lease.leaseId,
        userId: authorization.session.user.id,
        connectionId,
      });
      return jsonError("Managed credential cleanup could not be scheduled. Retry shortly.", 503);
    }
    return privateJson(managedLeaseResponse({
      lease: {
        id: lease.leaseId,
        provider: connection.provider,
        engine: resource.engine,
        host: lease.host,
        port: lease.port,
        database: lease.database,
        username: lease.username,
        password: lease.password,
        sslmode: lease.sslmode,
        ...(lease.tlsServerCaPem
          ? { tlsServerCaPem: lease.tlsServerCaPem }
          : {}),
        ...(lease.connector ? { connector: lease.connector } : {}),
        accessMode,
        expiresAt: lease.expiresAt,
      },
    }), {
      headers: {
        pragma: "no-cache",
        expires: "0",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logManagedDatabaseAccessFailure({
      provider: integration.provider,
      providerRequest: error instanceof ProviderRequestError,
      status: error instanceof ProviderRequestError ? error.status : 0,
      databaseCode: nestedDatabaseCode(error),
    });
    if (error instanceof ProviderRequestError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("Managed database access could not be issued", 502);
  }
}

/// Best-effort early release used when the desktop retires a managed pool before its
/// provider expiry. Exact tenant/user/connection/lease predicates prevent one member
/// from revoking another member's credential.
export async function DELETE(request: Request, context: RouteContext) {
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return jsonError("Desktop bearer authentication is required", 401);
  }
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) {
    return jsonError("Invalid workspace or connection id", 400);
  }
  const parsedBody = await boundedJsonBody(request, 256);
  if (!parsedBody.ok) {
    return jsonError(
      parsedBody.reason === "too_large"
        ? "Managed lease release request is too large"
        : "Managed lease release request is invalid",
      parsedBody.reason === "too_large" ? 413 : 400,
    );
  }
  let leaseId: string;
  try {
    const payload = parsedBody.value as { leaseId?: unknown };
    if (!payload || typeof payload.leaseId !== "string" || !isUuid(payload.leaseId)) {
      return jsonError("Managed lease id is invalid", 400);
    }
    leaseId = payload.leaseId;
  } catch {
    return jsonError("Managed lease release request must be valid JSON", 400);
  }

  // Cleanup remains available after a write/read downgrade, but not after membership
  // removal; an unreachable credential then expires through the durable sweeper.
  const authorization = await authorizeWorkspaceConnection(request, workspaceId, connectionId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (
    !await consumeLeaseReleaseBudget(
      workspaceId,
      authorization.session.user.id,
    )
  ) {
    return jsonError("Managed lease releases are being requested too quickly", 429);
  }
  const release = await revokeActiveLeases({
    organizationId: workspaceId,
    leaseId,
    userId: authorization.session.user.id,
    connectionId,
  });
  if (release.revoked > 0 || release.deferred > 0) {
    await db.insert(workspaceAuditEvent).values({
      organizationId: workspaceId,
      actorUserId: authorization.session.user.id,
      action: "credential.lease.release",
      resourceType: "connection",
      resourceId: connectionId,
      redactedSummary: {
        leaseId,
        released: release.revoked,
        deferred: release.deferred,
      },
      requestId: crypto.randomUUID(),
    });
  }
  return privateJson({
    released: release.revoked > 0,
    deferred: release.deferred > 0,
  });
}
