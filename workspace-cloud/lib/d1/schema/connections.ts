import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { matches } from "./patterns";
import { user, organization, member } from "./auth";
import { workspaceProviderIntegration } from "./integrations";
import { workspaceProviderResource } from "./discovery";

export const workspaceConnection = sqliteTable(
  "workspace_connection",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    engine: text("engine").notNull(),
    provider: text("provider").notNull().default("auto"),
    driverId: text("driver_id"),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    databaseName: text("database_name").notNull(),
    sslmode: text("sslmode").notNull(),
    readonlyDefault: integer("readonly_default", { mode: "boolean" }).notNull().default(true),
    allowWrites: integer("allow_writes", { mode: "boolean" }).notNull().default(false),
    credentialMode: text("credential_mode").notNull().default("member_local"),
    providerIntegrationId: text("provider_integration_id").references(
      () => workspaceProviderIntegration.id,
      { onDelete: "set null" },
    ),
    providerResource: text("provider_resource", { mode: "json" }),
    providerResourceId: text("provider_resource_id"),
    environment: text("environment"),
    schemaGroup: text("schema_group"),
    // Content optimistic-concurrency is separate from the revocation/lease epoch.
    contentRevision: integer("content_revision").notNull().default(1),
    revision: integer("revision").notNull().default(1),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
    deletedAt: utcDate("deleted_at"),
    revocationPendingAt: utcDate("revocation_pending_at"),
    revocationClaimedAt: utcDate("revocation_claimed_at"),
    revocationClaimId: text("revocation_claim_id"),
  },
  (table) => [
    index("workspace_connection_org_updated_idx").on(
      table.organizationId,
      table.updatedAt,
    ),
    unique("workspace_connection_org_id_idx").on(
      table.organizationId,
      table.id,
    ),
    foreignKey({
      columns: [table.organizationId, table.providerIntegrationId],
      foreignColumns: [
        workspaceProviderIntegration.organizationId,
        workspaceProviderIntegration.id,
      ],
      name: "workspace_connection_org_provider_integration_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.providerResourceId],
      foreignColumns: [workspaceProviderResource.organizationId, workspaceProviderResource.id],
      name: "workspace_connection_org_provider_resource_fk",
    }),
    uniqueIndex("workspace_connection_org_provider_resource_idx")
      .on(table.organizationId, table.providerResourceId)
      .where(sql`"provider_resource_id" IS NOT NULL AND "deleted_at" IS NULL`),
    check(
      "workspace_connection_revocation_claim_consistent",
      sql`(${table.revocationClaimedAt} IS NULL AND ${table.revocationClaimId} IS NULL)
        OR (${table.revocationClaimedAt} IS NOT NULL
          AND ${table.revocationClaimId} IS NOT NULL
          AND ${table.revocationPendingAt} IS NOT NULL)`,
    ),
    check("workspace_connection_content_revision", sql`${table.contentRevision} >= 1 AND ${table.contentRevision} <= 9007199254740991`),
    check("workspace_connection_revision", sql`${table.revision} >= 1 AND ${table.revision} <= 9007199254740991`),
    // Member-local templates are secretless and read-only. Managed integrations
    // may carry an administrator write policy, but credentials and provider
    // capability remain outside this row and are rechecked at lease issuance.
    check(
      "workspace_connection_member_local_read_only",
      sql`(${table.credentialMode} = 'member_local' AND ${table.readonlyDefault} = TRUE AND ${table.allowWrites} = FALSE)
        OR ${table.credentialMode} = 'managed'`,
    ),
  ],
);

// Target-database access is an explicit resource grant, never an implication of a
// workspace role. Composite foreign keys keep both the member and template in the
// same tenant even when an otherwise valid UUID is supplied by another workspace.
export const workspaceConnectionGrant = sqliteTable(
  "workspace_connection_grant",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull(),
    connectionId: text("connection_id").notNull(),
    memberId: text("member_id").notNull(),
    capability: text("capability").notNull().default("view"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("workspace_connection_grant_org_connection_member_idx").on(
      table.organizationId,
      table.connectionId,
      table.memberId,
    ),
    index("workspace_connection_grant_org_member_idx").on(table.organizationId, table.memberId),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [workspaceConnection.organizationId, workspaceConnection.id],
      name: "workspace_connection_grant_org_connection_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.memberId],
      foreignColumns: [member.organizationId, member.id],
      name: "workspace_connection_grant_org_member_fk",
    }).onDelete("cascade"),
    check(
      "workspace_connection_grant_capability",
      sql`${table.capability} IN ('view', 'read', 'use', 'manage')`,
    ),
  ],
);

// Import idempotency is scoped to the tenant and binds the opaque receipt's
// canonical resource plus the sanitized request representation. The final import
// command writes this row only after it has created the projection, grant, immutable
// version, and audit event.
export const workspaceProviderImportRequest = sqliteTable(
  "workspace_provider_import_request",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    productionApproved: integer("production_approved", { mode: "boolean" }).notNull().default(false),
    resourceId: text("resource_id").notNull(),
    connectionId: text("connection_id").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("provider_import_org_key_idx").on(table.organizationId, table.idempotencyKey),
    foreignKey({
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [workspaceProviderResource.organizationId, workspaceProviderResource.id],
      name: "provider_import_org_resource_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [workspaceConnection.organizationId, workspaceConnection.id],
      name: "provider_import_org_connection_fk",
    }).onDelete("restrict"),
    check("provider_import_request_hash", sql`${matches(sql`${table.requestHash}`, "^[0-9a-f]{64}$")}`),
  ],
);

// Resource versions are immutable tenant-scoped facts. The mutable connection row
// remains the current projection; offline candidates are stored on a conflict branch
// instead of replacing that projection.
