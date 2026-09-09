import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { matches } from "./patterns";
import { user, organization } from "./auth";

export const workspaceDataKey = sqliteTable(
  "workspace_data_key",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
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
    createdAt: utcDate("created_at").notNull().default(utcNow),
    retiredAt: utcDate("retired_at"),
    destroyedAt: utcDate("destroyed_at"),
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
      sql`length(${table.keyReference}) BETWEEN 20 AND 512`,
    ),
    check(
      "workspace_data_key_kms_version",
      sql`${matches(sql`${table.kmsKeyVersion}`, "^projects/[A-Za-z0-9._:-]+/locations/[A-Za-z0-9_-]+/keyRings/[A-Za-z0-9_-]+/cryptoKeys/[A-Za-z0-9_-]+/cryptoKeyVersions/[1-9][0-9]*$")}`,
    ),
    check(
      "workspace_data_key_wrapped_key",
      sql`(${table.wrappedKey} IS NOT NULL
          AND length(${table.wrappedKey}) BETWEEN 1 AND 8192
          AND ${matches(sql`${table.wrappedKey}`, "^[A-Za-z0-9+/]+={0,2}$")}
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
export const workspaceDataKeyRotation = sqliteTable(
  "workspace_data_key_rotation",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    fromDataKeyId: text("from_data_key_id"),
    toDataKeyId: text("to_data_key_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("running"),
    processedBackups: integer("processed_backups").notNull().default(0),
    claimId: text("claim_id"),
    claimExpiresAt: utcDate("claim_expires_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
    completedAt: utcDate("completed_at"),
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
export const workspaceMetadataBackup = sqliteTable(
  "workspace_metadata_backup",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    sourceRevision: integer("source_revision").notNull(),
    keyReference: text("key_reference").notNull(),
    keyVersion: text("key_version").notNull(),
    dataKeyId: text("data_key_id"),
    ciphertext: text("ciphertext").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    reencryptedAt: utcDate("reencrypted_at"),
    reencryptedByRotationId: text("reencrypted_by_rotation_id"),
    deletedAt: utcDate("deleted_at"),
    purgeAfter: utcDate("purge_after"),
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
    check("workspace_metadata_backup_snapshot_hash", sql`${matches(sql`${table.snapshotHash}`, "^[0-9a-f]{64}$")}`),
    check("workspace_metadata_backup_source_revision", sql`${table.sourceRevision} >= 1 AND ${table.sourceRevision} <= 9007199254740991`),
    check(
      "workspace_metadata_backup_key_binding",
      sql`(${table.dataKeyId} IS NULL
          AND ${table.keyReference} = 'dopedb-workspace-backup-hkdf-sha256'
          AND ${table.keyVersion} = 'v1')
        OR (${table.dataKeyId} IS NOT NULL
          AND ${table.keyReference} = 'dopedb-workspace-data-key'
          AND ${matches(sql`${table.keyVersion}`, "^v[1-9][0-9]*$")})`,
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

// Large encrypted envelopes remain inside the backup's atomic D1 transaction.
export const workspaceBackupChunk = sqliteTable("workspace_backup_chunk", {
  organizationId: text("organization_id").notNull(),
  backupId: text("backup_id").notNull(),
  manifest: text("manifest").notNull(),
  part: integer("part").notNull(),
  ciphertext: text("ciphertext").notNull(),
}, (table) => [
  primaryKey({ columns: [table.backupId, table.manifest, table.part] }),
  foreignKey({ columns: [table.organizationId, table.backupId], foreignColumns: [workspaceMetadataBackup.organizationId, workspaceMetadataBackup.id] }).onDelete("cascade"),
  check("workspace_backup_chunk_part", sql`typeof(${table.part}) = 'integer' AND ${table.part} >= 0 AND ${table.part} < 128`),
  check("workspace_backup_chunk_size", sql`length(${table.ciphertext}) > 0 AND length(${table.ciphertext}) <= 524288`),
]);
