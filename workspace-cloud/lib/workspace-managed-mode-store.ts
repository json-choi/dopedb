import "server-only";
import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { workspaceMemberAuthority, type MemberAuthority } from "./d1/member-authority";
import { jsonEqual } from "./d1/json";
import { utcNow, uuidDefault } from "./d1/schema/values";
import { returnedConnection } from "./workspace-versioning-store";

export async function disableWorkspaceManagedAccess(input: {
  organizationId: string; connectionId: string; authority: MemberAuthority; claimId: string; revision: number; revokedLeases: number;
}) {
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM workspace_connection connection
      JOIN workspace_provider_integration integration ON integration.id = connection.provider_integration_id AND integration.organization_id = connection.organization_id
      JOIN workspace_provider_resource resource ON resource.id = connection.provider_resource_id AND resource.organization_id = connection.organization_id
      JOIN workspace_provider_import_request imported ON imported.organization_id = connection.organization_id AND imported.connection_id = connection.id AND imported.resource_id = resource.id
      WHERE connection.id = ${input.connectionId} AND connection.organization_id = ${input.organizationId} AND connection.deleted_at IS NULL
        AND connection.credential_mode IN ('managed', 'member_local') AND connection.readonly_default = 1 AND connection.allow_writes = 0
        AND connection.revocation_claim_id = ${input.claimId} AND connection.revision = ${input.revision}
        AND EXISTS (${workspaceMemberAuthority(input.organizationId, input.authority, ["admin", "owner"])})
        AND EXISTS (SELECT 1 FROM workspace_connection_grant WHERE organization_id = ${input.organizationId}
          AND connection_id = ${input.connectionId} AND member_id = ${input.authority.membershipId} AND capability = 'manage')
        AND resource.provider = integration.provider AND (connection.provider = integration.provider OR (integration.provider = 'vault' AND connection.provider = 'generic'))
        AND ${jsonEqual(sql`connection.provider_resource`, sql`resource.resource`)}
        AND (json_type(resource.redacted_metadata, '$.production') = 'false' OR imported.production_approved = 1)
        AND integration.status = 'active' AND integration.refresh_phase = 'idle' AND integration.revoked_at IS NULL
        AND integration.revocation_pending_at IS NULL AND integration.revocation_claim_id IS NULL
        AND (json_type(resource.redacted_metadata, '$.production') = 'false' OR (
          resource.provider IN ('gcpCloudSql', 'planetScale', 'neon', 'vault') AND json_type(resource.redacted_metadata, '$.production') = 'true'
          AND (resource.provider <> 'planetScale' OR resource.resource ->> 'engine' = 'postgres' OR json_type(resource.redacted_metadata, '$.safeMigrations') = 'true')))
        AND json_type(resource.capability_manifest, '$.importReadOnly') = 'true'
        AND json_type(resource.capability_manifest, '$.write') IN ('true', 'false')
        AND json_type(resource.capability_manifest, '$.managedLease') = 'true'
        AND NOT EXISTS (SELECT 1 FROM workspace_credential_lease WHERE organization_id = ${input.organizationId}
          AND connection_id = ${input.connectionId} AND revoked_at IS NULL)`,
    statements: (scope) => [
      sql`UPDATE workspace_connection SET credential_mode = 'member_local', revocation_pending_at = NULL, revocation_claimed_at = NULL,
          revocation_claim_id = NULL, revision = revision + 1, updated_at = ${utcNow}
        WHERE id = ${input.connectionId} AND EXISTS (${scope})
        RETURNING id, name, engine, provider, driver_id AS driverId, host, port, database_name AS databaseName, sslmode,
          readonly_default AS readonlyDefault, allow_writes AS allowWrites, environment, schema_group AS schemaGroup,
          credential_mode AS credentialMode, content_revision AS contentRevision, updated_at AS updatedAt`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'connection.credential_mode.update', 'connection', ${input.connectionId},
          json_object('mode', 'member_local', 'providerLinkPreserved', json('true'), 'revokedLeases', ${input.revokedLeases}), ${uuidDefault} FROM (${scope})`,
    ],
  });
  return returnedConnection(result.rows[0][0]);
}
