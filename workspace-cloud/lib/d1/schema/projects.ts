import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { organization } from "./auth";
import { workspaceConnection } from "./connections";

export const knowledgeProject = sqliteTable(
  "knowledge_project",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
    deletedAt: utcDate("deleted_at"),
  },
  (table) => [
    unique("knowledge_project_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("knowledge_project_org_name_idx")
      .on(table.organizationId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    check("knowledge_project_name_length", sql`length(${table.name}) BETWEEN 1 AND 512`),
    check("knowledge_project_revision_positive", sql`${table.revision} >= 1`),
  ],
);

export const knowledgeProjectEnvironment = sqliteTable(
  "knowledge_project_environment",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectId: text("project_id").notNull().references(() => knowledgeProject.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    production: integer("production", { mode: "boolean" }).notNull().default(false),
    riskClass: text("risk_class").notNull().default("custom"),
    revision: integer("revision").notNull().default(1),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
  },
  (table) => [
    unique("knowledge_environment_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("knowledge_environment_project_name_idx").on(table.projectId, table.name),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [knowledgeProject.organizationId, knowledgeProject.id],
      name: "knowledge_environment_org_project_fk",
    }).onDelete("cascade"),
    check("knowledge_environment_name_length", sql`length(${table.name}) BETWEEN 1 AND 512`),
    check(
      "knowledge_environment_risk_class",
      sql`${table.riskClass} IN ('production', 'staging', 'development', 'test', 'custom')`,
    ),
    check("knowledge_environment_revision_positive", sql`${table.revision} >= 1`),
  ],
);

export const knowledgeEnvironmentConnection = sqliteTable(
  "knowledge_environment_connection",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: text("project_environment_id").notNull().references(
      () => knowledgeProjectEnvironment.id,
      { onDelete: "cascade" },
    ),
    environmentRevision: integer("environment_revision").notNull(),
    connectionId: text("connection_id").notNull().references(() => workspaceConnection.id, {
      onDelete: "cascade",
    }),
    connectionRevision: integer("connection_revision").notNull(),
    role: text("role").notNull(),
    alias: text("alias").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    revokedAt: utcDate("revoked_at"),
  },
  (table) => [
    uniqueIndex("knowledge_environment_connection_active_idx")
      .on(table.organizationId, table.connectionId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("knowledge_environment_connection_scope_idx").on(
      table.organizationId,
      table.projectEnvironmentId,
      table.revokedAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectEnvironmentId],
      foreignColumns: [
        knowledgeProjectEnvironment.organizationId,
        knowledgeProjectEnvironment.id,
      ],
      name: "knowledge_environment_connection_org_environment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [workspaceConnection.organizationId, workspaceConnection.id],
      name: "knowledge_environment_connection_org_connection_fk",
    }).onDelete("cascade"),
    check(
      "knowledge_environment_connection_revisions_positive",
      sql`${table.environmentRevision} >= 1 AND ${table.connectionRevision} >= 1`,
    ),
    check(
      "knowledge_environment_connection_labels",
      sql`length(${table.role}) BETWEEN 1 AND 64
        AND length(${table.alias}) BETWEEN 1 AND 128`,
    ),
  ],
);
