import { sql } from "drizzle-orm";
import { sqliteTable, text, check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, integerBigInt, uuidDefault } from "./values";
import { matches } from "./patterns";
import { user, organization, session, member } from "./auth";
import { workspaceProviderIntegration } from "./integrations";

export const workspaceProviderResource = sqliteTable(
  "workspace_provider_resource",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull(),
    resourceFingerprint: text("resource_fingerprint").notNull(),
    resource: text("resource", { mode: "json" }).notNull(),
    redactedMetadata: text("redacted_metadata", { mode: "json" }).notNull(),
    capabilityManifest: text("capability_manifest", { mode: "json" }).notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
  },
  (table) => [
    // PostgreSQL requires this exact non-partial unique target for every tenant
    // composite FK which names a provider resource.
    unique("provider_resource_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("provider_resource_org_provider_fingerprint_idx").on(
      table.organizationId, table.provider, table.resourceFingerprint,
    ),
  ],
);

// Discovery authority is an opaque UUID, not a provider identifier. It is scoped to
// the exact live Better Auth session and member which observed the resource, and is
// consumed by the import CTE in the same statement as the resulting workspace state.
export const workspaceProviderDiscoveryReceipt = sqliteTable(
  "workspace_provider_discovery_receipt",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    resourceId: text("resource_id").notNull(),
    integrationId: text("integration_id").notNull(),
    // Receipt consumption must observe the exact integration credential/policy
    // generation that produced the discovery result. This is deliberately not
    // a timestamp because Date cannot preserve PostgreSQL microseconds.
    integrationGeneration: integerBigInt("integration_generation").notNull(),
    memberId: text("member_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull().references(() => session.id, { onDelete: "cascade" }),
    expiresAt: utcDate("expires_at").notNull(),
    consumedAt: utcDate("consumed_at"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("provider_discovery_receipt_org_expiry_idx").on(table.organizationId, table.expiresAt),
    foreignKey({
      columns: [table.organizationId, table.resourceId],
      foreignColumns: [workspaceProviderResource.organizationId, workspaceProviderResource.id],
      name: "provider_discovery_receipt_org_resource_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.integrationId],
      foreignColumns: [workspaceProviderIntegration.organizationId, workspaceProviderIntegration.id],
      name: "provider_discovery_receipt_org_integration_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.memberId],
      foreignColumns: [member.organizationId, member.id],
      name: "provider_discovery_receipt_org_member_fk",
    }).onDelete("cascade"),
  ],
);

// GCP service-account ownership is a global, hash-only claim. A principal can
// belong to exactly one integration so concurrent setup cannot reuse it elsewhere.
export const workspaceProviderPrincipalClaim = sqliteTable(
  "workspace_provider_principal_claim",
  {
    principalFingerprint: text("principal_fingerprint").primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(
      () => organization.id,
      { onDelete: "cascade" },
    ),
    integrationId: text("integration_id").notNull(),
    targetFingerprint: text("target_fingerprint").notNull(),
    accessKind: text("access_kind").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("provider_principal_claim_integration_access_idx").on(
      table.integrationId,
      table.accessKind,
    ),
    uniqueIndex("provider_principal_claim_org_target_idx")
      .on(table.organizationId, table.targetFingerprint)
      .where(sql`"access_kind" = 'read'`),
    index("provider_principal_claim_target_idx").on(table.targetFingerprint),
    foreignKey({
      columns: [table.organizationId, table.integrationId],
      foreignColumns: [
        workspaceProviderIntegration.organizationId,
        workspaceProviderIntegration.id,
      ],
      name: "provider_principal_claim_org_integration_fk",
    }).onDelete("cascade"),
    check(
      "provider_principal_claim_principal_hash",
      sql`${matches(sql`${table.principalFingerprint}`, "^[0-9a-f]{64}$")}`,
    ),
    check(
      "provider_principal_claim_target_hash",
      sql`${matches(sql`${table.targetFingerprint}`, "^[0-9a-f]{64}$")}`,
    ),
    check(
      "provider_principal_claim_access_kind",
      sql`${table.accessKind} IN ('read', 'write', 'schema')`,
    ),
  ],
);

// OAuth state is single-use server data rather than a browser-readable cookie. Only
// a SHA-256 digest is retained, limiting the value of a database disclosure.
export const providerOauthState = sqliteTable(
  "provider_oauth_state",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull().references(() => user.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull(),
    stateHash: text("state_hash").notNull(),
    expiresAt: utcDate("expires_at").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("provider_oauth_state_hash_idx").on(table.stateHash),
    index("provider_oauth_state_expiry_idx").on(table.expiresAt),
  ],
);

// A provider setup token exists only long enough to discover and bootstrap one
// cloud target. The OAuth access token is envelope-encrypted and never returned.
export const providerSetupSession = sqliteTable(
  "provider_setup_session",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull().references(() => user.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull(),
    encryptedCredential: text("encrypted_credential").notNull(),
    accountLabel: text("account_label").notNull(),
    expiresAt: utcDate("expires_at").notNull(),
    consumedAt: utcDate("consumed_at"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("provider_setup_session_scope_idx").on(
      table.organizationId,
      table.userId,
      table.provider,
    ),
    index("provider_setup_session_expiry_idx").on(table.expiresAt),
    check("provider_setup_session_provider", sql`${table.provider} = 'gcpCloudSql'`),
  ],
);

// Shared connection rows are deliberately templates, not credentials. There is no
// username, password, token, certificate, connection URL, or local secret reference
// column in this table, so those values cannot be uploaded accidentally by the API.
