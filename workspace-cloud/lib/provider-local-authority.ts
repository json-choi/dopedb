// Read-only, redacted integration projection for device-local provider binding.
// This is the only database-facing port used by the local-authority route.
import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { workspaceProviderIntegration } from "./schema";
import type { GcpLocalVerificationTarget } from "./providers/gcp-cloud-sql-core";

const PROVIDERS = ["neon", "gcpCloudSql", "planetScale"] as const;
const STATUSES = ["active", "reconnect_required"] as const;
const MAX_DISPLAY_NAME = 256;
const MAX_GRANTED_SCOPE = 512;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LocalProviderAuthorityIntegration = Readonly<{
  id: string;
  provider: (typeof PROVIDERS)[number];
  status: (typeof STATUSES)[number];
  generation: string;
  displayName: string;
  grantedScope: string;
  reconnectRequired: boolean;
  verificationTarget?: GcpLocalVerificationTarget;
}>;

type IntegrationRow = {
  id: string;
  provider: string;
  status: string;
  generation: bigint;
  displayName: string;
  grantedScope: string | null;
  localVerificationTarget: unknown;
};

function isSafeText(value: string, maxLength: number, allowEmpty = false) {
  return (allowEmpty || value.length > 0)
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isProvider(value: string): value is LocalProviderAuthorityIntegration["provider"] {
  return (PROVIDERS as readonly string[]).includes(value);
}

function isStatus(value: string): value is LocalProviderAuthorityIntegration["status"] {
  return (STATUSES as readonly string[]).includes(value);
}

function isGcpVerificationTarget(value: unknown): value is GcpLocalVerificationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  const keys = Object.keys(target).sort();
  if (keys.join(",") !== "instanceId,kind,projectId") return false;
  const identifier = (candidate: unknown, maximum: number) => typeof candidate === "string"
    && candidate.length > 0 && candidate.length <= maximum && /^[A-Za-z0-9_-]+$/.test(candidate);
  return target.kind === "gcpCloudSql"
    && typeof target.projectId === "string"
    && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(target.projectId)
    && identifier(target.instanceId, 99);
}

/**
 * Narrows database rows into the exact secret-free local-binding authority wire.
 * Rejecting malformed metadata prevents an unsafe row from becoming device state.
 */
export function projectLocalProviderAuthority(
  row: IntegrationRow,
): LocalProviderAuthorityIntegration {
  const grantedScope = row.provider === "gcpCloudSql" ? "adcWif" : row.grantedScope ?? "";
  const verificationTarget = row.localVerificationTarget === null
    ? undefined
    : row.localVerificationTarget;
  if (
    !isProvider(row.provider)
    || !isStatus(row.status)
    || typeof row.generation !== "bigint"
    || row.generation < 1n
    || !UUID.test(row.id)
    || !isSafeText(row.displayName, MAX_DISPLAY_NAME)
    || !isSafeText(grantedScope, MAX_GRANTED_SCOPE, true)
    || (row.provider === "gcpCloudSql" && !isGcpVerificationTarget(verificationTarget))
    || (row.provider !== "gcpCloudSql" && verificationTarget !== undefined)
    || (verificationTarget !== undefined && !isGcpVerificationTarget(verificationTarget))
  ) {
    throw new Error("Invalid local provider authority projection");
  }
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    generation: row.generation.toString(),
    displayName: row.displayName,
    grantedScope,
    reconnectRequired: row.status === "reconnect_required",
    ...(verificationTarget ? { verificationTarget } : {}),
  };
}

/**
 * Reads only integrations that belong to the already-authorized workspace.
 * The organization predicate shares the projection query, so an integration UUID
 * from another tenant can never be observed through this port.
 */
export async function listLocalProviderAuthority(
  organizationId: string,
): Promise<LocalProviderAuthorityIntegration[]> {
  const rows = await db.select({
    id: workspaceProviderIntegration.id,
    provider: workspaceProviderIntegration.provider,
    status: workspaceProviderIntegration.status,
    generation: workspaceProviderIntegration.generation,
    displayName: workspaceProviderIntegration.displayName,
    grantedScope: workspaceProviderIntegration.grantedScope,
    localVerificationTarget: workspaceProviderIntegration.localVerificationTarget,
  }).from(workspaceProviderIntegration).where(and(
    eq(workspaceProviderIntegration.organizationId, organizationId),
    inArray(workspaceProviderIntegration.provider, PROVIDERS),
    inArray(workspaceProviderIntegration.status, STATUSES),
  ));
  return rows.map(projectLocalProviderAuthority);
}
