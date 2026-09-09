import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow } from "./values";
import { matches, safeRelativePath } from "./patterns";
import { organization } from "./auth";
import { knowledgeSource } from "./sources";
import { knowledgeSourceSyncJob } from "./sync";

export const knowledgeCodeIndexFile = sqliteTable(
  "knowledge_code_index_file",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    jobId: text("job_id").notNull().references(() => knowledgeSourceSyncJob.id, {
      onDelete: "cascade",
    }),
    sourceId: text("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    commitSha: text("commit_sha").notNull(),
    path: text("path").notNull(),
    blobSha: text("blob_sha").notNull(),
    bytes: integer("bytes").notNull(),
    language: text("language").notNull(),
    state: text("state").notNull().default("pending"),
    analysis: text("analysis", { mode: "json" }),
    failureCode: text("failure_code"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
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
      sql`${matches(sql`${table.commitSha}`, "^[0-9a-f]{40}$")} AND ${matches(sql`${table.blobSha}`, "^[0-9a-f]{40}$")}`,
    ),
    check(
      "knowledge_code_index_file_path",
      sql`length(${table.path}) BETWEEN 1 AND 4096
        AND ${safeRelativePath(table.path)}`,
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
      sql`(${table.state} = 'ready' AND json_type(${table.analysis}) = 'object')
        OR (${table.state} <> 'ready' AND ${table.analysis} IS NULL)`,
    ),
  ],
);

export const knowledgeCodeIndexActivationFragment = sqliteTable(
  "knowledge_code_index_activation_fragment",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    jobId: text("job_id").notNull().references(() => knowledgeSourceSyncJob.id, {
      onDelete: "cascade",
    }),
    sourceId: text("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    batchIndex: integer("batch_index").notNull(),
    startPath: text("start_path").notNull(),
    endPath: text("end_path").notNull(),
    fileCount: integer("file_count").notNull(),
    parsedFiles: integer("parsed_files").notNull(),
    skippedFiles: integer("skipped_files").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
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
      sql`length(${table.startPath}) BETWEEN 1 AND 4096
        AND length(${table.endPath}) BETWEEN 1 AND 4096`,
    ),
  ],
);

export const knowledgeCodeIndexActivationEntity = sqliteTable(
  "knowledge_code_index_activation_entity",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    jobId: text("job_id").notNull().references(() => knowledgeSourceSyncJob.id, {
      onDelete: "cascade",
    }),
    sourceId: text("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    entityKind: text("entity_kind").notNull(),
    entityId: text("entity_id").notNull(),
    batchIndex: integer("batch_index").notNull(),
    primaryDefinition: integer("primary_definition", { mode: "boolean" }).notNull().default(false),
    payload: text("payload", { mode: "json" }).notNull(),
    canonicalPayload: text("canonical_payload").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
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
      sql`${matches(sql`${table.entityId}`, "^[0-9a-f]{64}$")}
        AND ${table.batchIndex} >= 0
        AND json_type(${table.payload}) = 'object'
        AND ${table.payload} ->> 'id' = ${table.entityId}
        AND length(CAST(${table.canonicalPayload} AS BLOB)) BETWEEN 2 AND 2097152
        AND json(${table.canonicalPayload}) = json(${table.payload})
        AND substr(${table.canonicalPayload}, 1, 1) = '{'
        AND substr(${table.canonicalPayload}, -1) = '}'`,
    ),
    check(
      "knowledge_code_index_activation_entity_primary",
      sql`NOT ${table.primaryDefinition} OR ${table.entityKind} = 'node'`,
    ),
  ],
);
