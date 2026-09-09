import { workloadOidcToken } from "../../../../../../../../lib/workload-identity";
// Returns one expiring, secret-free canonical target for the desktop Managed
// Access planner. POST may refresh workspace-owned OAuth before pinning; DELETE
// is the cleanup-only revocation boundary. Neither endpoint delivers a secret.
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  privateJson,
} from "../../../../../../../../lib/http";
import {
  activeProviderIntegration,
  gcpCredential,
  neonCredential,
  parseManagedProviderResource,
  providerAccessToken,
  requiredOidcToken,
  revokeActiveLeases,
  verifiedNeonCredential,
} from "../../../../../../../../lib/provider-integrations";
import { loadProviderProvisioningTarget } from "../../../../../../../../lib/provider-provisioning-target";
import {
  validateGcpCloudSqlResource,
} from "../../../../../../../../lib/providers/gcp-cloud-sql";
import type {
  GcpCloudSqlResource,
} from "../../../../../../../../lib/providers/gcp-cloud-sql-core";
import {
  inspectNeonResourceIdentity,
  validateNeonResource,
} from "../../../../../../../../lib/providers/neon";
import type {
  NeonResource,
} from "../../../../../../../../lib/providers/neon-core";
import {
  inspectPlanetScaleResourceIdentity,
  validatePlanetScaleResource,
  type PlanetScaleResource,
} from "../../../../../../../../lib/providers/planetscale";
import { ProviderRequestError } from "../../../../../../../../lib/providers/provider-types";
import { db } from "../../../../../../../../lib/db";
import { workspaceAuditEvent } from "../../../../../../../../lib/schema";
import { authorizeWorkspaceConnection } from "../../../../../../../../lib/workspace-authorization";

type RouteContext = {
  params: Promise<{ workspaceId: string; connectionId: string }>;
};

function ownershipMarker(
  provider: "gcpCloudSql" | "neon" | "planetScale",
  connectionId: string,
) {
  const key = provider === "gcpCloudSql" ? "gcp_cloud_sql" : provider.toLowerCase();
  return `dopedb:${key}:${connectionId}`;
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) {
    return jsonError("Invalid workspace or connection id", 400);
  }
  const authorization = await authorizeWorkspaceConnection(
    request,
    workspaceId,
    connectionId,
    "manage",
  );
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  try {
    const target = await loadProviderProvisioningTarget({
      organizationId: workspaceId,
      connectionId,
    });
    if (!target) return jsonError("Managed Access target is unavailable", 409);
    return privateJson({ target });
  } catch {
    return jsonError("Managed Access target is temporarily unavailable", 500);
  }
}

/**
 * Native-client provisioning preparation. Unlike GET discovery, this verifies
 * the live Provider identity (and may refresh workspace-owned PlanetScale OAuth),
 * then returns a fresh target safe to pin into an approval plan.
 */
