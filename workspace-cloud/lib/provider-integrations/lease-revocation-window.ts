import "server-only";

// Read-only revocation preflight. Provider mutation routes use this before
// attempting a change that cannot invalidate an already-issued live credential.
import { and, count, eq, gt, isNull, max } from "drizzle-orm";

import { db } from "../db";
import { workspaceCredentialLease } from "../schema";

export type ActiveLeaseRevocationWindow = {
  activeLeaseCount: number;
  retryAt: Date;
};

export async function activeIntegrationLeaseRevocationWindow(input: {
  organizationId: string;
  integrationId: string;
  now?: Date;
}): Promise<ActiveLeaseRevocationWindow | null> {
  const now = input.now ?? new Date();
  const [window] = await db.select({
    activeLeaseCount: count(),
    retryAt: max(workspaceCredentialLease.expiresAt),
  }).from(workspaceCredentialLease).where(and(
    eq(workspaceCredentialLease.organizationId, input.organizationId),
    eq(workspaceCredentialLease.integrationId, input.integrationId),
    isNull(workspaceCredentialLease.revokedAt),
    gt(workspaceCredentialLease.expiresAt, now),
  ));
  return window?.retryAt && window.activeLeaseCount > 0
    ? window as ActiveLeaseRevocationWindow
    : null;
}

export const GCP_ACTIVE_DATABASE_ACCESS_CODE =
  "gcp_active_database_access" as const;

export function gcpActiveDatabaseAccessConflict(
  window: ActiveLeaseRevocationWindow,
  setupExpiresAt: Date,
) {
  return {
    error: "Active Cloud SQL database access is still valid",
    code: GCP_ACTIVE_DATABASE_ACCESS_CODE,
    activeLeaseCount: window.activeLeaseCount,
    retryAt: window.retryAt.toISOString(),
    setupExpiresAt: setupExpiresAt.toISOString(),
  };
}
