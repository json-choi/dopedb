import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "../db";
import { workspaceProviderIntegration } from "../schema";
import {
  type ActiveProviderIntegration,
  hasStrictGcpLocalVerificationTarget,
} from "./authority";

async function providerIntegration(
  organizationId: string,
  integrationId: string,
  allowPendingRevocation: boolean,
): Promise<ActiveProviderIntegration | null> {
  const predicates = [
    eq(workspaceProviderIntegration.id, integrationId),
    eq(workspaceProviderIntegration.organizationId, organizationId),
    isNull(workspaceProviderIntegration.revokedAt),
  ];
  if (allowPendingRevocation) {
    predicates.push(
      inArray(workspaceProviderIntegration.status, [
        "active",
        "reconnect_required",
      ]),
    );
  } else {
    predicates.push(eq(workspaceProviderIntegration.status, "active"));
    predicates.push(eq(workspaceProviderIntegration.refreshPhase, "idle"));
    predicates.push(
      isNull(workspaceProviderIntegration.revocationPendingAt),
    );
    predicates.push(isNull(workspaceProviderIntegration.revocationClaimId));
  }
  const row = await db.query.workspaceProviderIntegration.findFirst({
    where: and(...predicates),
    columns: {
      id: true,
      organizationId: true,
      provider: true,
      externalAccountId: true,
      encryptedCredential: true,
      credentialExpiresAt: true,
      grantedScope: true,
      generation: true,
      updatedAt: true,
      localVerificationTarget: true,
    },
  });
  // Keep the rolling-deployment gate even though the current DB constraint
  // rejects an active GCP integration without this exact redacted target.
  if (
    !row ||
    (row.provider === "gcpCloudSql" &&
      !hasStrictGcpLocalVerificationTarget(row.localVerificationTarget))
  ) {
    return null;
  }
  return row;
}

export function activeProviderIntegration(
  organizationId: string,
  integrationId: string,
) {
  return providerIntegration(organizationId, integrationId, false);
}

export function providerIntegrationForRevocation(
  organizationId: string,
  integrationId: string,
) {
  return providerIntegration(organizationId, integrationId, true);
}
