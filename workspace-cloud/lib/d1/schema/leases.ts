import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { user, organization } from "./auth";
import { workspaceProviderIntegration } from "./integrations";
import { workspaceConnection } from "./connections";

export const workspaceCredentialLease = sqliteTable(
  "workspace_credential_lease",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    connectionId: text("connection_id").notNull().references(() => workspaceConnection.id, {
      onDelete: "cascade",
    }),
    integrationId: text("integration_id").notNull().references(
      () => workspaceProviderIntegration.id,
      { onDelete: "cascade" },
    ),
    userId: text("user_id").notNull().references(() => user.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull(),
    accessMode: text("access_mode").notNull(),
    externalCredentialId: text("external_credential_id").notNull(),
    externalCredentialKind: text("external_credential_kind").notNull(),
    // Exact redacted resource identity returned by the live Provider proof.
    // Pending reservations have no completed Provider proof yet.
    providerAuditId: text("provider_audit_id"),
    activeSlot: integer("active_slot"),
    expiresAt: utcDate("expires_at").notNull(),
    revokedAt: utcDate("revoked_at"),
    // Cron workers claim cleanup atomically. Failed provider calls retain only
    // retry scheduling metadata; provider error text is never persisted.
    cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
    cleanupNextAttemptAt: utcDate("cleanup_next_attempt_at"),
    cleanupClaimedAt: utcDate("cleanup_claimed_at"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("credential_lease_member_active_idx").on(
      table.organizationId,
      table.userId,
      table.expiresAt,
    ),
    index("credential_lease_connection_active_idx").on(
      table.connectionId,
      table.expiresAt,
    ),
    index("credential_lease_expiry_idx").on(table.expiresAt),
    uniqueIndex("credential_lease_active_slot_idx")
      .on(
        table.organizationId,
        table.connectionId,
        table.userId,
        table.activeSlot,
      )
      .where(sql`"revoked_at" IS NULL`),
    check(
      "credential_lease_active_slot_range",
      sql`${table.activeSlot} IS NULL OR ${table.activeSlot} BETWEEN 1 AND 5`,
    ),
    check(
      "credential_lease_live_slot_required",
      sql`${table.revokedAt} IS NOT NULL OR ${table.activeSlot} IS NOT NULL`,
    ),
    check(
      "credential_lease_provider_audit_id_length",
      sql`${table.providerAuditId} IS NULL OR length(${table.providerAuditId}) BETWEEN 1 AND 512`,
    ),
    index("credential_lease_cleanup_ready_idx")
      .on(table.cleanupAttempts, table.cleanupNextAttemptAt, table.expiresAt)
      .where(sql`"revoked_at" IS NULL`),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [
        workspaceConnection.organizationId,
        workspaceConnection.id,
      ],
      name: "credential_lease_org_connection_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.integrationId],
      foreignColumns: [
        workspaceProviderIntegration.organizationId,
        workspaceProviderIntegration.id,
      ],
      name: "credential_lease_org_integration_fk",
    }).onDelete("cascade"),
  ],
);

// Project Knowledge is shared metadata, not a source-code mirror. GitHub App
// installation tokens, Local Folder paths, source bodies, and provider credentials
// have no representable column in these tables.
