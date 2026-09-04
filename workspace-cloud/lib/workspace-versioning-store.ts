// Server-side append-only persistence for secretless connection versions. All
// lookups are tenant-scoped so known UUIDs from another workspace reveal nothing.
import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "./db";
import { revocationGateLockKey } from "./revocation-gates";
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
  connectionVersionPayload,
  parseConnectionVersionPayload,
  type ConnectionVersionPayload,
} from "./workspace-versioning";
import type { WorkspaceMetadataSnapshot } from "./workspace-backup-core";

export type MutationAuthority = {
  sessionId: string;
  userId: string;
  membershipId: string;
  role: string;
};


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
  const result = await db.execute<{ conflictId: string }>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${revocationGateLockKey({
        kind: "member", organizationId, memberId: authority.membershipId, userId: authority.userId,
      })}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
        ON member."id" = ${authority.membershipId} AND member."organization_id" = ${organizationId}
        AND member."user_id" = ${authority.userId}
      JOIN "workspace_control"."workspace_connection_grant" manager_grant
        ON manager_grant."organization_id" = ${organizationId}
        AND manager_grant."connection_id" = ${connectionId}::uuid
        AND manager_grant."member_id" = member."id" AND manager_grant."capability" = 'manage'
      JOIN authority_lock ON TRUE
      WHERE session."id" = ${authority.sessionId} AND session."user_id" = ${authority.userId}
        AND session."expires_at" > now() AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member, manager_grant
    ), locked_connection AS MATERIALIZED (
      SELECT "content_revision" FROM ${workspaceConnection}
      WHERE "organization_id" = ${organizationId} AND "id" = ${connectionId}::uuid
      AND EXISTS (SELECT 1 FROM authority)
      FOR UPDATE
    ), server_version AS MATERIALIZED (
      SELECT version."id", version."revision" FROM ${workspaceResourceVersion} AS version
      JOIN locked_connection ON TRUE
      WHERE version."organization_id" = ${organizationId}
        AND version."resource_type" = 'connection'
        AND version."resource_id" = ${connectionId}::uuid
        AND version."branch" = 'main'
        AND version."revision" = locked_connection."content_revision"
    ), base_version AS MATERIALIZED (
      SELECT "id" FROM ${workspaceResourceVersion}
      WHERE "organization_id" = ${organizationId} AND "resource_type" = 'connection'
        AND "resource_id" = ${connectionId}::uuid AND "branch" = 'main'
        AND "revision" = ${expectedRevision}
    ), candidate AS (
      INSERT INTO ${workspaceResourceVersion}
        ("id", "organization_id", "resource_type", "resource_id", "revision",
         "base_revision", "parent_version_id", "branch", "operation", "payload",
         "payload_hash", "created_by_user_id")
      SELECT ${candidateId}::uuid, ${organizationId}, 'connection', ${connectionId}::uuid,
        ${expectedRevision}, ${expectedRevision}, COALESCE(base_version."id", server_version."id"),
        'conflict', ${operation}, ${JSON.stringify(payload)}::jsonb, ${canonicalHash(payload)},
        ${authority.userId}
      FROM server_version LEFT JOIN base_version ON TRUE
      RETURNING "id"
    ), conflict AS (
      INSERT INTO ${workspaceResourceConflict}
        ("id", "organization_id", "resource_type", "resource_id", "expected_revision",
         "server_version_id", "candidate_version_id", "created_by_user_id")
      SELECT ${conflictId}::uuid, ${organizationId}, 'connection', ${connectionId}::uuid,
        ${expectedRevision}, server_version."id", candidate."id", ${authority.userId}
      FROM server_version JOIN candidate ON TRUE
      RETURNING "id"
    ), audit AS (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${organizationId}, ${authority.userId}, 'connection.conflict.recorded',
        'connection_conflict', conflict."id"::text,
        jsonb_build_object('expectedRevision', ${expectedRevision}::bigint,
          'serverRevision', server_version."revision"), ${crypto.randomUUID()}::uuid
      FROM conflict JOIN server_version ON TRUE
    ) SELECT conflict."id"::text AS "conflictId" FROM conflict
  `);
  if (!result.rows[0]?.conflictId) {
    throw new Error("Missing immutable connection version");
  }
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
  const payload = parseConnectionVersionPayload(row[`${prefix}Payload`], {
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
    SELECT conflict."id"::text AS "id",
      conflict."resource_id"::text AS "connectionId",
      conflict."expected_revision" AS "expectedRevision",
      conflict."created_at" AS "createdAt",
      connection."name" AS "connectionName",
      connection."credential_mode" AS "credentialMode",
      current_version."id"::text AS "currentId",
      current_version."revision" AS "currentRevision",
      current_version."operation" AS "currentOperation",
      current_version."payload" AS "currentPayload",
      current_version."payload_hash" AS "currentPayloadHash",
      server_version."id"::text AS "serverId",
      server_version."revision" AS "serverRevision",
      server_version."operation" AS "serverOperation",
      server_version."payload" AS "serverPayload",
      server_version."payload_hash" AS "serverPayloadHash",
      candidate_version."id"::text AS "candidateId",
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
  const result = await db.execute<{ resolution: string; created: boolean }>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${revocationGateLockKey({
        kind: "member", organizationId, memberId: authority.membershipId, userId: authority.userId,
      })}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
        ON member."id" = ${authority.membershipId}
        AND member."organization_id" = ${organizationId}
        AND member."user_id" = ${authority.userId}
      JOIN authority_lock ON TRUE
      WHERE session."id" = ${authority.sessionId}
        AND session."user_id" = ${authority.userId}
        AND session."expires_at" > now()
        AND member."role" = ${authority.role}
        AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member
    ), conflict_row AS MATERIALIZED (
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
        AND conflict."id" = ${conflictId}::uuid
        AND conflict."resource_type" = 'connection'
      FOR UPDATE OF conflict, manager_grant
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
      WHERE CASE ${resolution}::text
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
    ), inserted AS MATERIALIZED (
      INSERT INTO ${workspaceResourceConflictResolution}
        ("id", "organization_id", "conflict_id", "resolution",
         "resulting_version_id", "resolved_by_user_id")
      SELECT ${resolutionId}::uuid, ${organizationId}, eligible."conflict_id", ${resolution},
        eligible."current_id", ${authority.userId}
      FROM eligible
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      ON CONFLICT ("organization_id", "conflict_id") DO NOTHING
      RETURNING "resolution", "resulting_version_id"
    ), audit AS MATERIALIZED (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${organizationId}, ${authority.userId}, 'connection.conflict.resolved',
        'connection_conflict', eligible."conflict_id"::text,
        jsonb_build_object('resolution', inserted."resolution",
          'resultingRevision', eligible."current_revision"), ${requestId}::uuid
      FROM inserted JOIN eligible ON TRUE
      RETURNING "id"
    )
    SELECT inserted."resolution", TRUE AS "created" FROM inserted JOIN audit ON TRUE
    UNION ALL
    SELECT existing."resolution", FALSE AS "created" FROM existing
    WHERE NOT EXISTS (SELECT 1 FROM inserted)
    LIMIT 1
  `);
  const row = result.rows[0];
  if (
    !row
    || !["server", "candidate", "dismissed"].includes(row.resolution)
    || typeof row.created !== "boolean"
  ) return null;
  return {
    resolution: row.resolution as ConnectionConflictResolution,
    created: row.created,
  };
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
  const port = safeNumber(row.port);
  const contentRevision = safeNumber(row.contentRevision);
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt));
  if (
    typeof row.id !== "string" || typeof row.name !== "string" || typeof row.engine !== "string"
    || typeof row.provider !== "string" || !(typeof row.driverId === "string" || row.driverId === null)
    || typeof row.host !== "string" || port === null || typeof row.databaseName !== "string"
    || typeof row.sslmode !== "string" || typeof row.readonlyDefault !== "boolean"
    || typeof row.allowWrites !== "boolean" || !(typeof row.environment === "string" || row.environment === null)
    || !(typeof row.schemaGroup === "string" || row.schemaGroup === null)
    || typeof row.credentialMode !== "string" || contentRevision === null || contentRevision < 1
    || Number.isNaN(updatedAt.valueOf())
  ) return null;
  return {
    id: row.id, name: row.name, engine: row.engine, provider: row.provider, driverId: row.driverId,
    host: row.host, port, databaseName: row.databaseName, sslmode: row.sslmode,
    readonlyDefault: row.readonlyDefault, allowWrites: row.allowWrites, environment: row.environment,
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
  const requestId = crypto.randomUUID();
  const result = await db.execute<RawConnectionRow>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${revocationGateLockKey({
        kind: "member", organizationId, memberId: authority.membershipId, userId: authority.userId,
      })}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member ON member."id" = ${authority.membershipId}
        AND member."organization_id" = ${organizationId} AND member."user_id" = ${authority.userId}
      JOIN authority_lock ON TRUE
      WHERE session."id" = ${authority.sessionId} AND session."user_id" = ${authority.userId}
        AND session."expires_at" > now() AND member."role" = ${authority.role}
        AND member."role" IN ('admin', 'owner') AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member
    ), inserted AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_connection"
        ("id", "organization_id", "name", "engine", "provider", "driver_id", "host", "port",
         "database_name", "sslmode", "readonly_default", "allow_writes", "environment", "schema_group",
         "content_revision", "created_by_user_id")
      SELECT ${connectionId}::uuid, ${organizationId}, ${input.name}, ${input.engine}, ${input.provider},
        ${input.driverId}, ${input.host}, ${input.port}, ${input.database}, ${input.sslmode},
        ${input.readonlyDefault}, ${input.allowWrites}, ${input.env}, ${input.schemaGroup}, 1, ${authority.userId}
      FROM authority
      RETURNING "id" AS "id", "name" AS "name", "engine" AS "engine", "provider" AS "provider",
        "driver_id" AS "driverId", "host" AS "host", "port" AS "port", "database_name" AS "databaseName",
        "sslmode" AS "sslmode", "readonly_default" AS "readonlyDefault", "allow_writes" AS "allowWrites",
        "environment" AS "environment", "schema_group" AS "schemaGroup", "credential_mode" AS "credentialMode",
        "content_revision" AS "contentRevision", "updated_at" AS "updatedAt"
    ), creator_grant AS MATERIALIZED (
      INSERT INTO ${workspaceConnectionGrant}
        ("organization_id", "connection_id", "member_id", "capability")
      SELECT ${organizationId}, inserted."id", ${authority.membershipId}, 'manage'
      FROM inserted
      RETURNING "id"
    ), version AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_resource_version"
        ("id", "organization_id", "resource_type", "resource_id", "revision", "base_revision",
         "parent_version_id", "branch", "operation", "payload", "payload_hash", "created_by_user_id")
      SELECT gen_random_uuid(), ${organizationId}, 'connection', inserted."id", 1, 0, NULL, 'main', 'create',
        ${JSON.stringify(input)}::jsonb, ${canonicalHash(input)}, ${authority.userId}
      FROM inserted JOIN creator_grant ON TRUE RETURNING "id"
    ), audit AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_audit_event"
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id", "redacted_summary", "request_id")
      SELECT ${organizationId}, ${authority.userId}, 'connection.share', 'connection', inserted."id"::text,
        jsonb_build_object('name', inserted."name", 'engine', inserted."engine"), ${requestId}::uuid
      FROM inserted JOIN version ON TRUE RETURNING "id"
    ) SELECT inserted.* FROM inserted JOIN creator_grant ON TRUE JOIN version ON TRUE JOIN audit ON TRUE
  `);
  return returnedConnection(result.rows[0]);
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
  const requestId = crypto.randomUUID();
  const set: SQL = mutation.kind === "update"
    ? sql`"name" = ${mutation.name}, "engine" = ${mutation.engine}, "provider" = ${mutation.provider},
      "driver_id" = ${mutation.driverId}, "host" = ${mutation.host}, "port" = ${mutation.port},
      "database_name" = ${mutation.databaseName}, "sslmode" = ${mutation.sslmode},
      "readonly_default" = ${mutation.readonlyDefault}, "allow_writes" = ${mutation.allowWrites},
      "environment" = ${mutation.environment}, "schema_group" = ${mutation.schemaGroup},
      "revocation_pending_at" = NULL, "revocation_claimed_at" = NULL, "revocation_claim_id" = NULL,
      "content_revision" = "content_revision" + 1, "updated_at" = now()`
    : sql`"deleted_at" = now(), "provider_integration_id" = NULL, "provider_resource" = NULL,
      "provider_resource_id" = NULL, "revocation_pending_at" = NULL, "revocation_claimed_at" = NULL,
      "revocation_claim_id" = NULL, "content_revision" = "content_revision" + 1, "updated_at" = now()`;
  const action = mutation.kind === "update"
    ? requireWorkspaceManager
      ? "connection.write_policy.update"
      : "connection.update"
    : "connection.delete";
  const workspaceManagerGuard = requireWorkspaceManager
    ? sql`AND member."role" IN ('admin', 'owner')`
    : sql``;
  const operation = mutation.kind;
  const result = await db.execute<RawConnectionRow>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${revocationGateLockKey({
        kind: "member", organizationId, memberId: authority.membershipId, userId: authority.userId,
      })}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
        ON member."id" = ${authority.membershipId} AND member."organization_id" = ${organizationId}
        AND member."user_id" = ${authority.userId}
      JOIN "workspace_control"."workspace_connection_grant" manager_grant
        ON manager_grant."organization_id" = ${organizationId}
        AND manager_grant."connection_id" = ${connectionId}::uuid
        AND manager_grant."member_id" = member."id" AND manager_grant."capability" = 'manage'
      JOIN authority_lock ON TRUE
      WHERE session."id" = ${authority.sessionId} AND session."user_id" = ${authority.userId}
        AND session."expires_at" > now() AND member."role" = ${authority.role}
        ${workspaceManagerGuard}
        AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member, manager_grant
    ), parent AS MATERIALIZED (
      SELECT version."id" FROM "workspace_control"."workspace_resource_version" version
      JOIN authority ON TRUE
      WHERE version."organization_id" = ${organizationId} AND version."resource_type" = 'connection'
        AND version."resource_id" = ${connectionId}::uuid AND version."branch" = 'main'
        AND version."revision" = ${expectedContentRevision}
    ), updated AS MATERIALIZED (
      UPDATE "workspace_control"."workspace_connection" connection SET ${set}
      FROM authority, parent
      WHERE connection."id" = ${connectionId}::uuid AND connection."organization_id" = ${organizationId}
        AND connection."content_revision" = ${expectedContentRevision}
        AND connection."revision" = ${expectedAuthorityRevision}
        AND connection."revocation_claim_id" = ${claimId}::uuid AND connection."deleted_at" IS NULL
      RETURNING connection."id" AS "id", connection."name" AS "name", connection."engine" AS "engine",
        connection."provider" AS "provider", connection."driver_id" AS "driverId", connection."host" AS "host",
        connection."port" AS "port", connection."database_name" AS "databaseName", connection."sslmode" AS "sslmode",
        connection."readonly_default" AS "readonlyDefault", connection."allow_writes" AS "allowWrites",
        connection."environment" AS "environment", connection."schema_group" AS "schemaGroup",
        connection."credential_mode" AS "credentialMode", connection."content_revision" AS "contentRevision",
        connection."updated_at" AS "updatedAt"
    ), version AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_resource_version"
        ("id", "organization_id", "resource_type", "resource_id", "revision", "base_revision",
         "parent_version_id", "branch", "operation", "payload", "payload_hash", "created_by_user_id")
      SELECT gen_random_uuid(), ${organizationId}, 'connection', updated."id", updated."contentRevision",
        ${expectedContentRevision}, parent."id", 'main', ${operation}, ${JSON.stringify(mutation.payload)}::jsonb,
        ${canonicalHash(mutation.payload)}, ${authority.userId}
      FROM updated JOIN parent ON TRUE
      RETURNING "id"
    ), audit AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_audit_event"
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${organizationId}, ${authority.userId}, ${action}, 'connection', updated."id"::text,
        jsonb_build_object(
          'name', updated."name",
          'revision', updated."contentRevision",
          'allowWrites', updated."allowWrites"
        ), ${requestId}::uuid
      FROM updated JOIN version ON TRUE
      RETURNING "id"
    ) SELECT updated.* FROM updated JOIN version ON TRUE JOIN audit ON TRUE
  `);
  return returnedConnection(result.rows[0]);
}

