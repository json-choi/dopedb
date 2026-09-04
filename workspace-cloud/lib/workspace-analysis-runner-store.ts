// Possession-bound registration for member-owned, foreground-only Desktop runners.
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "./db";
import { revocationGateLockKey } from "./revocation-gates";
import {
  member,
  workspaceAnalysisArticle,
  workspaceAnalysisArticleQueryReceipt,
  workspaceAnalysisArticleRun,
  workspaceAnalysisRunner,
  workspaceAuditEvent,
} from "./schema";
import type { AnalysisRunnerRegistration } from "./workspace-analysis-runs";
import type { AnalysisRunAuthority } from "./workspace-analysis-run-store";
import {
  analysisRunnerCapabilityVersion,
  hashAnalysisRunnerCapability,
  issueAnalysisRunnerCapability,
} from "./workspace-analysis-runner-capability";

function memberLockKey(input: { organizationId: string; authority: AnalysisRunAuthority }) {
  return revocationGateLockKey({
    kind: "member",
    organizationId: input.organizationId,
    memberId: input.authority.membershipId,
    userId: input.authority.userId,
  });
}

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
  const requestId = crypto.randomUUID();
  const result = await db.execute<Record<string, unknown>>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${memberLockKey(input)}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN ${member} member
        ON member."id" = ${input.authority.membershipId}
       AND member."organization_id" = ${input.organizationId}
       AND member."user_id" = ${input.authority.userId}
      JOIN authority_lock ON TRUE
      WHERE session."id" = ${input.authority.sessionId}
        AND session."user_id" = ${input.authority.userId}
        AND session."expires_at" > now()
        AND member."role" = ${input.authority.role}
        AND member."revocation_pending_at" IS NULL
        AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member
    ), inserted AS MATERIALIZED (
      INSERT INTO ${workspaceAnalysisRunner} AS inserted_runner
        ("organization_id", "member_id", "device_id", "display_name",
         "runner_capability_hash", "runner_capability_generation",
         "last_seen_at", "revoked_at")
      SELECT ${input.organizationId}, authority."id", ${input.registration.deviceId},
        ${input.registration.displayName}, ${issuedCapabilityHash}, 1, now(), NULL
      FROM authority
      ON CONFLICT ("organization_id", "device_id") WHERE "revoked_at" IS NULL DO NOTHING
      RETURNING inserted_runner.*
    ), verified AS MATERIALIZED (
      UPDATE ${workspaceAnalysisRunner} runner
      SET "display_name" = ${input.registration.displayName},
        "last_seen_at" = now()
      FROM authority
      WHERE runner."organization_id" = ${input.organizationId}
        AND runner."device_id" = ${input.registration.deviceId}
        AND runner."member_id" = authority."id" AND runner."revoked_at" IS NULL
        AND runner."runner_capability_hash" = ${providedCapabilityHash}
        AND NOT EXISTS (SELECT 1 FROM inserted)
      RETURNING runner.*
    ), stored AS MATERIALIZED (
      SELECT inserted.*, TRUE AS "created" FROM inserted
      UNION ALL SELECT verified.*, FALSE AS "created" FROM verified
    ), conflict AS MATERIALIZED (
      SELECT CASE WHEN runner."member_id" = authority."id"
            AND ${providedCapabilityHash}::text IS NULL
            THEN 'missing'
          ELSE 'invalid' END AS "status"
      FROM ${workspaceAnalysisRunner} runner JOIN authority ON TRUE
      WHERE runner."organization_id" = ${input.organizationId}
        AND runner."device_id" = ${input.registration.deviceId}
        AND runner."revoked_at" IS NULL
        AND NOT EXISTS (SELECT 1 FROM stored)
      LIMIT 1
    ), audit AS MATERIALIZED (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_runner.register',
        'analysis_runner', stored."id"::text,
        jsonb_build_object('foregroundOnly', TRUE,
          'capabilityGeneration', stored."runner_capability_generation",
          'created', stored."created"), ${requestId}::uuid
      FROM stored RETURNING "resource_id"
    )
    SELECT CASE WHEN stored."created" THEN 'created' ELSE 'verified' END AS "status",
      stored."id"::text AS "id", stored."device_id" AS "deviceId",
      stored."display_name" AS "displayName",
      stored."runner_capability_generation"::double precision AS "runnerCapabilityGeneration",
      stored."last_seen_at" AS "lastSeenAt"
    FROM stored JOIN audit ON audit."resource_id" = stored."id"::text
    UNION ALL SELECT conflict."status", NULL, NULL, NULL, NULL, NULL FROM conflict
  `);
  const row = result.rows[0];
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

export async function revokeAnalysisRunner(input: {
  organizationId: string;
  runnerId: string;
  authority: AnalysisRunAuthority;
}) {
  const requestId = crypto.randomUUID();
  const result = await db.execute<Record<string, unknown>>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${memberLockKey(input)}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN ${member} member
        ON member."id" = ${input.authority.membershipId}
       AND member."organization_id" = ${input.organizationId}
       AND member."user_id" = ${input.authority.userId}
      JOIN authority_lock ON TRUE
      WHERE session."id" = ${input.authority.sessionId}
        AND session."user_id" = ${input.authority.userId}
        AND session."expires_at" > now() AND member."role" = ${input.authority.role}
        AND member."revocation_pending_at" IS NULL AND member."revocation_claim_id" IS NULL
      FOR UPDATE OF session, member
    ), revoked AS MATERIALIZED (
      UPDATE ${workspaceAnalysisRunner} runner SET "revoked_at" = now()
      FROM authority
      WHERE runner."organization_id" = ${input.organizationId}
        AND runner."id" = ${input.runnerId}::uuid
        AND runner."member_id" = authority."id" AND runner."revoked_at" IS NULL
      RETURNING runner."id"
    ), stopped_runs AS MATERIALIZED (
      UPDATE ${workspaceAnalysisArticleRun} run
      SET "state" = 'stale', "finished_at" = now(),
        "error_kind" = 'runner_revoked',
        "error_message" = 'The Desktop runner was revoked before this run completed.'
      FROM revoked
      WHERE run."organization_id" = ${input.organizationId}
        AND run."runner_id" = revoked."id" AND run."state" IN ('queued', 'running')
      RETURNING run."id"
    ), discarded_receipts AS MATERIALIZED (
      DELETE FROM ${workspaceAnalysisArticleQueryReceipt} receipt USING stopped_runs
      WHERE receipt."organization_id" = ${input.organizationId}
        AND receipt."run_id" = stopped_runs."id" RETURNING receipt."run_id"
    ), audit AS MATERIALIZED (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_runner.revoke',
        'analysis_runner', revoked."id"::text,
        jsonb_build_object('activeRunCount', (SELECT count(*) FROM stopped_runs),
          'discardedReceiptCount', (SELECT count(*) FROM discarded_receipts)),
        ${requestId}::uuid
      FROM revoked RETURNING "resource_id"
    )
    SELECT revoked."id"::text AS "id",
      (SELECT count(*)::int FROM stopped_runs) AS "activeRunCount"
    FROM revoked JOIN audit ON audit."resource_id" = revoked."id"::text
  `);
  const row = result.rows[0];
  const activeRunCount = Number(row?.activeRunCount);
  return row && typeof row.id === "string"
    && Number.isSafeInteger(activeRunCount) && activeRunCount >= 0
    ? { id: row.id, activeRunCount }
    : null;
}

