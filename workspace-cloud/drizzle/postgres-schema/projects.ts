// Historical PostgreSQL migration/harness schema; the application uses D1.
import { bigint, boolean, check, foreignKey, index, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { workspaceConnection } from "./connections";
import { organization } from "./auth";

export const knowledgeProject = workspaceControl.table(
  "knowledge_project",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("knowledge_project_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("knowledge_project_org_name_idx")
      .on(table.organizationId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    check("knowledge_project_name_length", sql`char_length(${table.name}) BETWEEN 1 AND 512`),
    check("knowledge_project_revision_positive", sql`${table.revision} >= 1`),
  ],
);

export const knowledgeProjectEnvironment = workspaceControl.table(
  "knowledge_project_environment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id").notNull().references(() => knowledgeProject.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    production: boolean("production").notNull().default(false),
    riskClass: text("risk_class").notNull().default("custom"),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("knowledge_environment_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("knowledge_environment_project_name_idx").on(table.projectId, table.name),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [knowledgeProject.organizationId, knowledgeProject.id],
      name: "knowledge_environment_org_project_fk",
    }).onDelete("cascade"),
    check("knowledge_environment_name_length", sql`char_length(${table.name}) BETWEEN 1 AND 512`),
    check(
      "knowledge_environment_risk_class",
      sql`${table.riskClass} IN ('production', 'staging', 'development', 'test', 'custom')`,
    ),
    check("knowledge_environment_revision_positive", sql`${table.revision} >= 1`),
  ],
);

export const knowledgeEnvironmentConnection = workspaceControl.table(
  "knowledge_environment_connection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: uuid("project_environment_id").notNull().references(
      () => knowledgeProjectEnvironment.id,
      { onDelete: "cascade" },
    ),
    environmentRevision: bigint("environment_revision", { mode: "number" }).notNull(),
    connectionId: uuid("connection_id").notNull().references(() => workspaceConnection.id, {
      onDelete: "cascade",
    }),
    connectionRevision: bigint("connection_revision", { mode: "number" }).notNull(),
    role: text("role").notNull(),
    alias: text("alias").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
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
      sql`char_length(${table.role}) BETWEEN 1 AND 64
        AND char_length(${table.alias}) BETWEEN 1 AND 128`,
    ),
  ],
);
