// Historical PostgreSQL migration/harness schema; the application uses D1.
import { bigint, check, foreignKey, index, jsonb, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { knowledgeProjectEnvironment } from "./projects";
import { workspaceConnection } from "./connections";
import { user, organization, member } from "./auth";

export const workspaceAnalysisRunner = workspaceControl.table(
  "workspace_analysis_runner",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    memberId: text("member_id"),
    deviceId: text("device_id").notNull(),
    displayName: text("display_name").notNull(),
    runnerCapabilityHash: text("runner_capability_hash").notNull(),
    runnerCapabilityGeneration: bigint("runner_capability_generation", { mode: "number" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
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
      sql`char_length(${table.deviceId}) BETWEEN 1 AND 256
        AND char_length(${table.displayName}) BETWEEN 1 AND 256`,
    ),
    check(
      "workspace_analysis_runner_member",
      sql`${table.memberId} IS NOT NULL OR ${table.revokedAt} IS NOT NULL`,
    ),
    check(
      "workspace_analysis_runner_capability",
      sql`${table.runnerCapabilityHash} ~ '^[0-9a-f]{64}$'
        AND ${table.runnerCapabilityGeneration} >= 1
        AND ${table.runnerCapabilityGeneration} <= 9007199254740991`,
    ),
  ],
);

export const workspaceAnalysisArticle = workspaceControl.table(
  "workspace_analysis_article",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: uuid("project_environment_id").notNull(),
    environmentRevision: bigint("environment_revision", { mode: "number" }).notNull(),
    connectionId: uuid("connection_id").notNull(),
    connectionRevision: bigint("connection_revision", { mode: "number" }).notNull(),
    definition: jsonb("definition").notNull(),
    ownerMemberId: text("owner_member_id").notNull(),
    updatedByMemberId: text("updated_by_member_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    latestSuccessfulRunId: uuid("latest_successful_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
      sql`jsonb_typeof(${table.definition}) = 'object'`,
    ),
  ],
);

// Private invitations carry identity and resource pins, never query text or secrets.

export const workspaceArticleInvitation = workspaceControl.table(
  "workspace_article_invitation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    articleId: uuid("article_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    connectionRevision: bigint("connection_revision", { mode: "number" }).notNull(),
    inviterMemberId: text("inviter_member_id").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "cascade" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
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
      ${table.recipientEmail} = lower(btrim(${table.recipientEmail}))
      AND length(${table.recipientEmail}) BETWEEN 3 AND 254
      AND ${table.connectionRevision} >= 1
      AND ${table.expiresAt} > ${table.createdAt}
      AND ((${table.acceptedAt} IS NULL) = (${table.acceptedByUserId} IS NULL))
    `),
  ],
);

export const workspaceAnalysisArticleRevision = workspaceControl.table(
  "workspace_analysis_article_revision",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    articleId: uuid("article_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    baseRevision: bigint("base_revision", { mode: "number" }),
    operation: text("operation").notNull(),
    payload: jsonb("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdByMemberId: text("created_by_member_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
      sql`jsonb_typeof(${table.payload}) = 'object'
        AND ${table.payloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
