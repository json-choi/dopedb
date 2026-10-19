// D1 tables for direct shared databases: the secret-free endpoint and scope, one
// receipt per member principal (verifier only, never a password), and pending
// revocations the admin device must still apply. Triggers own the invariants.
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { organization, user } from "./auth";
import { workspaceConnection } from "./connections";

// Direct shared databases: the control plane keeps only the secretless endpoint
// shape, each member's public verifier receipt and pending revocation work. The
// administrator device owns the database-side principals and the admin credential.

export const workspaceDirectEndpoint = sqliteTable(
  "workspace_direct_endpoint",
  {
    organizationId: text("organization_id").notNull(),
    connectionId: text("connection_id").notNull(),
    engine: text("engine").notNull(),
    // PostgreSQL schemas or MySQL databases the principals may read.
    scope: text("scope", { mode: "json" }).notNull(),
    scopeRevision: integer("scope_revision").notNull().default(1),
    writeCeiling: integer("write_ceiling", { mode: "boolean" }).notNull().default(false),
    // PostgreSQL database oid / MySQL server_uuid, bound on first apply.
    serverFingerprint: text("server_fingerprint"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [workspaceConnection.organizationId, workspaceConnection.id],
      name: "workspace_direct_endpoint_connection_fk",
    }).onDelete("cascade"),
    primaryKey({ columns: [table.organizationId, table.connectionId] }),
    check("workspace_direct_endpoint_engine", sql`${table.engine} IN ('postgres', 'mysql')`),
    check(
      "workspace_direct_endpoint_scope",
      sql`json_valid(${table.scope}) AND json_type(${table.scope}) = 'array'
        AND json_array_length(${table.scope}) BETWEEN 1 AND 64`,
    ),
    check(
      "workspace_direct_endpoint_scope_revision",
      sql`typeof(${table.scopeRevision}) = 'integer' AND ${table.scopeRevision} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "workspace_direct_endpoint_write_ceiling",
      sql`typeof(${table.writeCeiling}) = 'integer' AND ${table.writeCeiling} IN (0, 1)`,
    ),
    check(
      "workspace_direct_endpoint_fingerprint",
      sql`${table.serverFingerprint} IS NULL OR length(${table.serverFingerprint}) BETWEEN 1 AND 128`,
    ),
  ],
);

export const workspaceDirectPrincipal = sqliteTable(
  "workspace_direct_principal",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    connectionId: text("connection_id").notNull(),
    // Neither identity has a foreign key: the receipt must outlive the member
    // row so a leave or account deletion can still be revoked on the database.
    memberId: text("member_id").notNull(),
    userId: text("user_id").notNull(),
    principalName: text("principal_name").notNull(),
    marker: text("marker").notNull(),
    verifierKind: text("verifier_kind").notNull(),
    verifier: text("verifier").notNull(),
    verifierVersion: integer("verifier_version").notNull().default(1),
    appliedVerifierVersion: integer("applied_verifier_version").notNull().default(0),
    appliedLevel: text("applied_level").notNull().default("none"),
    state: text("state").notNull().default("requested"),
    failureCode: text("failure_code"),
    serverRoleOid: text("server_role_oid"),
    appliedByDeviceId: text("applied_by_device_id"),
    claimExpiresAt: utcDate("claim_expires_at"),
    scopeRevisionApplied: integer("scope_revision_applied"),
    lastSyncedAt: utcDate("last_synced_at"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [workspaceConnection.organizationId, workspaceConnection.id],
      name: "workspace_direct_principal_connection_fk",
    }).onDelete("cascade"),
    uniqueIndex("workspace_direct_principal_name_idx").on(
      table.organizationId,
      table.connectionId,
      table.principalName,
    ),
    uniqueIndex("workspace_direct_principal_live_member_idx")
      .on(table.organizationId, table.connectionId, table.memberId)
      .where(sql`"state" <> 'dropped'`),
    index("workspace_direct_principal_work_idx").on(table.organizationId, table.connectionId, table.state),
    check(
      "workspace_direct_principal_name",
      sql`length(${table.principalName}) = 27 AND substr(${table.principalName}, 1, 7) = 'dopedb_'
        AND substr(${table.principalName}, 8) NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "workspace_direct_principal_marker",
      sql`length(${table.marker}) = 43 AND ${table.marker} NOT GLOB '*[^A-Za-z0-9_-]*'`,
    ),
    // Only the public verifier is stored. Exact byte shapes are rechecked by the
    // application parser before any literal reaches a database server.
    check(
      "workspace_direct_principal_verifier",
      sql`(${table.verifierKind} = 'scram-sha-256' AND length(${table.verifier}) = 133
          AND ${table.verifier} GLOB 'SCRAM-SHA-256$4096:*')
        OR (${table.verifierKind} = 'caching_sha2' AND length(${table.verifier}) = 70
          AND ${table.verifier} GLOB '$A$005$*')`,
    ),
    check(
      "workspace_direct_principal_versions",
      sql`${table.verifierVersion} BETWEEN 1 AND 9007199254740991
        AND ${table.appliedVerifierVersion} BETWEEN 0 AND ${table.verifierVersion}`,
    ),
    check("workspace_direct_principal_applied_level", sql`${table.appliedLevel} IN ('none', 'read', 'write')`),
    check(
      "workspace_direct_principal_state",
      sql`${table.state} IN ('requested', 'applying', 'ready', 'failed', 'drop_pending', 'dropped')`,
    ),
    check(
      "workspace_direct_principal_failure_code",
      sql`(${table.state} = 'failed') = (${table.failureCode} IS NOT NULL)
        AND (${table.failureCode} IS NULL OR ${table.failureCode} IN (
          'marker_mismatch', 'oid_mismatch', 'owns_objects', 'unexpected_membership',
          'grantor_insufficient', 'version_unsupported', 'endpoint_changed',
          'permission_denied', 'network', 'name_conflict', 'credential_missing'))`,
    ),
    check(
      "workspace_direct_principal_lengths",
      sql`length(${table.memberId}) BETWEEN 1 AND 128 AND length(${table.userId}) BETWEEN 1 AND 128
        AND (${table.serverRoleOid} IS NULL OR length(${table.serverRoleOid}) BETWEEN 1 AND 64)
        AND (${table.appliedByDeviceId} IS NULL OR length(${table.appliedByDeviceId}) BETWEEN 1 AND 128)`,
    ),
  ],
);

