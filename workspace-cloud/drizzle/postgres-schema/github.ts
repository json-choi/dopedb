// Historical PostgreSQL migration/harness schema; the application uses D1.
import { bigint, check, index, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { user, organization } from "./auth";

export const knowledgeGithubInstallation = workspaceControl.table(
  "knowledge_github_installation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    installationId: bigint("installation_id", { mode: "bigint" }).notNull(),
    accountId: text("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    status: text("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("knowledge_github_installation_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("knowledge_github_installation_org_external_idx").on(
      table.organizationId,
      table.installationId,
    ),
    check("knowledge_github_installation_id_positive", sql`${table.installationId} >= 1`),
    check(
      "knowledge_github_installation_status",
      sql`${table.status} IN ('active', 'suspended', 'revoked')`,
    ),
    check(
      "knowledge_github_installation_account_length",
      sql`char_length(${table.accountId}) BETWEEN 1 AND 128
        AND char_length(${table.accountLogin}) BETWEEN 1 AND 255`,
    ),
  ],
);

export const knowledgeGithubSetupState = workspaceControl.table(
  "knowledge_github_setup_state",
  {
    stateHash: text("state_hash").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("knowledge_github_setup_state_expiry_idx").on(table.expiresAt)],
);
