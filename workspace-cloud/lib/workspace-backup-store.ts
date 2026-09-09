import "server-only";

import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { backupEnvelopeStorage } from "./d1/backup-chunks";
import { jsonEqual } from "./d1/json";
import { workspaceMemberAuthority, type MemberAuthority } from "./d1/member-authority";
import { utcNow, uuidDefault } from "./d1/schema/values";

const snapshotColumns = ["id", "content_revision", "name", "engine", "provider", "driver_id", "host", "port",
  "database_name", "sslmode", "readonly_default", "allow_writes", "environment", "schema_group",
  "credential_mode", "provider_integration_id"] as const;

export async function insertWorkspaceBackup(input: {
  organizationId: string; backupId: string; authority: MemberAuthority;
  revision: number; lifecycleState: string; residencyRegion: string | null;
  connections: Record<string, unknown>[];
  sealed: { dataKeyId: string; keyReference: string; keyVersion: string; ciphertext: string };
  snapshotHash: string;
}) {
  if (input.connections.length > 1_000) throw new Error("Workspace backup connection limit exceeded");
  // Bound each JSON parameter, including provider metadata, below D1's value limit.
  const chunks = [];
  for (let offset = 0; offset < input.connections.length; offset += 32) {
    chunks.push(sql`(${JSON.stringify(input.connections.slice(offset, offset + 32))})`);
  }
  const supplied = chunks.length ? sql`VALUES ${sql.join(chunks, sql`, `)}` : sql`SELECT '[]'`;
  const matches = sql`NOT EXISTS (SELECT 1 FROM supplied
    WHERE NOT EXISTS (SELECT 1 FROM workspace_connection connection
      WHERE connection.organization_id = ${input.organizationId} AND connection.deleted_at IS NULL
        AND ${sql.join(snapshotColumns.map((column) => sql`connection.${sql.identifier(column)} IS json_extract(supplied.value, ${sql.raw("'$." + column + "'")})`), sql` AND `)}
        AND (connection.provider_resource IS json_extract(supplied.value, '$.provider_resource')
          OR ${jsonEqual(sql`connection.provider_resource`, sql`json_extract(supplied.value, '$.provider_resource')`)})))`;
  const storage = backupEnvelopeStorage(input.sealed.ciphertext);
  const result = await atomicD1({
    scope: sql`WITH chunks(payload) AS (${supplied}), supplied AS (SELECT value FROM chunks, json_each(chunks.payload)) SELECT '{}' AS payload FROM workspace_profile profile
      WHERE profile.organization_id = ${input.organizationId} AND profile.revision = ${input.revision}
        AND profile.lifecycle_state IS ${input.lifecycleState} AND profile.residency_region IS ${input.residencyRegion}
        AND EXISTS (${workspaceMemberAuthority(input.organizationId, input.authority, ["admin", "owner"])})
        AND EXISTS (SELECT 1 FROM workspace_data_key key WHERE key.id = ${input.sealed.dataKeyId}
          AND key.organization_id = ${input.organizationId} AND key.retired_at IS NULL AND key.destroyed_at IS NULL)
        AND (SELECT count(*) FROM workspace_connection WHERE organization_id = ${input.organizationId} AND deleted_at IS NULL) = ${input.connections.length}
        AND ${matches}`,
    statements: (scope) => [
      sql`INSERT INTO workspace_metadata_backup (id, organization_id, source_revision, key_reference, key_version,
          data_key_id, ciphertext, snapshot_hash, created_by_user_id)
        SELECT ${input.backupId}, ${input.organizationId}, ${input.revision}, ${input.sealed.keyReference},
          ${input.sealed.keyVersion}, ${input.sealed.dataKeyId}, ${storage.value}, ${input.snapshotHash}, ${input.authority.userId}
        FROM (${scope}) RETURNING id, source_revision AS sourceRevision, key_reference AS keyReference,
          key_version AS keyVersion, snapshot_hash AS snapshotHash, created_at AS createdAt`,
      ...storage.statements(input.organizationId, input.backupId, scope),
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'workspace.backup.create', 'workspace_backup', ${input.backupId},
          json_object('connectionCount', ${input.connections.length}, 'sourceRevision', ${input.revision}), ${uuidDefault} FROM (${scope})`,
    ],
  });
  return result.rows[0]?.[0] ?? null;
}

export async function tombstoneWorkspaceBackup(input: {
  organizationId: string; backupId: string; authority: MemberAuthority; retentionDays: number;
}) {
  const result = await atomicD1({
    scope: sql`SELECT json_object('alreadyDeleted', deleted_at IS NOT NULL) AS payload FROM workspace_metadata_backup
      WHERE id = ${input.backupId} AND organization_id = ${input.organizationId}
        AND EXISTS (${workspaceMemberAuthority(input.organizationId, input.authority, ["admin", "owner"])})`,
    statements: (scope) => [
      sql`UPDATE workspace_metadata_backup SET deleted_at = ${utcNow},
          purge_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${`+${input.retentionDays} days`})
        WHERE id = ${input.backupId} AND deleted_at IS NULL AND EXISTS (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'workspace.backup.delete', 'workspace_backup', ${input.backupId}, '{}', ${uuidDefault}
        FROM (${scope}) WHERE json_extract(payload, '$.alreadyDeleted') = 0`,
      sql`SELECT id, purge_after AS purgeAfter FROM workspace_metadata_backup WHERE id = ${input.backupId} AND EXISTS (${scope})`,
    ],
  });
  return result.rows[2]?.[0] as { id: string; purgeAfter: string } | undefined;
}
