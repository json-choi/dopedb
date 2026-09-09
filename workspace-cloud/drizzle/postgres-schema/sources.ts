// Historical PostgreSQL migration/harness schema; the application uses D1.
import { bigint, check, foreignKey, index, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { knowledgeProject, knowledgeProjectEnvironment } from "./projects";
import { knowledgeGithubInstallation } from "./github";
import { organization } from "./auth";

export const knowledgeSource = workspaceControl.table(
  "knowledge_source",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id").notNull().references(() => knowledgeProject.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: uuid("project_environment_id").notNull().references(
      () => knowledgeProjectEnvironment.id,
      { onDelete: "cascade" },
    ),
    environmentRevision: bigint("environment_revision", { mode: "number" }).notNull(),
    provider: text("provider").notNull(),
    displayName: text("display_name").notNull(),
    visibility: text("visibility").notNull(),
    githubInstallationId: uuid("github_installation_id").references(
      () => knowledgeGithubInstallation.id,
      { onDelete: "restrict" },
    ),
    repositoryId: text("repository_id"),
    repositoryFullName: text("repository_full_name"),
    refName: text("ref_name"),
    commitSha: text("commit_sha"),
    syncState: text("sync_state").notNull().default("pending"),
    syncRevision: bigint("sync_revision", { mode: "number" }).notNull().default(1),
    lastFailureCode: text("last_failure_code"),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("knowledge_source_org_id_idx").on(table.organizationId, table.id),
    index("knowledge_source_environment_idx").on(
      table.organizationId,
      table.projectEnvironmentId,
      table.updatedAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [knowledgeProject.organizationId, knowledgeProject.id],
      name: "knowledge_source_org_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.projectEnvironmentId],
      foreignColumns: [
        knowledgeProjectEnvironment.organizationId,
        knowledgeProjectEnvironment.id,
      ],
      name: "knowledge_source_org_environment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.githubInstallationId],
      foreignColumns: [
        knowledgeGithubInstallation.organizationId,
        knowledgeGithubInstallation.id,
      ],
      name: "knowledge_source_org_github_installation_fk",
    }).onDelete("restrict"),
    check("knowledge_source_provider", sql`${table.provider} = 'github'`),
    check("knowledge_source_visibility", sql`${table.visibility} = 'shared_graph'`),
    check("knowledge_source_name_length", sql`char_length(${table.displayName}) BETWEEN 1 AND 512`),
    check("knowledge_source_environment_revision_positive", sql`${table.environmentRevision} >= 1`),
    check("knowledge_source_sync_revision_positive", sql`${table.syncRevision} >= 1`),
    check(
      "knowledge_source_sync_state",
      sql`${table.syncState} IN ('pending', 'syncing', 'ready', 'stale', 'failed', 'revoked')`,
    ),
    check(
      "knowledge_source_provider_shape",
      sql`(
        ${table.provider} = 'github'
        AND ${table.githubInstallationId} IS NOT NULL
        AND ${table.repositoryId} IS NOT NULL
        AND ${table.repositoryFullName} IS NOT NULL
        AND ${table.refName} IS NOT NULL
        AND ${table.commitSha} ~ '^[0-9a-f]{40}$'
      )`,
    ),
  ],
);
