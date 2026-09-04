// Atomic persistence for explicit Desktop-run Analysis Articles. The control
// plane verifies immutable authority and stores receipts, never result rows.
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "./db";
import { revocationGateLockKey } from "./revocation-gates";
import {
  knowledgeEnvironmentConnection,
  workspaceAnalysisArticle,
  workspaceAnalysisArticleQueryReceipt,
  workspaceAnalysisArticleRevision,
  workspaceAnalysisArticleRun,
  workspaceAnalysisRunner,
  workspaceAuditEvent,
  workspaceConnection,
  workspaceConnectionGrant,
} from "./schema";
import type {
  AnalysisQueryReceiptInput,
  AnalysisRunCompletion,
  AnalysisRunRequest,
} from "./workspace-analysis-runs";
import { analysisRunResultHash } from "./workspace-analysis-runs";

export type AnalysisRunAuthority = Readonly<{
  sessionId: string;
  userId: string;
  membershipId: string;
  role: string;
}>;

export type AnalysisRunControl = Readonly<{
  state: string;
  cancelRequestedAt: string | null;
  authorized: boolean;
}>;

type RawRow = Record<string, unknown>;

export type AnalysisRunStart = Readonly<{
  run: RawRow;
  connectionContentRevision: number;
}>;

function analysisConnectionMatchesArticle() {
  return sql`connection."content_revision" = article."connection_revision"`;
}

function analysisReceiptMatchesConnection() {
  return sql`article."connection_id" = requested.connection_id
    AND article."connection_revision" = requested.connection_revision
    AND connection."content_revision" = article."connection_revision"`;
}

function returnedAnalysisRunStart(row: RawRow | undefined): AnalysisRunStart | null {
  if (!row) return null;
  const connectionContentRevision = typeof row.connectionContentRevision === "number"
    ? row.connectionContentRevision
    : Number(row.connectionContentRevision);
  if (!Number.isSafeInteger(connectionContentRevision) || connectionContentRevision < 1) {
    throw new Error("Analysis run start returned invalid connection content authority");
  }
  const run = { ...row };
  delete run.connectionContentRevision;
  return { run, connectionContentRevision };
}

function memberLockKey(input: { organizationId: string; authority: AnalysisRunAuthority }) {
  return revocationGateLockKey({
    kind: "member",
    organizationId: input.organizationId,
    memberId: input.authority.membershipId,
    userId: input.authority.userId,
  });
}

function runProjection() {
  return sql`
    run."id"::text AS "id", run."article_id"::text AS "articleId",
    run."article_revision"::double precision AS "articleRevision",
    run."runner_id"::text AS "runnerId",
    run."runner_capability_generation"::double precision AS "runnerCapabilityGeneration",
    'manual'::text AS "trigger", run."state" AS "state",
    run."definition_hash" AS "definitionHash",
    run."schema_fingerprints" AS "schemaFingerprints", run."row_count"::integer AS "rowCount",
    run."byte_count"::integer AS "byteCount", run."result_hash" AS "resultHash",
    run."error_kind" AS "errorKind", run."error_message" AS "errorMessage",
    CASE WHEN run."cancel_requested_at" IS NULL THEN NULL ELSE
      to_char(run."cancel_requested_at" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS "cancelRequestedAt",
    run."cancel_requested_by_member_id" AS "cancelRequestedByMemberId",
    CASE WHEN run."started_at" IS NULL THEN NULL ELSE
      to_char(run."started_at" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS "startedAt",
    CASE WHEN run."finished_at" IS NULL THEN NULL ELSE
      to_char(run."finished_at" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS "finishedAt",
    to_char(run."created_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"`;
}

