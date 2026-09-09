import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, unique } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { matches } from "./patterns";
import { organization, member } from "./auth";
import { knowledgeProject, knowledgeProjectEnvironment } from "./projects";
import { knowledgeSource } from "./sources";

export const knowledgeGraphRevision = sqliteTable(
  "knowledge_graph_revision",
  {
    id: text("id").primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    sourceId: text("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: text("project_environment_id").notNull().references(
      () => knowledgeProjectEnvironment.id,
      { onDelete: "cascade" },
    ),
    environmentRevision: integer("environment_revision").notNull(),
    parentGraphRevisionId: text("parent_graph_revision_id"),
    sourceRevisionSha256: text("source_revision_sha256").notNull(),
    artifactSha256: text("artifact_sha256").notNull(),
    artifact: text("artifact", { mode: "json" }).notNull(),
    generatedAt: utcDate("generated_at").notNull(),
    stagedAt: utcDate("staged_at").notNull().default(utcNow),
  },
  (table) => [
    unique("knowledge_graph_revision_org_id_idx").on(table.organizationId, table.id),
    index("knowledge_graph_revision_environment_idx").on(
      table.organizationId,
      table.projectEnvironmentId,
      table.stagedAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.sourceId],
      foreignColumns: [knowledgeSource.organizationId, knowledgeSource.id],
      name: "knowledge_graph_revision_org_source_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.projectEnvironmentId],
      foreignColumns: [
        knowledgeProjectEnvironment.organizationId,
        knowledgeProjectEnvironment.id,
      ],
      name: "knowledge_graph_revision_org_environment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.parentGraphRevisionId],
      foreignColumns: [table.organizationId, table.id],
      name: "knowledge_graph_revision_org_parent_fk",
    }).onDelete("restrict"),
    check("knowledge_graph_revision_environment_positive", sql`${table.environmentRevision} >= 1`),
    check(
      "knowledge_graph_revision_hashes",
      sql`${matches(sql`${table.sourceRevisionSha256}`, "^[0-9a-f]{64}$")}
        AND ${matches(sql`${table.artifactSha256}`, "^[0-9a-f]{64}$")}`,
    ),
    check("knowledge_graph_revision_artifact_object", sql`json_type(${table.artifact}) = 'object'`),
  ],
);

export const knowledgeEnvironmentHead = sqliteTable(
  "knowledge_environment_head",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: text("project_environment_id").notNull().references(
      () => knowledgeProjectEnvironment.id,
      { onDelete: "cascade" },
    ),
    sourceId: text("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    graphRevisionId: text("graph_revision_id").notNull().unique().references(
      () => knowledgeGraphRevision.id,
      { onDelete: "restrict" },
    ),
    environmentRevision: integer("environment_revision").notNull(),
    activatedAt: utcDate("activated_at").notNull().default(utcNow),
  },
  (table) => [
    primaryKey({ columns: [table.projectEnvironmentId, table.sourceId] }),
    foreignKey({
      columns: [table.organizationId, table.projectEnvironmentId],
      foreignColumns: [
        knowledgeProjectEnvironment.organizationId,
        knowledgeProjectEnvironment.id,
      ],
      name: "knowledge_environment_head_org_environment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.sourceId],
      foreignColumns: [knowledgeSource.organizationId, knowledgeSource.id],
      name: "knowledge_environment_head_org_source_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.graphRevisionId],
      foreignColumns: [knowledgeGraphRevision.organizationId, knowledgeGraphRevision.id],
      name: "knowledge_environment_head_org_graph_fk",
    }).onDelete("restrict"),
    check("knowledge_environment_head_revision_positive", sql`${table.environmentRevision} >= 1`),
  ],
);

export const knowledgeGrant = sqliteTable(
  "knowledge_grant",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    memberId: text("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => knowledgeProject.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: text("project_environment_id").notNull().references(
      () => knowledgeProjectEnvironment.id,
      { onDelete: "cascade" },
    ),
    environmentRevision: integer("environment_revision").notNull(),
    graphRevisionId: text("graph_revision_id").notNull().references(
      () => knowledgeGraphRevision.id,
      { onDelete: "cascade" },
    ),
    expiresAt: utcDate("expires_at").notNull(),
    revokedAt: utcDate("revoked_at"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    unique("knowledge_grant_org_id_idx").on(table.organizationId, table.id),
    index("knowledge_grant_member_active_idx").on(
      table.organizationId,
      table.memberId,
      table.expiresAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.memberId],
      foreignColumns: [member.organizationId, member.id],
      name: "knowledge_grant_org_member_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [knowledgeProject.organizationId, knowledgeProject.id],
      name: "knowledge_grant_org_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.projectEnvironmentId],
      foreignColumns: [
        knowledgeProjectEnvironment.organizationId,
        knowledgeProjectEnvironment.id,
      ],
      name: "knowledge_grant_org_environment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.graphRevisionId],
      foreignColumns: [knowledgeGraphRevision.organizationId, knowledgeGraphRevision.id],
      name: "knowledge_grant_org_graph_fk",
    }).onDelete("cascade"),
    check("knowledge_grant_environment_revision_positive", sql`${table.environmentRevision} >= 1`),
  ],
);

export const knowledgeGrantGraphRevision = sqliteTable(
  "knowledge_grant_graph_revision",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    grantId: text("grant_id").notNull().references(() => knowledgeGrant.id, {
      onDelete: "cascade",
    }),
    graphRevisionId: text("graph_revision_id").notNull().references(
      () => knowledgeGraphRevision.id,
      { onDelete: "cascade" },
    ),
  },
  (table) => [
    primaryKey({ columns: [table.grantId, table.graphRevisionId] }),
    foreignKey({
      columns: [table.organizationId, table.grantId],
      foreignColumns: [knowledgeGrant.organizationId, knowledgeGrant.id],
      name: "knowledge_grant_graph_revision_org_grant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.graphRevisionId],
      foreignColumns: [knowledgeGraphRevision.organizationId, knowledgeGraphRevision.id],
      name: "knowledge_grant_graph_revision_org_graph_fk",
    }).onDelete("cascade"),
  ],
);
