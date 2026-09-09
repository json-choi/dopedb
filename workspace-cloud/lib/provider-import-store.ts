// Receipt validation, consumption, connection creation and evidence share one D1 transaction.
import "server-only";

import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { queryD1 } from "./d1/database";
import { jsonEqual } from "./d1/json";
import { utcNow } from "./d1/schema/values";
import { canonicalHash, parseConnectionVersionPayload } from "./workspace-versioning";
import { returnedConnection, type MutationAuthority, type StoredConnection } from "./workspace-versioning-store";

export type ProviderImportAuthority = Pick<MutationAuthority, "sessionId" | "userId" | "membershipId" | "role">;
export type ProviderImportResult =
  | { kind: "imported"; connection: StoredConnection }
  | { kind: "invalid_receipt" | "idempotency_conflict" | "resource_conflict" };

type ImportInput = {
  organizationId: string; integrationId: string; receiptId: string; idempotencyKey: string;
  name: string; productionApproved: boolean; authority: ProviderImportAuthority;
};
type ResourceSnapshot = {
  resourceId: string; generation: number; provider: string; resource: string;
};

/**
 * Hashing happens outside SQLite. The batch revalidates these exact resource
 * bytes and generation before consuming the hash; a changed provider fact can
 * never authorize a connection derived from an earlier discovery snapshot.
 */
function importScope(input: ImportInput, snapshot: ResourceSnapshot, requestHash: string, connectionId: string) {
  return sql`WITH valid AS (
    SELECT receipt.id AS receipt_id, receipt.expires_at, receipt.consumed_at,
      resource.id AS resource_id, resource.provider, resource.resource,
      EXISTS (SELECT 1 FROM workspace_provider_operation mutation
        WHERE mutation.organization_id = receipt.organization_id
          AND mutation.integration_id = receipt.integration_id
          AND mutation.integration_generation = receipt.integration_generation
          AND mutation.provider = 'neon' AND mutation.resource_scope = resource.resource ->> 'project'
          AND ((mutation.kind = 'neon.branch.delete'
              AND mutation.source_resource_id = resource.resource ->> 'branch'
              AND mutation.state IN ('approved', 'claimed', 'remote_started', 'reconciling', 'succeeded'))
            OR (mutation.kind = 'neon.branch.switch'
              AND mutation.redacted_plan ->> '$.target.branchId' = resource.resource ->> 'branch'
              AND mutation.redacted_plan ->> '$.target.databaseId' = resource.resource ->> 'databaseId'
              AND mutation.state IN ('approved', 'claimed', 'remote_started', 'reconciling')))) AS blocked
    FROM workspace_provider_discovery_receipt receipt
    JOIN workspace_provider_integration integration ON integration.organization_id = receipt.organization_id
      AND integration.id = receipt.integration_id
    JOIN workspace_provider_resource resource ON resource.organization_id = receipt.organization_id
      AND resource.id = receipt.resource_id
    JOIN member ON member.id = receipt.member_id AND member.organization_id = receipt.organization_id
      AND member.user_id = receipt.user_id
    JOIN session ON session.id = receipt.session_id AND session.user_id = receipt.user_id
    JOIN workspace_profile profile ON profile.organization_id = receipt.organization_id
    WHERE receipt.id = ${input.receiptId} AND receipt.organization_id = ${input.organizationId}
      AND receipt.integration_id = ${input.integrationId} AND receipt.member_id = ${input.authority.membershipId}
      AND receipt.user_id = ${input.authority.userId} AND receipt.session_id = ${input.authority.sessionId}
      AND session.expires_at > ${utcNow} AND member.role = ${input.authority.role}
      AND member.role IN ('admin', 'owner') AND member.revocation_pending_at IS NULL
      AND member.revocation_claim_id IS NULL AND profile.lifecycle_state = 'active'
      AND receipt.integration_generation = integration.generation AND integration.generation = ${snapshot.generation}
      AND integration.status = 'active' AND integration.refresh_phase = 'idle'
      AND integration.revoked_at IS NULL AND integration.revocation_pending_at IS NULL
      AND integration.revocation_claim_id IS NULL AND resource.provider = integration.provider
      AND resource.id = ${snapshot.resourceId} AND resource.provider = ${snapshot.provider}
      AND resource.resource = ${snapshot.resource}
      AND (json_type(resource.redacted_metadata, '$.production') = 'false'
        OR (resource.provider IN ('gcpCloudSql', 'planetScale', 'neon', 'vault')
          AND json_type(resource.redacted_metadata, '$.production') = 'true' AND ${input.productionApproved}
          AND (resource.provider <> 'planetScale' OR resource.resource ->> 'engine' = 'postgres'
            OR json_type(resource.redacted_metadata, '$.safeMigrations') = 'true')))
      AND json_type(resource.capability_manifest, '$.importReadOnly') = 'true'
      AND json_type(resource.capability_manifest, '$.write') IN ('true', 'false')
      AND json_type(resource.capability_manifest, '$.managedLease') = 'true'
  ), prior_key AS (
    SELECT * FROM workspace_provider_import_request
    WHERE organization_id = ${input.organizationId} AND idempotency_key = ${input.idempotencyKey}
  ), prior AS (
    SELECT connection.id FROM prior_key key JOIN valid ON key.request_hash = ${requestHash}
      AND key.resource_id = valid.resource_id
    JOIN workspace_connection connection ON connection.organization_id = ${input.organizationId}
      AND connection.id = key.connection_id AND connection.credential_mode IN ('managed', 'member_local')
      AND connection.provider_integration_id = ${input.integrationId}
      AND connection.provider_resource_id = valid.resource_id
      AND connection.provider = CASE WHEN valid.provider = 'vault' THEN 'generic' ELSE valid.provider END
      AND ${jsonEqual(sql`connection.provider_resource`, sql`valid.resource`)} AND connection.readonly_default = 1
      AND connection.deleted_at IS NULL
  ) SELECT json_object('kind', CASE
      WHEN EXISTS (SELECT 1 FROM prior) THEN 'imported'
      WHEN EXISTS (SELECT 1 FROM prior_key) THEN 'idempotency_conflict'
      WHEN valid.blocked OR EXISTS (SELECT 1 FROM workspace_connection
        WHERE organization_id = ${input.organizationId} AND provider_resource_id = valid.resource_id
          AND deleted_at IS NULL) THEN 'resource_conflict'
      WHEN valid.consumed_at IS NOT NULL OR valid.expires_at <= ${utcNow} THEN 'invalid_receipt'
      ELSE 'fresh' END,
    'connectionId', COALESCE((SELECT id FROM prior), ${connectionId})) AS payload FROM valid`;
}