export async function getAnalysisRunControl(input: {
  organizationId: string;
  articleId: string;
  runId: string;
  membershipId: string;
  runnerCapabilityHash: string;
}): Promise<AnalysisRunControl | null> {
  const result = await db.execute<AnalysisRunControl>(sql`
    SELECT run."state" AS "state",
      CASE WHEN run."cancel_requested_at" IS NULL THEN NULL ELSE
        to_char(run."cancel_requested_at" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS "cancelRequestedAt",
      EXISTS (
        SELECT 1 FROM ${workspaceAnalysisRunner} runner
        JOIN ${workspaceAnalysisArticle} article
          ON article."organization_id" = run."organization_id"
         AND article."id" = run."article_id" AND article."deleted_at" IS NULL
        JOIN ${workspaceConnection} connection
          ON connection."organization_id" = article."organization_id"
         AND connection."id" = article."connection_id"
         AND ${analysisConnectionMatchesArticle()}
         AND connection."deleted_at" IS NULL
         AND connection."revocation_pending_at" IS NULL
        JOIN ${knowledgeEnvironmentConnection} environment_binding
          ON environment_binding."organization_id" = connection."organization_id"
         AND environment_binding."project_environment_id" = article."project_environment_id"
         AND environment_binding."environment_revision" = article."environment_revision"
         AND environment_binding."connection_id" = connection."id"
         AND environment_binding."connection_revision" = connection."revision"
         AND environment_binding."revoked_at" IS NULL
        JOIN ${workspaceConnectionGrant} connection_grant
          ON connection_grant."organization_id" = connection."organization_id"
         AND connection_grant."connection_id" = connection."id"
         AND connection_grant."member_id" = ${input.membershipId}
         AND connection_grant."capability" IN ('use', 'manage')
        JOIN ${workspaceAnalysisArticleRevision} revision
          ON revision."organization_id" = run."organization_id"
         AND revision."article_id" = run."article_id"
         AND revision."revision" = run."article_revision"
        WHERE runner."organization_id" = run."organization_id"
          AND runner."id" = run."runner_id"
          AND runner."member_id" = ${input.membershipId}
          AND runner."revoked_at" IS NULL
          AND runner."runner_capability_hash" = ${input.runnerCapabilityHash}
          AND runner."runner_capability_generation" = run."runner_capability_generation"
          AND article."revision" = run."article_revision"
      ) AS "authorized"
    FROM ${workspaceAnalysisArticleRun} run
    WHERE run."organization_id" = ${input.organizationId}
      AND run."article_id" = ${input.articleId}::uuid
      AND run."id" = ${input.runId}::uuid
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export async function requestAnalysisRunCancellation(input: {
  organizationId: string;
  articleId: string;
  runId: string;
  authority: AnalysisRunAuthority;
}) {
  const requestId = crypto.randomUUID();
  const result = await db.execute<RawRow>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${memberLockKey(input)}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id", member."role"
      FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
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
    ), current AS MATERIALIZED (
      SELECT run."id" FROM ${workspaceAnalysisArticleRun} run
      JOIN ${workspaceAnalysisRunner} runner
        ON runner."organization_id" = run."organization_id" AND runner."id" = run."runner_id"
      JOIN authority ON TRUE
      WHERE run."organization_id" = ${input.organizationId}
        AND run."article_id" = ${input.articleId}::uuid
        AND run."id" = ${input.runId}::uuid
        AND run."state" IN ('queued', 'running')
        AND run."cancel_requested_at" IS NULL
        AND (run."requested_by_member_id" = authority."id"
          OR runner."member_id" = authority."id"
          OR authority."role" IN ('editor', 'admin', 'owner'))
      FOR UPDATE OF run, runner
    ), updated AS MATERIALIZED (
      UPDATE ${workspaceAnalysisArticleRun} run SET
        "cancel_requested_at" = now(), "cancel_requested_by_member_id" = authority."id"
      FROM current CROSS JOIN authority
      WHERE run."organization_id" = ${input.organizationId} AND run."id" = current."id"
      RETURNING run.*
    ), audit AS MATERIALIZED (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${input.organizationId}, ${input.authority.userId},
        'analysis_article.run_cancel_requested', 'analysis_article_run', updated."id"::text,
        jsonb_build_object('articleId', updated."article_id", 'articleRevision',
          updated."article_revision"), ${requestId}::uuid
      FROM updated RETURNING "resource_id"
    )
    SELECT ${runProjection()} FROM updated run
    JOIN audit ON audit."resource_id" = run."id"::text
  `);
  return result.rows[0] ?? null;
}

