import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, integerBigInt, uuidDefault } from "./values";
import { matches } from "./patterns";
import { organization } from "./auth";
import { workspaceProviderIntegration } from "./integrations";

export const workspaceProviderOperation = sqliteTable(
  "workspace_provider_operation",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    integrationId: text("integration_id").notNull(),
    provider: text("provider").notNull(),
    integrationGeneration: integerBigInt("integration_generation").notNull(),
    kind: text("kind").notNull(),
    state: text("state").notNull().default("awaiting_approval"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    planHash: text("plan_hash").notNull(),
    planVersion: integer("plan_version").notNull().default(1),
    planExpiresAt: utcDate("plan_expires_at").notNull(),
    risk: text("risk").notNull(),
    approvalPolicy: text("approval_policy").notNull(),
    requestedByMemberId: text("requested_by_member_id").notNull(),
    requestedByUserId: text("requested_by_user_id").notNull(),
    requestedBySessionId: text("requested_by_session_id").notNull(),
    requestedByRole: text("requested_by_role").notNull(),
    resourceScope: text("resource_scope").notNull(),
    sourceResourceId: text("source_resource_id").notNull(),
    targetName: text("target_name").notNull(),
    ownershipMarker: text("ownership_marker").notNull(),
    redactedPlan: text("redacted_plan", { mode: "json" }).notNull(),
    providerOperationId: text("provider_operation_id"),
    providerResourceId: text("provider_resource_id"),
    redactedResult: text("redacted_result", { mode: "json" }),
    failureCode: text("failure_code"),
    claimId: text("claim_id"),
    claimedAt: utcDate("claimed_at"),
    remoteStartedAt: utcDate("remote_started_at"),
    reconcileAfter: utcDate("reconcile_after"),
    completedAt: utcDate("completed_at"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
  },
  (table) => [
    unique("provider_operation_org_id_idx").on(table.organizationId, table.id),
    uniqueIndex("provider_operation_org_idempotency_idx").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("provider_operation_org_state_updated_idx").on(
      table.organizationId,
      table.state,
      table.updatedAt,
    ),
    index("provider_operation_integration_state_idx").on(
      table.integrationId,
      table.state,
    ),
    foreignKey({
      columns: [table.organizationId, table.integrationId, table.provider],
      foreignColumns: [
        workspaceProviderIntegration.organizationId,
        workspaceProviderIntegration.id,
        workspaceProviderIntegration.provider,
      ],
      name: "provider_operation_org_integration_fk",
    }).onDelete("cascade"),
    check("provider_operation_provider", sql`${table.provider} = 'neon'`),
    check(
      "provider_operation_kind",
      sql`${table.kind} IN (
        'neon.branch.create', 'neon.branch.delete', 'neon.branch.switch'
      )`,
    ),
    check(
      "provider_operation_state",
      sql`${table.state} IN (
        'awaiting_approval', 'approved', 'claimed', 'remote_started',
        'reconciling', 'succeeded', 'failed', 'needs_repair', 'cancelled'
      )`,
    ),
    check(
      "provider_operation_generation",
      sql`${table.integrationGeneration} >= 1`,
    ),
    check(
      "provider_operation_hashes",
      sql`${matches(sql`${table.requestHash}`, "^[0-9a-f]{64}$")}
        AND ${matches(sql`${table.planHash}`, "^[0-9a-f]{64}$")}`,
    ),
    check("provider_operation_plan_version", sql`${table.planVersion} = 1`),
    check(
      "provider_operation_risk",
      sql`${table.risk} IN ('standard', 'production_data')`,
    ),
    check(
      "provider_operation_approval_policy",
      sql`${table.approvalPolicy} IN ('single_admin', 'separate_admin')
        AND (${table.risk} <> 'production_data'
          OR ${table.approvalPolicy} = 'separate_admin')`,
    ),
    check(
      "provider_operation_requester_role",
      sql`${table.requestedByRole} IN ('admin', 'owner')`,
    ),
    check(
      "provider_operation_scope_length",
      sql`length(${table.resourceScope}) BETWEEN 1 AND 512
        AND length(${table.sourceResourceId}) BETWEEN 1 AND 512
        AND length(${table.targetName}) BETWEEN 1 AND 256
        AND length(${table.ownershipMarker}) BETWEEN 1 AND 256
        AND length(${table.requestedByMemberId}) BETWEEN 1 AND 512
        AND length(${table.requestedByUserId}) BETWEEN 1 AND 512
        AND length(${table.requestedBySessionId}) BETWEEN 1 AND 512`,
    ),
    check(
      "provider_operation_neon_identifiers",
      sql`${matches(sql`${table.resourceScope}`, "^[a-z0-9][a-z0-9-]{0,59}$")}
        AND ${matches(sql`${table.sourceResourceId}`, "^[a-z0-9][a-z0-9-]{0,59}$")}
        AND ${matches(sql`${table.ownershipMarker}`, "^v1\\.[A-Za-z0-9_-]{43}$")}`,
    ),
    check(
      "provider_operation_provider_identifiers",
      sql`${table.providerOperationId} IS NULL
        OR ${matches(sql`${table.providerOperationId}`, "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")}`,
    ),
    check(
      "provider_operation_provider_resource",
      sql`${table.providerResourceId} IS NULL
        OR ${matches(sql`${table.providerResourceId}`, "^[a-z0-9][a-z0-9-]{0,59}$")}`,
    ),
    check(
      "provider_operation_failure_code",
      sql`${table.failureCode} IS NULL
        OR ${matches(sql`${table.failureCode}`, "^[A-Z][A-Z0-9_]{0,95}$")}`,
    ),
    check(
      "provider_operation_json_shapes",
      sql`json_type(${table.redactedPlan}) = 'object'
        AND (${table.redactedResult} IS NULL
          OR json_type(${table.redactedResult}) = 'object')`,
    ),
    check(
      "provider_operation_plan_expiry",
      sql`${table.planExpiresAt} > ${table.createdAt}
        AND ${table.planExpiresAt} <= strftime('%Y-%m-%dT%H:%M:%fZ', ${table.createdAt}, '+15 minutes')`,
    ),
    check(
      "provider_operation_claim_consistency",
      sql`(
          ${table.state} IN ('awaiting_approval', 'approved')
          AND ${table.claimId} IS NULL AND ${table.claimedAt} IS NULL
          AND ${table.remoteStartedAt} IS NULL AND ${table.completedAt} IS NULL
        ) OR (
          ${table.state} = 'claimed'
          AND ${table.claimId} IS NOT NULL AND ${table.claimedAt} IS NOT NULL
          AND ${table.remoteStartedAt} IS NULL AND ${table.completedAt} IS NULL
        ) OR (
          ${table.state} IN ('remote_started', 'reconciling')
          AND ${table.claimId} IS NOT NULL AND ${table.claimedAt} IS NOT NULL
          AND ${table.remoteStartedAt} IS NOT NULL AND ${table.completedAt} IS NULL
        ) OR (
          ${table.state} IN ('succeeded', 'failed', 'needs_repair', 'cancelled')
          AND ${table.completedAt} IS NOT NULL
        )`,
    ),
    check(
      "provider_operation_claim_pair",
      sql`(${table.claimId} IS NULL AND ${table.claimedAt} IS NULL)
        OR (${table.claimId} IS NOT NULL AND ${table.claimedAt} IS NOT NULL)`,
    ),
    check(
      "provider_operation_failure_state",
      sql`${table.failureCode} IS NULL
        OR ${table.state} IN ('failed', 'needs_repair')`,
    ),
    check(
      "provider_operation_success_resource",
      sql`${table.state} <> 'succeeded' OR ${table.providerResourceId} IS NOT NULL`,
    ),
  ],
);

// Approval identity remains after a member leaves, while every transition
// rechecks that the same member/session/role is still live. One operation has
// one terminal approval decision; separate_admin rejects requester self-approval.
export const workspaceProviderOperationApproval = sqliteTable(
  "workspace_provider_operation_approval",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    operationId: text("operation_id").notNull(),
    planHash: text("plan_hash").notNull(),
    decision: text("decision").notNull(),
    actorMemberId: text("actor_member_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorSessionId: text("actor_session_id").notNull(),
    actorRole: text("actor_role").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("provider_operation_approval_org_operation_idx").on(
      table.organizationId,
      table.operationId,
    ),
    foreignKey({
      columns: [table.organizationId, table.operationId],
      foreignColumns: [
        workspaceProviderOperation.organizationId,
        workspaceProviderOperation.id,
      ],
      name: "provider_operation_approval_org_operation_fk",
    }).onDelete("cascade"),
    check(
      "provider_operation_approval_hash",
      sql`${matches(sql`${table.planHash}`, "^[0-9a-f]{64}$")}`,
    ),
    check(
      "provider_operation_approval_decision",
      sql`${table.decision} IN ('approved', 'rejected')`,
    ),
    check(
      "provider_operation_approval_role",
      sql`${table.actorRole} IN ('admin', 'owner')`,
    ),
  ],
);

// A discovered provider resource is a durable tenant-scoped, non-secret canonical
// fact. Browser import authority is deliberately kept in the separate, single-use
// receipt table below; never put session/member lifetime into this resource.
