// Server-side append-only persistence for secretless connection versions. All
// lookups are tenant-scoped so known UUIDs from another workspace reveal nothing.
import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "./db";
import { atomicD1 } from "./d1/atomic";
import { utcNow } from "./d1/schema/values";
import {
  workspaceAuditEvent,
  workspaceConnection,
  workspaceConnectionGrant,
  workspaceResourceConflict,
  workspaceResourceConflictResolution,
  workspaceResourceVersion,
} from "./schema";
import {
  canonicalHash,
  parseConnectionVersionPayload,
  type ConnectionVersionPayload,
} from "./workspace-versioning";

export type MutationAuthority = {
  sessionId: string;
  userId: string;
  membershipId: string;
  role: string;
};


function connectionAuthority(organizationId: string, authority: MutationAuthority, connectionId?: SQL, manager = false) {
  const grant = connectionId ? sql`AND EXISTS (SELECT 1 FROM workspace_connection_grant
    WHERE organization_id = ${organizationId} AND connection_id = ${connectionId}
      AND member_id = ${authority.membershipId} AND capability = 'manage')` : sql``;
  return sql`EXISTS (SELECT 1 FROM session JOIN member ON member.user_id = session.user_id
    JOIN workspace_profile profile ON profile.organization_id = member.organization_id
    WHERE session.id = ${authority.sessionId} AND session.user_id = ${authority.userId} AND session.expires_at > ${utcNow}
      AND member.id = ${authority.membershipId} AND member.organization_id = ${organizationId}
      AND member.role = ${authority.role} AND member.revocation_pending_at IS NULL AND member.revocation_claim_id IS NULL
      AND profile.lifecycle_state = 'active' ${manager ? sql`AND member.role IN ('admin', 'owner')` : sql``} ${grant})`;
}

const connectionProjection = sql`id, name, engine, provider, driver_id AS driverId, host, port,
  database_name AS databaseName, sslmode, readonly_default AS readonlyDefault, allow_writes AS allowWrites,
  environment, schema_group AS schemaGroup, credential_mode AS credentialMode,
  content_revision AS contentRevision, updated_at AS updatedAt`;


export async function conflictConnectionCandidate({
  organizationId,
  connectionId,
  expectedRevision,
  payload,
  authority,
  operation = "update",
}: {
  organizationId: string;
  connectionId: string;
  expectedRevision: number;
  payload: ConnectionVersionPayload;
  authority: MutationAuthority;
  operation?: "update" | "delete" | "restore";
}) {
  const candidateId = crypto.randomUUID();
  const conflictId = crypto.randomUUID();
  const result = await atomicD1({
    scope: sql`SELECT json_object('serverId', version.id, 'serverRevision', version.revision,
        'parentId', COALESCE((SELECT id FROM workspace_resource_version
          WHERE organization_id = ${organizationId} AND resource_type = 'connection' AND resource_id = ${connectionId}
            AND branch = 'main' AND revision = ${expectedRevision}), version.id)) AS payload
      FROM workspace_connection connection JOIN workspace_resource_version version
        ON version.organization_id = connection.organization_id AND version.resource_type = 'connection'
        AND version.resource_id = connection.id AND version.branch = 'main' AND version.revision = connection.content_revision
      WHERE connection.organization_id = ${organizationId} AND connection.id = ${connectionId}
        AND ${connectionAuthority(organizationId, authority, sql`${connectionId}`)}`,
    statements: (scope) => [
      sql`INSERT INTO workspace_resource_version (id, organization_id, resource_type, resource_id, revision,
          base_revision, parent_version_id, branch, operation, payload, payload_hash, created_by_user_id)
        SELECT ${candidateId}, ${organizationId}, 'connection', ${connectionId}, ${expectedRevision}, ${expectedRevision},
          payload ->> 'parentId', 'conflict', ${operation}, ${JSON.stringify(payload)}, ${canonicalHash(payload)},
          ${authority.userId} FROM (${scope})`,
      sql`INSERT INTO workspace_resource_conflict (id, organization_id, resource_type, resource_id, expected_revision,
          server_version_id, candidate_version_id, created_by_user_id)
        SELECT ${conflictId}, ${organizationId}, 'connection', ${connectionId}, ${expectedRevision},
          payload ->> 'serverId', ${candidateId}, ${authority.userId} FROM (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${organizationId}, ${authority.userId}, 'connection.conflict.recorded', 'connection_conflict', ${conflictId},
          json_object('expectedRevision', ${expectedRevision}, 'serverRevision', payload ->> 'serverRevision'),
          ${crypto.randomUUID()} FROM (${scope})`,
    ],
  });
  if (!result.matched) throw new Error("Missing immutable connection version");
  return conflictId;
}