export async function commitAnalysisRunCreate(input: {
  organizationId: string;
  articleId: string;
  run: AnalysisRunRequest;
  definitionHash: string;
  runnerCapabilityHash: string;
  authority: AnalysisRunAuthority;
}) {
  const requestId = crypto.randomUUID();
  const result = await db.execute<RawRow>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${memberLockKey(input)}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id", member."role"
      FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
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
    ), runner_authority AS MATERIALIZED (
      SELECT runner."id", runner."runner_capability_generation"
      FROM ${workspaceAnalysisRunner} runner
      JOIN authority ON runner."member_id" = authority."id"
      WHERE runner."organization_id" = ${input.organizationId}
        AND runner."id" = ${input.run.runnerId}::uuid
        AND runner."revoked_at" IS NULL
        AND runner."runner_capability_hash" = ${input.runnerCapabilityHash}
      FOR UPDATE OF runner
    ), article_authority AS MATERIALIZED (
      SELECT article."id", article."organization_id", article."project_environment_id",
        article."environment_revision", article."connection_id", article."connection_revision"
      FROM ${workspaceAnalysisArticle} article
      JOIN ${workspaceAnalysisArticleRevision} revision
        ON revision."organization_id" = article."organization_id"
       AND revision."article_id" = article."id"
       AND revision."revision" = ${input.run.articleRevision}
      JOIN authority ON TRUE
      WHERE article."organization_id" = ${input.organizationId}
        AND article."id" = ${input.articleId}::uuid AND article."deleted_at" IS NULL
        AND article."revision" = ${input.run.articleRevision}
      FOR UPDATE OF article, revision
    ), connection_authority AS MATERIALIZED (
      SELECT connection."id" AS "connection_id", connection."content_revision"
      FROM article_authority
      JOIN ${workspaceConnection} connection
        ON connection."organization_id" = article_authority."organization_id"
       AND connection."id" = article_authority."connection_id"
       AND connection."content_revision" = article_authority."connection_revision"
       AND connection."deleted_at" IS NULL AND connection."revocation_pending_at" IS NULL
      JOIN ${knowledgeEnvironmentConnection} environment_binding
        ON environment_binding."organization_id" = connection."organization_id"
       AND environment_binding."project_environment_id" = article_authority."project_environment_id"
       AND environment_binding."environment_revision" = article_authority."environment_revision"
       AND environment_binding."connection_id" = connection."id"
       AND environment_binding."connection_revision" = connection."revision"
       AND environment_binding."revoked_at" IS NULL
      JOIN ${workspaceConnectionGrant} connection_grant
        ON connection_grant."organization_id" = connection."organization_id"
       AND connection_grant."connection_id" = connection."id"
       AND connection_grant."member_id" = ${input.authority.membershipId}
       AND connection_grant."capability" IN ('use', 'manage')
      FOR UPDATE OF connection, environment_binding, connection_grant
    ), inserted AS MATERIALIZED (
      INSERT INTO ${workspaceAnalysisArticleRun}
        ("id", "organization_id", "article_id", "article_revision", "runner_id",
         "runner_capability_generation", "requested_by_member_id", "state",
         "definition_hash", "started_at")
      SELECT ${input.run.id}::uuid, ${input.organizationId}, ${input.articleId}::uuid,
        ${input.run.articleRevision}, runner_authority."id",
        runner_authority."runner_capability_generation", authority."id", 'running',
        ${input.definitionHash}, now()
      FROM authority JOIN runner_authority ON TRUE JOIN article_authority ON TRUE
      WHERE (SELECT count(*) FROM connection_authority) = 1
      RETURNING *
    ), audit AS MATERIALIZED (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_article.run_start',
        'analysis_article_run', inserted."id"::text,
        jsonb_build_object('articleId', inserted."article_id", 'articleRevision',
          inserted."article_revision", 'trigger', 'manual'), ${requestId}::uuid
      FROM inserted RETURNING "resource_id"
    )
    SELECT ${runProjection()}, (
      SELECT connection_authority."content_revision" FROM connection_authority
    ) AS "connectionContentRevision"
    FROM inserted run JOIN audit ON audit."resource_id" = run."id"::text
  `);
  return returnedAnalysisRunStart(result.rows[0]);
}

function receiptRows(receipts: readonly AnalysisQueryReceiptInput[]) {
  return receipts.map((receipt) => ({
    query_node_id: receipt.queryNodeId,
    connection_id: receipt.connectionId,
    connection_revision: receipt.connectionRevision,
    query_run_id: receipt.queryRunId,
    query_hash: receipt.queryHash,
    schema_fingerprint: receipt.schemaFingerprint,
    state: receipt.state,
    row_count: receipt.rowCount,
    byte_count: receipt.byteCount,
    duration_ms: receipt.durationMs,
  }));
}

export async function commitAnalysisRunCompletion(input: {
  organizationId: string;
  articleId: string;
  runId: string;
  runnerId: string;
  runnerCapabilityHash: string;
  completion: AnalysisRunCompletion;
  authority: AnalysisRunAuthority;
}) {
  const receipts = receiptRows(input.completion.queryReceipts);
  const schemaFingerprints = Object.fromEntries(
    input.completion.state === "succeeded"
      ? input.completion.queryReceipts.map((receipt) => [receipt.queryNodeId, receipt.schemaFingerprint])
      : [],
  );
  const rowCount = input.completion.state === "succeeded"
    ? input.completion.queryReceipts.reduce((sum, receipt) => sum + receipt.rowCount, 0)
    : 0;
  const byteCount = input.completion.state === "succeeded"
    ? input.completion.queryReceipts.reduce((sum, receipt) => sum + receipt.byteCount, 0)
    : 0;
  const resultHash = input.completion.state === "succeeded"
    ? analysisRunResultHash(input.completion.queryReceipts)
    : null;
  const requestId = crypto.randomUUID();
  const result = await db.execute<RawRow>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${memberLockKey(input)}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
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
    ), current AS MATERIALIZED (
      SELECT run.*
      FROM ${workspaceAnalysisArticleRun} run
      JOIN ${workspaceAnalysisRunner} runner
        ON runner."organization_id" = run."organization_id"
       AND runner."id" = run."runner_id"
       AND runner."member_id" = ${input.authority.membershipId}
       AND runner."revoked_at" IS NULL
       AND runner."runner_capability_hash" = ${input.runnerCapabilityHash}
       AND runner."runner_capability_generation" = run."runner_capability_generation"
      JOIN authority ON TRUE
      JOIN ${workspaceAnalysisArticle} article
        ON article."organization_id" = run."organization_id"
       AND article."id" = run."article_id"
       AND (article."deleted_at" IS NULL OR ${input.completion.state} <> 'succeeded')
      JOIN ${workspaceAnalysisArticleRevision} revision
        ON revision."organization_id" = run."organization_id"
       AND revision."article_id" = run."article_id"
       AND revision."revision" = run."article_revision"
      WHERE run."organization_id" = ${input.organizationId}
        AND run."id" = ${input.runId}::uuid
        AND run."article_id" = ${input.articleId}::uuid
        AND run."runner_id" = ${input.runnerId}::uuid
        AND run."state" = 'running'
        AND (run."cancel_requested_at" IS NULL OR ${input.completion.state} <> 'succeeded')
      FOR UPDATE OF run, runner, article, revision
    ), requested_receipt AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(receipts)}::jsonb)
        AS requested(query_node_id text, connection_id uuid, connection_revision bigint,
          query_run_id uuid, query_hash text, schema_fingerprint text, state text,
          row_count bigint, byte_count bigint, duration_ms bigint)
    ), receipt_authority AS MATERIALIZED (
      SELECT requested.query_node_id FROM requested_receipt requested
      JOIN current ON TRUE
      JOIN ${workspaceAnalysisArticle} article
        ON article."organization_id" = current."organization_id"
       AND article."id" = current."article_id" AND article."deleted_at" IS NULL
       AND article."revision" = current."article_revision"
      JOIN ${workspaceConnection} connection
        ON connection."organization_id" = article."organization_id"
       AND connection."id" = article."connection_id"
       AND ${analysisReceiptMatchesConnection()}
       AND connection."deleted_at" IS NULL AND connection."revocation_pending_at" IS NULL
      JOIN ${knowledgeEnvironmentConnection} environment_binding
        ON environment_binding."organization_id" = connection."organization_id"
       AND environment_binding."project_environment_id" = article."project_environment_id"
       AND environment_binding."environment_revision" = article."environment_revision"
       AND environment_binding."connection_id" = connection."id"
       AND environment_binding."connection_revision" = connection."revision"
       AND environment_binding."revoked_at" IS NULL
      JOIN ${workspaceConnectionGrant} connection_grant
        ON connection_grant."organization_id" = connection."organization_id"
       AND connection_grant."connection_id" = connection."id"
       AND connection_grant."member_id" = ${input.authority.membershipId}
       AND connection_grant."capability" IN ('use', 'manage')
      FOR UPDATE OF connection, environment_binding, connection_grant
    ), eligible AS MATERIALIZED (
      SELECT current."id" FROM current
      WHERE ${input.completion.state} <> 'succeeded'
        OR ((SELECT count(*) FROM receipt_authority) = ${receipts.length}
          AND ${receipts.length} = 1)
    ), inserted_receipts AS MATERIALIZED (
      INSERT INTO ${workspaceAnalysisArticleQueryReceipt}
        ("organization_id", "run_id", "query_node_id", "connection_id",
         "connection_revision", "query_run_id", "query_hash", "schema_fingerprint",
         "state", "row_count", "byte_count", "duration_ms")
      SELECT ${input.organizationId}, eligible."id", requested.query_node_id,
        requested.connection_id, requested.connection_revision, requested.query_run_id,
        requested.query_hash, requested.schema_fingerprint, requested.state,
        requested.row_count, requested.byte_count, requested.duration_ms
      FROM eligible CROSS JOIN requested_receipt requested
      WHERE ${input.completion.state} = 'succeeded'
      RETURNING "run_id"
    ), updated AS MATERIALIZED (
      UPDATE ${workspaceAnalysisArticleRun} run
      SET "state" = ${input.completion.state},
        "schema_fingerprints" = ${JSON.stringify(schemaFingerprints)}::jsonb,
        "row_count" = ${rowCount}, "byte_count" = ${byteCount}, "result_hash" = ${resultHash},
        "error_kind" = ${input.completion.error?.kind ?? null},
        "error_message" = ${input.completion.error?.message ?? null}, "finished_at" = now()
      FROM current JOIN eligible ON eligible."id" = current."id"
      WHERE run."organization_id" = current."organization_id" AND run."id" = current."id"
        AND (${input.completion.state} <> 'succeeded'
          OR (SELECT count(*) FROM inserted_receipts) = ${receipts.length})
      RETURNING run.*
    ), article_updated AS MATERIALIZED (
      UPDATE ${workspaceAnalysisArticle} article
      SET "latest_successful_run_id" = CASE
          WHEN ${input.completion.state} = 'succeeded'
            AND article."revision" = updated."article_revision" THEN updated."id"
          ELSE article."latest_successful_run_id" END,
        "updated_at" = CASE
          WHEN ${input.completion.state} = 'succeeded'
            AND article."revision" = updated."article_revision" THEN now()
          ELSE article."updated_at" END
      FROM updated
      WHERE article."organization_id" = updated."organization_id"
        AND article."id" = updated."article_id"
      RETURNING article."id"
    ), audit AS MATERIALIZED (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type", "resource_id",
         "redacted_summary", "request_id")
      SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_article.run_complete',
        'analysis_article_run', updated."id"::text,
        jsonb_build_object('articleId', updated."article_id", 'articleRevision',
          updated."article_revision", 'state', updated."state", 'rowCount', updated."row_count",
          'byteCount', updated."byte_count"), ${requestId}::uuid
      FROM updated JOIN article_updated ON TRUE RETURNING "resource_id"
    )
    SELECT ${runProjection()} FROM updated run
    JOIN audit ON audit."resource_id" = run."id"::text
  `);
  if (result.rows[0]) return result.rows[0];
  return replayAnalysisRunCompletion({
    ...input, receipts, schemaFingerprints, rowCount, byteCount, resultHash,
  });
}

