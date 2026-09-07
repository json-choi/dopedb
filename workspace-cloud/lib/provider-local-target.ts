// Read-only, tenant-scoped authority for a desktop-local provider credential.
// The cloud never receives that credential; it returns only a canonical, already
// imported target after rechecking the exact live session, member, and grant.
import "server-only";

import { sql } from "drizzle-orm";
import { db } from "./db";
import { revocationGateLockKey } from "./revocation-gates";
import { providerImportAdapters } from "./providers/import-projection";

const AUTHORITY_TTL_MS = 5 * 60 * 1_000;
const MAX_SAFE_REVISION = 9_007_199_254_740_991n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[0-9a-f]{64}$/;

export type ProviderLocalTargetAuthority = Readonly<{
  sessionId: string;
  userId: string;
  membershipId: string;
}>;

export type ProviderLocalTarget = Readonly<{
  connectionId: string;
  connectionRevision: string;
  integrationId: string;
  integrationGeneration: string;
  provider: "neon" | "gcpCloudSql";
  resourceFingerprint: string;
  target: Readonly<{
    project: string;
    branch: string;
    databaseId: string;
    database: string;
    engine: "postgres";
    schemas: readonly string[];
  }> | Readonly<{
    project: string;
    instance: string;
    database: string;
    engine: "postgres" | "mysql";
    networkMode: "PRIVATE_SERVICES_ACCESS" | "PUBLIC" | "PRIVATE_SERVICE_CONNECT";
  }>;
  authorityExpiresAt: string;
}>;

type RawTargetRow = Record<string, unknown>;

function exactRecord(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === fields.length
    && fields.every((field) => Object.hasOwn(record, field))
    ? record
    : null;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function decimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "bigint") return null;
  const text = value.toString();
  if (!/^[1-9][0-9]{0,15}$/.test(text)) return null;
  const parsed = BigInt(text);
  return parsed <= MAX_SAFE_REVISION ? text : null;
}

function parseTarget(provider: "neon" | "gcpCloudSql", resource: unknown) {
  const normalized = providerImportAdapters[provider].reconstruct(resource);
  if (provider === "neon") {
    const value = normalized as {
      project: string; branch: string; databaseId: string; database: string;
      engine: "postgres"; schemas: string[];
    };
    return {
      project: value.project,
      branch: value.branch,
      databaseId: value.databaseId,
      database: value.database,
      engine: "postgres" as const,
      schemas: [...value.schemas],
    };
  }
  const value = normalized as {
    project: string; instance: string; database: string;
    engine: "postgres" | "mysql";
    networkMode: "PRIVATE_SERVICES_ACCESS" | "PUBLIC" | "PRIVATE_SERVICE_CONNECT";
  };
  return {
    project: value.project,
    instance: value.instance,
    database: value.database,
    engine: value.engine,
    networkMode: value.networkMode,
  };
}

/**
 * Validates the only public shape of a local target. Rows are deliberately
 * reconstructed from provider-specific allowlists, never cast from SQL JSON.
 */
export function parseProviderLocalTarget(
  value: unknown,
  now = new Date(),
): ProviderLocalTarget | null {
  const record = exactRecord(value, [
    "connectionId", "connectionRevision", "integrationId", "integrationGeneration",
    "provider", "resourceFingerprint", "resource",
  ]);
  if (
    !record
    || !uuid(record.connectionId)
    || !uuid(record.integrationId)
    || (record.provider !== "neon" && record.provider !== "gcpCloudSql")
    || typeof record.resourceFingerprint !== "string"
    || !FINGERPRINT.test(record.resourceFingerprint)
  ) {
    return null;
  }
  const connectionRevision = decimal(record.connectionRevision);
  const integrationGeneration = decimal(record.integrationGeneration);
  if (!connectionRevision || !integrationGeneration || Number.isNaN(now.valueOf())) return null;
  try {
    return {
      connectionId: record.connectionId,
      connectionRevision,
      integrationId: record.integrationId,
      integrationGeneration,
      provider: record.provider,
      resourceFingerprint: record.resourceFingerprint,
      target: parseTarget(record.provider, record.resource),
      authorityExpiresAt: new Date(now.valueOf() + AUTHORITY_TTL_MS).toISOString(),
    };
  } catch {
    return null;
  }
}

function memberLock(input: { organizationId: string; authority: ProviderLocalTargetAuthority }) {
  return revocationGateLockKey({
    kind: "member",
    organizationId: input.organizationId,
    memberId: input.authority.membershipId,
    userId: input.authority.userId,
  });
}

/**
 * Revalidates all durable authority in one locked query. It intentionally has
 * no receipt creation or other write: the returned target is an ephemeral
 * desktop hint and cannot be replayed as cloud import authority.
 */