export async function POST(request: Request, context: RouteContext) {
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return jsonError("Desktop bearer authentication is required", 401);
  }
  if (request.headers.get("x-dopedb-managed-provisioning-contract") !== "lifecycle-v1") {
    return jsonError("Update DopeDB to provision managed database access safely", 426);
  }
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) {
    return jsonError("Invalid workspace or connection id", 400);
  }
  const parsed = await boundedJsonBody(request, 64);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large"
        ? "Managed provisioning request is too large"
        : "Invalid managed provisioning request",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  try {
    const body = parsed.value as Record<string, unknown>;
    if (
      !body
      || Array.isArray(body)
      || Object.keys(body).length !== 1
      || body.action !== "prepare"
    ) {
      return jsonError("Invalid managed provisioning request", 400);
    }
  } catch {
    return jsonError("Invalid managed provisioning request", 400);
  }

  const authorization = await authorizeWorkspaceConnection(
    request,
    workspaceId,
    connectionId,
    "manage",
  );
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  try {
    const initial = await loadProviderProvisioningTarget({
      organizationId: workspaceId,
      connectionId,
    });
    if (
      !initial
      || !["planetScale", "neon", "gcpCloudSql"].includes(initial.provider)
    ) {
      return jsonError("Managed Access target is unavailable", 409);
    }
    const integration = await activeProviderIntegration(workspaceId, initial.integrationId);
    if (
      !integration
      || integration.provider !== initial.provider
      || integration.generation.toString() !== initial.integrationGeneration
    ) {
      return jsonError("Managed Access integration changed", 409);
    }
    const resource = parseManagedProviderResource(
      integration.provider,
      initial.resource,
    );
    const verification = integration.provider === "planetScale"
      ? await validatePlanetScaleResource(
          await providerAccessToken(integration, {
            organizationId: workspaceId,
            membershipId: authorization.membership.id,
            userId: authorization.session.user.id,
            sessionId: authorization.session.session.id,
            role: authorization.role,
          }),
          resource as PlanetScaleResource,
          {
            production: initial.production,
            safeMigrations: initial.safeMigrations,
          },
        )
      : integration.provider === "neon"
        ? await validateNeonResource(
            await verifiedNeonCredential(integration),
            resource as NeonResource,
            "write",
            initial.production,
          )
        : await validateGcpCloudSqlResource(
          gcpCredential(integration),
          requiredOidcToken(await workloadOidcToken()),
          resource as GcpCloudSqlResource,
        );
    const target = await loadProviderProvisioningTarget({
      organizationId: workspaceId,
      connectionId,
    });
    if (
      !target
      || target.provider !== initial.provider
      || target.integrationId !== initial.integrationId
      || target.integrationGeneration !== integration.generation.toString()
      || target.connectionRevision !== initial.connectionRevision
      || target.resourceFingerprint !== initial.resourceFingerprint
    ) {
      return jsonError("Managed Access target changed", 409);
    }
    return privateJson({ target, verification }, {
      headers: {
        pragma: "no-cache",
        expires: "0",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("Managed Access preparation failed", 502);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return jsonError("Desktop bearer authentication is required", 401);
  }
  if (request.headers.get("x-dopedb-managed-provisioning-contract") !== "lifecycle-v1") {
    return jsonError("Update DopeDB to destroy managed database access safely", 426);
  }
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) {
    return jsonError("Invalid workspace or connection id", 400);
  }
  const parsed = await boundedJsonBody(request, 1_024);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large"
        ? "Managed provisioning destroy request is too large"
        : "Invalid managed provisioning destroy request",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  let pins: {
    connectionRevision: string;
    integrationId: string;
    integrationGeneration: string;
    resourceFingerprint: string;
    providerAuditId: string;
    ownershipMarker: string;
  };
  try {
    const body = parsed.value as Record<string, unknown>;
    const fields = [
      "action",
      "connectionRevision",
      "integrationId",
      "integrationGeneration",
      "resourceFingerprint",
      "providerAuditId",
      "ownershipMarker",
    ];
    if (
      !body
      || Array.isArray(body)
      || Object.keys(body).length !== fields.length
      || fields.some((field) => !Object.hasOwn(body, field))
      || body.action !== "destroy"
      || typeof body.connectionRevision !== "string"
      || !/^[1-9][0-9]{0,15}$/.test(body.connectionRevision)
      || typeof body.integrationId !== "string"
      || !isUuid(body.integrationId)
      || typeof body.integrationGeneration !== "string"
      || !/^[1-9][0-9]{0,18}$/.test(body.integrationGeneration)
      || typeof body.resourceFingerprint !== "string"
      || !/^[0-9a-f]{64}$/.test(body.resourceFingerprint)
      || typeof body.providerAuditId !== "string"
      || body.providerAuditId.length === 0
      || body.providerAuditId.length > 512
      || /[\u0000-\u001f\u007f]/.test(body.providerAuditId)
      || (
        body.ownershipMarker !== ownershipMarker("planetScale", connectionId)
        && body.ownershipMarker !== ownershipMarker("neon", connectionId)
        && body.ownershipMarker !== ownershipMarker("gcpCloudSql", connectionId)
      )
    ) {
      return jsonError("Invalid managed provisioning destroy request", 400);
    }
    pins = {
      connectionRevision: body.connectionRevision,
      integrationId: body.integrationId,
      integrationGeneration: body.integrationGeneration,
      resourceFingerprint: body.resourceFingerprint,
      providerAuditId: body.providerAuditId,
      ownershipMarker: body.ownershipMarker,
    };
  } catch {
    return jsonError("Invalid managed provisioning destroy request", 400);
  }

  const authorization = await authorizeWorkspaceConnection(
    request,
    workspaceId,
    connectionId,
    "manage",
  );
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  try {
    const initial = await loadProviderProvisioningTarget({
      organizationId: workspaceId,
      connectionId,
      cleanup: true,
    });
    if (
      !initial
      || !["planetScale", "neon", "gcpCloudSql"].includes(initial.provider)
      || initial.integrationId !== pins.integrationId
      || initial.resourceFingerprint !== pins.resourceFingerprint
      || BigInt(pins.connectionRevision) > BigInt(initial.connectionRevision)
      || BigInt(pins.integrationGeneration) > BigInt(initial.integrationGeneration)
      || pins.ownershipMarker !== ownershipMarker(initial.provider, connectionId)
    ) {
      return jsonError("Managed Access target changed", 409);
    }
    const integration = await activeProviderIntegration(workspaceId, pins.integrationId);
    if (
      !integration
      || integration.provider !== initial.provider
      || integration.generation.toString() !== initial.integrationGeneration
    ) {
      return jsonError("Managed Access integration changed", 409);
    }
    const resource = parseManagedProviderResource(
      integration.provider,
      initial.resource,
    );
    const verification = integration.provider === "planetScale"
      ? await inspectPlanetScaleResourceIdentity(
          await providerAccessToken(integration, {
            organizationId: workspaceId,
            membershipId: authorization.membership.id,
            userId: authorization.session.user.id,
            sessionId: authorization.session.session.id,
            role: authorization.role,
          }),
          resource as PlanetScaleResource,
        )
      : integration.provider === "neon"
        ? await inspectNeonResourceIdentity(
            neonCredential(integration),
            resource as NeonResource,
          )
        : await validateGcpCloudSqlResource(
          gcpCredential(integration),
          requiredOidcToken(await workloadOidcToken()),
          resource as GcpCloudSqlResource,
        );
    if (verification.providerAuditId !== pins.providerAuditId) {
      return jsonError("Managed Access provider identity changed", 409);
    }
    const fresh = await loadProviderProvisioningTarget({
      organizationId: workspaceId,
      connectionId,
      cleanup: true,
    });
    if (
      !fresh
      || fresh.integrationId !== initial.integrationId
      || fresh.integrationGeneration !== integration.generation.toString()
      || fresh.connectionRevision !== initial.connectionRevision
      || fresh.resourceFingerprint !== initial.resourceFingerprint
    ) {
      return jsonError("Managed Access target changed", 409);
    }
    const result = await revokeActiveLeases({
      organizationId: workspaceId,
      connectionId,
    });
    if (result.deferred > 0) {
      await db.insert(workspaceAuditEvent).values({
        organizationId: workspaceId,
        actorUserId: authorization.session.user.id,
        action: "provider.provisioning.destroy_deferred",
        resourceType: "connection",
        resourceId: connectionId,
        redactedSummary: {
          provider: initial.provider,
          providerAuditId: verification.providerAuditId,
          ownershipMarker: pins.ownershipMarker,
          revokedCredentials: result.revoked,
          deferredCredentials: result.deferred,
        },
        requestId: crypto.randomUUID(),
      });
      return jsonError("Managed Access credentials could not all be revoked", 503);
    }
    await db.insert(workspaceAuditEvent).values({
      organizationId: workspaceId,
      actorUserId: authorization.session.user.id,
      action: "provider.provisioning.destroy",
      resourceType: "connection",
      resourceId: connectionId,
      redactedSummary: {
        provider: initial.provider,
        providerAuditId: verification.providerAuditId,
        ownershipMarker: pins.ownershipMarker,
        revokedCredentials: result.revoked,
      },
      requestId: crypto.randomUUID(),
    });
    return privateJson({
      destroyed: true,
      revoked: result.revoked,
      providerAuditId: verification.providerAuditId,
    });
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("Managed Access destroy failed", 502);
  }
}