async function replayAnalysisRunCompletion(input: {
  organizationId: string;
  articleId: string;
  runId: string;
  runnerId: string;
  runnerCapabilityHash: string;
  completion: AnalysisRunCompletion;
  authority: AnalysisRunAuthority;
  receipts: ReturnType<typeof receiptRows>;
  schemaFingerprints: Record<string, string>;
  rowCount: number;
  byteCount: number;
  resultHash: string | null;
}) {
  const result = await db.execute<RawRow>(sql`
    WITH authority_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${memberLockKey(input)}, 0))
    ), authority AS MATERIALIZED (
      SELECT member."id" FROM "workspace_control"."session" session
      JOIN "workspace_control"."member" member
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
    ), requested_receipt AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(input.receipts)}::jsonb)
        AS requested(query_node_id text, connection_id uuid, connection_revision bigint,
          query_run_id uuid, query_hash text, schema_fingerprint text, state text,
          row_count bigint, byte_count bigint, duration_ms bigint)
    ), replay AS MATERIALIZED (
      SELECT run.* FROM ${workspaceAnalysisArticleRun} run
      JOIN ${workspaceAnalysisRunner} runner
        ON runner."organization_id" = run."organization_id" AND runner."id" = run."runner_id"
       AND runner."member_id" = ${input.authority.membershipId}
       AND runner."revoked_at" IS NULL
       AND runner."runner_capability_hash" = ${input.runnerCapabilityHash}
       AND runner."runner_capability_generation" = run."runner_capability_generation"
      JOIN authority ON TRUE
      WHERE run."organization_id" = ${input.organizationId}
        AND run."article_id" = ${input.articleId}::uuid
        AND run."id" = ${input.runId}::uuid AND run."runner_id" = ${input.runnerId}::uuid
        AND run."state" = ${input.completion.state} AND run."finished_at" IS NOT NULL
        AND run."schema_fingerprints" = ${JSON.stringify(input.schemaFingerprints)}::jsonb
        AND run."row_count" = ${input.rowCount} AND run."byte_count" = ${input.byteCount}
        AND run."result_hash" IS NOT DISTINCT FROM ${input.resultHash}
        AND run."error_kind" IS NOT DISTINCT FROM ${input.completion.error?.kind ?? null}
        AND run."error_message" IS NOT DISTINCT FROM ${input.completion.error?.message ?? null}
        AND (SELECT count(*) FROM ${workspaceAnalysisArticleQueryReceipt} stored
          WHERE stored."organization_id" = run."organization_id"
            AND stored."run_id" = run."id") = CASE
              WHEN ${input.completion.state} = 'succeeded' THEN ${input.receipts.length} ELSE 0 END
        AND (SELECT count(*) FROM requested_receipt requested
          JOIN ${workspaceAnalysisArticleQueryReceipt} stored
            ON stored."organization_id" = run."organization_id"
           AND stored."run_id" = run."id"
           AND stored."query_node_id" = requested.query_node_id
           AND stored."connection_id" = requested.connection_id
           AND stored."connection_revision" = requested.connection_revision
           AND stored."query_run_id" = requested.query_run_id
           AND stored."query_hash" = requested.query_hash
           AND stored."schema_fingerprint" = requested.schema_fingerprint
           AND stored."state" = requested.state
           AND stored."row_count" = requested.row_count
           AND stored."byte_count" = requested.byte_count
           AND stored."duration_ms" = requested.duration_ms) = CASE
             WHEN ${input.completion.state} = 'succeeded' THEN ${input.receipts.length} ELSE 0 END
      FOR UPDATE OF run, runner
    )
    SELECT ${runProjection()} FROM replay run
  `);
  return result.rows[0] ?? null;
}