export async function loadProviderLocalTarget(input: {
  organizationId: string;
  connectionId: string;
  authority: ProviderLocalTargetAuthority;
  now?: Date;
}): Promise<ProviderLocalTarget | null> {
  const result = await db.execute<RawTargetRow>(sql`
    WITH member_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${memberLock(input)}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id"
      FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
        ON member."id" = ${input.authority.membershipId}
       AND member."organization_id" = ${input.organizationId}
       AND member."user_id" = ${input.authority.userId}
      JOIN member_lock ON TRUE
      WHERE session."id" = ${input.authority.sessionId}
        AND session."user_id" = ${input.authority.userId}
        AND session."expires_at" > now()
        AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member
    ), target AS MATERIALIZED (
      SELECT
        connection."id" AS "connectionId",
        connection."revision" AS "connectionRevision",
        integration."id" AS "integrationId",
        integration."generation" AS "integrationGeneration",
        integration."provider" AS "provider",
        resource."resource_fingerprint" AS "resourceFingerprint",
        resource."resource" AS "resource"
      FROM "workspace_control"."workspace_connection_grant" member_grant
      JOIN "workspace_control"."workspace_connection" connection
        ON connection."organization_id" = member_grant."organization_id"
       AND connection."id" = member_grant."connection_id"
      JOIN "workspace_control"."workspace_provider_integration" integration
        ON integration."organization_id" = connection."organization_id"
       AND integration."id" = connection."provider_integration_id"
      JOIN "workspace_control"."workspace_provider_resource" resource
        ON resource."organization_id" = connection."organization_id"
       AND resource."id" = connection."provider_resource_id"
      -- The import record is the durable receipt-derived witness.  Its hash
      -- binds the original managed import to this exact integration generation,
      -- resource, organization, and immutable connection name before a
      -- member-local desktop credential may use the target.
      JOIN "workspace_control"."workspace_provider_import_request" imported
        ON imported."organization_id" = connection."organization_id"
       AND imported."connection_id" = connection."id"
       AND imported."resource_id" = resource."id"
      JOIN authority ON authority."id" = member_grant."member_id"
      WHERE member_grant."organization_id" = ${input.organizationId}
        AND member_grant."connection_id" = ${input.connectionId}::uuid
        AND member_grant."member_id" = ${input.authority.membershipId}
        AND member_grant."capability" IN ('read', 'use', 'manage')
        AND connection."deleted_at" IS NULL
        AND connection."revocation_pending_at" IS NULL
        AND connection."revocation_claim_id" IS NULL
        AND connection."readonly_default" = TRUE
        AND connection."allow_writes" = FALSE
        AND connection."credential_mode" = 'member_local'
        AND connection."provider" = integration."provider"
        AND connection."provider" = resource."provider"
        AND connection."provider_resource" = resource."resource"
        AND imported."request_hash" IN (
          encode(digest(jsonb_build_object(
            'integrationGeneration', integration."generation"::text,
            'integrationId', integration."id"::text,
            'mode', 'managed',
            'name', connection."name",
            'organizationId', connection."organization_id",
            'resourceId', resource."id"::text
          )::text, 'sha256'), 'hex'),
          encode(digest(jsonb_build_object(
            'integrationGeneration', integration."generation"::text,
            'integrationId', integration."id"::text,
            'mode', 'managed',
            'name', connection."name",
            'organizationId', connection."organization_id",
            'productionApproved',
              resource."redacted_metadata" -> 'production' = 'true'::jsonb,
            'resourceId', resource."id"::text
          )::text, 'sha256'), 'hex')
        )
        AND integration."status" = 'active'
        AND integration."refresh_phase" = 'idle'
        AND integration."revoked_at" IS NULL
        AND integration."revocation_pending_at" IS NULL
        AND integration."revocation_claim_id" IS NULL
        AND resource."provider" = integration."provider"
        AND integration."provider" IN ('neon', 'gcpCloudSql')
        AND (
          resource."redacted_metadata" -> 'production' = 'false'::jsonb
          OR (
            resource."provider" IN ('gcpCloudSql', 'neon')
            AND resource."redacted_metadata" -> 'production' = 'true'::jsonb
            AND imported."production_approved" = TRUE
          )
        )
        AND resource."capability_manifest" -> 'importReadOnly' = 'true'::jsonb
        AND jsonb_typeof(resource."capability_manifest" -> 'write') = 'boolean'
        AND resource."capability_manifest" -> 'managedLease' = 'true'::jsonb
      FOR UPDATE OF member_grant, connection, integration, resource, imported
    ) SELECT * FROM target
  `);
  return parseProviderLocalTarget(result.rows[0], input.now);
}
