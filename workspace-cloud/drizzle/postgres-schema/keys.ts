// Historical PostgreSQL migration/harness schema; the application uses D1.
import { bigint, check, foreignKey, index, integer, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { user, organization } from "./auth";

export const workspaceDataKey = workspaceControl.table(
  "workspace_data_key",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    version: integer("version").notNull(),
    keyReference: text("key_reference").notNull(),
    kmsKeyVersion: text("kms_key_version").notNull(),
    wrappedKey: text("wrapped_key"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    destroyedAt: timestamp("destroyed_at", { withTimezone: true }),
  },
  (table) => [
    unique("workspace_data_key_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("workspace_data_key_org_version_idx").on(
      table.organizationId,
      table.version,
    ),
    uniqueIndex("workspace_data_key_org_active_idx")
      .on(table.organizationId)
      .where(sql`"retired_at" IS NULL`),
    check(
      "workspace_data_key_version",
      sql`${table.version} >= 1 AND ${table.version} <= 2147483647`,
    ),
    check(
      "workspace_data_key_reference_length",
      sql`char_length(${table.keyReference}) BETWEEN 20 AND 512`,
    ),
    check(
      "workspace_data_key_kms_version",
      sql`${table.kmsKeyVersion} ~ '^projects/[A-Za-z0-9._:-]+/locations/[A-Za-z0-9_-]+/keyRings/[A-Za-z0-9_-]+/cryptoKeys/[A-Za-z0-9_-]+/cryptoKeyVersions/[1-9][0-9]*$'`,
    ),
    check(
      "workspace_data_key_wrapped_key",
      sql`(${table.wrappedKey} IS NOT NULL
          AND char_length(${table.wrappedKey}) BETWEEN 1 AND 8192
          AND ${table.wrappedKey} ~ '^[A-Za-z0-9+/]+={0,2}$'
          AND ${table.destroyedAt} IS NULL)
        OR (${table.wrappedKey} IS NULL
          AND ${table.destroyedAt} IS NOT NULL
          AND ${table.retiredAt} IS NOT NULL)`,
    ),
  ],
);

// Rotation is a resumable owner command. A short database claim prevents two
// requests from processing the same workspace concurrently; an expired claim
// can be recovered without losing already re-encrypted backups.

export const workspaceDataKeyRotation = workspaceControl.table(
  "workspace_data_key_rotation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    fromDataKeyId: uuid("from_data_key_id"),
    toDataKeyId: uuid("to_data_key_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    status: text("status").notNull().default("running"),
    processedBackups: integer("processed_backups").notNull().default(0),
    claimId: uuid("claim_id"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    unique("workspace_data_key_rotation_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("workspace_data_key_rotation_org_idempotency_idx").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    uniqueIndex("workspace_data_key_rotation_org_running_idx")
      .on(table.organizationId)
      .where(sql`"status" = 'running'`),
    foreignKey({
      columns: [table.organizationId, table.fromDataKeyId],
      foreignColumns: [workspaceDataKey.organizationId, workspaceDataKey.id],
      name: "workspace_data_key_rotation_org_from_key_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.toDataKeyId],
      foreignColumns: [workspaceDataKey.organizationId, workspaceDataKey.id],
      name: "workspace_data_key_rotation_org_to_key_fk",
    }).onDelete("restrict"),
    check(
      "workspace_data_key_rotation_status",
      sql`${table.status} IN ('running', 'completed')`,
    ),
    check(
      "workspace_data_key_rotation_processed",
      sql`${table.processedBackups} >= 0`,
    ),
    check(
      "workspace_data_key_rotation_claim",
      sql`(${table.claimId} IS NULL AND ${table.claimExpiresAt} IS NULL)
        OR (${table.status} = 'running'
          AND ${table.claimId} IS NOT NULL
          AND ${table.claimExpiresAt} IS NOT NULL)`,
    ),
    check(
      "workspace_data_key_rotation_completion",
      sql`(${table.status} = 'running' AND ${table.completedAt} IS NULL)
        OR (${table.status} = 'completed' AND ${table.completedAt} IS NOT NULL)`,
    ),
  ],
);

// Backup payloads are ciphertext only. Metadata snapshots are immutable after
// creation except for owner-approved key rotation; deletion is a retention
// tombstone and never exposes the envelope.

export const workspaceMetadataBackup = workspaceControl.table(
  "workspace_metadata_backup",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    sourceRevision: bigint("source_revision", { mode: "number" }).notNull(),
    keyReference: text("key_reference").notNull(),
    keyVersion: text("key_version").notNull(),
    dataKeyId: uuid("data_key_id"),
    ciphertext: text("ciphertext").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reencryptedAt: timestamp("reencrypted_at", { withTimezone: true }),
    reencryptedByRotationId: uuid("reencrypted_by_rotation_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("workspace_metadata_backup_org_id_idx").on(table.organizationId, table.id),
    index("workspace_metadata_backup_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("workspace_metadata_backup_org_data_key_idx").on(
      table.organizationId,
      table.dataKeyId,
    ),
    foreignKey({
      columns: [table.organizationId, table.dataKeyId],
      foreignColumns: [workspaceDataKey.organizationId, workspaceDataKey.id],
      name: "workspace_metadata_backup_org_data_key_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.reencryptedByRotationId],
      foreignColumns: [
        workspaceDataKeyRotation.organizationId,
        workspaceDataKeyRotation.id,
      ],
      name: "workspace_metadata_backup_org_rotation_fk",
    }).onDelete("restrict"),
    check("workspace_metadata_backup_snapshot_hash", sql`${table.snapshotHash} ~ '^[0-9a-f]{64}$'`),
    check("workspace_metadata_backup_source_revision", sql`${table.sourceRevision} >= 1 AND ${table.sourceRevision} <= 9007199254740991`),
    check(
      "workspace_metadata_backup_key_binding",
      sql`(${table.dataKeyId} IS NULL
          AND ${table.keyReference} = 'dopedb-workspace-backup-hkdf-sha256'
          AND ${table.keyVersion} = 'v1')
        OR (${table.dataKeyId} IS NOT NULL
          AND ${table.keyReference} = 'dopedb-workspace-data-key'
          AND ${table.keyVersion} ~ '^v[1-9][0-9]*$')`,
    ),
    check(
      "workspace_metadata_backup_retention",
      sql`(${table.deletedAt} IS NULL AND ${table.purgeAfter} IS NULL)
        OR (${table.deletedAt} IS NOT NULL
          AND ${table.purgeAfter} IS NOT NULL
          AND ${table.purgeAfter} >= ${table.deletedAt})`,
    ),
  ],
);

// Lease rows are a secret-free revocation and audit index. One-time passwords and
// tokens are returned directly to the native client and are never inserted here.
