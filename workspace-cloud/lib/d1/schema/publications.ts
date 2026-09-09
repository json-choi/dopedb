import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { matches } from "./patterns";
import { organization, member } from "./auth";
import { workspaceAnalysisArticleRevision } from "./analysis";
import { workspaceAnalysisArticleRun } from "./analysis-runs";

export const workspaceAnalysisPublication = sqliteTable(
  "workspace_analysis_publication",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    articleId: text("article_id").notNull(),
    articleRevision: integer("article_revision").notNull(),
    sourceRunId: text("source_run_id").notNull(),
    slug: text("slug").notNull(),
    version: integer("version").notNull().default(1),
    replacesPublicationId: text("replaces_publication_id"),
    visibility: text("visibility").notNull().default("unlisted"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    approvedByMemberId: text("approved_by_member_id"),
    publishedAt: utcDate("published_at").notNull().default(utcNow),
    revokedAt: utcDate("revoked_at"),
  },
  (table) => [
    unique("workspace_analysis_publication_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("workspace_analysis_publication_slug_version_idx").on(table.slug, table.version),
    uniqueIndex("workspace_analysis_publication_active_slug_idx")
      .on(table.slug)
      .where(sql`${table.revokedAt} IS NULL`),
    index("workspace_analysis_publication_article_idx").on(
      table.organizationId,
      table.articleId,
      table.publishedAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.articleId, table.articleRevision],
      foreignColumns: [
        workspaceAnalysisArticleRevision.organizationId,
        workspaceAnalysisArticleRevision.articleId,
        workspaceAnalysisArticleRevision.revision,
      ],
      name: "workspace_analysis_publication_org_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.replacesPublicationId],
      foreignColumns: [table.organizationId, table.id],
      name: "workspace_analysis_publication_org_replaces_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.sourceRunId],
      foreignColumns: [workspaceAnalysisArticleRun.organizationId, workspaceAnalysisArticleRun.id],
      name: "workspace_analysis_publication_org_run_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.approvedByMemberId],
      foreignColumns: [member.organizationId, member.id],
      name: "workspace_analysis_publication_org_approver_fk",
    }).onDelete("set null"),
    check(
      "workspace_analysis_publication_slug",
      sql`${matches(sql`${table.slug}`, "^[a-z0-9][a-z0-9-]{7,127}$")}`,
    ),
    check(
      "workspace_analysis_publication_visibility",
      sql`${table.visibility} IN ('unlisted', 'public')`,
    ),
    check(
      "workspace_analysis_publication_snapshot",
      sql`json_type(${table.snapshot}) = 'object'
        AND ${matches(sql`${table.snapshotHash}`, "^[0-9a-f]{64}$")}
        AND ${table.version} >= 1`,
    ),
    check(
      "workspace_analysis_publication_text",
      sql`length(trim(${table.title})) BETWEEN 1 AND 160
        AND length(${table.description}) <= 2000`,
    ),
  ],
);