/**
 * Applies a decrypted, already validated backup as one PostgreSQL statement.
 * A CTE statement is atomic, so a failed insert, immutable-version violation, or
 * audit failure rolls back the profile CAS and every restore effect together.
 */
export async function restoreWorkspaceSnapshot({
  organizationId,
  backupId,
  expectedRevision,
  sourceRevision,
  authority,
  snapshot,
}: {
  organizationId: string;
  backupId: string;
  expectedRevision: number;
  sourceRevision: number;
  authority: {
    sessionId: string;
    userId: string;
    membershipId: string;
    role: "admin" | "owner";
  };
  snapshot: WorkspaceMetadataSnapshot;
}) {
  const items = snapshot.connections.map((item) => {
    const normalized = {
      ...item,
      readonlyDefault: true,
      allowWrites: false,
    };
    return {
      id: normalized.id,
      content_revision: normalized.contentRevision,
      name: normalized.name,
      engine: normalized.engine,
      provider: normalized.provider,
      driver_id: normalized.driverId,
      host: normalized.host,
      port: normalized.port,
      database_name: normalized.database,
      sslmode: normalized.sslmode,
      readonly_default: normalized.readonlyDefault,
      allow_writes: normalized.allowWrites,
      environment: normalized.env,
      schema_group: normalized.schemaGroup,
      payload: connectionVersionPayload(normalized),
      payload_hash: canonicalHash(connectionVersionPayload(normalized)),
    };
  });
  const result = await db.execute<{
    revision: number;
    restored: number;
    conflictIds: string[];
  }>(sql`
    WITH input AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(items)}::jsonb) AS item(
        "id" uuid, "content_revision" bigint, "name" text, "engine" text,
        "provider" text, "driver_id" text, "host" text, "port" integer,
        "database_name" text, "sslmode" text, "readonly_default" boolean,
        "allow_writes" boolean, "environment" text, "schema_group" text,
        "payload" jsonb, "payload_hash" text
      )
    ), authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(
        ${revocationGateLockKey({
          kind: "member",
          organizationId,
          memberId: authority.membershipId,
          userId: authority.userId,
        })}, 0
      ))
    ), authority AS MATERIALIZED (
      SELECT member."id"
      FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
        ON member."id" = ${authority.membershipId}
        AND member."organization_id" = ${organizationId}
        AND member."user_id" = ${authority.userId}
      JOIN authority_lock ON TRUE
      WHERE session."id" = ${authority.sessionId}
        AND session."user_id" = ${authority.userId}
        AND session."expires_at" > now()
        AND member."role" = ${authority.role}
        AND member."role" IN ('admin', 'owner')
        AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member
    ), backup_gate AS MATERIALIZED (
      SELECT backup."id"
      FROM "workspace_control"."workspace_metadata_backup" backup
      JOIN authority ON TRUE
      WHERE backup."id" = ${backupId}::uuid
        AND backup."organization_id" = ${organizationId}
        AND backup."deleted_at" IS NULL
        AND backup."source_revision" = ${sourceRevision}
      FOR UPDATE OF backup
    ), profile_gate AS MATERIALIZED (
      SELECT profile."organization_id"
      FROM "workspace_control"."workspace_profile" profile
      JOIN backup_gate ON TRUE
      WHERE profile."organization_id" = ${organizationId}
        AND profile."revision" = ${expectedRevision}
      FOR UPDATE OF profile
    ), existing AS MATERIALIZED (
      SELECT item.*, connection."content_revision" AS "server_revision"
      FROM input item
      JOIN "workspace_control"."workspace_connection" connection
        ON connection."organization_id" = ${organizationId} AND connection."id" = item."id"
      JOIN profile_gate ON TRUE
      FOR UPDATE OF connection
    ), server_versions AS MATERIALIZED (
      SELECT existing.*, version."id" AS "server_version_id", base."id" AS "base_version_id"
      FROM existing
      JOIN "workspace_control"."workspace_resource_version" version
        ON version."organization_id" = ${organizationId}
        AND version."resource_type" = 'connection' AND version."resource_id" = existing."id"
        AND version."branch" = 'main' AND version."revision" = existing."server_revision"
      LEFT JOIN "workspace_control"."workspace_resource_version" base
        ON base."organization_id" = ${organizationId}
        AND base."resource_type" = 'connection' AND base."resource_id" = existing."id"
        AND base."branch" = 'main' AND base."revision" = existing."content_revision"
    ), coverage AS MATERIALIZED (
      SELECT 1 FROM profile_gate
      WHERE NOT EXISTS (
        SELECT 1 FROM input item
        LEFT JOIN existing ON existing."id" = item."id"
        LEFT JOIN server_versions ON server_versions."id" = item."id"
        WHERE existing."id" IS NOT NULL AND server_versions."server_version_id" IS NULL
      )
    ), claimed AS MATERIALIZED (
      UPDATE "workspace_control"."workspace_profile"
      SET "revision" = "revision" + 1, "updated_at" = now()
      FROM coverage
      WHERE "organization_id" = ${organizationId} AND "revision" = ${expectedRevision}
      RETURNING "revision"
    ), candidates AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_resource_version"
        ("id", "organization_id", "resource_type", "resource_id", "revision", "base_revision",
         "parent_version_id", "branch", "operation", "payload", "payload_hash", "created_by_user_id")
      SELECT gen_random_uuid(), ${organizationId}, 'connection', "id", "content_revision",
        "content_revision", COALESCE("base_version_id", "server_version_id"), 'conflict', 'restore',
        "payload", "payload_hash", ${authority.userId}
      FROM server_versions
      JOIN claimed ON TRUE
      RETURNING "id", "resource_id"
    ), conflicts AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_resource_conflict"
        ("id", "organization_id", "resource_type", "resource_id", "expected_revision",
         "server_version_id", "candidate_version_id", "created_by_user_id")
      SELECT gen_random_uuid(), ${organizationId}, 'connection', candidate."resource_id",
        server."content_revision", server."server_version_id", candidate."id", ${authority.userId}
      FROM candidates candidate
      JOIN server_versions server ON server."id" = candidate."resource_id"
      RETURNING "id"
    ), missing AS MATERIALIZED (
      SELECT input.* FROM input
      LEFT JOIN existing ON existing."id" = input."id"
      JOIN claimed ON TRUE
      WHERE existing."id" IS NULL
    ), inserted AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_connection"
        ("id", "organization_id", "name", "engine", "provider", "driver_id", "host", "port",
         "database_name", "sslmode", "readonly_default", "allow_writes", "environment", "schema_group",
         "content_revision", "created_by_user_id")
      SELECT "id", ${organizationId}, "name", "engine", "provider", "driver_id", "host", "port",
        "database_name", "sslmode", "readonly_default", "allow_writes", "environment", "schema_group",
        "content_revision", ${authority.userId}
      FROM missing
      RETURNING "id"
    ), restored_grants AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_connection_grant"
        ("organization_id", "connection_id", "member_id", "capability")
      SELECT ${organizationId}, inserted."id", ${authority.membershipId}, 'manage'
      FROM inserted
      ON CONFLICT ("organization_id", "connection_id", "member_id") DO NOTHING
      RETURNING "connection_id"
    ), created_versions AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_resource_version"
        ("id", "organization_id", "resource_type", "resource_id", "revision", "base_revision",
         "parent_version_id", "branch", "operation", "payload", "payload_hash", "created_by_user_id")
      SELECT gen_random_uuid(), ${organizationId}, 'connection', missing."id", missing."content_revision",
        missing."content_revision" - 1, NULL, 'main', 'restore', missing."payload", missing."payload_hash",
        ${authority.userId}
      FROM missing JOIN inserted ON inserted."id" = missing."id"
      JOIN restored_grants ON restored_grants."connection_id" = inserted."id"
    ), audit AS MATERIALIZED (
      INSERT INTO "workspace_control"."workspace_audit_event"
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${organizationId}, ${authority.userId}, 'workspace.backup.restore', 'workspace_backup', ${backupId},
        jsonb_build_object('created', (SELECT count(*) FROM inserted),
          'conflictCount', (SELECT count(*) FROM conflicts), 'sourceRevision', ${sourceRevision}),
        gen_random_uuid()
      FROM claimed
    )
    SELECT claimed."revision"::bigint AS "revision", (SELECT count(*) FROM inserted)::int AS "restored",
      COALESCE((SELECT array_agg(conflict."id"::text) FROM conflicts conflict), ARRAY[]::text[]) AS "conflictIds"
    FROM claimed
  `);
  return result.rows[0] ?? null;
}