export async function removeMemberAfterAnalysisRunnerCleanup(input: {
  organizationId: string;
  target: { memberId: string; userId: string; role: AnalysisRunAuthority["role"]; claimId: string };
  externalLeaseRevocation: { revoked: number; deferred: number };
  authority: AnalysisRunAuthority;
}) {
  const [actorGateLock, targetGateLock = actorGateLock] = [...new Set([
    memberLockKey(input),
    revocationGateLockKey({
      kind: "member",
      organizationId: input.organizationId,
      memberId: input.target.memberId,
      userId: input.target.userId,
    }),
  ])].sort();
  const requestId = crypto.randomUUID();
  const result = await db.execute<Record<string, unknown>>(sql`
    WITH actor_gate_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${actorGateLock}, 0))
    ), target_gate_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${targetGateLock}, 0)) FROM actor_gate_lock
    ), actor_authority AS MATERIALIZED (
      SELECT actor_member."id" FROM "workspace_control"."session" actor_session
      JOIN ${member} actor_member
        ON actor_member."id" = ${input.authority.membershipId}
       AND actor_member."organization_id" = ${input.organizationId}
       AND actor_member."user_id" = ${input.authority.userId}
      JOIN actor_gate_lock ON TRUE JOIN target_gate_lock ON TRUE
      WHERE actor_session."id" = ${input.authority.sessionId}
        AND actor_session."user_id" = ${input.authority.userId}
        AND actor_session."expires_at" > now()
        AND actor_member."role" = ${input.authority.role}
        AND actor_member."role" IN ('admin', 'owner')
        AND actor_member."revocation_pending_at" IS NULL
        AND actor_member."revocation_claim_id" IS NULL
      FOR UPDATE OF actor_session, actor_member
    ), target_authority AS MATERIALIZED (
      SELECT target."id", target."organization_id", target."role" FROM ${member} target
      JOIN actor_authority ON TRUE
      WHERE target."id" = ${input.target.memberId}
        AND target."organization_id" = ${input.organizationId}
        AND target."user_id" = ${input.target.userId}
        AND target."role" = ${input.target.role} AND target."role" <> 'owner'
        AND target."revocation_claim_id" = ${input.target.claimId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM ${workspaceAnalysisArticle} owned_article
          WHERE owned_article."organization_id" = target."organization_id"
            AND owned_article."owner_member_id" = target."id"
            AND owned_article."deleted_at" IS NULL
        )
      FOR UPDATE OF target
    ), target_runners AS MATERIALIZED (
      SELECT runner."id" FROM ${workspaceAnalysisRunner} runner
      JOIN target_authority
        ON runner."organization_id" = target_authority."organization_id"
       AND runner."member_id" = target_authority."id"
      FOR UPDATE OF runner
    ), revoked_runners AS MATERIALIZED (
      UPDATE ${workspaceAnalysisRunner} runner
      SET "revoked_at" = COALESCE(runner."revoked_at", now())
      FROM target_runners
      WHERE runner."organization_id" = ${input.organizationId}
        AND runner."id" = target_runners."id" RETURNING runner."id"
    ), stopped_runs AS MATERIALIZED (
      UPDATE ${workspaceAnalysisArticleRun} run
      SET "state" = 'stale', "finished_at" = now(),
        "error_kind" = 'runner_revoked',
        "error_message" = 'The Desktop runner owner was removed before this run completed.'
      FROM revoked_runners
      WHERE run."organization_id" = ${input.organizationId}
        AND run."runner_id" = revoked_runners."id" AND run."state" IN ('queued', 'running')
      RETURNING run."id"
    ), discarded_receipts AS MATERIALIZED (
      DELETE FROM ${workspaceAnalysisArticleQueryReceipt} receipt USING stopped_runs
      WHERE receipt."organization_id" = ${input.organizationId}
        AND receipt."run_id" = stopped_runs."id" RETURNING receipt."run_id"
    ), cleanup_barrier AS MATERIALIZED (
      SELECT (SELECT count(*)::int FROM revoked_runners) AS "runnerCount",
        (SELECT count(*)::int FROM stopped_runs) AS "activeRunCount",
        (SELECT count(*)::int FROM discarded_receipts) AS "discardedReceiptCount"
    ), deleted_member AS MATERIALIZED (
      DELETE FROM ${member} target USING target_authority, cleanup_barrier
      WHERE target."id" = target_authority."id"
        AND target."organization_id" = target_authority."organization_id"
      RETURNING target."id", target."organization_id", target."role"
    ), audit AS MATERIALIZED (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT deleted_member."organization_id", ${input.authority.userId},
        'member.remove', 'member', deleted_member."id",
        jsonb_build_object('previousRole', deleted_member."role",
          'revokedLeases', ${input.externalLeaseRevocation.revoked}::integer,
          'deferredRevocations', ${input.externalLeaseRevocation.deferred}::integer,
          'analysisRunnerCount', cleanup_barrier."runnerCount",
          'analysisActiveRunCount', cleanup_barrier."activeRunCount",
          'analysisDiscardedReceiptCount', cleanup_barrier."discardedReceiptCount"),
        ${requestId}::uuid
      FROM deleted_member CROSS JOIN cleanup_barrier RETURNING "resource_id"
    )
    SELECT deleted_member."id"::text AS "id", cleanup_barrier."runnerCount",
      cleanup_barrier."activeRunCount", cleanup_barrier."discardedReceiptCount"
    FROM deleted_member CROSS JOIN cleanup_barrier
    JOIN audit ON audit."resource_id" = deleted_member."id"
  `);
  const row = result.rows[0];
  if (!row || typeof row.id !== "string") return null;
  const counts = {
    runnerCount: Number(row.runnerCount),
    activeRunCount: Number(row.activeRunCount),
    discardedReceiptCount: Number(row.discardedReceiptCount),
  };
  return Object.values(counts).every((value) => Number.isSafeInteger(value) && value >= 0)
    ? { id: row.id, ...counts }
    : null;
}