export type ConnectionConflictVersion = {
  id: string;
  revision: number;
  operation: "create" | "update" | "delete" | "restore";
  payload: ConnectionVersionPayload;
};

export type ConnectionConflictReview = {
  id: string;
  connectionId: string;
  connectionName: string;
  expectedRevision: number;
  createdAt: string;
  current: ConnectionConflictVersion;
  server: ConnectionConflictVersion;
  candidate: ConnectionConflictVersion;
  currentMatchesServer: boolean;
  currentMatchesCandidate: boolean;
};

type RawConflictReview = Record<string, unknown>;

function conflictVersion(
  row: RawConflictReview,
  prefix: "current" | "server" | "candidate",
  credentialMode: "managed" | "member_local",
): ConnectionConflictVersion {
  const id = row[`${prefix}Id`];
  const revision = safeNumber(row[`${prefix}Revision`]);
  const operation = row[`${prefix}Operation`];
  const storedPayload = row[`${prefix}Payload`];
  const payload = parseConnectionVersionPayload(typeof storedPayload === "string" ? JSON.parse(storedPayload) : storedPayload, {
    credentialMode,
  });
  const payloadHash = row[`${prefix}PayloadHash`];
  if (
    typeof id !== "string"
    || revision === null
    || typeof operation !== "string"
    || !["create", "update", "delete", "restore"].includes(operation)
    || typeof payloadHash !== "string"
    || canonicalHash(payload) !== payloadHash
  ) {
    throw new Error("Invalid immutable connection conflict version");
  }
  return {
    id,
    revision,
    operation: operation as ConnectionConflictVersion["operation"],
    payload,
  };
}

