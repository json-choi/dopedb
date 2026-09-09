import "server-only";

import { sql } from "drizzle-orm";

import { atomicD1 } from "../d1/atomic";
import { queryD1 } from "../d1/database";
import { jsonEqual } from "../d1/json";
import { utcNow } from "../d1/schema/values";
import { canonicalJson } from "../workspace-versioning";
import { kickWorkspaceBackgroundTask } from "../workspace-background-scheduler";
import { discoveredProviderResource } from "./domain";

type ProviderDiscoveryReceiptRow = {
  id: string;
  expiresAt: Date | string;
};

// Raw D1 returns UTC timestamp text, while ORM projections use Date. Normalize this one database boundary before a route serializes it;
// malformed driver data must not become an externally visible error payload.
function providerDiscoveryReceiptRow(
  row: ProviderDiscoveryReceiptRow | undefined,
): { id: string; expiresAt: Date } | null {
  if (
    !row
    || typeof row.id !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)
  ) {
    return null;
  }
  const expiresAt = row.expiresAt instanceof Date
    ? new Date(row.expiresAt.valueOf())
    : typeof row.expiresAt === "string"
      ? new Date(row.expiresAt)
      : null;
  if (!expiresAt || Number.isNaN(expiresAt.valueOf())) return null;
  return { id: row.id, expiresAt };
}

export async function recordProviderDiscoveryReceipt(input: {
  organizationId: string;
  integrationId: string;
  memberId: string;
  userId: string;
  sessionId: string;
  role: string;
  provider: string;
  integrationGeneration: bigint;
  receiptId: string;
  expiresAt: Date;
  projection: ReturnType<typeof discoveredProviderResource>;
}) {
  if (
    !input.projection
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.receiptId)
    || Number.isNaN(input.expiresAt.valueOf())
    || input.expiresAt.valueOf() <= Date.now()
    || input.expiresAt.valueOf() > Date.now() + 5 * 60 * 1_000
  ) {
    return null;
  }
  const projection = input.projection;
  const resource = canonicalJson(projection.resource);
  const metadata = canonicalJson(projection.metadata);
  const capabilities = canonicalJson(projection.capabilities);
  const result = await atomicD1({
    scope: sql`SELECT json_object('replayed', EXISTS (
        SELECT 1 FROM workspace_provider_discovery_receipt receipt
        JOIN workspace_provider_resource resource ON resource.id = receipt.resource_id
          AND resource.organization_id = receipt.organization_id
        WHERE receipt.id = ${input.receiptId}
          AND ${jsonEqual(sql`resource.resource`, sql`${resource}`)}
          AND ${jsonEqual(sql`resource.redacted_metadata`, sql`${metadata}`)}
          AND ${jsonEqual(sql`resource.capability_manifest`, sql`${capabilities}`)}
      )) AS payload WHERE EXISTS (${discoveryAuthority(input)})
      AND NOT EXISTS (
        SELECT 1 FROM workspace_provider_discovery_receipt receipt
        WHERE receipt.id = ${input.receiptId} AND NOT (
          receipt.organization_id = ${input.organizationId} AND receipt.integration_id = ${input.integrationId}
          AND receipt.integration_generation = ${input.integrationGeneration} AND receipt.member_id = ${input.memberId}
          AND receipt.user_id = ${input.userId} AND receipt.session_id = ${input.sessionId}
          AND receipt.expires_at = ${input.expiresAt} AND EXISTS (
            SELECT 1 FROM workspace_provider_resource resource WHERE resource.id = receipt.resource_id
              AND resource.organization_id = ${input.organizationId} AND resource.provider = ${input.provider}
              AND resource.resource_fingerprint = ${projection.fingerprint})))`,
    statements: (scope) => [
      sql`INSERT INTO workspace_provider_resource (organization_id, provider, resource_fingerprint,
          resource, redacted_metadata, capability_manifest, updated_at)
        SELECT ${input.organizationId}, ${input.provider}, ${projection.fingerprint},
          ${resource}, ${metadata}, ${capabilities}, ${utcNow} FROM (${scope}) WHERE payload ->> 'replayed' = 0
        ON CONFLICT (organization_id, provider, resource_fingerprint) DO UPDATE SET
          resource = excluded.resource, redacted_metadata = excluded.redacted_metadata,
          capability_manifest = excluded.capability_manifest, updated_at = excluded.updated_at`,
      sql`INSERT INTO workspace_provider_discovery_receipt (id, organization_id, resource_id, integration_id,
          integration_generation, member_id, user_id, session_id, expires_at)
        SELECT ${input.receiptId}, ${input.organizationId}, resource.id, ${input.integrationId},
          ${input.integrationGeneration}, ${input.memberId}, ${input.userId}, ${input.sessionId}, ${input.expiresAt}
        FROM workspace_provider_resource resource CROSS JOIN (${scope})
        WHERE resource.organization_id = ${input.organizationId} AND resource.provider = ${input.provider}
          AND resource.resource_fingerprint = ${projection.fingerprint}
        ON CONFLICT (id) DO NOTHING`,
      sql`SELECT id, expires_at AS expiresAt FROM workspace_provider_discovery_receipt CROSS JOIN (${scope})
        WHERE id = ${input.receiptId}`,
    ],
  });
  const receipt = providerDiscoveryReceiptRow(result.rows[2]?.[0] as ProviderDiscoveryReceiptRow | undefined);
  if (receipt) {
    await kickWorkspaceBackgroundTask({
      task: "maintenance",
      notBefore: receipt.expiresAt,
    });
  }
  return receipt;
}

// External discovery may take seconds. Re-check the exact live principal and
// integration immediately before any names/identifiers leave this process.
type DiscoveryAuthority = {
  organizationId: string; integrationId: string; provider: string; integrationGeneration: bigint;
  memberId: string; userId: string; sessionId: string; role: string;
};

function discoveryAuthority(input: DiscoveryAuthority) {
  return sql`SELECT integration.id FROM workspace_provider_integration integration
    JOIN member ON member.organization_id = integration.organization_id AND member.id = ${input.memberId}
      AND member.user_id = ${input.userId}
    JOIN session ON session.id = ${input.sessionId} AND session.user_id = member.user_id
    JOIN workspace_profile profile ON profile.organization_id = integration.organization_id
    WHERE integration.id = ${input.integrationId} AND integration.organization_id = ${input.organizationId}
      AND integration.provider = ${input.provider} AND integration.generation = ${input.integrationGeneration}
      AND integration.status = 'active' AND integration.refresh_phase = 'idle'
      AND integration.revoked_at IS NULL AND integration.revocation_pending_at IS NULL AND integration.revocation_claim_id IS NULL
      AND session.expires_at > ${utcNow} AND member.role = ${input.role}
      AND member.revocation_pending_at IS NULL AND member.revocation_claim_id IS NULL AND profile.lifecycle_state = 'active'`;
}

export async function revalidateProviderDiscoveryAuthority(input: DiscoveryAuthority) {
  const rows = await queryD1<{ ok: number }>(sql`SELECT EXISTS (${discoveryAuthority(input)}) AS ok`);
  return rows[0]?.ok === 1;
}
