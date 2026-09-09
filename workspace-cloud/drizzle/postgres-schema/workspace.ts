// Historical PostgreSQL migration/harness schema; the application uses D1.
import { bigint, boolean, check, foreignKey, index, jsonb, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { user, organization } from "./auth";

export const workspaceDeletionReceipt = workspaceControl.table(
  "workspace_deletion_receipt",
  {
    id: uuid("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    requestedByUserId: text("requested_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    purgeAfter: timestamp("purge_after", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("workspace_deletion_receipt_org_pending_idx")
      .on(table.organizationId)
      .where(sql`"status" = 'pending'`),
    index("workspace_deletion_receipt_purge_idx").on(table.status, table.purgeAfter),
    check(
      "workspace_deletion_receipt_status",
      sql`${table.status} IN ('pending', 'cancelled', 'purged')`,
    ),
    check(
      "workspace_deletion_receipt_deadline",
      sql`${table.purgeAfter} >= ${table.requestedAt} + interval '24 hours'`,
    ),
    check(
      "workspace_deletion_receipt_terminal",
      sql`(${table.status} = 'pending'
          AND ${table.cancelledAt} IS NULL AND ${table.purgedAt} IS NULL)
        OR (${table.status} = 'cancelled'
          AND ${table.cancelledAt} IS NOT NULL AND ${table.purgedAt} IS NULL)
        OR (${table.status} = 'purged'
          AND ${table.cancelledAt} IS NULL AND ${table.purgedAt} IS NOT NULL)`,
    ),
  ],
);

export const workspaceProfile = workspaceControl.table("workspace_profile", {
  organizationId: text("organization_id").primaryKey().references(() => organization.id, {
    onDelete: "cascade",
  }),
  lifecycleState: text("lifecycle_state").notNull().default("active"),
  encryptionKeyRef: text("encryption_key_ref").notNull(),
  residencyRegion: text("residency_region"),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  deletionReceiptId: uuid("deletion_receipt_id").references(
    () => workspaceDeletionReceipt.id,
    { onDelete: "restrict" },
  ),
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("workspace_profile_lifecycle_purge_idx").on(table.lifecycleState, table.purgeAfter),
  check("workspace_profile_revision", sql`${table.revision} >= 1 AND ${table.revision} <= 9007199254740991`),
  check(
    "workspace_profile_lifecycle",
    sql`(${table.lifecycleState} = 'active'
        AND ${table.deletionReceiptId} IS NULL
        AND ${table.deletionRequestedAt} IS NULL
        AND ${table.purgeAfter} IS NULL)
      OR (${table.lifecycleState} = 'deletion_pending'
        AND ${table.deletionReceiptId} IS NOT NULL
        AND ${table.deletionRequestedAt} IS NOT NULL
        AND ${table.purgeAfter} IS NOT NULL
        AND ${table.purgeAfter} >= ${table.deletionRequestedAt} + interval '24 hours')`,
  ),
]);

export const workspaceAuditEvent = workspaceControl.table(
  "workspace_audit_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    redactedSummary: jsonb("redacted_summary").notNull().default({}),
    requestId: uuid("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("workspace_audit_org_id_idx").on(table.organizationId, table.id),
    index("workspace_audit_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

// One gap-free sequence per workspace orders every committed shared-resource or
// authority audit fact. Credential-lease and web-only backup/key lifecycle audits
// remain in the audit table but are intentionally outside this projection cursor.
// The database trigger advances this row in the same transaction as each selected
// audit insert.

export const workspaceSyncHead = workspaceControl.table(
  "workspace_sync_head",
  {
    organizationId: text("organization_id").primaryKey().references(() => organization.id, {
      onDelete: "cascade",
    }),
    lastSequence: bigint("last_sequence", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "workspace_sync_head_sequence",
      sql`${table.lastSequence} >= 0 AND ${table.lastSequence} <= 9007199254740991`,
    ),
  ],
);

// Sync events deliberately contain no resource payload, resource id, actor, or
// audit summary. They tell an authenticated desktop which authoritative
// collection must be reconciled; the existing collection APIs independently
// recheck current membership and per-connection grants before returning data.

export const workspaceSyncEvent = workspaceControl.table(
  "workspace_sync_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    auditEventId: uuid("audit_event_id").notNull(),
    resourceType: text("resource_type").notNull(),
    operation: text("operation").notNull(),
    tombstone: boolean("tombstone").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_sync_event_org_sequence_idx").on(
      table.organizationId,
      table.sequence,
    ),
    uniqueIndex("workspace_sync_event_audit_idx").on(table.auditEventId),
    foreignKey({
      columns: [table.organizationId, table.auditEventId],
      foreignColumns: [workspaceAuditEvent.organizationId, workspaceAuditEvent.id],
      name: "workspace_sync_event_org_audit_fk",
    }).onDelete("cascade"),
    check(
      "workspace_sync_event_sequence",
      sql`${table.sequence} >= 1 AND ${table.sequence} <= 9007199254740991`,
    ),
    check(
      "workspace_sync_event_resource_type_length",
      sql`char_length(${table.resourceType}) BETWEEN 1 AND 64`,
    ),
    check(
      "workspace_sync_event_operation_length",
      sql`char_length(${table.operation}) BETWEEN 1 AND 128`,
    ),
  ],
);

// Long-lived provider authorization is isolated from connection templates. The
// credential payload is application-encrypted before it reaches this column; public
// serializers never select it.