export async function importProviderReceipt(input: ImportInput): Promise<ProviderImportResult> {
  const [snapshot] = await queryD1<ResourceSnapshot>(sql`
    SELECT resource.id AS resourceId, receipt.integration_generation AS generation, resource.provider, resource.resource
    FROM workspace_provider_discovery_receipt receipt JOIN workspace_provider_resource resource
      ON resource.organization_id = receipt.organization_id AND resource.id = receipt.resource_id
    WHERE receipt.id = ${input.receiptId} AND receipt.organization_id = ${input.organizationId}
      AND receipt.integration_id = ${input.integrationId} AND receipt.member_id = ${input.authority.membershipId}
      AND receipt.user_id = ${input.authority.userId} AND receipt.session_id = ${input.authority.sessionId}`);
  if (!snapshot) return { kind: "invalid_receipt" };
  const resource = JSON.parse(snapshot.resource) as Record<string, unknown>;
  if (resource.engine !== "postgres" && resource.engine !== "mysql") return { kind: "invalid_receipt" };
  let payload;
  try {
    payload = parseConnectionVersionPayload({
      name: input.name, engine: resource.engine, provider: snapshot.provider === "vault" ? "generic" : snapshot.provider,
      driverId: null, host: snapshot.provider === "vault" ? resource.host : `${snapshot.provider.toLowerCase()}.managed.invalid`,
      port: snapshot.provider === "vault" ? Number(resource.port) : resource.engine === "postgres" ? 5432 : 3306,
      database: resource.database, sslmode: snapshot.provider === "vault" ? resource.sslmode : "verify-full",
      readonlyDefault: true, allowWrites: false, env: null, schemaGroup: null, deleted: false,
    }, { credentialMode: "managed" });
  } catch {
    return { kind: "invalid_receipt" };
  }
  const requestHash = canonicalHash({
    integrationGeneration: String(snapshot.generation), integrationId: input.integrationId,
    mode: "managed", name: input.name, organizationId: input.organizationId,
    productionApproved: input.productionApproved, resourceId: snapshot.resourceId,
  });
  const connectionId = crypto.randomUUID();
  const outcome = await atomicD1({
    scope: importScope(input, snapshot, requestHash, connectionId),
    statements: (scope) => {
      const fresh = sql`SELECT payload FROM (${scope}) WHERE payload ->> 'kind' = 'fresh'`;
      return [
        sql`UPDATE workspace_provider_discovery_receipt SET consumed_at = ${utcNow}
          WHERE id = ${input.receiptId} AND EXISTS (${fresh})`,
        sql`INSERT INTO workspace_connection (id, organization_id, name, engine, provider, host, port,
            database_name, sslmode, readonly_default, allow_writes, credential_mode,
            provider_integration_id, provider_resource_id, provider_resource, content_revision, created_by_user_id)
          SELECT ${connectionId}, ${input.organizationId}, ${payload.name}, ${payload.engine}, ${payload.provider},
            ${payload.host}, ${payload.port}, ${payload.database}, ${payload.sslmode}, 1, 0, 'managed',
            ${input.integrationId}, ${snapshot.resourceId}, ${snapshot.resource}, 1, ${input.authority.userId} FROM (${fresh})`,
        sql`INSERT INTO workspace_connection_grant (organization_id, connection_id, member_id, capability)
          SELECT ${input.organizationId}, ${connectionId}, ${input.authority.membershipId}, 'manage' FROM (${fresh})`,
        sql`INSERT INTO workspace_resource_version (organization_id, resource_type, resource_id, revision,
            base_revision, parent_version_id, branch, operation, payload, payload_hash, created_by_user_id)
          SELECT ${input.organizationId}, 'connection', ${connectionId}, 1, 0, NULL, 'main', 'create',
            ${JSON.stringify(payload)}, ${canonicalHash(payload)}, ${input.authority.userId} FROM (${fresh})`,
        sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
            resource_id, redacted_summary, request_id)
          SELECT ${input.organizationId}, ${input.authority.userId}, 'connection.provider_import', 'connection',
            ${connectionId}, ${JSON.stringify({ provider: payload.provider, mode: "managed",
              production: resource.production ?? null, productionApproved: input.productionApproved })},
            ${crypto.randomUUID()} FROM (${fresh})`,
        sql`INSERT INTO workspace_provider_import_request (organization_id, idempotency_key, request_hash,
            production_approved, resource_id, connection_id)
          SELECT ${input.organizationId}, ${input.idempotencyKey}, ${requestHash}, ${input.productionApproved},
            ${snapshot.resourceId}, ${connectionId} FROM (${fresh})`,
        sql`SELECT CASE WHEN scope.payload ->> 'kind' = 'fresh' THEN 'imported' ELSE scope.payload ->> 'kind' END AS kind,
            connection.id, connection.name, connection.engine, connection.provider, connection.driver_id AS driverId,
            connection.host, connection.port, connection.database_name AS databaseName, connection.sslmode,
            connection.readonly_default AS readonlyDefault, connection.allow_writes AS allowWrites,
            connection.environment, connection.schema_group AS schemaGroup, connection.credential_mode AS credentialMode,
            connection.content_revision AS contentRevision, connection.updated_at AS updatedAt
          FROM (${scope}) scope LEFT JOIN workspace_connection connection
            ON connection.organization_id = ${input.organizationId} AND connection.id = scope.payload ->> 'connectionId'
            AND scope.payload ->> 'kind' IN ('fresh', 'imported')`,
      ];
    },
  });
  const row = outcome.rows[6]?.[0];
  if (row?.kind === "imported") {
    const connection = returnedConnection({ ...row, readonlyDefault: row.readonlyDefault === 1, allowWrites: row.allowWrites === 1 });
    if (!connection) throw new Error("Provider import returned an invalid projection");
    return { kind: "imported", connection };
  }
  if (row?.kind === "idempotency_conflict" || row?.kind === "resource_conflict") return { kind: row.kind };
  return { kind: "invalid_receipt" };
}
