// Restore secretless templates atomically; existing identities become reviewable conflicts.
import "server-only";
import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { utcNow } from "./d1/schema/values";
import { providerMutationAuthoritySql } from "./provider-integrations/authority";
import { canonicalHash, connectionVersionPayload } from "./workspace-versioning";
import type { WorkspaceMetadataSnapshot } from "./workspace-backup-core";

export async function restoreWorkspaceSnapshot({ organizationId, backupId, expectedRevision, sourceRevision, authority, snapshot }: {
  organizationId: string; backupId: string; expectedRevision: number; sourceRevision: number;
  authority: { sessionId: string; userId: string; membershipId: string; role: "admin" | "owner" };
  snapshot: WorkspaceMetadataSnapshot;
}) {
  const items = snapshot.connections.map(({ id, contentRevision, ...template }) => {
    const payload = connectionVersionPayload({ ...template, readonlyDefault: true, allowWrites: false });
    return { id, contentRevision, payload, payloadHash: canonicalHash(payload),
      versionId: crypto.randomUUID(), conflictId: crypto.randomUUID() };
  });
  // Only identities and revisions occupy the shared snapshot. Template batches
  // stay small enough for D1's per-value limit, even for a 1,000-template backup.
  const identities = JSON.stringify(items.map(({ id, contentRevision, conflictId }) => ({ id, contentRevision, conflictId })));
  const result = await atomicD1({
    scope: sql`WITH candidates AS (
      SELECT json_object('id', item.value ->> 'id', 'contentRevision', item.value ->> 'contentRevision',
        'conflictId', item.value ->> 'conflictId', 'existed', connection.id IS NOT NULL,
        'serverId', version.id, 'parentId', COALESCE(base.id, version.id)) AS value
      FROM json_each(${identities}) item LEFT JOIN workspace_connection connection
        ON connection.organization_id = ${organizationId} AND connection.id = item.value ->> 'id'
      LEFT JOIN workspace_resource_version version ON version.organization_id = ${organizationId}
        AND version.resource_type = 'connection' AND version.resource_id = connection.id
        AND version.branch = 'main' AND version.revision = connection.content_revision
      LEFT JOIN workspace_resource_version base ON base.organization_id = ${organizationId}
        AND base.resource_type = 'connection' AND base.resource_id = connection.id
        AND base.branch = 'main' AND base.revision = item.value ->> 'contentRevision'
    ) SELECT json_object('items', (SELECT json_group_array(json(value)) FROM candidates),
        'revision', profile.revision + 1) AS payload FROM workspace_profile profile
      WHERE profile.organization_id = ${organizationId} AND profile.revision = ${expectedRevision}
        AND ${providerMutationAuthoritySql({ ...authority, organizationId, requireManager: true })}
        AND EXISTS (SELECT 1 FROM workspace_metadata_backup WHERE id = ${backupId} AND organization_id = ${organizationId}
          AND deleted_at IS NULL AND source_revision = ${sourceRevision})
        AND NOT EXISTS (SELECT 1 FROM candidates WHERE value ->> 'existed' = 1 AND value ->> 'serverId' IS NULL)`,
    statements: (scope) => {
      const entries = sql`SELECT item.value FROM (${scope}), json_each(payload, '$.items') item`;
      const statements = [sql`UPDATE workspace_profile SET revision = revision + 1, updated_at = ${utcNow}
        WHERE organization_id = ${organizationId} AND EXISTS (${scope})`];
      for (let start = 0; start < items.length; start += 64) {
        const requested = sql`SELECT value FROM json_each(${JSON.stringify(items.slice(start, start + 64))})`;
        const rows = sql`SELECT item.value AS item, snapshot.value AS snapshot FROM (${requested}) item
          JOIN (${entries}) snapshot ON snapshot.value ->> 'id' = item.value ->> 'id'`;
        const existing = sql`SELECT * FROM (${rows}) WHERE snapshot ->> 'existed' = 1`;
        const missing = sql`SELECT * FROM (${rows}) WHERE snapshot ->> 'existed' = 0`;
        statements.push(
          sql`INSERT INTO workspace_resource_version (id, organization_id, resource_type, resource_id, revision,
              base_revision, parent_version_id, branch, operation, payload, payload_hash, created_by_user_id)
            SELECT item ->> 'versionId', ${organizationId}, 'connection', item ->> 'id', item ->> 'contentRevision',
              item ->> 'contentRevision', snapshot ->> 'parentId', 'conflict', 'restore', item -> '$.payload',
              item ->> 'payloadHash', ${authority.userId} FROM (${existing})`,
          sql`INSERT INTO workspace_resource_conflict (id, organization_id, resource_type, resource_id,
              expected_revision, server_version_id, candidate_version_id, created_by_user_id)
            SELECT item ->> 'conflictId', ${organizationId}, 'connection', item ->> 'id', item ->> 'contentRevision',
              snapshot ->> 'serverId', item ->> 'versionId', ${authority.userId} FROM (${existing})`,
          sql`INSERT INTO workspace_connection (id, organization_id, name, engine, provider, driver_id, host, port,
              database_name, sslmode, readonly_default, allow_writes, environment, schema_group, content_revision, created_by_user_id)
            SELECT item ->> 'id', ${organizationId}, item ->> '$.payload.name', item ->> '$.payload.engine',
              item ->> '$.payload.provider', item ->> '$.payload.driverId', item ->> '$.payload.host', item ->> '$.payload.port',
              item ->> '$.payload.database', item ->> '$.payload.sslmode', 1, 0, item ->> '$.payload.env',
              item ->> '$.payload.schemaGroup', item ->> 'contentRevision', ${authority.userId} FROM (${missing})`,
          sql`INSERT INTO workspace_connection_grant (organization_id, connection_id, member_id, capability)
            SELECT ${organizationId}, item ->> 'id', ${authority.membershipId}, 'manage' FROM (${missing})`,
          sql`INSERT INTO workspace_resource_version (id, organization_id, resource_type, resource_id, revision,
              base_revision, parent_version_id, branch, operation, payload, payload_hash, created_by_user_id)
            SELECT item ->> 'versionId', ${organizationId}, 'connection', item ->> 'id', item ->> 'contentRevision',
              (item ->> 'contentRevision') - 1, NULL, 'main', 'restore', item -> '$.payload', item ->> 'payloadHash',
              ${authority.userId} FROM (${missing})`,
        );
      }
      statements.push(
        sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
            resource_id, redacted_summary, request_id)
          SELECT ${organizationId}, ${authority.userId}, 'workspace.backup.restore', 'workspace_backup', ${backupId},
            json_object('created', (SELECT count(*) FROM (${entries}) WHERE value ->> 'existed' = 0),
              'conflictCount', (SELECT count(*) FROM (${entries}) WHERE value ->> 'existed' = 1), 'sourceRevision', ${sourceRevision}),
            ${crypto.randomUUID()} FROM (${scope})`,
        sql`SELECT payload ->> 'revision' AS revision,
          (SELECT count(*) FROM (${entries}) WHERE value ->> 'existed' = 0) AS restored,
          (SELECT json_group_array(value ->> 'conflictId') FROM (${entries}) WHERE value ->> 'existed' = 1) AS conflictIds
          FROM (${scope})`,
      );
      return statements;
    },
  });
  const row = result.rows.at(-1)?.[0];
  if (!row) return null;
  return { revision: Number(row.revision), restored: Number(row.restored), conflictIds: JSON.parse(String(row.conflictIds)) as string[] };
}
