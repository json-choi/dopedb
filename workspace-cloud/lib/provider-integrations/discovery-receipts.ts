import "server-only";

import { sql } from "drizzle-orm";

import { db } from "../db";
import {
  workspaceProviderDiscoveryReceipt,
  workspaceProviderIntegration,
  workspaceProviderResource,
} from "../schema";
import { revocationGateLockKey } from "../revocation-gates";
import { kickWorkspaceBackgroundTask } from "../workspace-background-scheduler";
import { discoveredProviderResource } from "./domain";

type ProviderDiscoveryReceiptRow = {
  id: string;
  expiresAt: Date | string;
};

// Neon returns timestamptz columns as strings, while some test and driver paths
// use Date. Normalize this one database boundary before a route serializes it;
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
  const now = new Date();
  const result = await db.execute<ProviderDiscoveryReceiptRow>(sql`
    WITH member_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${revocationGateLockKey({
        kind: "member", organizationId: input.organizationId, memberId: input.memberId, userId: input.userId,
      })}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member ON member."id" = ${input.memberId}
        AND member."organization_id" = ${input.organizationId} AND member."user_id" = ${input.userId}
      JOIN member_lock ON TRUE
      WHERE session."id" = ${input.sessionId} AND session."user_id" = ${input.userId}
        AND session."expires_at" > now() AND member."role" = ${input.role}
        AND member."revocation_pending_at" IS NULL AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member
    ), active_integration AS MATERIALIZED (
      SELECT integration."id", integration."generation" AS "generation"
      FROM ${workspaceProviderIntegration} AS integration
      JOIN authority ON TRUE
      WHERE integration."id" = ${input.integrationId}::uuid
        AND integration."organization_id" = ${input.organizationId}
        AND integration."provider" = ${input.provider}
        AND integration."generation" = ${input.integrationGeneration}
        AND integration."status" = 'active'
        AND integration."refresh_phase" = 'idle'
        AND integration."revoked_at" IS NULL
        AND integration."revocation_pending_at" IS NULL
        AND integration."revocation_claim_id" IS NULL
      FOR UPDATE OF integration
    ), existing_receipt AS MATERIALIZED (
      SELECT receipt."id", receipt."expires_at" AS "expiresAt"
      FROM ${workspaceProviderDiscoveryReceipt} AS receipt
      JOIN ${workspaceProviderResource} AS resource
        ON resource."organization_id" = receipt."organization_id"
       AND resource."id" = receipt."resource_id"
      JOIN active_integration AS integration
        ON integration."id" = receipt."integration_id"
       AND integration."generation" = receipt."integration_generation"
      WHERE receipt."id" = ${input.receiptId}::uuid
        AND receipt."organization_id" = ${input.organizationId}
        AND receipt."integration_id" = ${input.integrationId}::uuid
        AND receipt."integration_generation" = ${input.integrationGeneration}
        AND receipt."member_id" = ${input.memberId}
        AND receipt."user_id" = ${input.userId}
        AND receipt."session_id" = ${input.sessionId}
        AND receipt."expires_at" = ${input.expiresAt}
        AND resource."provider" = ${input.provider}
        AND resource."resource_fingerprint" = ${input.projection.fingerprint}
        AND resource."resource" = ${JSON.stringify(input.projection.resource)}::jsonb
        AND resource."redacted_metadata" = ${JSON.stringify(input.projection.metadata)}::jsonb
        AND resource."capability_manifest" = ${JSON.stringify(input.projection.capabilities)}::jsonb
      FOR UPDATE OF receipt, resource
    ), canonical_resource AS MATERIALIZED (
      INSERT INTO ${workspaceProviderResource}
        ("organization_id", "provider", "resource_fingerprint", "resource",
         "redacted_metadata", "capability_manifest", "updated_at")
      SELECT ${input.organizationId}, ${input.provider}, ${input.projection.fingerprint},
        ${JSON.stringify(input.projection.resource)}::jsonb,
        ${JSON.stringify(input.projection.metadata)}::jsonb,
        ${JSON.stringify(input.projection.capabilities)}::jsonb, ${now}
      FROM active_integration
      WHERE NOT EXISTS (SELECT 1 FROM existing_receipt)
      ON CONFLICT ("organization_id", "provider", "resource_fingerprint")
      DO UPDATE SET
        "resource" = EXCLUDED."resource",
        "redacted_metadata" = EXCLUDED."redacted_metadata",
        "capability_manifest" = EXCLUDED."capability_manifest",
        "updated_at" = EXCLUDED."updated_at"
      RETURNING "id"
    ), issued AS MATERIALIZED (
      INSERT INTO ${workspaceProviderDiscoveryReceipt} AS existing
        ("id", "organization_id", "resource_id", "integration_id", "integration_generation",
         "member_id", "user_id", "session_id", "expires_at")
      SELECT ${input.receiptId}::uuid, ${input.organizationId}, resource."id", integration."id",
        integration."generation", ${input.memberId}, ${input.userId}, ${input.sessionId}, ${input.expiresAt}
      FROM canonical_resource AS resource
      JOIN active_integration AS integration ON TRUE
      ON CONFLICT ("id") DO UPDATE
      SET "expires_at" = existing."expires_at"
      WHERE existing."organization_id" = EXCLUDED."organization_id"
        AND existing."resource_id" = EXCLUDED."resource_id"
        AND existing."integration_id" = EXCLUDED."integration_id"
        AND existing."integration_generation" = EXCLUDED."integration_generation"
        AND existing."member_id" = EXCLUDED."member_id"
        AND existing."user_id" = EXCLUDED."user_id"
        AND existing."session_id" = EXCLUDED."session_id"
        AND existing."expires_at" = EXCLUDED."expires_at"
      RETURNING "id" AS "id", "expires_at" AS "expiresAt"
    )
    SELECT "id", "expiresAt" FROM existing_receipt
    UNION ALL
    SELECT "id", "expiresAt" FROM issued
    LIMIT 1
  `);
  const receipt = providerDiscoveryReceiptRow(result.rows[0]);
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
export async function revalidateProviderDiscoveryAuthority(input: {
  organizationId: string; integrationId: string; provider: string; integrationGeneration: bigint;
  memberId: string; userId: string; sessionId: string; role: string;
}) {
  const result = await db.execute<{ ok: boolean }>(sql`
    WITH member_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${revocationGateLockKey({
        kind: "member", organizationId: input.organizationId, memberId: input.memberId, userId: input.userId,
      })}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member ON member."id" = ${input.memberId}
        AND member."organization_id" = ${input.organizationId} AND member."user_id" = ${input.userId}
      JOIN member_lock ON TRUE
      WHERE session."id" = ${input.sessionId} AND session."user_id" = ${input.userId}
        AND session."expires_at" > now() AND member."role" = ${input.role}
        AND member."revocation_pending_at" IS NULL AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member
    ), integration AS MATERIALIZED (
      SELECT integration."id" FROM ${workspaceProviderIntegration} integration JOIN authority ON TRUE
      WHERE integration."id" = ${input.integrationId}::uuid
        AND integration."organization_id" = ${input.organizationId} AND integration."provider" = ${input.provider}
        AND integration."generation" = ${input.integrationGeneration}
        AND integration."status" = 'active' AND integration."refresh_phase" = 'idle'
        AND integration."revoked_at" IS NULL
        AND integration."revocation_pending_at" IS NULL AND integration."revocation_claim_id" IS NULL
      FOR UPDATE OF integration
    ) SELECT EXISTS (SELECT 1 FROM integration) AS "ok"
  `);
  return result.rows[0]?.ok === true;
}
