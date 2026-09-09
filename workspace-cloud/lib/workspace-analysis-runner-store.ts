// Possession-bound registration for member-owned, foreground-only Desktop runners.
import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { atomicD1 } from "./d1/atomic";
import { utcNow } from "./d1/schema/values";
import { workspaceMemberAuthority } from "./d1/member-authority";
import type { AnalysisRunnerRegistration } from "./workspace-analysis-runs";
import type { AnalysisRunAuthority } from "./workspace-analysis-run-store";
import {
  analysisRunnerCapabilityVersion,
  hashAnalysisRunnerCapability,
  issueAnalysisRunnerCapability,
} from "./workspace-analysis-runner-capability";

const allRoles = ["viewer", "analyst", "editor", "admin", "owner"] as const;

export async function registerAnalysisRunner(input: {
  organizationId: string;
  registration: AnalysisRunnerRegistration;
  runnerCapability: string | null;
  capabilityVersion: number | null;
  authority: AnalysisRunAuthority;
}) {
  if (input.runnerCapability && !/^[0-9a-f]{64}$/.test(input.runnerCapability)) {
    return { status: "invalid" } as const;
  }
  if (input.capabilityVersion !== analysisRunnerCapabilityVersion) {
    return { status: "unsupported" } as const;
  }
  const issuedCapability = issueAnalysisRunnerCapability();
  const issuedCapabilityHash = hashAnalysisRunnerCapability(issuedCapability);
  const providedCapabilityHash = input.runnerCapability
    ? hashAnalysisRunnerCapability(input.runnerCapability)
    : null;
  const runnerId = crypto.randomUUID();
  const result = await atomicD1({
    scope: sql`SELECT json_object('id', COALESCE(runner.id, ${runnerId}), 'status', CASE
        WHEN runner.id IS NULL THEN 'created'
        WHEN runner.member_id = actor.id AND runner.runner_capability_hash = ${providedCapabilityHash} THEN 'verified'
        WHEN runner.member_id = actor.id AND ${providedCapabilityHash} IS NULL THEN 'missing'
        ELSE 'invalid' END) AS payload FROM (${workspaceMemberAuthority(input.organizationId, input.authority, allRoles)}) actor
      LEFT JOIN workspace_analysis_runner runner ON runner.organization_id = ${input.organizationId}
        AND runner.device_id = ${input.registration.deviceId} AND runner.revoked_at IS NULL`,
    statements: (scope) => [
      sql`INSERT INTO workspace_analysis_runner (id, organization_id, member_id, device_id, display_name,
          runner_capability_hash, runner_capability_generation, last_seen_at, revoked_at)
        SELECT ${runnerId}, ${input.organizationId}, ${input.authority.membershipId}, ${input.registration.deviceId},
          ${input.registration.displayName}, ${issuedCapabilityHash}, 1, ${utcNow}, NULL
          FROM (${scope}) WHERE payload ->> 'status' = 'created'`,
      sql`UPDATE workspace_analysis_runner SET display_name = ${input.registration.displayName}, last_seen_at = ${utcNow}
        WHERE id = (SELECT payload ->> 'id' FROM (${scope}) WHERE payload ->> 'status' = 'verified')`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_runner.register', 'analysis_runner', runner.id,
          json_object('foregroundOnly', json('true'), 'capabilityGeneration', runner.runner_capability_generation,
            'created', json(CASE WHEN payload ->> 'status' = 'created' THEN 'true' ELSE 'false' END)),
          ${crypto.randomUUID()} FROM workspace_analysis_runner runner CROSS JOIN (${scope})
          WHERE runner.id = payload ->> 'id' AND payload ->> 'status' IN ('created', 'verified')`,
      sql`SELECT payload ->> 'status' AS status, runner.id, runner.device_id AS deviceId, runner.display_name AS displayName,
        runner.runner_capability_generation AS runnerCapabilityGeneration, runner.last_seen_at AS lastSeenAt
        FROM (${scope}) LEFT JOIN workspace_analysis_runner runner ON runner.id = payload ->> 'id'
          AND payload ->> 'status' IN ('created', 'verified')`,
    ],
  });
  const row = result.rows[3][0];
  if (row?.status === "missing" || row?.status === "invalid"
    || row?.status === "unsupported") return { status: row.status } as const;
  const lastSeenAt = row?.lastSeenAt instanceof Date
    ? row.lastSeenAt : new Date(String(row?.lastSeenAt));
  return row && typeof row.id === "string" && typeof row.deviceId === "string"
    && typeof row.displayName === "string"
    && (row.status === "created" || row.status === "verified")
    && Number.isSafeInteger(Number(row.runnerCapabilityGeneration))
    && Number(row.runnerCapabilityGeneration) >= 1 && !Number.isNaN(lastSeenAt.valueOf())
    ? {
      status: row.status,
      id: row.id,
      deviceId: row.deviceId,
      displayName: row.displayName,
      runnerCapabilityGeneration: Number(row.runnerCapabilityGeneration),
      runnerCapability: row.status === "created" ? issuedCapability : null,
      lastSeenAt,
    }
    : row ? ({ status: "invalid" } as const) : null;
}

function cleanupSnapshot(runners: SQL) {
  return sql`SELECT json_object('runnerIds', (SELECT json_group_array(id) FROM (${runners})),
      'runIds', (SELECT json_group_array(id) FROM workspace_analysis_article_run
        WHERE runner_id IN (${runners}) AND state IN ('queued', 'running')),
      'receiptCount', (SELECT count(*) FROM workspace_analysis_article_query_receipt
        WHERE run_id IN (SELECT id FROM workspace_analysis_article_run WHERE runner_id IN (${runners}) AND state IN ('queued', 'running')))
    ) AS payload`;
}

async function cleanupRunnerWork(input: { organizationId: string; authority: AnalysisRunAuthority }, options: {
  scope: SQL; targetId: string; removal?: { previousRole: string; revokedLeases: number; deferredRevocations: number };
}) {
  const result = await atomicD1({
    scope: options.scope,
    statements: (scope) => {
      const ids = (field: "runIds" | "runnerIds") => sql`SELECT value FROM (${scope}), json_each(payload, ${`$.${field}`})`;
      return [
        sql`UPDATE workspace_analysis_runner SET revoked_at = COALESCE(revoked_at, ${utcNow})
          WHERE organization_id = ${input.organizationId} AND id IN (${ids("runnerIds")})`,
        sql`UPDATE workspace_analysis_article_run SET state = 'stale', finished_at = ${utcNow}, error_kind = 'runner_revoked',
            error_message = ${options.removal
              ? "The Desktop runner owner was removed before this run completed."
              : "The Desktop runner was revoked before this run completed."}
          WHERE organization_id = ${input.organizationId} AND id IN (${ids("runIds")})`,
        sql`DELETE FROM workspace_analysis_article_query_receipt WHERE organization_id = ${input.organizationId}
          AND run_id IN (${ids("runIds")})`,
        ...(options.removal ? [sql`DELETE FROM member WHERE organization_id = ${input.organizationId}
          AND id = ${options.targetId} AND EXISTS (${scope})`] : []),
        sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
            resource_id, redacted_summary, request_id)
          SELECT ${input.organizationId}, ${input.authority.userId}, ${options.removal ? "member.remove" : "analysis_runner.revoke"},
            ${options.removal ? "member" : "analysis_runner"}, ${options.targetId},
            ${options.removal
              ? sql`json_object('previousRole', ${options.removal.previousRole}, 'revokedLeases', ${options.removal.revokedLeases},
                'deferredRevocations', ${options.removal.deferredRevocations}, 'analysisRunnerCount', json_array_length(payload, '$.runnerIds'),
                'analysisActiveRunCount', json_array_length(payload, '$.runIds'), 'analysisDiscardedReceiptCount', payload ->> 'receiptCount')`
              : sql`json_object('activeRunCount', json_array_length(payload, '$.runIds'), 'discardedReceiptCount', payload ->> 'receiptCount')`},
            ${crypto.randomUUID()} FROM (${scope})`,
        sql`SELECT json_array_length(payload, '$.runnerIds') AS runnerCount,
          json_array_length(payload, '$.runIds') AS activeRunCount, payload ->> 'receiptCount' AS discardedReceiptCount FROM (${scope})`,
      ];
    },
  });
  const row = result.rows.at(-1)?.[0];
  if (!row) return null;
  const counts = { runnerCount: Number(row.runnerCount), activeRunCount: Number(row.activeRunCount),
    discardedReceiptCount: Number(row.discardedReceiptCount) };
  return Object.values(counts).every((value) => Number.isSafeInteger(value) && value >= 0)
    ? { id: options.targetId, ...counts } : null;
}