export async function listConnectionConflicts({
  organizationId,
  membershipId,
}: {
  organizationId: string;
  membershipId: string;
}): Promise<ConnectionConflictReview[]> {
  const result = await db.execute<RawConflictReview>(sql`
    SELECT conflict."id" AS "id",
      conflict."resource_id" AS "connectionId",
      conflict."expected_revision" AS "expectedRevision",
      conflict."created_at" AS "createdAt",
      connection."name" AS "connectionName",
      connection."credential_mode" AS "credentialMode",
      current_version."id" AS "currentId",
      current_version."revision" AS "currentRevision",
      current_version."operation" AS "currentOperation",
      current_version."payload" AS "currentPayload",
      current_version."payload_hash" AS "currentPayloadHash",
      server_version."id" AS "serverId",
      server_version."revision" AS "serverRevision",
      server_version."operation" AS "serverOperation",
      server_version."payload" AS "serverPayload",
      server_version."payload_hash" AS "serverPayloadHash",
      candidate_version."id" AS "candidateId",
      candidate_version."revision" AS "candidateRevision",
      candidate_version."operation" AS "candidateOperation",
      candidate_version."payload" AS "candidatePayload",
      candidate_version."payload_hash" AS "candidatePayloadHash"
    FROM ${workspaceResourceConflict} conflict
    JOIN ${workspaceConnection} connection
      ON connection."organization_id" = conflict."organization_id"
      AND connection."id" = conflict."resource_id"
    JOIN ${workspaceConnectionGrant} manager_grant
      ON manager_grant."organization_id" = conflict."organization_id"
      AND manager_grant."connection_id" = conflict."resource_id"
      AND manager_grant."member_id" = ${membershipId}
      AND manager_grant."capability" = 'manage'
    JOIN ${workspaceResourceVersion} current_version
      ON current_version."organization_id" = conflict."organization_id"
      AND current_version."resource_type" = 'connection'
      AND current_version."resource_id" = conflict."resource_id"
      AND current_version."branch" = 'main'
      AND current_version."revision" = connection."content_revision"
    JOIN ${workspaceResourceVersion} server_version
      ON server_version."organization_id" = conflict."organization_id"
      AND server_version."id" = conflict."server_version_id"
    JOIN ${workspaceResourceVersion} candidate_version
      ON candidate_version."organization_id" = conflict."organization_id"
      AND candidate_version."id" = conflict."candidate_version_id"
    LEFT JOIN ${workspaceResourceConflictResolution} resolution
      ON resolution."organization_id" = conflict."organization_id"
      AND resolution."conflict_id" = conflict."id"
    WHERE conflict."organization_id" = ${organizationId}
      AND conflict."resource_type" = 'connection'
      AND resolution."id" IS NULL
    ORDER BY conflict."created_at" DESC, conflict."id" DESC
    LIMIT 100
  `);
  return result.rows.map((row) => {
    const id = row.id;
    const connectionId = row.connectionId;
    const connectionName = row.connectionName;
    const expectedRevision = safeNumber(row.expectedRevision);
    const credentialMode = row.credentialMode;
    const createdAt = row.createdAt instanceof Date
      ? row.createdAt
      : new Date(String(row.createdAt));
    if (
      typeof id !== "string"
      || typeof connectionId !== "string"
      || typeof connectionName !== "string"
      || expectedRevision === null
      || (credentialMode !== "managed" && credentialMode !== "member_local")
      || Number.isNaN(createdAt.valueOf())
    ) {
      throw new Error("Invalid immutable connection conflict");
    }
    const current = conflictVersion(row, "current", credentialMode);
    const server = conflictVersion(row, "server", credentialMode);
    const candidate = conflictVersion(row, "candidate", credentialMode);
    return {
      id,
      connectionId,
      connectionName,
      expectedRevision,
      createdAt: createdAt.toISOString(),
      current,
      server,
      candidate,
      currentMatchesServer: current.id === server.id,
      currentMatchesCandidate: (
        current.operation === "delete" && candidate.operation === "delete"
      ) || canonicalHash(current.payload) === canonicalHash(candidate.payload),
    };
  });
}

export type ConnectionConflictResolution = "server" | "candidate" | "dismissed";

