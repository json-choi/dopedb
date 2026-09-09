// Historical PostgreSQL migration/harness schema; the application uses D1.
import { boolean, check, foreignKey, index, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { knowledgeSource } from "./sources";
import { organization } from "./auth";
import { knowledgeSourceSyncJob } from "./sync";

export const knowledgeCodeIndexFile = workspaceControl.table(
  "knowledge_code_index_file",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    jobId: uuid("job_id").notNull().references(() => knowledgeSourceSyncJob.id, {
      onDelete: "cascade",
    }),
    sourceId: uuid("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    commitSha: text("commit_sha").notNull(),
    path: text("path").notNull(),
    blobSha: text("blob_sha").notNull(),
    bytes: integer("bytes").notNull(),
    language: text("language").notNull(),
    state: text("state").notNull().default("pending"),
    analysis: jsonb("analysis"),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.path] }),
    index("knowledge_code_index_file_pending_idx").on(table.jobId, table.state, table.path),
    index("knowledge_code_index_file_reuse_idx").on(
      table.organizationId,
      table.sourceId,
      table.blobSha,
      table.updatedAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.jobId],
      foreignColumns: [knowledgeSourceSyncJob.organizationId, knowledgeSourceSyncJob.id],
      name: "knowledge_code_index_file_org_job_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.sourceId],
      foreignColumns: [knowledgeSource.organizationId, knowledgeSource.id],
      name: "knowledge_code_index_file_org_source_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.jobId, table.sourceId],
      foreignColumns: [
        knowledgeSourceSyncJob.organizationId,
        knowledgeSourceSyncJob.id,
        knowledgeSourceSyncJob.sourceId,
      ],
      name: "knowledge_code_index_file_exact_job_fk",
    }).onDelete("cascade"),
    check(
      "knowledge_code_index_file_commit",
      sql`${table.commitSha} ~ '^[0-9a-f]{40}$' AND ${table.blobSha} ~ '^[0-9a-f]{40}$'`,
    ),
    check(
      "knowledge_code_index_file_path",
      sql`char_length(${table.path}) BETWEEN 1 AND 4096
        AND ${table.path} !~ '(^/|\\\\|(^|/)\\.\\.?(/|$)|//)'`,
    ),
    check(
      "knowledge_code_index_file_bytes",
      sql`${table.bytes} BETWEEN 0 AND 1048576`,
    ),
    check(
      "knowledge_code_index_file_state",
      sql`${table.state} IN ('pending', 'ready', 'skipped')`,
    ),
    check(
      "knowledge_code_index_file_analysis",
      sql`(${table.state} = 'ready' AND jsonb_typeof(${table.analysis}) = 'object')
        OR (${table.state} <> 'ready' AND ${table.analysis} IS NULL)`,
    ),
  ],
);

export const knowledgeCodeIndexActivationFragment = workspaceControl.table(
  "knowledge_code_index_activation_fragment",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    jobId: uuid("job_id").notNull().references(() => knowledgeSourceSyncJob.id, {
      onDelete: "cascade",
    }),
    sourceId: uuid("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    batchIndex: integer("batch_index").notNull(),
    startPath: text("start_path").notNull(),
    endPath: text("end_path").notNull(),
    fileCount: integer("file_count").notNull(),
    parsedFiles: integer("parsed_files").notNull(),
    skippedFiles: integer("skipped_files").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.batchIndex] }),
    index("knowledge_code_index_activation_fragment_job_idx").on(
      table.organizationId,
      table.jobId,
      table.batchIndex,
    ),
    foreignKey({
      columns: [table.organizationId, table.jobId],
      foreignColumns: [knowledgeSourceSyncJob.organizationId, knowledgeSourceSyncJob.id],
      name: "knowledge_code_index_activation_fragment_org_job_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.sourceId],
      foreignColumns: [knowledgeSource.organizationId, knowledgeSource.id],
      name: "knowledge_code_index_activation_fragment_org_source_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.jobId, table.sourceId],
      foreignColumns: [
        knowledgeSourceSyncJob.organizationId,
        knowledgeSourceSyncJob.id,
        knowledgeSourceSyncJob.sourceId,
      ],
      name: "knowledge_code_index_activation_fragment_exact_job_fk",
    }).onDelete("cascade"),
    check(
      "knowledge_code_index_activation_fragment_batch",
      sql`${table.batchIndex} >= 0
        AND ${table.fileCount} BETWEEN 1 AND 64
        AND ${table.parsedFiles} >= 0
        AND ${table.skippedFiles} >= 0
        AND ${table.parsedFiles} + ${table.skippedFiles} = ${table.fileCount}`,
    ),
    check(
      "knowledge_code_index_activation_fragment_paths",
      sql`char_length(${table.startPath}) BETWEEN 1 AND 4096
        AND char_length(${table.endPath}) BETWEEN 1 AND 4096`,
    ),
  ],
);

export const knowledgeCodeIndexActivationEntity = workspaceControl.table(
  "knowledge_code_index_activation_entity",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    jobId: uuid("job_id").notNull().references(() => knowledgeSourceSyncJob.id, {
      onDelete: "cascade",
    }),
    sourceId: uuid("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    entityKind: text("entity_kind").notNull(),
    entityId: text("entity_id").notNull(),
    batchIndex: integer("batch_index").notNull(),
    primaryDefinition: boolean("primary_definition").notNull().default(false),
    payload: jsonb("payload").notNull(),
    canonicalPayload: text("canonical_payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.entityKind, table.entityId] }),
    index("knowledge_code_index_activation_entity_job_idx").on(
      table.organizationId,
      table.jobId,
      table.entityKind,
      table.entityId,
    ),
    foreignKey({
      columns: [table.organizationId, table.jobId],
      foreignColumns: [knowledgeSourceSyncJob.organizationId, knowledgeSourceSyncJob.id],
      name: "knowledge_code_index_activation_entity_org_job_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.sourceId],
      foreignColumns: [knowledgeSource.organizationId, knowledgeSource.id],
      name: "knowledge_code_index_activation_entity_org_source_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.jobId, table.sourceId],
      foreignColumns: [
        knowledgeSourceSyncJob.organizationId,
        knowledgeSourceSyncJob.id,
        knowledgeSourceSyncJob.sourceId,
      ],
      name: "knowledge_code_index_activation_entity_exact_job_fk",
    }).onDelete("cascade"),
    check(
      "knowledge_code_index_activation_entity_kind",
      sql`${table.entityKind} IN ('node', 'edge', 'evidence')`,
    ),
    check(
      "knowledge_code_index_activation_entity_identity",
      sql`${table.entityId} ~ '^[0-9a-f]{64}$'
        AND ${table.batchIndex} >= 0
        AND jsonb_typeof(${table.payload}) = 'object'
        AND ${table.payload} ->> 'id' = ${table.entityId}
        AND octet_length(${table.canonicalPayload}) BETWEEN 2 AND 2097152
        AND ${table.canonicalPayload}::jsonb = ${table.payload}
        AND left(${table.canonicalPayload}, 1) = '{'
        AND right(${table.canonicalPayload}, 1) = '}'`,
    ),
    check(
      "knowledge_code_index_activation_entity_primary",
      sql`NOT ${table.primaryDefinition} OR ${table.entityKind} = 'node'`,
    ),
  ],
);
