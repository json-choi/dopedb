// Atomic persistence for explicit Desktop-run Analysis Articles. The control
// plane verifies immutable authority and stores receipts, never result rows.
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "./db";
import { atomicD1 } from "./d1/atomic";
import { utcNow } from "./d1/schema/values";
import { jsonEqual } from "./d1/json";
import { workspaceMemberAuthority } from "./d1/member-authority";
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
  const run = { ...returnedRun(row)! };
  delete run.connectionContentRevision;
  return { run, connectionContentRevision };
}

const allRoles = ["viewer", "analyst", "editor", "admin", "owner"] as const;

function runProjection() {
  return sql`run.id, run.article_id AS articleId, run.article_revision AS articleRevision, run.runner_id AS runnerId,
    run.runner_capability_generation AS runnerCapabilityGeneration, 'manual' AS trigger, run.state,
    run.definition_hash AS definitionHash, run.schema_fingerprints AS schemaFingerprints, run.row_count AS rowCount,
    run.byte_count AS byteCount, run.result_hash AS resultHash, run.error_kind AS errorKind, run.error_message AS errorMessage,
    run.cancel_requested_at AS cancelRequestedAt, run.cancel_requested_by_member_id AS cancelRequestedByMemberId,
    run.started_at AS startedAt, run.finished_at AS finishedAt, run.created_at AS createdAt`;
}

function returnedRun(row: RawRow | undefined): RawRow | null {
  return row ? { ...row, schemaFingerprints: typeof row.schemaFingerprints === "string"
    ? JSON.parse(row.schemaFingerprints) : row.schemaFingerprints } : null;
}

function requestedReceipts(receipts: ReturnType<typeof receiptRows>) {
  return sql`SELECT value ->> 'query_node_id' AS query_node_id, value ->> 'connection_id' AS connection_id,
    value ->> 'connection_revision' AS connection_revision, value ->> 'query_run_id' AS query_run_id,
    value ->> 'query_hash' AS query_hash, value ->> 'schema_fingerprint' AS schema_fingerprint,
    value ->> 'state' AS state, value ->> 'row_count' AS row_count, value ->> 'byte_count' AS byte_count,
    value ->> 'duration_ms' AS duration_ms FROM json_each(${JSON.stringify(receipts)})`;
}

export async function getAnalysisRunControl(input: {
  organizationId: string;
  articleId: string;
  runId: string;
  membershipId: string;
  runnerCapabilityHash: string;
}): Promise<AnalysisRunControl | null> {
  const result = await db.execute<{ state: string; cancelRequestedAt: string | null; authorized: number }>(sql`
    SELECT run."state" AS "state",
      run."cancel_requested_at" AS "cancelRequestedAt",
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
         AND environment_binding."connection_revision" = connection."content_revision"
         AND environment_binding."revoked_at" IS NULL
        JOIN ${workspaceConnectionGrant} connection_grant
          ON connection_grant."organization_id" = connection."organization_id"
         AND connection_grant."connection_id" = connection."id"
         AND connection_grant."member_id" = ${input.membershipId}
         AND connection_grant."capability" IN ('read', 'use', 'manage')
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
      AND run."article_id" = ${input.articleId}
      AND run."id" = ${input.runId}
    LIMIT 1
  `);
  return result.rows[0] ? { ...result.rows[0], authorized: result.rows[0].authorized === 1 } : null;
}

