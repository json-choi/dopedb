import "server-only";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { workspaceCredentialLease } from "../schema";
import {
  issuePlanetScaleLease,
  PlanetScaleLeaseCleanupRequiredError,
  revokePlanetScaleLease,
  validatePlanetScaleResource,
  type PlanetScaleResource,
} from "../providers/planetscale";
import {
  issueNeonLease,
  NeonLeaseCleanupRequiredError,
  neonRoleForLease,
  revokeNeonLease,
  validateNeonResource,
} from "../providers/neon";
import type { NeonResource } from "../providers/neon-core";
import {
  issueGcpCloudSqlLease,
  validateGcpCloudSqlResource,
} from "../providers/gcp-cloud-sql";
import type { GcpCloudSqlResource } from "../providers/gcp-cloud-sql-core";
import {
  issueVaultLease,
  revokeVaultLease,
  VaultLeaseCleanupRequiredError,
  type VaultManagedResource,
} from "../providers/vault";
import {
  issueAfterFreshProviderAuthority,
  ProviderRequestError,
  verifiedProviderAuditId,
  type ManagedProviderLease,
} from "../providers/provider-types";
import {
  finalizeManagedLeaseIfUnblocked,
  reserveManagedLeaseIfUnblocked,
  type ManagedLeaseAuthority,
} from "../revocation-gates";
import { requireNeonBranchManagedAccessReady } from "../provider-operation-store";
import type { WorkspaceRoleName } from "../workspace-permissions";
import type { ActiveProviderIntegration } from "./authority";
import type { ManagedProviderResource } from "./domain";
import {
  currentPlanetScaleAccessToken,
  gcpCredential,
  neonCredential,
  providerAccessToken,
  requiredOidcToken,
  vaultCredential,
  verifiedNeonCredential,
} from "./integration";
import { cleanupExpiredManagedLeases } from "./lease-cleanup";

async function bestEffortRevokeLease(input: {
  integration: ActiveProviderIntegration;
  resource: ManagedProviderResource;
  lease: ManagedProviderLease;
  planetScaleToken?: string;
}) {
  if (
    input.integration.provider === "planetScale"
    && (input.lease.externalCredentialKind === "role"
      || input.lease.externalCredentialKind === "password")
  ) {
    const token = input.planetScaleToken
      ?? currentPlanetScaleAccessToken(input.integration);
    await revokePlanetScaleLease(
      token,
      input.resource as PlanetScaleResource,
      input.lease.externalCredentialKind,
      input.lease.externalCredentialId,
    );
  } else if (
    input.integration.provider === "neon"
    && input.lease.externalCredentialKind === "role"
  ) {
    await revokeNeonLease(
      neonCredential(input.integration),
      input.resource as NeonResource,
      input.lease.externalCredentialId,
    );
  } else if (
    input.integration.provider === "vault"
    && input.lease.externalCredentialKind === "role"
  ) {
    await revokeVaultLease(
      vaultCredential(input.integration),
      input.lease.externalCredentialId,
    );
  }
  // Cloud SQL IAM access tokens have no token-revocation API. If the one-time
  // response was not delivered, it is unreachable and expires within 15 minutes.
}

