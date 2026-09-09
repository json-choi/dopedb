// Historical PostgreSQL migration/harness schema; the application uses D1.
import { bigint, check, foreignKey, index, jsonb, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { workspaceAnalysisArticleRun } from "./analysis-runs";
import { workspaceAnalysisArticleRevision } from "./analysis";
import { organization, member } from "./auth";

export const workspaceAnalysisPublication = workspaceControl.table(
  "workspace_analysis_publication",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    articleId: uuid("article_id").notNull(),
    articleRevision: bigint("article_revision", { mode: "number" }).notNull(),
    sourceRunId: uuid("source_run_id").notNull(),
    slug: text("slug").notNull(),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    replacesPublicationId: uuid("replaces_publication_id"),
    visibility: text("visibility").notNull().default("unlisted"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    snapshot: jsonb("snapshot").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    approvedByMemberId: text("approved_by_member_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
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
      sql`${table.slug} ~ '^[a-z0-9][a-z0-9-]{7,127}$'`,
    ),
    check(
      "workspace_analysis_publication_visibility",
      sql`${table.visibility} IN ('unlisted', 'public')`,
    ),
    check(
      "workspace_analysis_publication_snapshot",
      sql`jsonb_typeof(${table.snapshot}) = 'object'
        AND ${table.snapshotHash} ~ '^[0-9a-f]{64}$'
        AND ${table.version} >= 1`,
    ),
    check(
      "workspace_analysis_publication_text",
      sql`char_length(btrim(${table.title})) BETWEEN 1 AND 160
        AND char_length(${table.description}) <= 2000`,
    ),
  ],
);
