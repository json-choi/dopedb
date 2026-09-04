// Receipt-only managed imports use Neon HTTP's non-interactive transaction: a
// lock/revalidation statement runs before a fresh-snapshot mutation statement.
import "server-only";

import type { NeonQueryFunctionInTransaction } from "@neondatabase/serverless";
import { neonSql } from "./db";
import { revocationGateLockKey } from "./revocation-gates";
import { returnedConnection, type MutationAuthority, type StoredConnection } from "./workspace-versioning-store";

type RawConnectionRow = Record<string, unknown>;
type TransactionSql = NeonQueryFunctionInTransaction<false, false>;

export type ProviderImportAuthority = Pick<
  MutationAuthority,
  "sessionId" | "userId" | "membershipId" | "role"
>;

export type ProviderImportResult =
  | { kind: "imported"; connection: StoredConnection }
  | { kind: "invalid_receipt" | "idempotency_conflict" | "resource_conflict" };

function memberLock(input: { organizationId: string; authority: ProviderImportAuthority }) {
  return revocationGateLockKey({
    kind: "member", organizationId: input.organizationId,
    memberId: input.authority.membershipId, userId: input.authority.userId,
  });
}

function importLock(input: { organizationId: string; idempotencyKey: string }) {
  return `provider-import:${input.organizationId}:${input.idempotencyKey}`;
}

function integrationLock(input: { organizationId: string; integrationId: string }) {
  return `provider-import-integration:${input.organizationId}:${input.integrationId}`;
}

/**
 * The first HTTP-transaction statement deliberately acquires locks only.  The
 * following statement therefore receives a new READ COMMITTED snapshot after a
 * concurrent same-key import commits, instead of treating it as a false 409.
 */
function lockAndRevalidate(tx: TransactionSql, input: {
  organizationId: string; integrationId: string; receiptId: string;
  idempotencyKey: string;
  authority: ProviderImportAuthority;
}) {
  return tx`
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
        AND member."role" = ${input.authority.role}
        AND member."role" IN ('admin', 'owner')
        AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member
    ), integration_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${integrationLock(input)}, 0))
      FROM authority
    ), receipt_scope AS MATERIALIZED (
      SELECT receipt."id", receipt."resource_id" AS "resourceId",
        resource."provider", resource."resource"
      FROM "workspace_control"."workspace_provider_discovery_receipt" receipt
      JOIN "workspace_control"."workspace_provider_integration" integration
        ON integration."organization_id" = receipt."organization_id"
       AND integration."id" = receipt."integration_id"
      JOIN "workspace_control"."workspace_provider_resource" resource
        ON resource."organization_id" = receipt."organization_id"
       AND resource."id" = receipt."resource_id"
      JOIN authority ON authority."id" = receipt."member_id"
      JOIN integration_lock ON TRUE
      WHERE receipt."id" = ${input.receiptId}::uuid
        AND receipt."organization_id" = ${input.organizationId}
        AND receipt."integration_id" = ${input.integrationId}::uuid
        AND receipt."member_id" = ${input.authority.membershipId}
        AND receipt."user_id" = ${input.authority.userId}
        AND receipt."session_id" = ${input.authority.sessionId}
        AND receipt."integration_generation" = integration."generation"
        AND integration."status" = 'active'
        AND integration."refresh_phase" = 'idle'
        AND integration."revoked_at" IS NULL
        AND integration."revocation_pending_at" IS NULL
        AND integration."revocation_claim_id" IS NULL
      FOR UPDATE OF receipt, integration, resource
    ), branch_lock AS MATERIALIZED (
      -- Branch deletion and import share this provider identity lock. If an
      -- import wins, remote-start sees the new connection; if deletion wins,
      -- the fresh import snapshot sees the durable delete fence.
      SELECT pg_advisory_xact_lock(hashtextextended(
        'provider-branch:' || ${input.organizationId} || ':'
        || ${input.integrationId} || ':' || receipt_scope."provider" || ':'
        || COALESCE(receipt_scope."resource" ->> 'project', '') || ':'
        || COALESCE(receipt_scope."resource" ->> 'branch', ''),
        0
      ))
      FROM receipt_scope
    ), resource_lock AS MATERIALIZED (
      -- A different idempotency key must not race the partial unique index on
      -- workspace_connection.provider_resource_id.  Lock the durable canonical
      -- resource before the request key so all imports use member → integration
      -- → resource → key ordering.
      SELECT pg_advisory_xact_lock(hashtextextended(
        'provider-import-resource:' || ${input.organizationId} || ':' || "resourceId"::text,
        0
      ))
      FROM receipt_scope
      JOIN branch_lock ON TRUE
    ), key_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${importLock(input)}, 0))
      FROM resource_lock
    ) SELECT count(*)::int AS "locked" FROM key_lock
  `;
}

