// Historical PostgreSQL migration/harness schema; the application uses D1.
import { bigint, check, foreignKey, index, integer, jsonb, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { knowledgeSource } from "./sources";
import { organization } from "./auth";

export const knowledgeSourceEvent = workspaceControl.table(
  "knowledge_source_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    sourceId: uuid("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    deliveryId: text("delivery_id").notNull(),
    eventKind: text("event_kind").notNull(),
    beforeCommitSha: text("before_commit_sha"),
    afterCommitSha: text("after_commit_sha"),
    changedFiles: jsonb("changed_files").notNull().default(sql`'[]'::jsonb`),
    state: text("state").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
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
      sql`(${table.beforeCommitSha} IS NULL OR ${table.beforeCommitSha} ~ '^[0-9a-f]{40}$')
        AND (${table.afterCommitSha} IS NULL OR ${table.afterCommitSha} ~ '^[0-9a-f]{40}$')`,
    ),
    check("knowledge_source_event_files_array", sql`jsonb_typeof(${table.changedFiles}) = 'array'`),
  ],
);

export const knowledgeSourceSyncJob = workspaceControl.table(
  "knowledge_source_sync_job",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    sourceId: uuid("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    desiredCommitSha: text("desired_commit_sha").notNull(),
    sourceSyncRevision: bigint("source_sync_revision", { mode: "number" }).notNull(),
    triggerEventId: uuid("trigger_event_id").references(() => knowledgeSourceEvent.id, {
      onDelete: "set null",
    }),
    phase: text("phase").notNull().default("manifest"),
    state: text("state").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    totalFiles: integer("total_files").notNull().default(0),
    processedFiles: integer("processed_files").notNull().default(0),
    manifest: jsonb("manifest"),
    sourceRevisionSha256: text("source_revision_sha256"),
    activationGraphRevisionId: uuid("activation_graph_revision_id"),
    activationParentGraphRevisionId: uuid("activation_parent_graph_revision_id"),
    activationGeneratedAt: timestamp("activation_generated_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    workerId: text("worker_id"),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
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
      sql`${table.desiredCommitSha} ~ '^[0-9a-f]{40}$'`,
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
      sql`${table.manifest} IS NULL OR jsonb_typeof(${table.manifest}) = 'array'`,
    ),
    check(
      "knowledge_source_sync_job_source_revision",
      sql`${table.sourceRevisionSha256} IS NULL
        OR ${table.sourceRevisionSha256} ~ '^[0-9a-f]{64}$'`,
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
