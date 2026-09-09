import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { matches } from "./patterns";
import { organization, member } from "./auth";
import { workspaceConnection } from "./connections";
import { workspaceAnalysisRunner, workspaceAnalysisArticleRevision } from "./analysis";

export const workspaceAnalysisArticleRun = sqliteTable(
  "workspace_analysis_article_run",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    articleId: text("article_id").notNull(),
    articleRevision: integer("article_revision").notNull(),
    runnerId: text("runner_id").notNull(),
    runnerCapabilityGeneration: integer("runner_capability_generation").notNull(),
    requestedByMemberId: text("requested_by_member_id"),
    state: text("state").notNull().default("queued"),
    definitionHash: text("definition_hash").notNull(),
    schemaFingerprints: text("schema_fingerprints", { mode: "json" }).notNull().default(sql`'{}'`),
    rowCount: integer("row_count").notNull().default(0),
    byteCount: integer("byte_count").notNull().default(0),
    resultHash: text("result_hash"),
    errorKind: text("error_kind"),
    errorMessage: text("error_message"),
    cancelRequestedAt: utcDate("cancel_requested_at"),
    cancelRequestedByMemberId: text("cancel_requested_by_member_id"),
    startedAt: utcDate("started_at"),
    finishedAt: utcDate("finished_at"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
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
      sql`${matches(sql`${table.definitionHash}`, "^[0-9a-f]{64}$")}
        AND (${table.resultHash} IS NULL OR ${matches(sql`${table.resultHash}`, "^[0-9a-f]{64}$")})`,
    ),
    check(
      "workspace_analysis_article_run_numbers",
      sql`${table.articleRevision} >= 1 AND ${table.rowCount} >= 0 AND ${table.byteCount} >= 0`,
    ),
    check(
      "workspace_analysis_article_run_json",
      sql`json_type(${table.schemaFingerprints}) = 'object'`,
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
          AND length(${table.errorKind}) BETWEEN 1 AND 128
          AND length(${table.errorMessage}) BETWEEN 1 AND 2000)`,
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

export const workspaceAnalysisArticleQueryReceipt = sqliteTable(
  "workspace_analysis_article_query_receipt",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    runId: text("run_id").notNull(),
    queryNodeId: text("query_node_id").notNull(),
    connectionId: text("connection_id").notNull(),
    connectionRevision: integer("connection_revision").notNull(),
    queryRunId: text("query_run_id").notNull(),
    queryHash: text("query_hash").notNull(),
    schemaFingerprint: text("schema_fingerprint").notNull(),
    state: text("state").notNull(),
    rowCount: integer("row_count").notNull(),
    byteCount: integer("byte_count").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
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
      sql`${matches(sql`${table.queryNodeId}`, "^[A-Za-z][A-Za-z0-9_-]{0,63}$")}`,
    ),
    check(
      "workspace_analysis_query_receipt_hashes",
      sql`${matches(sql`${table.queryHash}`, "^[0-9a-f]{64}$")}
        AND ${matches(sql`${table.schemaFingerprint}`, "^[0-9a-f]{64}$")}`,
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