function mutateFreshSnapshot(tx: TransactionSql, input: {
  organizationId: string; integrationId: string; receiptId: string;
  idempotencyKey: string;
  name: string; productionApproved: boolean;
  authority: ProviderImportAuthority;
}) {
  const connectionId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  return tx`
    WITH authority AS MATERIALIZED (
      SELECT member."id"
      FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
        ON member."id" = ${input.authority.membershipId}
       AND member."organization_id" = ${input.organizationId}
       AND member."user_id" = ${input.authority.userId}
      WHERE session."id" = ${input.authority.sessionId}
        AND session."user_id" = ${input.authority.userId}
        AND session."expires_at" > now()
        AND member."role" = ${input.authority.role}
        AND member."role" IN ('admin', 'owner')
        AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member
    ), scope AS MATERIALIZED (
      SELECT receipt."id" AS "receiptId", receipt."resource_id" AS "resourceId",
        receipt."integration_generation" AS "integrationGeneration",
        resource."provider", resource."resource",
        resource."capability_manifest",
        EXISTS (
          SELECT 1
          FROM "workspace_control"."workspace_provider_operation" mutation
          WHERE mutation."organization_id" = receipt."organization_id"
            AND mutation."integration_id" = receipt."integration_id"
            AND mutation."integration_generation" = receipt."integration_generation"
            AND mutation."provider" = 'neon'
            AND mutation."resource_scope" = resource."resource" ->> 'project'
            AND (
              (
                mutation."kind" = 'neon.branch.delete'
                AND mutation."source_resource_id" = resource."resource" ->> 'branch'
                AND mutation."state" IN (
                  'approved', 'claimed', 'remote_started', 'reconciling', 'succeeded'
                )
              ) OR (
                mutation."kind" = 'neon.branch.switch'
                AND mutation."redacted_plan"->'target'->>'branchId'
                  = resource."resource" ->> 'branch'
                AND mutation."redacted_plan"->'target'->>'databaseId'
                  = resource."resource" ->> 'databaseId'
                AND mutation."state" IN (
                  'approved', 'claimed', 'remote_started', 'reconciling'
                )
              )
            )
        ) AS "deletionBlocked",
        encode(digest(
          jsonb_build_object(
            'integrationGeneration', receipt."integration_generation"::text,
            'integrationId', ${input.integrationId}::text,
            'mode', 'managed',
            'name', ${input.name}::text,
            'organizationId', ${input.organizationId}::text,
            'productionApproved', ${input.productionApproved}::boolean,
            'resourceId', resource."id"::text
          )::text,
          'sha256'
        ), 'hex') AS "requestHash"
      FROM "workspace_control"."workspace_provider_discovery_receipt" receipt
      JOIN "workspace_control"."workspace_provider_integration" integration
        ON integration."organization_id" = receipt."organization_id"
       AND integration."id" = receipt."integration_id"
      JOIN "workspace_control"."workspace_provider_resource" resource
        ON resource."organization_id" = receipt."organization_id"
       AND resource."id" = receipt."resource_id"
      JOIN authority ON authority."id" = receipt."member_id"
      WHERE receipt."id" = ${input.receiptId}::uuid
        AND receipt."organization_id" = ${input.organizationId}
        AND receipt."integration_id" = ${input.integrationId}::uuid
        AND receipt."member_id" = ${input.authority.membershipId}
        AND receipt."user_id" = ${input.authority.userId}
        AND receipt."session_id" = ${input.authority.sessionId}
        AND receipt."integration_generation" = integration."generation"
        AND integration."status" = 'active'
        AND integration."refresh_phase" = 'idle'
        AND integration."revoked_at" IS NULL
        AND integration."revocation_pending_at" IS NULL AND integration."revocation_claim_id" IS NULL
        -- Canonical resources are mutable provider facts.  A receipt is not a
        -- permission to outlive a later discovery which classifies the target
        -- as production or removes an import/lease capability.
        AND resource."provider" = integration."provider"
        AND (
          resource."redacted_metadata" -> 'production' = 'false'::jsonb
          OR (
            resource."provider" IN ('gcpCloudSql', 'planetScale', 'neon', 'vault')
            AND resource."redacted_metadata" -> 'production' = 'true'::jsonb
            AND ${input.productionApproved}
            AND (
              resource."provider" <> 'planetScale'
              OR resource."resource" ->> 'engine' = 'postgres'
              OR resource."redacted_metadata" -> 'safeMigrations' = 'true'::jsonb
            )
          )
        )
        AND resource."capability_manifest" -> 'importReadOnly' = 'true'::jsonb
        AND jsonb_typeof(resource."capability_manifest" -> 'write') = 'boolean'
        AND resource."capability_manifest" -> 'managedLease' = 'true'::jsonb
      FOR UPDATE OF receipt, integration, resource
    ), prior_key AS MATERIALIZED (
      SELECT "request_hash", "resource_id", "connection_id"
      FROM "workspace_control"."workspace_provider_import_request"
      WHERE "organization_id" = ${input.organizationId} AND "idempotency_key" = ${input.idempotencyKey}
      FOR UPDATE
    ), prior AS MATERIALIZED (
      SELECT connection."id" AS "id", connection."name" AS "name", connection."engine" AS "engine",
        connection."provider" AS "provider", connection."driver_id" AS "driverId", connection."host" AS "host",
        connection."port" AS "port", connection."database_name" AS "databaseName", connection."sslmode" AS "sslmode",
        connection."readonly_default" AS "readonlyDefault", connection."allow_writes" AS "allowWrites",
        connection."environment" AS "environment", connection."schema_group" AS "schemaGroup",
        connection."credential_mode" AS "credentialMode", connection."content_revision" AS "contentRevision",
        connection."updated_at" AS "updatedAt"
      FROM prior_key key JOIN scope
        ON scope."requestHash" = key."request_hash"
       AND scope."resourceId" = key."resource_id"
      JOIN "workspace_control"."workspace_connection" connection
        ON connection."organization_id" = ${input.organizationId} AND connection."id" = key."connection_id"
       AND connection."credential_mode" IN ('managed', 'member_local')
       AND connection."provider_integration_id" = ${input.integrationId}::uuid
       AND connection."provider_resource_id" = scope."resourceId"
       AND connection."provider" = CASE
         WHEN scope."provider" = 'vault' THEN 'generic'
         ELSE scope."provider"
       END
       AND connection."provider_resource" = scope."resource"
       AND connection."readonly_default" = TRUE
       AND connection."deleted_at" IS NULL
    ), connection_conflict AS MATERIALIZED (
      SELECT connection."id" FROM "workspace_control"."workspace_connection" connection JOIN scope
        ON connection."organization_id" = ${input.organizationId}
       AND connection."provider_resource_id" = scope."resourceId" AND connection."deleted_at" IS NULL
      WHERE NOT EXISTS (SELECT 1 FROM prior_key)
      FOR UPDATE OF connection
    ), deletion_conflict AS MATERIALIZED (
      SELECT scope."resourceId" FROM scope
      WHERE scope."deletionBlocked"
    ), resource_conflict AS MATERIALIZED (
      SELECT "id" FROM connection_conflict
      UNION ALL
      SELECT "resourceId" FROM deletion_conflict
    ), fresh AS MATERIALIZED (
      SELECT scope.* FROM scope
      WHERE NOT EXISTS (SELECT 1 FROM prior_key) AND NOT EXISTS (SELECT 1 FROM resource_conflict)
        AND (SELECT "consumed_at" IS NULL AND "expires_at" > now()
             FROM "workspace_control"."workspace_provider_discovery_receipt" WHERE "id" = scope."receiptId")
        AND (scope."resource" ->> 'engine') IN ('postgres', 'mysql')
    ), claimed AS MATERIALIZED (
      UPDATE "workspace_control"."workspace_provider_discovery_receipt" receipt SET "consumed_at" = now()
      FROM fresh WHERE receipt."id" = fresh."receiptId" AND receipt."consumed_at" IS NULL
      RETURNING receipt."id"
    ), inserted AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_connection"
        ("id", "organization_id", "name", "engine", "provider", "host", "port", "database_name", "sslmode",
         "readonly_default", "allow_writes", "credential_mode", "provider_integration_id", "provider_resource_id",
         "provider_resource", "content_revision", "created_by_user_id")
      SELECT ${connectionId}::uuid, ${input.organizationId}, ${input.name}, source."resource" ->> 'engine',
        CASE WHEN source."provider" = 'vault' THEN 'generic' ELSE source."provider" END,
        CASE WHEN source."provider" = 'vault'
          THEN source."resource" ->> 'host'
          ELSE lower(source."provider") || '.managed.invalid'
        END,
        CASE WHEN source."provider" = 'vault'
          THEN (source."resource" ->> 'port')::int
          WHEN source."resource" ->> 'engine' = 'postgres' THEN 5432
          ELSE 3306
        END,
        source."resource" ->> 'database',
        CASE WHEN source."provider" = 'vault'
          THEN source."resource" ->> 'sslmode'
          ELSE 'verify-full'
        END,
        TRUE, FALSE, 'managed', ${input.integrationId}::uuid,
        source."resourceId", source."resource", 1, ${input.authority.userId} FROM fresh source
      JOIN claimed ON claimed."id" = source."receiptId"
      RETURNING "id", "name", "engine", "provider", "driver_id" AS "driverId", "host", "port",
        "database_name" AS "databaseName", "sslmode", "readonly_default" AS "readonlyDefault",
        "allow_writes" AS "allowWrites", "environment", "schema_group" AS "schemaGroup",
        "credential_mode" AS "credentialMode", "content_revision" AS "contentRevision", "updated_at" AS "updatedAt"
    ), connection_grant AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_connection_grant" ("organization_id", "connection_id", "member_id", "capability")
      SELECT ${input.organizationId}, inserted."id", ${input.authority.membershipId}, 'manage' FROM inserted
      ON CONFLICT ("organization_id", "connection_id", "member_id") DO UPDATE SET "capability" = 'manage'
      RETURNING "connection_id"
    ), payload AS MATERIALIZED (
      SELECT inserted."id", fresh."resourceId", fresh."requestHash",
        '{"allowWrites":false,"database":' || to_json(inserted."databaseName")::text
        || ',"deleted":false,"driverId":null,"engine":' || to_json(inserted."engine")::text
        || ',"env":' || COALESCE(to_json(inserted."environment")::text, 'null')
        || ',"host":' || to_json(inserted."host")::text
        || ',"name":' || to_json(inserted."name")::text
        || ',"port":' || inserted."port"::text
        || ',"provider":' || to_json(inserted."provider")::text
        || ',"readonlyDefault":true,"schemaGroup":'
        || COALESCE(to_json(inserted."schemaGroup")::text, 'null')
        || ',"sslmode":' || to_json(inserted."sslmode")::text || '}' AS "text"
      FROM inserted JOIN fresh ON TRUE
      JOIN connection_grant ON connection_grant."connection_id" = inserted."id"
    ), version AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_resource_version"
        ("id", "organization_id", "resource_type", "resource_id", "revision", "base_revision", "parent_version_id", "branch", "operation", "payload", "payload_hash", "created_by_user_id")
      SELECT gen_random_uuid(), ${input.organizationId}, 'connection', payload."id",
        1, 0, NULL, 'main', 'create',
        payload."text"::jsonb, encode(digest(payload."text", 'sha256'), 'hex'),
        ${input.authority.userId}
      FROM payload
      RETURNING "resource_id"
    ), audit AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_audit_event" ("organization_id", "actor_user_id", "action", "resource_type", "resource_id", "redacted_summary", "request_id")
      SELECT ${input.organizationId}, ${input.authority.userId},
        'connection.provider_import', 'connection', inserted."id"::text,
        jsonb_build_object(
          'provider', inserted."provider",
          'mode', 'managed',
          'production', fresh."resource" -> 'production',
          'productionApproved', ${input.productionApproved}::boolean
        ),
        ${requestId}::uuid
      FROM inserted
      JOIN version ON version."resource_id" = inserted."id"
      JOIN fresh ON TRUE
      RETURNING "id"
    ), recorded AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_provider_import_request" ("organization_id", "idempotency_key", "request_hash", "production_approved", "resource_id", "connection_id")
      SELECT ${input.organizationId}, ${input.idempotencyKey}, payload."requestHash", ${input.productionApproved}, payload."resourceId", payload."id"
      FROM payload JOIN audit ON TRUE RETURNING "connection_id"
    ), outcome AS (
      SELECT 'imported'::text AS "kind", prior.* FROM prior
      UNION ALL SELECT 'imported'::text, inserted.* FROM inserted JOIN recorded ON recorded."connection_id" = inserted."id"
      UNION ALL SELECT 'idempotency_conflict'::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
        WHERE EXISTS (SELECT 1 FROM prior_key) AND EXISTS (SELECT 1 FROM scope)
          AND NOT EXISTS (SELECT 1 FROM prior)
      UNION ALL SELECT 'resource_conflict'::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
        WHERE EXISTS (SELECT 1 FROM resource_conflict)
      UNION ALL SELECT 'invalid_receipt'::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
        WHERE NOT EXISTS (SELECT 1 FROM scope)
          OR (NOT EXISTS (SELECT 1 FROM prior) AND NOT EXISTS (SELECT 1 FROM prior_key)
            AND NOT EXISTS (SELECT 1 FROM resource_conflict))
    ) SELECT * FROM outcome LIMIT 1
  `;
}

export async function importProviderReceipt(input: {
  organizationId: string; integrationId: string; receiptId: string; idempotencyKey: string;
  name: string; productionApproved: boolean;
  authority: ProviderImportAuthority;
}): Promise<ProviderImportResult> {
  const [, mutation] = await neonSql.transaction((tx) => [
    lockAndRevalidate(tx, input),
    mutateFreshSnapshot(tx, input),
  ]);
  const row = mutation?.[0] as RawConnectionRow | undefined;
  if (row?.kind === "imported") {
    const connection = returnedConnection(row);
    if (!connection) throw new Error("Provider import returned an invalid projection");
    return { kind: "imported", connection };
  }
  if (row?.kind === "idempotency_conflict" || row?.kind === "resource_conflict") return { kind: row.kind };
  return { kind: "invalid_receipt" };
}
