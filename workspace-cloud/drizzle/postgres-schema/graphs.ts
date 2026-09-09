// Historical PostgreSQL migration/harness schema; the application uses D1.
import { bigint, check, foreignKey, index, jsonb, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { knowledgeProject, knowledgeProjectEnvironment } from "./projects";
import { knowledgeSource } from "./sources";
import { organization, member } from "./auth";

export const knowledgeGraphRevision = workspaceControl.table(
  "knowledge_graph_revision",
  {
    id: uuid("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    sourceId: uuid("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: uuid("project_environment_id").notNull().references(
      () => knowledgeProjectEnvironment.id,
      { onDelete: "cascade" },
    ),
    environmentRevision: bigint("environment_revision", { mode: "number" }).notNull(),
    parentGraphRevisionId: uuid("parent_graph_revision_id"),
    sourceRevisionSha256: text("source_revision_sha256").notNull(),
    artifactSha256: text("artifact_sha256").notNull(),
    artifact: jsonb("artifact").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    stagedAt: timestamp("staged_at", { withTimezone: true }).notNull().defaultNow(),
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
      sql`${table.sourceRevisionSha256} ~ '^[0-9a-f]{64}$'
        AND ${table.artifactSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("knowledge_graph_revision_artifact_object", sql`jsonb_typeof(${table.artifact}) = 'object'`),
  ],
);

export const knowledgeEnvironmentHead = workspaceControl.table(
  "knowledge_environment_head",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: uuid("project_environment_id").notNull().references(
      () => knowledgeProjectEnvironment.id,
      { onDelete: "cascade" },
    ),
    sourceId: uuid("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    graphRevisionId: uuid("graph_revision_id").notNull().unique().references(
      () => knowledgeGraphRevision.id,
      { onDelete: "restrict" },
    ),
    environmentRevision: bigint("environment_revision", { mode: "number" }).notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
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

export const knowledgeGrant = workspaceControl.table(
  "knowledge_grant",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    memberId: text("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => knowledgeProject.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: uuid("project_environment_id").notNull().references(
      () => knowledgeProjectEnvironment.id,
      { onDelete: "cascade" },
    ),
    environmentRevision: bigint("environment_revision", { mode: "number" }).notNull(),
    graphRevisionId: uuid("graph_revision_id").notNull().references(
      () => knowledgeGraphRevision.id,
      { onDelete: "cascade" },
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

export const knowledgeGrantGraphRevision = workspaceControl.table(
  "knowledge_grant_graph_revision",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    grantId: uuid("grant_id").notNull().references(() => knowledgeGrant.id, {
      onDelete: "cascade",
    }),
    graphRevisionId: uuid("graph_revision_id").notNull().references(
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