export async function issueManagedLease(input: {
  organizationId: string;
  connectionId: string;
  userId: string;
  memberId: string;
  sessionId: string;
  role: WorkspaceRoleName;
  connectionRevision: number;
  connectionProvider: string;
  providerResourceId: string;
  engine: "postgres" | "mysql";
  production: boolean;
  safeMigrations: boolean | null;
  accessMode: "read" | "write" | "schema";
  integration: ActiveProviderIntegration;
  resource: ManagedProviderResource;
  oidcToken?: string | null;
}): Promise<ManagedProviderLease & { leaseId: string; providerAuditId: string }> {
  if (input.accessMode === "schema" && input.integration.provider !== "neon") {
    throw new ProviderRequestError(
      input.integration.provider,
      "This managed provider does not support short-lived schema access",
      409,
    );
  }
  const leaseId = crypto.randomUUID();
  const label = `dopedb-${input.userId.replace(/-/g, "").slice(0, 8)}-${
    leaseId.replace(/-/g, "").slice(0, 8)
  }`;
  const authority: ManagedLeaseAuthority = {
    leaseId,
    organizationId: input.organizationId,
    memberId: input.memberId,
    userId: input.userId,
    sessionId: input.sessionId,
    role: input.role,
    connectionId: input.connectionId,
    integrationId: input.integration.id,
    integrationGeneration: input.integration.generation,
    connectionProvider: input.connectionProvider,
    provider: input.integration.provider,
    connectionRevision: input.connectionRevision,
    providerResourceId: input.providerResourceId,
    engine: input.engine,
    accessMode: input.accessMode,
  };
  if (input.integration.provider === "neon") {
    const resource = input.resource as NeonResource;
    await requireNeonBranchManagedAccessReady({
      organizationId: input.organizationId,
      integrationId: input.integration.id,
      integrationGeneration: input.integration.generation,
      projectId: resource.project,
      branchId: resource.branch,
    });
  }
  // Every active managed-access request also repairs a missed event-driven
  // cleanup wake-up. Provider expiry remains authoritative; only a Neon schema
  // lease must wait for physical role cleanup because it temporarily owns the
  // connection-wide policy role.
  const cleanupMustComplete = input.integration.provider === "neon"
    && input.accessMode === "schema";
  let cleanupDeferred = 0;
  try {
    cleanupDeferred = (await cleanupExpiredManagedLeases({
      integrationId: input.integration.id,
      limit: input.accessMode === "schema" ? 20 : 2,
    })).deferred;
  } catch (error) {
    if (cleanupMustComplete) {
      if (error instanceof ProviderRequestError) throw error;
      throw new ProviderRequestError(
        "neon",
        "Expired Neon database access cleanup could not be verified",
        503,
      );
    }
  }
  if (cleanupMustComplete && cleanupDeferred > 0) {
    throw new ProviderRequestError(
      "neon",
      "Expired Neon database access could not be cleaned up",
      503,
    );
  }
  const reservation = await reserveManagedLeaseIfUnblocked(authority);
  if (reservation !== "reserved") {
    throw new ProviderRequestError(
      input.integration.provider,
      reservation === "schema_busy"
        ? "Another managed schema change session is active for this connection"
        : reservation === "limit"
          ? "Too many active database sessions. Retry after leases expire."
          : "Workspace database authority is changing. Retry shortly.",
      reservation === "limit" ? 429 : 409,
    );
  }

  let planetScaleToken: string | undefined;
  let providerAuditId: string | null = null;
  let lease: ManagedProviderLease;
  try {
    switch (input.integration.provider) {
      case "planetScale": {
        if (input.accessMode === "schema") {
          throw new ProviderRequestError(
            "planetScale",
            "PlanetScale managed schema access is not supported",
            409,
          );
        }
        const accessMode = input.accessMode;
        lease = await issueAfterFreshProviderAuthority(
          "planetScale",
          async () => {
            const token = await providerAccessToken(input.integration, {
              organizationId: input.organizationId,
              membershipId: input.memberId,
              userId: input.userId,
              sessionId: input.sessionId,
              role: input.role,
              lease: {
                connectionId: input.connectionId,
                connectionRevision: input.connectionRevision,
                providerResourceId: input.providerResourceId,
              },
            });
            // Re-read the exact canonical branch immediately before the provider
            // creates a database role/password. Discovery-time safety is never a
            // substitute for this live production/readiness check.
            const verification = await validatePlanetScaleResource(
              token,
              input.resource as PlanetScaleResource,
              {
                production: input.production,
                safeMigrations: input.safeMigrations,
              },
            );
            return {
              token,
              providerAuditId: verifiedProviderAuditId(
                "planetScale",
                verification.providerAuditId,
              ),
            };
          },
          async (proof) => {
            planetScaleToken = proof.token;
            providerAuditId = proof.providerAuditId;
            return issuePlanetScaleLease(
              proof.token,
              input.resource as PlanetScaleResource,
              accessMode,
              label,
            );
          },
        );
        break;
      }
      case "neon": {
        lease = await issueAfterFreshProviderAuthority(
          "neon",
          async () => {
            const credential = await verifiedNeonCredential(input.integration);
            const verification = await validateNeonResource(
              credential,
              input.resource as NeonResource,
              input.accessMode,
              input.production,
            );
            return {
              credential,
              providerAuditId: verifiedProviderAuditId(
                "neon",
                verification.providerAuditId,
              ),
            };
          },
          (proof) => {
            providerAuditId = proof.providerAuditId;
            return issueNeonLease({
              credential: proof.credential,
              resource: input.resource as NeonResource,
              accessMode: input.accessMode,
              production: input.production,
              role: neonRoleForLease(input.userId, leaseId),
            });
          },
        );
        break;
      }
      case "gcpCloudSql": {
        if (input.accessMode === "schema") {
          throw new ProviderRequestError(
            "gcpCloudSql",
            "Cloud SQL managed schema access is not supported",
            409,
          );
        }
        const credential = gcpCredential(input.integration);
        const oidcToken = requiredOidcToken(input.oidcToken);
        lease = await issueAfterFreshProviderAuthority(
          "gcpCloudSql",
          async () => {
            const verification = await validateGcpCloudSqlResource(
              credential,
              oidcToken,
              input.resource as GcpCloudSqlResource,
            );
            return {
              credential,
              oidcToken,
              providerAuditId: verifiedProviderAuditId(
                "gcpCloudSql",
                verification.providerAuditId,
              ),
            };
          },
          (fresh) => {
            providerAuditId = fresh.providerAuditId;
            return issueGcpCloudSqlLease({
              credential: fresh.credential,
              oidcToken: fresh.oidcToken,
              resource: input.resource as GcpCloudSqlResource,
              accessMode: input.accessMode,
              externalCredentialId: leaseId,
            });
          },
        );
        break;
      }
      case "vault": {
        if (input.accessMode === "schema") {
          throw new ProviderRequestError(
            "vault",
            "Vault schema access requires a separately verified dynamic role",
            409,
          );
        }
        const credential = vaultCredential(input.integration);
        const issued = await issueVaultLease({
          credential,
          resource: input.resource as VaultManagedResource,
          accessMode: input.accessMode,
        });
        providerAuditId = verifiedProviderAuditId(
          "vault",
          issued.providerAuditId,
        );
        lease = issued;
        break;
      }
      default:
        throw new Error("Managed credential provider is not available");
    }
    if (providerAuditId === null) {
      throw new ProviderRequestError(
        input.integration.provider,
        "Provider security validation omitted its audit identifier",
        502,
      );
    }
    // PlanetScale refresh rotates the durable integration generation before
    // credential creation. Finalization must bind to that exact new generation;
    // any independent reconnect/revoke after this point still fails the CAS.
    authority.integrationGeneration = input.integration.generation;
  } catch (error) {
    if (
      error instanceof PlanetScaleLeaseCleanupRequiredError
      || error instanceof NeonLeaseCleanupRequiredError
      || error instanceof VaultLeaseCleanupRequiredError
    ) {
      const provider = error instanceof NeonLeaseCleanupRequiredError
        ? "neon"
        : error instanceof VaultLeaseCleanupRequiredError
          ? "vault"
          : "planetScale";
      const cleanupAuditId = error instanceof VaultLeaseCleanupRequiredError
        ? verifiedProviderAuditId("vault", error.providerAuditId)
        : providerAuditId;
      const queued = await db.update(workspaceCredentialLease)
        .set({
          externalCredentialId: error.externalCredentialId,
          externalCredentialKind: error instanceof NeonLeaseCleanupRequiredError
            ? "role"
            : error instanceof VaultLeaseCleanupRequiredError
              ? "role"
            : error.externalCredentialKind,
          providerAuditId: cleanupAuditId,
          expiresAt: new Date(),
        })
        .where(eq(workspaceCredentialLease.id, leaseId))
        .returning({ id: workspaceCredentialLease.id });
      if (queued.length !== 1) {
        throw new ProviderRequestError(
          provider,
          `${provider === "neon" ? "Neon" : provider === "vault" ? "Vault" : "PlanetScale"} credential cleanup could not be queued`,
          503,
        );
      }
      throw error;
    }
    await db.update(workspaceCredentialLease)
      .set(input.integration.provider === "neon"
        ? { expiresAt: new Date(), providerAuditId }
        : { revokedAt: new Date(), providerAuditId })
      .where(eq(workspaceCredentialLease.id, leaseId))
      .catch(() => undefined);
    throw error;
  }

  try {
    if (!await finalizeManagedLeaseIfUnblocked(
      authority,
      lease,
      providerAuditId,
    )) {
      throw new Error("Managed lease reservation is no longer active");
    }
  } catch (error) {
    let revoked = false;
    try {
      await bestEffortRevokeLease({
        integration: input.integration,
        resource: input.resource,
        lease,
        planetScaleToken,
      });
      revoked = true;
    } catch {
      // Leave failed Neon cleanup visible to the durable expiry sweeper.
    }
    await db.update(workspaceCredentialLease)
      .set(input.integration.provider === "vault" && !revoked
        ? {
            externalCredentialId: lease.externalCredentialId,
            externalCredentialKind: lease.externalCredentialKind,
            expiresAt: new Date(),
            providerAuditId,
          }
        : input.integration.provider === "neon" && !revoked
          ? { expiresAt: new Date(), providerAuditId }
          : { revokedAt: new Date(), providerAuditId })
      .where(eq(workspaceCredentialLease.id, leaseId))
      .catch(() => undefined);
    throw error;
  }
  return { ...lease, leaseId, providerAuditId };
}