export const workspaceDirectRevocation = sqliteTable(
  "workspace_direct_revocation",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    connectionId: text("connection_id").notNull(),
    memberId: text("member_id").notNull(),
    kind: text("kind").notNull(),
    targetLevel: text("target_level").notNull(),
    requestedByUserId: text("requested_by_user_id"),
    state: text("state").notNull().default("pending"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [workspaceConnection.organizationId, workspaceConnection.id],
      name: "workspace_direct_revocation_connection_fk",
    }).onDelete("cascade"),
    index("workspace_direct_revocation_pending_idx").on(table.organizationId, table.connectionId, table.state),
    check(
      "workspace_direct_revocation_kind",
      sql`${table.kind} IN ('member_removed', 'grant_lowered', 'role_lowered', 'team_read_off',
        'db_deleted', 'self_leave', 'account_deleted')`,
    ),
    check("workspace_direct_revocation_target", sql`${table.targetLevel} IN ('none', 'read')`),
    check("workspace_direct_revocation_state", sql`${table.state} IN ('pending', 'applied', 'cancelled')`),
    check(
      "workspace_direct_revocation_lengths",
      sql`length(${table.memberId}) BETWEEN 1 AND 128
        AND (${table.requestedByUserId} IS NULL OR length(${table.requestedByUserId}) BETWEEN 1 AND 128)`,
    ),
  ],
);
