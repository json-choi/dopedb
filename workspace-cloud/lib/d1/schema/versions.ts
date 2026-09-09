import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { matches } from "./patterns";
import { user, organization } from "./auth";
import { workspaceConnection } from "./connections";

export const workspaceResourceVersion = sqliteTable(
  "workspace_resource_version",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    revision: integer("revision").notNull(),
    baseRevision: integer("base_revision"),
    parentVersionId: text("parent_version_id"),
    branch: text("branch").notNull().default("main"),
    operation: text("operation").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    unique("workspace_resource_version_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("workspace_resource_version_main_revision_idx")
      .on(table.organizationId, table.resourceType, table.resourceId, table.revision)
      .where(sql`"branch" = 'main'`),
    index("workspace_resource_version_org_resource_created_idx").on(
      table.organizationId,
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [workspaceConnection.organizationId, workspaceConnection.id],
      name: "workspace_resource_version_org_connection_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.parentVersionId],
      foreignColumns: [table.organizationId, table.id],
      name: "workspace_resource_version_org_parent_fk",
    }).onDelete("restrict"),
    check("workspace_resource_version_type", sql`${table.resourceType} = 'connection'`),
    check("workspace_resource_version_branch", sql`${table.branch} IN ('main', 'conflict')`),
    check(
      "workspace_resource_version_revision",
      sql`(${table.branch} = 'main' AND ${table.revision} >= 1 AND ${table.revision} <= 9007199254740991)
        OR (${table.branch} = 'conflict' AND ${table.revision} >= 0 AND ${table.revision} <= 9007199254740991)`,
    ),
    check(
      "workspace_resource_version_base_revision",
      sql`${table.baseRevision} IS NULL OR (${table.baseRevision} >= 0 AND ${table.baseRevision} <= 9007199254740991)`,
    ),
    check(
      "workspace_resource_version_operation",
      sql`${table.operation} IN ('create', 'update', 'delete', 'restore')`,
    ),
    check("workspace_resource_version_payload_hash", sql`${matches(sql`${table.payloadHash}`, "^[0-9a-f]{64}$")}`),
  ],
);

// A conflict is an opaque tenant-local handle joining an immutable stale candidate
// to the main-line version that won the optimistic-concurrency race.
export const workspaceResourceConflict = sqliteTable(
  "workspace_resource_conflict",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    expectedRevision: integer("expected_revision").notNull(),
    serverVersionId: text("server_version_id").notNull(),
    candidateVersionId: text("candidate_version_id").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    unique("workspace_resource_conflict_org_id_idx").on(table.organizationId, table.id),
    index("workspace_resource_conflict_org_resource_idx").on(
      table.organizationId,
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [workspaceConnection.organizationId, workspaceConnection.id],
      name: "workspace_resource_conflict_org_connection_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.serverVersionId],
      foreignColumns: [workspaceResourceVersion.organizationId, workspaceResourceVersion.id],
      name: "workspace_resource_conflict_org_server_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.candidateVersionId],
      foreignColumns: [workspaceResourceVersion.organizationId, workspaceResourceVersion.id],
      name: "workspace_resource_conflict_org_candidate_version_fk",
    }).onDelete("restrict"),
    check("workspace_resource_conflict_type", sql`${table.resourceType} = 'connection'`),
    check("workspace_resource_conflict_expected_revision", sql`${table.expectedRevision} >= 0 AND ${table.expectedRevision} <= 9007199254740991`),
  ],
);

// Conflict decisions are append-only audit facts. The chosen resulting version
// is retained alongside the decision so a later main-line change cannot rewrite
// what the reviewer actually approved.
export const workspaceResourceConflictResolution = sqliteTable(
  "workspace_resource_conflict_resolution",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    conflictId: text("conflict_id").notNull(),
    resolution: text("resolution").notNull(),
    resultingVersionId: text("resulting_version_id").notNull(),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("workspace_resource_conflict_resolution_org_id_idx")
      .on(table.organizationId, table.id),
    uniqueIndex("workspace_resource_conflict_resolution_org_conflict_idx")
      .on(table.organizationId, table.conflictId),
    foreignKey({
      columns: [table.organizationId, table.conflictId],
      foreignColumns: [workspaceResourceConflict.organizationId, workspaceResourceConflict.id],
      name: "workspace_resource_conflict_resolution_org_conflict_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.resultingVersionId],
      foreignColumns: [workspaceResourceVersion.organizationId, workspaceResourceVersion.id],
      name: "workspace_resource_conflict_resolution_org_version_fk",
    }).onDelete("restrict"),
    check(
      "workspace_resource_conflict_resolution_value",
      sql`${table.resolution} IN ('server', 'candidate', 'dismissed')`,
    ),
  ],
);

// A workspace data-encryption key exists only as Cloud KMS-wrapped ciphertext.
// Rotation creates a new version, re-encrypts every backup, and then erases the
// retired wrapped DEK so an old version cannot be recovered from the database.