export async function resolveConnectionConflict({
  organizationId,
  conflictId,
  resolution,
  authority,
}: {
  organizationId: string;
  conflictId: string;
  resolution: ConnectionConflictResolution;
  authority: MutationAuthority;
}): Promise<{ resolution: ConnectionConflictResolution; created: boolean } | null> {
  const resolutionId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const result = await atomicD1({
    scope: sql`WITH authority AS (SELECT 1 WHERE ${connectionAuthority(organizationId, authority)}
    ), conflict_row AS (
      SELECT conflict."id", conflict."resource_id", conflict."server_version_id",
        conflict."candidate_version_id"
      FROM ${workspaceResourceConflict} conflict
      JOIN ${workspaceConnectionGrant} manager_grant
        ON manager_grant."organization_id" = conflict."organization_id"
        AND manager_grant."connection_id" = conflict."resource_id"
        AND manager_grant."member_id" = ${authority.membershipId}
        AND manager_grant."capability" = 'manage'
      JOIN authority ON TRUE
      WHERE conflict."organization_id" = ${organizationId}
        AND conflict."id" = ${conflictId}
        AND conflict."resource_type" = 'connection'
    ), versions AS MATERIALIZED (
      SELECT conflict_row."id" AS "conflict_id", current_version."id" AS "current_id",
        current_version."revision" AS "current_revision",
        current_version."payload_hash" AS "current_hash",
        current_version."operation" AS "current_operation",
        server_version."id" AS "server_id", server_version."revision" AS "server_revision",
        candidate_version."payload_hash" AS "candidate_hash",
        candidate_version."operation" AS "candidate_operation"
      FROM conflict_row
      JOIN ${workspaceConnection} connection
        ON connection."organization_id" = ${organizationId}
        AND connection."id" = conflict_row."resource_id"
      JOIN ${workspaceResourceVersion} current_version
        ON current_version."organization_id" = ${organizationId}
        AND current_version."resource_type" = 'connection'
        AND current_version."resource_id" = connection."id"
        AND current_version."branch" = 'main'
        AND current_version."revision" = connection."content_revision"
      JOIN ${workspaceResourceVersion} server_version
        ON server_version."organization_id" = ${organizationId}
        AND server_version."id" = conflict_row."server_version_id"
      JOIN ${workspaceResourceVersion} candidate_version
        ON candidate_version."organization_id" = ${organizationId}
        AND candidate_version."id" = conflict_row."candidate_version_id"
    ), eligible AS MATERIALIZED (
      SELECT versions.* FROM versions
      WHERE CASE ${resolution}
        WHEN 'server' THEN versions."current_id" = versions."server_id"
        WHEN 'candidate' THEN versions."current_id" <> versions."server_id"
          AND ((versions."candidate_operation" = 'delete'
              AND versions."current_operation" = 'delete')
            OR versions."current_hash" = versions."candidate_hash")
        WHEN 'dismissed' THEN versions."current_id" <> versions."server_id"
          AND versions."current_hash" <> versions."candidate_hash"
        ELSE FALSE
      END
    ), existing AS MATERIALIZED (
      SELECT stored."resolution", stored."resulting_version_id"
      FROM ${workspaceResourceConflictResolution} stored
      JOIN conflict_row ON conflict_row."id" = stored."conflict_id"
      WHERE stored."organization_id" = ${organizationId}

    ) SELECT json_object('resolution', COALESCE(existing.resolution, ${resolution}),
        'created', existing.resolution IS NULL AND eligible.conflict_id IS NOT NULL,
        'currentId', eligible.current_id, 'currentRevision', eligible.current_revision) AS payload
      FROM conflict_row LEFT JOIN eligible ON eligible.conflict_id = conflict_row.id LEFT JOIN existing ON TRUE
      WHERE existing.resolution IS NOT NULL OR eligible.conflict_id IS NOT NULL`,
    statements: (scope) => [
      sql`INSERT INTO workspace_resource_conflict_resolution (id, organization_id, conflict_id, resolution,
          resulting_version_id, resolved_by_user_id)
        SELECT ${resolutionId}, ${organizationId}, ${conflictId}, payload ->> 'resolution', payload ->> 'currentId',
          ${authority.userId} FROM (${scope}) WHERE payload ->> 'created' = 1`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${organizationId}, ${authority.userId}, 'connection.conflict.resolved', 'connection_conflict', ${conflictId},
          json_object('resolution', payload ->> 'resolution', 'resultingRevision', payload ->> 'currentRevision'),
          ${requestId} FROM (${scope}) WHERE payload ->> 'created' = 1`,
      sql`SELECT payload ->> 'resolution' AS resolution, payload ->> 'created' AS created FROM (${scope})`,
    ],
  });
  const row = result.rows[2][0];
  if (!row || typeof row.resolution !== "string" || !["server", "candidate", "dismissed"].includes(row.resolution)
    || (row.created !== 0 && row.created !== 1)) return null;
  return { resolution: row.resolution as ConnectionConflictResolution, created: row.created === 1 };
}

export type StoredConnection = Pick<typeof workspaceConnection.$inferSelect,
  "id" | "name" | "engine" | "provider" | "driverId" | "host" | "port" | "databaseName"
  | "sslmode" | "readonlyDefault" | "allowWrites" | "environment" | "schemaGroup"
  | "credentialMode" | "contentRevision" | "updatedAt">;

type RawConnectionRow = Record<string, unknown>;

function safeNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(number) ? number : null;
}

export function returnedConnection(row: RawConnectionRow | undefined): StoredConnection | null {
  if (!row) return null;
  const readonlyDefault = row.readonlyDefault === 1 ? true : row.readonlyDefault === 0 ? false : row.readonlyDefault;
  const allowWrites = row.allowWrites === 1 ? true : row.allowWrites === 0 ? false : row.allowWrites;
  const port = safeNumber(row.port);
  const contentRevision = safeNumber(row.contentRevision);
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt));
  if (
    typeof row.id !== "string" || typeof row.name !== "string" || typeof row.engine !== "string"
    || typeof row.provider !== "string" || !(typeof row.driverId === "string" || row.driverId === null)
    || typeof row.host !== "string" || port === null || typeof row.databaseName !== "string"
    || typeof row.sslmode !== "string" || typeof readonlyDefault !== "boolean"
    || typeof allowWrites !== "boolean" || !(typeof row.environment === "string" || row.environment === null)
    || !(typeof row.schemaGroup === "string" || row.schemaGroup === null)
    || typeof row.credentialMode !== "string" || contentRevision === null || contentRevision < 1
    || Number.isNaN(updatedAt.valueOf())
  ) return null;
  return {
    id: row.id, name: row.name, engine: row.engine, provider: row.provider, driverId: row.driverId,
    host: row.host, port, databaseName: row.databaseName, sslmode: row.sslmode,
    readonlyDefault, allowWrites, environment: row.environment,
    schemaGroup: row.schemaGroup, credentialMode: row.credentialMode, contentRevision, updatedAt,
  };
}

export async function commitConnectionCreate({
  organizationId, connectionId, authority, input,
}: {
  organizationId: string;
  connectionId: string;
  authority: MutationAuthority;
  input: ConnectionVersionPayload;
}): Promise<StoredConnection | null> {
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload WHERE ${connectionAuthority(organizationId, authority, undefined, true)}`,
    statements: (scope) => [
      sql`INSERT INTO workspace_connection (id, organization_id, name, engine, provider, driver_id, host, port,
          database_name, sslmode, readonly_default, allow_writes, environment, schema_group, content_revision, created_by_user_id)
        SELECT ${connectionId}, ${organizationId}, ${input.name}, ${input.engine}, ${input.provider}, ${input.driverId},
          ${input.host}, ${input.port}, ${input.database}, ${input.sslmode}, ${input.readonlyDefault}, ${input.allowWrites},
          ${input.env}, ${input.schemaGroup}, 1, ${authority.userId} FROM (${scope}) RETURNING ${connectionProjection}`,
      sql`INSERT INTO workspace_connection_grant (organization_id, connection_id, member_id, capability)
        SELECT ${organizationId}, ${connectionId}, ${authority.membershipId}, 'manage' FROM (${scope})`,
      sql`INSERT INTO workspace_resource_version (organization_id, resource_type, resource_id, revision, base_revision,
          parent_version_id, branch, operation, payload, payload_hash, created_by_user_id)
        SELECT ${organizationId}, 'connection', ${connectionId}, 1, 0, NULL, 'main', 'create',
          ${JSON.stringify(input)}, ${canonicalHash(input)}, ${authority.userId} FROM (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${organizationId}, ${authority.userId}, 'connection.share', 'connection', ${connectionId},
          ${JSON.stringify({ name: input.name, engine: input.engine })}, ${crypto.randomUUID()} FROM (${scope})`,
    ],
  });
  return returnedConnection(result.rows[0][0]);
}

export async function commitConnectionMutation({
  organizationId,
  connectionId,
  expectedContentRevision,
  expectedAuthorityRevision,
  claimId,
  authority,
  requireWorkspaceManager = false,
  mutation,
}: {
  organizationId: string;
  connectionId: string;
  expectedContentRevision: number;
  expectedAuthorityRevision: number;
  claimId: string;
  authority: MutationAuthority;
  requireWorkspaceManager?: boolean;
  mutation: {
    kind: "update";
    payload: ConnectionVersionPayload;
    name: string; engine: string; provider: string; driverId: string | null;
    host: string; port: number; databaseName: string; sslmode: string;
    readonlyDefault: boolean; allowWrites: boolean; environment: string | null; schemaGroup: string | null;
  } | {
    kind: "delete";
    payload: ConnectionVersionPayload;
  };
}): Promise<StoredConnection | null> {
  const set: SQL = mutation.kind === "update"
    ? sql`"name" = ${mutation.name}, "engine" = ${mutation.engine}, "provider" = ${mutation.provider},
      "driver_id" = ${mutation.driverId}, "host" = ${mutation.host}, "port" = ${mutation.port},
      "database_name" = ${mutation.databaseName}, "sslmode" = ${mutation.sslmode},
      "readonly_default" = ${mutation.readonlyDefault}, "allow_writes" = ${mutation.allowWrites},
      "environment" = ${mutation.environment}, "schema_group" = ${mutation.schemaGroup},
      "revocation_pending_at" = NULL, "revocation_claimed_at" = NULL, "revocation_claim_id" = NULL,
      "content_revision" = "content_revision" + 1, "updated_at" = ${utcNow}`
    : sql`"deleted_at" = ${utcNow}, "provider_integration_id" = NULL, "provider_resource" = NULL,
      "provider_resource_id" = NULL, "revocation_pending_at" = NULL, "revocation_claimed_at" = NULL,
      "revocation_claim_id" = NULL, "content_revision" = "content_revision" + 1, "updated_at" = ${utcNow}`;
  const action = mutation.kind === "update"
    ? requireWorkspaceManager
      ? "connection.write_policy.update"
      : "connection.update"
    : "connection.delete";
  const result = await atomicD1({
    scope: sql`SELECT json_object('parentId', version.id) AS payload
      FROM workspace_connection connection JOIN workspace_resource_version version
        ON version.organization_id = connection.organization_id AND version.resource_type = 'connection'
        AND version.resource_id = connection.id AND version.branch = 'main' AND version.revision = connection.content_revision
      WHERE connection.id = ${connectionId} AND connection.organization_id = ${organizationId}
        AND connection.content_revision = ${expectedContentRevision} AND connection.revision = ${expectedAuthorityRevision}
        AND connection.revocation_claim_id = ${claimId} AND connection.deleted_at IS NULL
        AND ${connectionAuthority(organizationId, authority, sql`${connectionId}`, requireWorkspaceManager)}`,
    statements: (scope) => [
      sql`UPDATE workspace_connection SET ${set} WHERE id = ${connectionId} AND EXISTS (${scope})
        RETURNING ${connectionProjection}`,
      sql`INSERT INTO workspace_resource_version (organization_id, resource_type, resource_id, revision,
          base_revision, parent_version_id, branch, operation, payload, payload_hash, created_by_user_id)
        SELECT ${organizationId}, 'connection', ${connectionId}, ${expectedContentRevision + 1}, ${expectedContentRevision},
          payload ->> 'parentId', 'main', ${mutation.kind}, ${JSON.stringify(mutation.payload)}, ${canonicalHash(mutation.payload)},
          ${authority.userId} FROM (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${organizationId}, ${authority.userId}, ${action}, 'connection', ${connectionId},
          json_object('name', name, 'revision', content_revision, 'allowWrites', json(CASE WHEN allow_writes THEN 'true' ELSE 'false' END)),
          ${crypto.randomUUID()} FROM workspace_connection CROSS JOIN (${scope}) WHERE id = ${connectionId}`,
    ],
  });
  return returnedConnection(result.rows[0][0]);
}

export { restoreWorkspaceSnapshot } from "./workspace-snapshot-restore";