export async function requestAnalysisRunCancellation(input: {
  organizationId: string;
  articleId: string;
  runId: string;
  authority: AnalysisRunAuthority;
}) {
  const requestId = crypto.randomUUID();
  const result = await atomicD1({
    scope: sql`    WITH authority AS (${workspaceMemberAuthority(input.organizationId, input.authority, allRoles)}    ), current AS MATERIALIZED (
      SELECT run."id", run."article_revision" FROM ${workspaceAnalysisArticleRun} run
      JOIN ${workspaceAnalysisRunner} runner
        ON runner."organization_id" = run."organization_id" AND runner."id" = run."runner_id"
      JOIN authority ON TRUE
      WHERE run."organization_id" = ${input.organizationId}
        AND run."article_id" = ${input.articleId}
        AND run."id" = ${input.runId}
        AND run."state" IN ('queued', 'running')
        AND run."cancel_requested_at" IS NULL
        AND (run."requested_by_member_id" = authority."id"
          OR runner."member_id" = authority."id"
          OR authority."role" IN ('editor', 'admin', 'owner'))

    ) SELECT json_object('revision', article_revision) AS payload FROM current`,
    statements: (scope) => [
      sql`UPDATE workspace_analysis_article_run SET cancel_requested_at = ${utcNow},
        cancel_requested_by_member_id = ${input.authority.membershipId} WHERE id = ${input.runId} AND EXISTS (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_article.run_cancel_requested', 'analysis_article_run',
          ${input.runId}, json_object('articleId', ${input.articleId}, 'articleRevision', payload ->> 'revision'),
          ${requestId} FROM (${scope})`,
      sql`SELECT ${runProjection()} FROM workspace_analysis_article_run run CROSS JOIN (${scope}) WHERE run.id = ${input.runId}`,
    ],
  });
  return returnedRun(result.rows[2][0]);
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
  const result = await atomicD1({
    scope: sql`    WITH authority AS (${workspaceMemberAuthority(input.organizationId, input.authority, allRoles)}    ), runner_authority AS MATERIALIZED (
      SELECT runner."id", runner."runner_capability_generation"
      FROM ${workspaceAnalysisRunner} runner
      JOIN authority ON runner."member_id" = authority."id"
      WHERE runner."organization_id" = ${input.organizationId}
        AND runner."id" = ${input.run.runnerId}
        AND runner."revoked_at" IS NULL
        AND runner."runner_capability_hash" = ${input.runnerCapabilityHash}
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
        AND article."id" = ${input.articleId} AND article."deleted_at" IS NULL
        AND article."revision" = ${input.run.articleRevision}
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
       AND environment_binding."connection_revision" = connection."content_revision"
       AND environment_binding."revoked_at" IS NULL
      JOIN ${workspaceConnectionGrant} connection_grant
        ON connection_grant."organization_id" = connection."organization_id"
       AND connection_grant."connection_id" = connection."id"
       AND connection_grant."member_id" = ${input.authority.membershipId}
       AND connection_grant."capability" IN ('read', 'use', 'manage')

    ) SELECT json_object('runnerGeneration', runner_authority.runner_capability_generation,
      'connectionRevision', (SELECT content_revision FROM connection_authority)) AS payload
      FROM runner_authority WHERE EXISTS (SELECT 1 FROM article_authority) AND (SELECT count(*) FROM connection_authority) = 1`,
    statements: (scope) => [
      sql`INSERT INTO workspace_analysis_article_run (id, organization_id, article_id, article_revision, runner_id,
          runner_capability_generation, requested_by_member_id, state, definition_hash, started_at)
        SELECT ${input.run.id}, ${input.organizationId}, ${input.articleId}, ${input.run.articleRevision}, ${input.run.runnerId},
          payload ->> 'runnerGeneration', ${input.authority.membershipId}, 'running', ${input.definitionHash}, ${utcNow} FROM (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_article.run_start', 'analysis_article_run',
          ${input.run.id}, ${JSON.stringify({ articleId: input.articleId, articleRevision: input.run.articleRevision, trigger: "manual" })},
          ${requestId} FROM (${scope})`,
      sql`SELECT ${runProjection()}, payload ->> 'connectionRevision' AS connectionContentRevision
        FROM workspace_analysis_article_run run CROSS JOIN (${scope}) WHERE run.id = ${input.run.id}`,
    ],
  });
  return returnedAnalysisRunStart(result.rows[2][0]);
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
  const result = await atomicD1({
    scope: sql`    WITH authority AS (${workspaceMemberAuthority(input.organizationId, input.authority, allRoles)}    ), current AS MATERIALIZED (
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
        AND run."id" = ${input.runId}
        AND run."article_id" = ${input.articleId}
        AND run."runner_id" = ${input.runnerId}
        AND run."state" = 'running'
        AND (run."cancel_requested_at" IS NULL OR ${input.completion.state} <> 'succeeded')
    ), requested_receipt AS MATERIALIZED (
      ${requestedReceipts(receipts)}
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
       AND environment_binding."connection_revision" = connection."content_revision"
       AND environment_binding."revoked_at" IS NULL
      JOIN ${workspaceConnectionGrant} connection_grant
        ON connection_grant."organization_id" = connection."organization_id"
       AND connection_grant."connection_id" = connection."id"
       AND connection_grant."member_id" = ${input.authority.membershipId}
       AND connection_grant."capability" IN ('read', 'use', 'manage')
    ), eligible AS MATERIALIZED (
      SELECT current."id" FROM current
      WHERE ${input.completion.state} <> 'succeeded'
        OR ((SELECT count(*) FROM receipt_authority) = ${receipts.length}
          AND ${receipts.length} = 1)

    ) SELECT json_object('revision', current.article_revision) AS payload FROM current JOIN eligible ON eligible.id = current.id`,
    statements: (scope) => [
      sql`INSERT INTO workspace_analysis_article_query_receipt (organization_id, run_id, query_node_id, connection_id,
          connection_revision, query_run_id, query_hash, schema_fingerprint, state, row_count, byte_count, duration_ms)
        SELECT ${input.organizationId}, ${input.runId}, requested.query_node_id, requested.connection_id,
          requested.connection_revision, requested.query_run_id, requested.query_hash, requested.schema_fingerprint,
          requested.state, requested.row_count, requested.byte_count, requested.duration_ms
        FROM (${requestedReceipts(receipts)}) requested CROSS JOIN (${scope}) WHERE ${input.completion.state} = 'succeeded'`,
      sql`UPDATE workspace_analysis_article_run SET state = ${input.completion.state}, schema_fingerprints = ${JSON.stringify(schemaFingerprints)},
          row_count = ${rowCount}, byte_count = ${byteCount}, result_hash = ${resultHash}, error_kind = ${input.completion.error?.kind ?? null},
          error_message = ${input.completion.error?.message ?? null}, finished_at = ${utcNow}
        WHERE id = ${input.runId} AND EXISTS (${scope})`,
      sql`UPDATE workspace_analysis_article SET latest_successful_run_id = ${input.runId}, updated_at = ${utcNow}
        WHERE organization_id = ${input.organizationId} AND id = ${input.articleId} AND ${input.completion.state} = 'succeeded'
          AND revision = (SELECT payload ->> 'revision' FROM (${scope}))`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_article.run_complete', 'analysis_article_run', ${input.runId},
          json_object('articleId', ${input.articleId}, 'articleRevision', payload ->> 'revision', 'state', ${input.completion.state},
            'rowCount', ${rowCount}, 'byteCount', ${byteCount}), ${requestId} FROM (${scope})`,
      sql`SELECT ${runProjection()} FROM workspace_analysis_article_run run CROSS JOIN (${scope}) WHERE run.id = ${input.runId}`,
    ],
  });
  if (result.rows[4][0]) return returnedRun(result.rows[4][0]);
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
    WITH authority AS (${workspaceMemberAuthority(input.organizationId, input.authority, allRoles)}    ), requested_receipt AS MATERIALIZED (
      ${requestedReceipts(input.receipts)}
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
        AND run."article_id" = ${input.articleId}
        AND run."id" = ${input.runId} AND run."runner_id" = ${input.runnerId}
        AND run."state" = ${input.completion.state} AND run."finished_at" IS NOT NULL
        AND ${jsonEqual(sql`run.schema_fingerprints`, sql`${JSON.stringify(input.schemaFingerprints)}`)}
        AND run."row_count" = ${input.rowCount} AND run."byte_count" = ${input.byteCount}
        AND run."result_hash" IS ${input.resultHash}
        AND run."error_kind" IS ${input.completion.error?.kind ?? null}
        AND run."error_message" IS ${input.completion.error?.message ?? null}
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
    )
    SELECT ${runProjection()} FROM replay run
  `);
  return returnedRun(result.rows[0]);
}