export async function revokeAnalysisRunner(input: { organizationId: string; runnerId: string; authority: AnalysisRunAuthority }) {
  const runners = sql`SELECT id FROM workspace_analysis_runner WHERE organization_id = ${input.organizationId}
    AND id = ${input.runnerId} AND member_id = ${input.authority.membershipId} AND revoked_at IS NULL`;
  const result = await cleanupRunnerWork(input, {
    targetId: input.runnerId,
    scope: sql`SELECT payload FROM (${cleanupSnapshot(runners)}) WHERE EXISTS (${runners})
      AND EXISTS (${workspaceMemberAuthority(input.organizationId, input.authority, allRoles)})`,
  });
  return result ? { id: result.id, activeRunCount: result.activeRunCount } : null;
}

export async function removeMemberAfterAnalysisRunnerCleanup(input: {
  organizationId: string;
  target: { memberId: string; userId: string; role: AnalysisRunAuthority["role"]; claimId: string };
  externalLeaseRevocation: { revoked: number; deferred: number };
  authority: AnalysisRunAuthority;
}) {
  const runners = sql`SELECT id FROM workspace_analysis_runner WHERE organization_id = ${input.organizationId}
    AND member_id = ${input.target.memberId}`;
  return cleanupRunnerWork(input, {
    targetId: input.target.memberId,
    removal: { previousRole: input.target.role, revokedLeases: input.externalLeaseRevocation.revoked,
      deferredRevocations: input.externalLeaseRevocation.deferred },
    scope: sql`SELECT payload FROM (${cleanupSnapshot(runners)}) WHERE
      EXISTS (${workspaceMemberAuthority(input.organizationId, input.authority, ["admin", "owner"])})
      AND EXISTS (SELECT 1 FROM member target WHERE target.id = ${input.target.memberId}
        AND target.organization_id = ${input.organizationId} AND target.user_id = ${input.target.userId}
        AND target.role = ${input.target.role} AND target.role <> 'owner' AND target.revocation_claim_id = ${input.target.claimId}
        AND NOT EXISTS (SELECT 1 FROM workspace_analysis_article WHERE organization_id = target.organization_id
          AND owner_member_id = target.id AND deleted_at IS NULL))`,
  });
}
