import { sql } from "drizzle-orm";
import { sqliteTable, text, check, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, integerBigInt, uuidDefault } from "./values";
import { user, organization } from "./auth";

export const knowledgeGithubInstallation = sqliteTable(
  "knowledge_github_installation",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    installationId: integerBigInt("installation_id").notNull(),
    accountId: text("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    status: text("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
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
      sql`length(${table.accountId}) BETWEEN 1 AND 128
        AND length(${table.accountLogin}) BETWEEN 1 AND 255`,
    ),
  ],
);

export const knowledgeGithubSetupState = sqliteTable(
  "knowledge_github_setup_state",
  {
    stateHash: text("state_hash").primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    expiresAt: utcDate("expires_at").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [index("knowledge_github_setup_state_expiry_idx").on(table.expiresAt)],
);
