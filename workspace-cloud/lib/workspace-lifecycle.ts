// Owner-only workspace deletion lifecycle and system retention cleanup. Scheduling
// is reversible during the retention window; final purge is database-atomic and
// leaves only a payload-free deletion receipt.
import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "./db";
import { atomicD1 } from "./d1/atomic";
import { workspaceMemberAuthority } from "./d1/member-authority";
import { utcNow, uuidDefault } from "./d1/schema/values";
import { purgeDueWorkspace, workspaceDeletionUnblocked } from "./workspace-retention-purge";
import { workspaceDeletionReceipt } from "./schema";

export const WORKSPACE_DELETION_RETENTION_DAYS = 7;
export const WORKSPACE_BACKUP_RETENTION_DAYS = 7;

export type WorkspaceLifecycleAuthority = {
  sessionId: string;
  userId: string;
  membershipId: string;
};

type LifecycleStatusRow = {
  workspaceName: unknown;
  revision: unknown;
  lifecycleState: unknown;
  deletionReceiptId: unknown;
  deletionRequestedAt: unknown;
  purgeAfter: unknown;
  activeProviderIntegrations: unknown;
  activeCredentialLeases: unknown;
  unresolvedProviderOperations: unknown;
  runningKeyRotations: unknown;
  memberRevocations: unknown;
  backupCount: unknown;
  tombstonedBackupCount: unknown;
};

