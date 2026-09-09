import { sql } from "drizzle-orm";
import { sqliteTable, text, check, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, integerBigInt, uuidDefault } from "./values";
import { matches } from "./patterns";
import { user, organization } from "./auth";

export const workspaceProviderIntegration = sqliteTable(
  "workspace_provider_integration",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("active"),
    externalAccountId: text("external_account_id").notNull(),
    displayName: text("display_name").notNull(),
    encryptedCredential: text("encrypted_credential").notNull(),
    credentialExpiresAt: utcDate("credential_expires_at"),
    grantedScope: text("granted_scope"),
    // A redacted, verified GCP project/instance pin for desktop-local WIF.
    // This is deliberately separate from the encrypted provider envelope so
    // read-only local-authority inventory never needs to decrypt a credential.
    localVerificationTarget: text("local_verification_target", { mode: "json" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    // Stable bigint CAS token. PostgreSQL timestamps cannot be round-tripped
    // through JavaScript Date without losing microseconds.
    generation: integerBigInt("generation").notNull().default(sql`1`),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
    revokedAt: utcDate("revoked_at"),
    revocationPendingAt: utcDate("revocation_pending_at"),
    revocationClaimedAt: utcDate("revocation_claimed_at"),
    revocationClaimId: text("revocation_claim_id"),
    refreshClaimedAt: utcDate("refresh_claimed_at"),
    refreshClaimId: text("refresh_claim_id"),
    refreshGeneration: integerBigInt("refresh_generation"),
    // PlanetScale refresh has no provider idempotency/fencing primitive.  A
    // durable remote_started fence therefore intentionally makes the integration
    // non-issuable until an explicit OAuth reconnect supersedes it.
    refreshPhase: text("refresh_phase").notNull().default("idle"),
    refreshRemoteStartedAt: utcDate("refresh_remote_started_at"),
    // Disconnect owns a separate state machine because revocation of a provider
    // grant is externally irreversible even when credential cleanup is retried.
    disconnectPhase: text("disconnect_phase").notNull().default("idle"),
    disconnectGeneration: integerBigInt("disconnect_generation"),
  },
  (table) => [
    uniqueIndex("provider_integration_org_provider_account_idx").on(
      table.organizationId,
      table.provider,
      table.externalAccountId,
    ),
    unique("provider_integration_org_id_idx").on(
      table.organizationId,
      table.id,
    ),
    unique("provider_integration_org_id_provider_idx").on(
      table.organizationId,
      table.id,
      table.provider,
    ),
    index("provider_integration_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
    check(
      "provider_integration_revocation_claim_consistent",
      sql`(${table.revocationClaimedAt} IS NULL AND ${table.revocationClaimId} IS NULL)
        OR (${table.revocationClaimedAt} IS NOT NULL
          AND ${table.revocationClaimId} IS NOT NULL
          AND ${table.revocationPendingAt} IS NOT NULL)`,
    ),
    check("provider_integration_generation_positive", sql`${table.generation} >= 1`),
    // Never permit a credential envelope (or arbitrary provider metadata) to
    // masquerade as the desktop-local GCP verification projection. Active,
    // non-revoked GCP rows must have an exact verified target. Inactive rows
    // may omit it because they cannot issue credentials.
    check(
      "provider_integration_local_verification_target_shape",
      sql`(
        ${table.provider} = 'gcpCloudSql' AND (
          (
            ${table.status} = 'active' AND ${table.revokedAt} IS NULL
            AND ${table.localVerificationTarget} IS NOT NULL
            AND json_type(${table.localVerificationTarget}) = 'object'
            AND json_type(${table.localVerificationTarget}, '$.kind') IS NOT NULL
            AND json_type(${table.localVerificationTarget}, '$.projectId') IS NOT NULL
            AND json_type(${table.localVerificationTarget}, '$.instanceId') IS NOT NULL
            AND json_remove(${table.localVerificationTarget}, '$.kind', '$.projectId', '$.instanceId') = '{}'
            AND ${table.localVerificationTarget}->>'kind' = 'gcpCloudSql'
            AND ${matches(sql`${table.localVerificationTarget}->>'projectId'`, "^[a-z][a-z0-9-]{4,28}[a-z0-9]$")}
            AND ${matches(sql`${table.localVerificationTarget}->>'instanceId'`, "^[A-Za-z0-9][A-Za-z0-9_-]{0,97}$")}
          )
          OR (
            (${table.status} <> 'active' OR ${table.revokedAt} IS NOT NULL)
            AND (
              ${table.localVerificationTarget} IS NULL OR (
                json_type(${table.localVerificationTarget}) = 'object'
                AND json_type(${table.localVerificationTarget}, '$.kind') IS NOT NULL
            AND json_type(${table.localVerificationTarget}, '$.projectId') IS NOT NULL
            AND json_type(${table.localVerificationTarget}, '$.instanceId') IS NOT NULL
                AND json_remove(${table.localVerificationTarget}, '$.kind', '$.projectId', '$.instanceId') = '{}'
                AND ${table.localVerificationTarget}->>'kind' = 'gcpCloudSql'
                AND ${matches(sql`${table.localVerificationTarget}->>'projectId'`, "^[a-z][a-z0-9-]{4,28}[a-z0-9]$")}
                AND ${matches(sql`${table.localVerificationTarget}->>'instanceId'`, "^[A-Za-z0-9][A-Za-z0-9_-]{0,97}$")}
              )
            )
          )
        )
      ) OR (${table.provider} <> 'gcpCloudSql' AND ${table.localVerificationTarget} IS NULL)`,
    ),
    check(
      "provider_integration_refresh_claim_consistent",
      sql`(${table.refreshPhase} = 'idle'
            AND ${table.refreshClaimedAt} IS NULL AND ${table.refreshClaimId} IS NULL
            AND ${table.refreshGeneration} IS NULL AND ${table.refreshRemoteStartedAt} IS NULL)
        OR (${table.refreshPhase} = 'claimed'
            AND ${table.refreshClaimedAt} IS NOT NULL AND ${table.refreshClaimId} IS NOT NULL
            AND ${table.refreshGeneration} IS NOT NULL AND ${table.refreshRemoteStartedAt} IS NULL)
        OR (${table.refreshPhase} = 'remote_started'
            AND ${table.refreshClaimedAt} IS NOT NULL AND ${table.refreshClaimId} IS NOT NULL
            AND ${table.refreshGeneration} IS NOT NULL AND ${table.refreshRemoteStartedAt} IS NOT NULL)
        OR (${table.refreshPhase} = 'reconnect_required'
            AND ${table.refreshClaimedAt} IS NOT NULL AND ${table.refreshClaimId} IS NOT NULL
            AND ${table.refreshGeneration} IS NOT NULL AND ${table.refreshRemoteStartedAt} IS NOT NULL)`,
    ),
    check(
      "provider_integration_disconnect_phase",
      sql`${table.disconnectPhase} IN ('idle', 'claimed', 'lease_cleanup_pending', 'leases_revoked',
          'provider_revoke_started', 'provider_revoke_ambiguous',
          'provider_revoked', 'finalized')`,
    ),
    check(
      "provider_integration_disconnect_generation_consistent",
      sql`(${table.disconnectPhase} = 'idle' AND ${table.disconnectGeneration} IS NULL)
        OR (${table.disconnectPhase} <> 'idle' AND ${table.disconnectGeneration} IS NOT NULL)`,
    ),
  ],
);

// Provider mutations are durable workspace operations, not request-local API
// calls. The plan is redacted and immutable; remote_started is an external-I/O
// fence so an ambiguous response can only enter reconciliation, never blind
// retry. The initial closed kind set expands only with a real adapter.
