import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { matches } from "./patterns";
import { user, organization, member } from "./auth";
import { workspaceConnection } from "./connections";
import { knowledgeProjectEnvironment } from "./projects";

export const workspaceAnalysisRunner = sqliteTable(
  "workspace_analysis_runner",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    memberId: text("member_id"),
    deviceId: text("device_id").notNull(),
    displayName: text("display_name").notNull(),
    runnerCapabilityHash: text("runner_capability_hash").notNull(),
    runnerCapabilityGeneration: integer("runner_capability_generation").notNull(),
    lastSeenAt: utcDate("last_seen_at").notNull().default(utcNow),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    revokedAt: utcDate("revoked_at"),
  },
  (table) => [
    unique("workspace_analysis_runner_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("workspace_analysis_runner_org_device_idx").on(
      table.organizationId,
      table.deviceId,
    ).where(sql`${table.revokedAt} IS NULL`),
    index("workspace_analysis_runner_member_idx").on(
      table.organizationId,
      table.memberId,
      table.revokedAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.memberId],
      foreignColumns: [member.organizationId, member.id],
      name: "workspace_analysis_runner_org_member_fk",
    }).onDelete("set null"),
    check(
      "workspace_analysis_runner_text",
      sql`length(${table.deviceId}) BETWEEN 1 AND 256
        AND length(${table.displayName}) BETWEEN 1 AND 256`,
    ),
    check(
      "workspace_analysis_runner_member",
      sql`${table.memberId} IS NOT NULL OR ${table.revokedAt} IS NOT NULL`,
    ),
    check(
      "workspace_analysis_runner_capability",
      sql`${matches(sql`${table.runnerCapabilityHash}`, "^[0-9a-f]{64}$")}
        AND ${table.runnerCapabilityGeneration} >= 1
        AND ${table.runnerCapabilityGeneration} <= 9007199254740991`,
    ),
  ],
);

export const workspaceAnalysisArticle = sqliteTable(
  "workspace_analysis_article",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: text("project_environment_id").notNull(),
    environmentRevision: integer("environment_revision").notNull(),
    connectionId: text("connection_id").notNull(),
    connectionRevision: integer("connection_revision").notNull(),
    definition: text("definition", { mode: "json" }).notNull(),
    ownerMemberId: text("owner_member_id").notNull(),
    updatedByMemberId: text("updated_by_member_id").notNull(),
    revision: integer("revision").notNull().default(1),
    latestSuccessfulRunId: text("latest_successful_run_id"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
    deletedAt: utcDate("deleted_at"),
  },
  (table) => [
    unique("workspace_analysis_article_org_id_idx").on(table.organizationId, table.id),
    index("workspace_analysis_article_environment_idx").on(
      table.organizationId,
      table.projectEnvironmentId,
      table.updatedAt,
    ),
    index("workspace_analysis_article_connection_idx").on(
      table.organizationId,
      table.connectionId,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectEnvironmentId],
      foreignColumns: [
        knowledgeProjectEnvironment.organizationId,
        knowledgeProjectEnvironment.id,
      ],
      name: "workspace_analysis_article_org_environment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [workspaceConnection.organizationId, workspaceConnection.id],
      name: "workspace_analysis_article_org_connection_fk",
    }).onDelete("restrict"),
    check(
      "workspace_analysis_article_revisions",
      sql`${table.environmentRevision} >= 1
        AND ${table.connectionRevision} >= 1
        AND ${table.revision} >= 1
        AND ${table.revision} <= 9007199254740991`,
    ),
    check(
      "workspace_analysis_article_definition",
      sql`json_type(${table.definition}) = 'object'`,
    ),
  ],
);

// Private invitations carry identity and resource pins, never query text or secrets.
export const workspaceArticleInvitation = sqliteTable(
  "workspace_article_invitation",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull(),
    articleId: text("article_id").notNull(),
    connectionId: text("connection_id").notNull(),
    connectionRevision: integer("connection_revision").notNull(),
    inviterMemberId: text("inviter_member_id").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    expiresAt: utcDate("expires_at").notNull(),
    acceptedAt: utcDate("accepted_at"),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "cascade" }),
    revokedAt: utcDate("revoked_at"),
  },
  (table) => [
    index("workspace_article_invitation_article_idx").on(table.organizationId, table.articleId),
    foreignKey({
      columns: [table.organizationId, table.articleId],
      foreignColumns: [workspaceAnalysisArticle.organizationId, workspaceAnalysisArticle.id],
      name: "workspace_article_invitation_article_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [workspaceConnection.organizationId, workspaceConnection.id],
      name: "workspace_article_invitation_connection_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.inviterMemberId],
      foreignColumns: [member.organizationId, member.id],
      name: "workspace_article_invitation_inviter_fk",
    }).onDelete("cascade"),
    check("workspace_article_invitation_identity", sql`
      ${table.recipientEmail} = lower(trim(${table.recipientEmail}))
      AND length(${table.recipientEmail}) BETWEEN 3 AND 254
      AND ${table.connectionRevision} >= 1
      AND ${table.expiresAt} > ${table.createdAt}
      AND ((${table.acceptedAt} IS NULL) = (${table.acceptedByUserId} IS NULL))
    `),
  ],
);

export const workspaceAnalysisArticleRevision = sqliteTable(
  "workspace_analysis_article_revision",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    articleId: text("article_id").notNull(),
    revision: integer("revision").notNull(),
    baseRevision: integer("base_revision"),
    operation: text("operation").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdByMemberId: text("created_by_member_id").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    unique("workspace_analysis_article_revision_unique_idx").on(
      table.organizationId,
      table.articleId,
      table.revision,
    ),
    index("workspace_analysis_article_revision_history_idx").on(
      table.organizationId,
      table.articleId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.articleId],
      foreignColumns: [workspaceAnalysisArticle.organizationId, workspaceAnalysisArticle.id],
      name: "workspace_analysis_article_revision_org_article_fk",
    }).onDelete("cascade"),
    check(
      "workspace_analysis_article_revision_numbers",
      sql`${table.revision} >= 1
        AND ${table.revision} <= 9007199254740991
        AND (${table.baseRevision} IS NULL OR ${table.baseRevision} >= 0)`,
    ),
    check(
      "workspace_analysis_article_revision_operation",
      sql`${table.operation} IN ('create', 'propose', 'update', 'delete')`,
    ),
    check(
      "workspace_analysis_article_revision_payload",
      sql`json_type(${table.payload}) = 'object'
        AND ${matches(sql`${table.payloadHash}`, "^[0-9a-f]{64}$")}`,
    ),
  ],
);