function integer(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function isoDate(value: unknown) {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export async function workspaceLifecycleStatus(organizationId: string) {
  const result = await db.execute<LifecycleStatusRow>(sql`
    SELECT organization."name" AS "workspaceName",
      profile."revision" AS "revision",
      profile."lifecycle_state" AS "lifecycleState",
      profile."deletion_receipt_id" AS "deletionReceiptId",
      profile."deletion_requested_at" AS "deletionRequestedAt",
      profile."purge_after" AS "purgeAfter",
      (SELECT count(*)
       FROM "workspace_provider_integration" integration
       WHERE integration."organization_id" = profile."organization_id"
         AND (integration."revoked_at" IS NULL OR integration."status" <> 'revoked'))
        AS "activeProviderIntegrations",
      (SELECT count(*)
       FROM "workspace_credential_lease" lease
       WHERE lease."organization_id" = profile."organization_id"
         AND lease."revoked_at" IS NULL) AS "activeCredentialLeases",
      (SELECT count(*)
       FROM "workspace_provider_operation" operation
       WHERE operation."organization_id" = profile."organization_id"
         AND operation."state" NOT IN ('succeeded', 'failed', 'cancelled'))
        AS "unresolvedProviderOperations",
      (SELECT count(*)
       FROM "workspace_data_key_rotation" rotation
       WHERE rotation."organization_id" = profile."organization_id"
         AND rotation."status" = 'running') AS "runningKeyRotations",
      (SELECT count(*)
       FROM "member" pending_member
       WHERE pending_member."organization_id" = profile."organization_id"
         AND (pending_member."revocation_pending_at" IS NOT NULL
           OR pending_member."revocation_claim_id" IS NOT NULL)) AS "memberRevocations",
      (SELECT count(*)
       FROM "workspace_metadata_backup" backup
       WHERE backup."organization_id" = profile."organization_id"
         AND backup."deleted_at" IS NULL) AS "backupCount",
      (SELECT count(*)
       FROM "workspace_metadata_backup" backup
       WHERE backup."organization_id" = profile."organization_id"
         AND backup."deleted_at" IS NOT NULL) AS "tombstonedBackupCount"
    FROM "workspace_profile" profile
    JOIN "organization" organization
      ON organization."id" = profile."organization_id"
    WHERE profile."organization_id" = ${organizationId}
  `);
  const row = result.rows[0];
  if (!row || typeof row.workspaceName !== "string") return null;
  const blockers = {
    providerIntegrations: integer(row.activeProviderIntegrations),
    credentialLeases: integer(row.activeCredentialLeases),
    providerOperations: integer(row.unresolvedProviderOperations),
    keyRotations: integer(row.runningKeyRotations),
    memberRevocations: integer(row.memberRevocations),
  };
  return {
    workspaceName: row.workspaceName,
    revision: integer(row.revision),
    lifecycleState: row.lifecycleState === "deletion_pending"
      ? "deletion_pending" as const
      : "active" as const,
    deletionReceiptId: typeof row.deletionReceiptId === "string"
      ? row.deletionReceiptId
      : null,
    deletionRequestedAt: isoDate(row.deletionRequestedAt),
    purgeAfter: isoDate(row.purgeAfter),
    retentionDays: WORKSPACE_DELETION_RETENTION_DAYS,
    backupRetentionDays: WORKSPACE_BACKUP_RETENTION_DAYS,
    backupCount: integer(row.backupCount),
    tombstonedBackupCount: integer(row.tombstonedBackupCount),
    blockers,
    canScheduleDeletion: row.lifecycleState === "active"
      && Object.values(blockers).every((count) => count === 0),
  };
}

export async function scheduleWorkspaceDeletion(input: {
  organizationId: string;
  authority: WorkspaceLifecycleAuthority;
  requestId: string;
  confirmation: string;
}) {
  const existing = await db.query.workspaceDeletionReceipt.findFirst({
    where: and(
      eq(workspaceDeletionReceipt.id, input.requestId),
      eq(workspaceDeletionReceipt.organizationId, input.organizationId),
    ),
  });
  if (existing) return existing.status === "pending" ? "replayed" as const : null;

  const requestedAtDate = new Date();
  const requestedAt = requestedAtDate.toISOString();
  const purgeAfter = new Date(
    requestedAtDate.valueOf() + WORKSPACE_DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM organization
      WHERE id = ${input.organizationId} AND name = ${input.confirmation}
        AND EXISTS (${workspaceMemberAuthority(input.organizationId, { ...input.authority, role: "owner" }, ["owner"])})
        AND NOT EXISTS (SELECT 1 FROM workspace_deletion_receipt WHERE id = ${input.requestId})
        AND NOT EXISTS (SELECT 1 FROM member WHERE organization_id = ${input.organizationId}
          AND (revocation_pending_at IS NOT NULL OR revocation_claim_id IS NOT NULL))
        AND ${workspaceDeletionUnblocked(input.organizationId)}`,
    statements: (scope) => [
      sql`INSERT INTO workspace_deletion_receipt (id, organization_id, requested_by_user_id, requested_at, purge_after)
        SELECT ${input.requestId}, ${input.organizationId}, ${input.authority.userId}, ${requestedAt}, ${purgeAfter} FROM (${scope})`,
      sql`UPDATE workspace_profile SET lifecycle_state = 'deletion_pending', deletion_receipt_id = ${input.requestId},
          deletion_requested_at = ${requestedAt}, purge_after = ${purgeAfter}, revision = revision + 1, updated_at = ${utcNow}
        WHERE organization_id = ${input.organizationId} AND EXISTS (${scope})`,
      sql`UPDATE member SET revocation_pending_at = ${requestedAt}
        WHERE organization_id = ${input.organizationId} AND EXISTS (${scope})`,
      sql`UPDATE session SET active_organization_id = NULL, updated_at = ${utcNow}
        WHERE active_organization_id = ${input.organizationId} AND EXISTS (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'workspace.deletion.schedule', 'workspace', ${input.organizationId},
          json_object('purgeAfter', ${purgeAfter}), ${input.requestId} FROM (${scope})`,
    ],
  });
  return result.matched ? "scheduled" as const : null;
}

export async function cancelWorkspaceDeletion(input: {
  organizationId: string;
  authority: WorkspaceLifecycleAuthority;
  requestId: string;
}) {
  const existing = await db.query.workspaceDeletionReceipt.findFirst({
    where: and(
      eq(workspaceDeletionReceipt.id, input.requestId),
      eq(workspaceDeletionReceipt.organizationId, input.organizationId),
    ),
  });
  if (existing?.status === "cancelled") return "replayed" as const;
  if (existing?.status !== "pending") return null;
  const result = await atomicD1({
    scope: sql`SELECT json_object('requestedAt', profile.deletion_requested_at) AS payload
      FROM workspace_profile profile JOIN workspace_deletion_receipt receipt
        ON receipt.id = profile.deletion_receipt_id AND receipt.organization_id = profile.organization_id
      JOIN member ON member.organization_id = profile.organization_id AND member.id = ${input.authority.membershipId}
      JOIN session ON session.user_id = member.user_id AND session.id = ${input.authority.sessionId}
      WHERE profile.organization_id = ${input.organizationId} AND profile.lifecycle_state = 'deletion_pending'
        AND profile.deletion_receipt_id = ${input.requestId} AND profile.purge_after > ${utcNow}
        AND receipt.status = 'pending' AND receipt.purge_after > ${utcNow}
        AND session.user_id = ${input.authority.userId} AND session.expires_at > ${utcNow}
        AND member.role = 'owner' AND member.revocation_claim_id IS NULL
        AND member.revocation_pending_at = profile.deletion_requested_at`,
    statements: (scope) => [
      sql`UPDATE workspace_deletion_receipt SET status = 'cancelled', cancelled_at = ${utcNow}
        WHERE id = ${input.requestId} AND EXISTS (${scope})`,
      sql`UPDATE workspace_profile SET lifecycle_state = 'active', deletion_receipt_id = NULL, deletion_requested_at = NULL,
          purge_after = NULL, revision = revision + 1, updated_at = ${utcNow}
        WHERE organization_id = ${input.organizationId} AND EXISTS (${scope})`,
      sql`UPDATE member SET revocation_pending_at = NULL WHERE organization_id = ${input.organizationId}
        AND revocation_claim_id IS NULL AND revocation_pending_at = (SELECT json_extract(payload, '$.requestedAt') FROM (${scope}))`,
      sql`UPDATE session SET active_organization_id = ${input.organizationId}, updated_at = ${utcNow}
        WHERE id = ${input.authority.sessionId} AND user_id = ${input.authority.userId} AND EXISTS (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'workspace.deletion.cancel', 'workspace', ${input.organizationId},
          '{}', ${uuidDefault} FROM (${scope})`,
    ],
  });
  return result.matched ? "cancelled" as const : null;
}

export async function cleanupWorkspaceRetention(input: {
  backupLimit?: number;
  workspaceLimit?: number;
} = {}) {
  const backupLimit = Math.max(1, Math.min(input.backupLimit ?? 25, 100));
  const workspaceLimit = Math.max(1, Math.min(input.workspaceLimit ?? 1, 5));
  const backupResult = await atomicD1({
    scope: sql`SELECT json_object('backups', json_group_array(json_object('id', id, 'org', organization_id))) AS payload
      FROM (SELECT id, organization_id FROM workspace_metadata_backup WHERE deleted_at IS NOT NULL AND purge_after <= ${utcNow}
        ORDER BY purge_after, id LIMIT ${backupLimit})`,
    statements: (scope) => [
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT json_extract(backup.value, '$.org'), NULL, 'workspace.backup.purge', 'workspace_backup', json_extract(backup.value, '$.id'), '{}', ${uuidDefault}
        FROM (${scope}) scope, json_each(scope.payload, '$.backups') backup`,
      sql`DELETE FROM workspace_metadata_backup WHERE id IN
        (SELECT json_extract(backup.value, '$.id') FROM (${scope}) scope, json_each(scope.payload, '$.backups') backup) RETURNING id`,
    ],
  });
  const due = await db.execute<{ organizationId: string; receiptId: string }>(sql`
    SELECT profile."organization_id" AS "organizationId",
      profile."deletion_receipt_id" AS "receiptId"
    FROM "workspace_profile" profile
    JOIN "workspace_deletion_receipt" receipt
      ON receipt."id" = profile."deletion_receipt_id"
     AND receipt."organization_id" = profile."organization_id"
    WHERE profile."lifecycle_state" = 'deletion_pending'
      AND profile."purge_after" <= ${utcNow}
      AND receipt."status" = 'pending'
      AND receipt."purge_after" <= ${utcNow}
    ORDER BY profile."purge_after", profile."organization_id"
    LIMIT ${workspaceLimit}
  `);
  let workspacesPurged = 0;
  for (const row of due.rows) {
    if (await purgeDueWorkspace(row.organizationId, row.receiptId)) workspacesPurged += 1;
  }
  return {
    backupsPurged: backupResult.rows[1].length,
    workspacesPurged,
    workspacesDeferred: due.rows.length - workspacesPurged,
  };
}
