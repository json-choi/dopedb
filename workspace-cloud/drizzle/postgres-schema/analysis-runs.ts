// Historical PostgreSQL migration/harness schema; the application uses D1.
import { bigint, check, foreignKey, index, jsonb, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { workspaceConnection } from "./connections";
import { workspaceAnalysisRunner, workspaceAnalysisArticleRevision } from "./analysis";
import { organization, member } from "./auth";

export const workspaceAnalysisArticleRun = workspaceControl.table(
  "workspace_analysis_article_run",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    articleId: uuid("article_id").notNull(),
    articleRevision: bigint("article_revision", { mode: "number" }).notNull(),
    runnerId: uuid("runner_id").notNull(),
    runnerCapabilityGeneration: bigint("runner_capability_generation", { mode: "number" }).notNull(),
    requestedByMemberId: text("requested_by_member_id"),
    state: text("state").notNull().default("queued"),
    definitionHash: text("definition_hash").notNull(),
    schemaFingerprints: jsonb("schema_fingerprints").notNull().default(sql`'{}'::jsonb`),
    rowCount: bigint("row_count", { mode: "number" }).notNull().default(0),
    byteCount: bigint("byte_count", { mode: "number" }).notNull().default(0),
    resultHash: text("result_hash"),
    errorKind: text("error_kind"),
    errorMessage: text("error_message"),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    cancelRequestedByMemberId: text("cancel_requested_by_member_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("workspace_analysis_article_run_org_id_idx").on(table.organizationId, table.id),
    index("workspace_analysis_article_run_article_idx").on(
      table.organizationId,
      table.articleId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.articleId, table.articleRevision],
      foreignColumns: [
        workspaceAnalysisArticleRevision.organizationId,
        workspaceAnalysisArticleRevision.articleId,
        workspaceAnalysisArticleRevision.revision,
      ],
      name: "workspace_analysis_article_run_org_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.runnerId],
      foreignColumns: [workspaceAnalysisRunner.organizationId, workspaceAnalysisRunner.id],
      name: "workspace_analysis_article_run_org_runner_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.requestedByMemberId],
      foreignColumns: [member.organizationId, member.id],
      name: "workspace_analysis_article_run_org_requester_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.organizationId, table.cancelRequestedByMemberId],
      foreignColumns: [member.organizationId, member.id],
      name: "workspace_analysis_article_run_org_cancel_requester_fk",
    }).onDelete("set null"),
    check(
      "workspace_analysis_article_run_state",
      sql`${table.state} IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale')`,
    ),
    check(
      "workspace_analysis_article_run_hashes",
      sql`${table.definitionHash} ~ '^[0-9a-f]{64}$'
        AND (${table.resultHash} IS NULL OR ${table.resultHash} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "workspace_analysis_article_run_numbers",
      sql`${table.articleRevision} >= 1 AND ${table.rowCount} >= 0 AND ${table.byteCount} >= 0`,
    ),
    check(
      "workspace_analysis_article_run_json",
      sql`jsonb_typeof(${table.schemaFingerprints}) = 'object'`,
    ),
    check(
      "workspace_analysis_article_run_terminal",
      sql`(${table.state} IN ('queued', 'running') AND ${table.finishedAt} IS NULL)
        OR (${table.state} IN ('succeeded', 'failed', 'cancelled', 'stale')
          AND ${table.finishedAt} IS NOT NULL)`,
    ),
    check(
      "workspace_analysis_article_run_error",
      sql`(${table.errorKind} IS NULL AND ${table.errorMessage} IS NULL)
        OR (${table.errorKind} IS NOT NULL AND ${table.errorMessage} IS NOT NULL
          AND char_length(${table.errorKind}) BETWEEN 1 AND 128
          AND char_length(${table.errorMessage}) BETWEEN 1 AND 2000)`,
    ),
    check(
      "workspace_analysis_article_run_cancel",
      sql`(${table.cancelRequestedAt} IS NULL AND ${table.cancelRequestedByMemberId} IS NULL)
        OR ${table.cancelRequestedAt} IS NOT NULL`,
    ),
    check(
      "workspace_analysis_article_run_runner_capability",
      sql`${table.runnerCapabilityGeneration} >= 1
        AND ${table.runnerCapabilityGeneration} <= 9007199254740991`,
    ),
  ],
);

export const workspaceAnalysisArticleQueryReceipt = workspaceControl.table(
  "workspace_analysis_article_query_receipt",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    runId: uuid("run_id").notNull(),
    queryNodeId: text("query_node_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    connectionRevision: bigint("connection_revision", { mode: "number" }).notNull(),
    queryRunId: uuid("query_run_id").notNull(),
    queryHash: text("query_hash").notNull(),
    schemaFingerprint: text("schema_fingerprint").notNull(),
    state: text("state").notNull(),
    rowCount: bigint("row_count", { mode: "number" }).notNull(),
    byteCount: bigint("byte_count", { mode: "number" }).notNull(),
    durationMs: bigint("duration_ms", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.queryNodeId] }),
    uniqueIndex("workspace_analysis_query_receipt_run_query_idx").on(
      table.organizationId,
      table.runId,
      table.queryRunId,
    ),
    foreignKey({
      columns: [table.organizationId, table.runId],
      foreignColumns: [workspaceAnalysisArticleRun.organizationId, workspaceAnalysisArticleRun.id],
      name: "workspace_analysis_query_receipt_org_run_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [workspaceConnection.organizationId, workspaceConnection.id],
      name: "workspace_analysis_query_receipt_org_connection_fk",
    }).onDelete("restrict"),
    check(
      "workspace_analysis_query_receipt_node",
      sql`${table.queryNodeId} ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'`,
    ),
    check(
      "workspace_analysis_query_receipt_hashes",
      sql`${table.queryHash} ~ '^[0-9a-f]{64}$'
        AND ${table.schemaFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "workspace_analysis_query_receipt_state",
      sql`${table.state} IN ('succeeded', 'failed', 'cancelled', 'stale')`,
    ),
    check(
      "workspace_analysis_query_receipt_numbers",
      sql`${table.connectionRevision} >= 1 AND ${table.rowCount} >= 0
        AND ${table.byteCount} >= 0 AND ${table.durationMs} >= 0`,
    ),
  ],
);
