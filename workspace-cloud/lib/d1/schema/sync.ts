import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { matches } from "./patterns";
import { organization } from "./auth";
import { knowledgeSource } from "./sources";

export const knowledgeSourceEvent = sqliteTable(
  "knowledge_source_event",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    sourceId: text("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    deliveryId: text("delivery_id").notNull(),
    eventKind: text("event_kind").notNull(),
    beforeCommitSha: text("before_commit_sha"),
    afterCommitSha: text("after_commit_sha"),
    changedFiles: text("changed_files", { mode: "json" }).notNull().default(sql`'[]'`),
    state: text("state").notNull().default("pending"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    consumedAt: utcDate("consumed_at"),
  },
  (table) => [
    uniqueIndex("knowledge_source_event_delivery_idx").on(table.deliveryId, table.sourceId),
    index("knowledge_source_event_pending_idx").on(
      table.organizationId,
      table.sourceId,
      table.state,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.sourceId],
      foreignColumns: [knowledgeSource.organizationId, knowledgeSource.id],
      name: "knowledge_source_event_org_source_fk",
    }).onDelete("cascade"),
    check(
      "knowledge_source_event_kind",
      sql`${table.eventKind} IN ('push', 'installation', 'repository')`,
    ),
    check(
      "knowledge_source_event_state",
      sql`${table.state} IN ('pending', 'claimed', 'consumed', 'failed')`,
    ),
    check(
      "knowledge_source_event_commits",
      sql`(${table.beforeCommitSha} IS NULL OR ${matches(sql`${table.beforeCommitSha}`, "^[0-9a-f]{40}$")})
        AND (${table.afterCommitSha} IS NULL OR ${matches(sql`${table.afterCommitSha}`, "^[0-9a-f]{40}$")})`,
    ),
    check("knowledge_source_event_files_array", sql`json_type(${table.changedFiles}) = 'array'`),
  ],
);

export const knowledgeSourceSyncJob = sqliteTable(
  "knowledge_source_sync_job",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    sourceId: text("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    desiredCommitSha: text("desired_commit_sha").notNull(),
    sourceSyncRevision: integer("source_sync_revision").notNull(),
    triggerEventId: text("trigger_event_id").references(() => knowledgeSourceEvent.id, {
      onDelete: "set null",
    }),
    phase: text("phase").notNull().default("manifest"),
    state: text("state").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    totalFiles: integer("total_files").notNull().default(0),
    processedFiles: integer("processed_files").notNull().default(0),
    manifest: text("manifest", { mode: "json" }),
    sourceRevisionSha256: text("source_revision_sha256"),
    activationGraphRevisionId: text("activation_graph_revision_id"),
    activationParentGraphRevisionId: text("activation_parent_graph_revision_id"),
    activationGeneratedAt: utcDate("activation_generated_at"),
    availableAt: utcDate("available_at").notNull().default(utcNow),
    claimedAt: utcDate("claimed_at"),
    leaseExpiresAt: utcDate("lease_expires_at"),
    workerId: text("worker_id"),
    failureCode: text("failure_code"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
    finishedAt: utcDate("finished_at"),
  },
  (table) => [
    unique("knowledge_source_sync_job_org_id_idx").on(table.organizationId, table.id),
    unique("knowledge_source_sync_job_org_id_source_idx").on(
      table.organizationId,
      table.id,
      table.sourceId,
    ),
    uniqueIndex("knowledge_source_sync_job_revision_idx").on(
      table.sourceId,
      table.desiredCommitSha,
    ),
    index("knowledge_source_sync_job_claim_idx").on(
      table.state,
      table.availableAt,
      table.createdAt,
    ),
    index("knowledge_source_sync_job_source_idx").on(
      table.organizationId,
      table.sourceId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.sourceId],
      foreignColumns: [knowledgeSource.organizationId, knowledgeSource.id],
      name: "knowledge_source_sync_job_org_source_fk",
    }).onDelete("cascade"),
    check(
      "knowledge_source_sync_job_state",
      sql`${table.state} IN ('queued', 'claimed', 'succeeded', 'failed', 'superseded')`,
    ),
    check(
      "knowledge_source_sync_job_phase",
      sql`${table.phase} IN ('manifest', 'indexing', 'activating')`,
    ),
    check(
      "knowledge_source_sync_job_commit",
      sql`${matches(sql`${table.desiredCommitSha}`, "^[0-9a-f]{40}$")}`,
    ),
    check(
      "knowledge_source_sync_job_revision_positive",
      sql`${table.sourceSyncRevision} >= 1`,
    ),
    check(
      "knowledge_source_sync_job_attempt",
      sql`${table.attempt} >= 0 AND ${table.attempt} <= 20`,
    ),
    check(
      "knowledge_source_sync_job_progress",
      sql`${table.totalFiles} >= 0
        AND ${table.processedFiles} >= 0
        AND ${table.processedFiles} <= ${table.totalFiles}`,
    ),
    check(
      "knowledge_source_sync_job_manifest",
      sql`${table.manifest} IS NULL OR json_type(${table.manifest}) = 'array'`,
    ),
    check(
      "knowledge_source_sync_job_source_revision",
      sql`${table.sourceRevisionSha256} IS NULL
        OR ${matches(sql`${table.sourceRevisionSha256}`, "^[0-9a-f]{64}$")}`,
    ),
    check(
      "knowledge_source_sync_job_activation_identity",
      sql`(${table.activationGraphRevisionId} IS NOT NULL
          AND ${table.activationGeneratedAt} IS NOT NULL)
        OR (${table.activationGraphRevisionId} IS NULL
          AND ${table.activationParentGraphRevisionId} IS NULL
          AND ${table.activationGeneratedAt} IS NULL)`,
    ),
    check(
      "knowledge_source_sync_job_claim_shape",
      sql`(
        ${table.state} = 'claimed'
        AND ${table.claimedAt} IS NOT NULL
        AND ${table.leaseExpiresAt} IS NOT NULL
        AND ${table.workerId} IS NOT NULL
      ) OR ${table.state} <> 'claimed'`,
    ),
  ],
);
