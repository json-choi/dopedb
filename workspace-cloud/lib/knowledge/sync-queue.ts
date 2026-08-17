// Durable Project Knowledge queue. GitHub delivery ids remain the audit cursor;
// sync jobs are coalesced by source + immutable commit and advanced by bounded
// scheduler-triggered invocations without any member desktop being online.
import "server-only";

import { sql } from "drizzle-orm";

import { db, neonSql } from "../db";
import {
  codeIndexSourceRevisionSha256,
  compareCodeIndexPath,
  MAX_CODE_INDEX_FILES,
} from "./code-index-core";
import { githubSourceManifest } from "./github-app";
import {
  knowledgeMutationAuthoritySql,
  type KnowledgeMutationAuthority,
} from "./mutation-authority";

const SHA1 = /^[0-9a-f]{40}$/;

type EnqueueResult = { jobId: string };
type RequeueResult = { jobId: string; graphRevisionId: string | null };

export type GithubReconciliationCandidate = {
  organizationId: string;
  sourceId: string;
  installationId: bigint;
  repositoryFullName: string;
  refName: string;
  commitSha: string;
};

type GithubKnowledgeSourceIdentity = {
  installationId: bigint;
  repositoryFullName: string;
};

function checkedSha(value: string) {
  if (!SHA1.test(value)) throw new Error("Invalid GitHub commit identity");
  return value;
}

function checkedChangedFiles(values: readonly string[]) {
  if (values.length > 10_000) return [];
  for (const value of values) {
    if (
      value.length < 1
      || value.length > 4_096
      || value.startsWith("/")
      || value.includes("\\")
      || /[\u0000-\u001f\u007f-\u009f]/.test(value)
      || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error("Invalid GitHub changed-file path");
    }
  }
  return [...new Set(values)].sort();
}

function validManifest(manifest: Awaited<ReturnType<typeof githubSourceManifest>>) {
  return manifest.length <= MAX_CODE_INDEX_FILES
    && manifest.every((file, index) =>
      file.path.length >= 1
      && file.path.length <= 4_096
      && !file.path.startsWith("/")
      && !file.path.includes("\\")
      && !/[\u0000-\u001f\u007f-\u009f]/.test(file.path)
      && file.path.split("/").every((segment) =>
        segment.length > 0 && segment !== "." && segment !== ".."
      )
      && /^[0-9a-f]{40}$/.test(file.blobSha)
      && Number.isSafeInteger(file.bytes)
      && file.bytes >= 0
      && file.bytes <= 16 * 1024 * 1024
      && (index === 0 || compareCodeIndexPath(manifest[index - 1]!.path, file.path) < 0)
    );
}

async function githubKnowledgeSourceIdentity(
  organizationId: string,
  sourceId: string,
  commitSha: string,
): Promise<GithubKnowledgeSourceIdentity | null> {
  const rows = await neonSql.query(
    `SELECT installation."installation_id"::text AS "installationId",
       source."repository_full_name" AS "repositoryFullName"
     FROM "workspace_control"."knowledge_source" source
     JOIN "workspace_control"."knowledge_github_installation" installation
       ON installation."organization_id" = source."organization_id"
      AND installation."id" = source."github_installation_id"
      AND installation."status" = 'active'
     WHERE source."organization_id" = $1
       AND source."id" = $2::uuid
       AND source."provider" = 'github'
       AND source."commit_sha" = $3
       AND source."revoked_at" IS NULL`,
    [organizationId, sourceId, checkedSha(commitSha)],
  );
  const row = rows[0];
  if (
    typeof row?.installationId !== "string"
    || !/^[1-9][0-9]{0,19}$/.test(row.installationId)
    || typeof row.repositoryFullName !== "string"
  ) return null;
  return {
    installationId: BigInt(row.installationId),
    repositoryFullName: row.repositoryFullName,
  };
}

async function githubKnowledgeManifest(identity: GithubKnowledgeSourceIdentity, commitSha: string) {
  const manifest = await githubSourceManifest(
    identity.installationId,
    identity.repositoryFullName,
    checkedSha(commitSha),
  );
  if (!validManifest(manifest)) throw new Error("Invalid code index manifest");
  return manifest;
}

export async function enqueueInitialGithubKnowledgeSync(input: {
  organizationId: string;
  sourceId: string;
  commitSha: string;
  authority: KnowledgeMutationAuthority;
}) {
  const identity = await githubKnowledgeSourceIdentity(
    input.organizationId,
    input.sourceId,
    input.commitSha,
  );
  if (!identity) return null;
  const manifest = await githubKnowledgeManifest(identity, input.commitSha);
  const result = await db.execute<EnqueueResult>(sql`
     INSERT INTO "workspace_control"."knowledge_source_sync_job" (
       "organization_id", "source_id", "desired_commit_sha", "source_sync_revision",
       "manifest", "total_files", "source_revision_sha256"
     )
     SELECT source."organization_id", source."id", source."commit_sha", source."sync_revision",
       ${JSON.stringify(manifest)}::text::jsonb, ${manifest.length},
       ${codeIndexSourceRevisionSha256(manifest)}
     FROM "workspace_control"."knowledge_source" source
     JOIN "workspace_control"."knowledge_github_installation" installation
       ON installation."organization_id" = source."organization_id"
      AND installation."id" = source."github_installation_id"
      AND installation."status" = 'active'
     WHERE source."organization_id" = ${input.organizationId}
       AND source."id" = ${input.sourceId}::uuid
       AND source."provider" = 'github'
       AND source."commit_sha" = ${checkedSha(input.commitSha)}
       AND source."revoked_at" IS NULL
       AND ${knowledgeMutationAuthoritySql(input.authority, input.organizationId)}
     ON CONFLICT ("source_id", "desired_commit_sha") DO UPDATE SET
       "desired_commit_sha" = EXCLUDED."desired_commit_sha"
     RETURNING "id"::text AS "jobId"
  `);
  return result.rows[0]?.jobId ?? null;
}

export async function requeueGithubKnowledgeSync(input: {
  organizationId: string;
  sourceId: string;
  authority: KnowledgeMutationAuthority;
}) {
  const current = await neonSql.query(
    `SELECT source."commit_sha" AS "commitSha"
     FROM "workspace_control"."knowledge_source" source
     WHERE source."organization_id" = $1
       AND source."id" = $2::uuid
       AND source."provider" = 'github'
       AND source."revoked_at" IS NULL
       AND source."commit_sha" IS NOT NULL`,
    [input.organizationId, input.sourceId],
  );
  const commitSha = typeof current[0]?.commitSha === "string"
    ? checkedSha(current[0].commitSha)
    : null;
  if (!commitSha) return null;
  const identity = await githubKnowledgeSourceIdentity(
    input.organizationId,
    input.sourceId,
    commitSha,
  );
  if (!identity) return null;
  const manifest = await githubKnowledgeManifest(identity, commitSha);
  const result = await db.execute<RequeueResult>(sql`
     WITH advanced_source AS MATERIALIZED (
       UPDATE "workspace_control"."knowledge_source" source
       SET "sync_state" = 'pending',
         "sync_revision" = source."sync_revision" + 1,
         "last_failure_code" = NULL,
         "updated_at" = now()
       WHERE source."organization_id" = ${input.organizationId}
         AND source."id" = ${input.sourceId}::uuid
         AND source."provider" = 'github'
         AND source."revoked_at" IS NULL
         AND source."commit_sha" = ${commitSha}
         AND ${knowledgeMutationAuthoritySql(input.authority, input.organizationId)}
       RETURNING source."organization_id", source."id", source."commit_sha",
         source."sync_revision"
     ), queued AS (
       INSERT INTO "workspace_control"."knowledge_source_sync_job" (
         "organization_id", "source_id", "desired_commit_sha", "source_sync_revision",
         "manifest", "total_files", "source_revision_sha256"
       )
       SELECT "organization_id", "id", "commit_sha", "sync_revision",
         ${JSON.stringify(manifest)}::text::jsonb, ${manifest.length},
         ${codeIndexSourceRevisionSha256(manifest)}
       FROM advanced_source
       ON CONFLICT ("source_id", "desired_commit_sha") DO UPDATE SET
         "source_sync_revision" = EXCLUDED."source_sync_revision",
         "trigger_event_id" = NULL,
         "phase" = 'manifest',
         "state" = 'queued',
         "attempt" = 0,
         "total_files" = ${manifest.length},
         "processed_files" = 0,
         "manifest" = ${JSON.stringify(manifest)}::text::jsonb,
         "source_revision_sha256" = ${codeIndexSourceRevisionSha256(manifest)},
         "activation_graph_revision_id" = NULL,
         "activation_parent_graph_revision_id" = NULL,
         "activation_generated_at" = NULL,
         "available_at" = now(),
         "claimed_at" = NULL,
         "lease_expires_at" = NULL,
         "worker_id" = NULL,
         "failure_code" = NULL,
         "finished_at" = NULL,
         "updated_at" = now()
       RETURNING "id", "organization_id", "source_id"
     ), cleared AS (
       DELETE FROM "workspace_control"."knowledge_code_index_file" file
       USING queued
       WHERE file."job_id" = queued."id"
       RETURNING file."job_id"
     ), cleared_fragments AS (
       DELETE FROM "workspace_control"."knowledge_code_index_activation_fragment" fragment
       USING queued
       WHERE fragment."job_id" = queued."id"
       RETURNING fragment."job_id"
     ), cleared_entities AS (
       DELETE FROM "workspace_control"."knowledge_code_index_activation_entity" entity
       USING queued
       WHERE entity."job_id" = queued."id"
       RETURNING entity."job_id"
     )
     SELECT queued."id"::text AS "jobId",
       head."graph_revision_id"::text AS "graphRevisionId"
     FROM queued
     LEFT JOIN "workspace_control"."knowledge_environment_head" head
       ON head."organization_id" = queued."organization_id"
      AND head."source_id" = queued."source_id"
  `);
  return result.rows[0] ?? null;
}

// Stop the code index a member started. Superseding the job is the same halt the
// claim path already applies to an outdated job: every worker write is guarded on
// `state = 'claimed'`, so a superseded job cannot advance a phase, record a file,
// or activate a revision, and its partial index rows are discarded here. The
// source returns to 'stale' so nothing re-claims it until a member syncs again.
export async function cancelGithubKnowledgeSync(input: {
  organizationId: string;
  sourceId: string;
  authority: KnowledgeMutationAuthority;
}) {
  const result = await db.execute<{ cancelled: number }>(sql`
    WITH cancelled AS MATERIALIZED (
      UPDATE "workspace_control"."knowledge_source_sync_job" job
      SET "state" = 'superseded',
        "claimed_at" = NULL,
        "lease_expires_at" = NULL,
        "worker_id" = NULL,
        "finished_at" = now(),
        "updated_at" = now()
      FROM "workspace_control"."knowledge_source" source
      WHERE source."organization_id" = job."organization_id"
        AND source."id" = job."source_id"
        AND job."organization_id" = ${input.organizationId}
        AND job."source_id" = ${input.sourceId}::uuid
        AND job."state" IN ('queued', 'claimed')
        AND source."provider" = 'github'
        AND source."revoked_at" IS NULL
        AND ${knowledgeMutationAuthoritySql(input.authority, input.organizationId)}
      RETURNING job."id"
    ), purged AS (
      DELETE FROM "workspace_control"."knowledge_code_index_file" file
      USING cancelled
      WHERE file."job_id" = cancelled."id"
      RETURNING file."job_id"
    ), purged_fragments AS (
      DELETE FROM "workspace_control"."knowledge_code_index_activation_fragment" fragment
      USING cancelled
      WHERE fragment."job_id" = cancelled."id"
      RETURNING fragment."job_id"
    ), purged_entities AS (
      DELETE FROM "workspace_control"."knowledge_code_index_activation_entity" entity
      USING cancelled
      WHERE entity."job_id" = cancelled."id"
      RETURNING entity."job_id"
    ), stalled AS (
      UPDATE "workspace_control"."knowledge_source" source
      SET "sync_state" = 'stale',
        "updated_at" = now()
      WHERE source."organization_id" = ${input.organizationId}
        AND source."id" = ${input.sourceId}::uuid
        AND source."sync_state" IN ('pending', 'syncing')
        AND EXISTS (SELECT 1 FROM cancelled)
      RETURNING source."id"
    )
    SELECT count(*)::int AS "cancelled" FROM cancelled
  `);
  return { cancelled: (result.rows[0]?.cancelled ?? 0) > 0 };
}

export async function recordGithubKnowledgePush(input: {
  organizationId: string;
  sourceId: string;
  deliveryId: string;
  beforeCommitSha: string;
  afterCommitSha: string | null;
  changedFiles: readonly string[];
}) {
  const after = input.afterCommitSha ? checkedSha(input.afterCommitSha) : null;
  const files = checkedChangedFiles(input.changedFiles);
  let manifest: Awaited<ReturnType<typeof githubKnowledgeManifest>> = [];
  let manifestReady = after === null;
  if (after) {
    const identity = await githubKnowledgeSourceIdentity(
      input.organizationId,
      input.sourceId,
      checkedSha(input.beforeCommitSha),
    );
    if (identity) {
      manifest = await githubKnowledgeManifest(identity, after);
      manifestReady = true;
    }
  }
  const rows = await neonSql.query(
    `WITH current_source AS MATERIALIZED (
       SELECT source."commit_sha", source."sync_revision"
       FROM "workspace_control"."knowledge_source" source
       WHERE source."organization_id" = $1
         AND source."id" = $2::uuid
         AND source."provider" = 'github'
         AND source."revoked_at" IS NULL
       FOR UPDATE OF source
     ), inserted_event AS MATERIALIZED (
       INSERT INTO "workspace_control"."knowledge_source_event" (
         "organization_id", "source_id", "delivery_id", "event_kind",
         "before_commit_sha", "after_commit_sha", "changed_files", "state", "consumed_at"
       )
       SELECT $1, $2::uuid, $3, 'push', $4, $5, $6::text::jsonb,
         CASE
           WHEN current_source."commit_sha" = $4 AND ($5::text IS NULL OR $10)
             THEN 'pending'
           ELSE 'failed'
         END,
         CASE
           WHEN current_source."commit_sha" = $4 AND ($5::text IS NULL OR $10)
             THEN NULL
           ELSE now()
         END
       FROM current_source
       ON CONFLICT ("delivery_id", "source_id") DO NOTHING
       RETURNING "id"
     ), advanced_source AS MATERIALIZED (
       UPDATE "workspace_control"."knowledge_source" source
       SET "commit_sha" = CASE
           WHEN current_source."commit_sha" = $4 AND ($5::text IS NULL OR $10)
             THEN COALESCE($5, source."commit_sha")
           ELSE source."commit_sha"
         END,
         "sync_state" = CASE
           WHEN current_source."commit_sha" <> $4 OR ($5::text IS NOT NULL AND NOT $10)
             THEN source."sync_state"
           WHEN $5::text IS NULL THEN 'stale'
           ELSE 'pending'
         END,
         "sync_revision" = CASE
           WHEN current_source."commit_sha" = $4 AND ($5::text IS NULL OR $10)
             THEN source."sync_revision" + 1
           ELSE source."sync_revision"
         END,
         "last_failure_code" = CASE
           WHEN current_source."commit_sha" <> $4 OR ($5::text IS NOT NULL AND NOT $10)
             THEN source."last_failure_code"
           WHEN $5::text IS NULL THEN 'tracked_ref_deleted'
           ELSE NULL
         END,
         "last_reconciled_at" = CASE
           WHEN current_source."commit_sha" <> $4 OR ($5::text IS NOT NULL AND NOT $10)
             THEN NULL
           ELSE source."last_reconciled_at"
         END,
         "updated_at" = now()
       FROM current_source CROSS JOIN inserted_event
       WHERE source."organization_id" = $1
         AND source."id" = $2::uuid
       RETURNING source."sync_revision",
         current_source."commit_sha" = $4 AND ($5::text IS NULL OR $10) AS "accepted"
     ), reset_job AS MATERIALIZED (
       SELECT job."id"
       FROM "workspace_control"."knowledge_source_sync_job" job
       CROSS JOIN advanced_source
       WHERE advanced_source."accepted"
         AND job."source_id" = $2::uuid
         AND job."desired_commit_sha" = $5
         AND (job."state" = 'superseded'
           OR job."source_sync_revision" < advanced_source."sync_revision")
     ), queued AS (
       INSERT INTO "workspace_control"."knowledge_source_sync_job" (
         "organization_id", "source_id", "desired_commit_sha",
         "source_sync_revision", "trigger_event_id", "manifest", "total_files",
         "source_revision_sha256"
       )
       SELECT $1, $2::uuid, $5, advanced_source."sync_revision", inserted_event."id",
         $7::text::jsonb, $8, $9
       FROM advanced_source CROSS JOIN inserted_event
       WHERE advanced_source."accepted" AND $5::text IS NOT NULL
       ON CONFLICT ("source_id", "desired_commit_sha") DO UPDATE SET
         "source_sync_revision" = EXCLUDED."source_sync_revision",
         "trigger_event_id" = EXCLUDED."trigger_event_id",
         "phase" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN 'manifest'
           ELSE "workspace_control"."knowledge_source_sync_job"."phase"
         END,
         "state" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN 'queued'
           ELSE "workspace_control"."knowledge_source_sync_job"."state"
         END,
         "attempt" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN 0
           ELSE "workspace_control"."knowledge_source_sync_job"."attempt"
         END,
         "total_files" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN EXCLUDED."total_files"
           ELSE "workspace_control"."knowledge_source_sync_job"."total_files"
         END,
         "processed_files" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN 0
           ELSE "workspace_control"."knowledge_source_sync_job"."processed_files"
         END,
         "manifest" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN EXCLUDED."manifest"
           ELSE "workspace_control"."knowledge_source_sync_job"."manifest"
         END,
         "source_revision_sha256" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN EXCLUDED."source_revision_sha256"
           ELSE "workspace_control"."knowledge_source_sync_job"."source_revision_sha256"
         END,
         "activation_graph_revision_id" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN NULL
           ELSE "workspace_control"."knowledge_source_sync_job"."activation_graph_revision_id"
         END,
         "activation_parent_graph_revision_id" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN NULL
           ELSE "workspace_control"."knowledge_source_sync_job"."activation_parent_graph_revision_id"
         END,
         "activation_generated_at" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN NULL
           ELSE "workspace_control"."knowledge_source_sync_job"."activation_generated_at"
         END,
         "available_at" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN now()
           ELSE "workspace_control"."knowledge_source_sync_job"."available_at"
         END,
         "claimed_at" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN NULL
           ELSE "workspace_control"."knowledge_source_sync_job"."claimed_at"
         END,
         "lease_expires_at" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN NULL
           ELSE "workspace_control"."knowledge_source_sync_job"."lease_expires_at"
         END,
         "worker_id" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN NULL
           ELSE "workspace_control"."knowledge_source_sync_job"."worker_id"
         END,
         "failure_code" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN NULL
           ELSE "workspace_control"."knowledge_source_sync_job"."failure_code"
         END,
         "finished_at" = CASE
           WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
             OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN NULL
           ELSE "workspace_control"."knowledge_source_sync_job"."finished_at"
         END,
         "updated_at" = now()
       RETURNING "id"
     ), cleared_files AS (
       DELETE FROM "workspace_control"."knowledge_code_index_file" file
       USING queued, reset_job
       WHERE file."job_id" = queued."id" AND reset_job."id" = queued."id"
       RETURNING file."job_id"
     ), cleared_fragments AS (
       DELETE FROM "workspace_control"."knowledge_code_index_activation_fragment" fragment
       USING queued, reset_job
       WHERE fragment."job_id" = queued."id" AND reset_job."id" = queued."id"
       RETURNING fragment."job_id"
     ), cleared_entities AS (
       DELETE FROM "workspace_control"."knowledge_code_index_activation_entity" entity
       USING queued, reset_job
       WHERE entity."job_id" = queued."id" AND reset_job."id" = queued."id"
       RETURNING entity."job_id"
     )
     SELECT inserted_event."id"::text AS "eventId",
       (SELECT "id"::text FROM queued) AS "jobId"
     FROM inserted_event`,
    [
      input.organizationId,
      input.sourceId,
      input.deliveryId,
      checkedSha(input.beforeCommitSha),
      after,
      JSON.stringify(files),
      JSON.stringify(manifest),
      manifest.length,
      codeIndexSourceRevisionSha256(manifest),
      manifestReady,
    ],
  ) as Array<{ eventId: string; jobId: string | null }>;
  return rows[0] ?? null;
}

// Raw-source mode advances only the exact GitHub revision. The delivery row
// makes webhook replay idempotent and the locked before-SHA prevents an older
// delivery from rolling a source back after a newer push was accepted.
export async function recordGithubSourceRevision(input: {
  organizationId: string;
  sourceId: string;
  deliveryId: string;
  beforeCommitSha: string;
  afterCommitSha: string | null;
}) {
  const before = checkedSha(input.beforeCommitSha);
  const after = input.afterCommitSha ? checkedSha(input.afterCommitSha) : null;
  const rows = await neonSql.query(
    `WITH current_source AS MATERIALIZED (
       SELECT source."commit_sha"
       FROM "workspace_control"."knowledge_source" source
       WHERE source."organization_id" = $1
         AND source."id" = $2::uuid
         AND source."provider" = 'github'
         AND source."revoked_at" IS NULL
       FOR UPDATE OF source
     ), inserted_event AS MATERIALIZED (
       INSERT INTO "workspace_control"."knowledge_source_event" (
         "organization_id", "source_id", "delivery_id", "event_kind",
         "before_commit_sha", "after_commit_sha", "changed_files", "state", "consumed_at"
       )
       SELECT $1, $2::uuid, $3, 'push', $4, $5, '[]'::jsonb,
         CASE WHEN current_source."commit_sha" = $4 THEN 'consumed' ELSE 'failed' END,
         now()
       FROM current_source
       ON CONFLICT ("delivery_id", "source_id") DO NOTHING
       RETURNING "id", "state"
     ), advanced AS (
       UPDATE "workspace_control"."knowledge_source" source
       SET "commit_sha" = COALESCE($5, source."commit_sha"),
         "sync_state" = CASE WHEN $5::text IS NULL THEN 'stale' ELSE 'ready' END,
         "sync_revision" = source."sync_revision" + 1,
         "last_failure_code" = CASE
           WHEN $5::text IS NULL THEN 'github_ref_deleted'
           ELSE NULL
         END,
         "last_reconciled_at" = CASE WHEN $5::text IS NULL THEN NULL ELSE now() END,
         "updated_at" = now()
       FROM current_source CROSS JOIN inserted_event
       WHERE source."organization_id" = $1
         AND source."id" = $2::uuid
         AND current_source."commit_sha" = $4
         AND inserted_event."state" = 'consumed'
       RETURNING source."id"
     )
     SELECT inserted_event."id"::text AS "eventId",
       EXISTS(SELECT 1 FROM advanced) AS "advanced"
     FROM inserted_event`,
    [input.organizationId, input.sourceId, input.deliveryId, before, after],
  ) as Array<{ eventId: string; advanced: boolean }>;
  return rows[0] ?? null;
}

export async function listGithubKnowledgeReconciliationCandidates(limit = 10) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Invalid GitHub reconciliation batch size");
  }
  const rows = await neonSql.query(
    `SELECT source."organization_id" AS "organizationId",
       source."id"::text AS "sourceId",
       installation."installation_id"::text AS "installationId",
       source."repository_full_name" AS "repositoryFullName",
       source."ref_name" AS "refName",
       source."commit_sha" AS "commitSha"
     FROM "workspace_control"."knowledge_source" source
     JOIN "workspace_control"."knowledge_github_installation" installation
       ON installation."organization_id" = source."organization_id"
      AND installation."id" = source."github_installation_id"
     WHERE source."provider" = 'github'
       AND source."revoked_at" IS NULL
       AND installation."status" = 'active'
       AND (
         source."last_reconciled_at" IS NULL
         OR source."last_reconciled_at" <= now() - interval '10 minutes'
       )
     ORDER BY source."last_reconciled_at" ASC NULLS FIRST, source."id"
     LIMIT $1`,
    [limit],
  ) as Array<Omit<GithubReconciliationCandidate, "installationId"> & {
    installationId: string;
  }>;
  return rows.map((row) => ({ ...row, installationId: BigInt(row.installationId) }));
}

export async function reconcileGithubKnowledgeCommit(input: {
  organizationId: string;
  sourceId: string;
  observedCommitSha: string;
}) {
  const observed = checkedSha(input.observedCommitSha);
  const deliveryId = `reconcile-${input.sourceId}-${observed}`;
  const current = await neonSql.query(
    `SELECT source."commit_sha" AS "commitSha", source."sync_state" AS "syncState",
       EXISTS (
         SELECT 1 FROM "workspace_control"."knowledge_source_sync_job" job
         WHERE job."organization_id" = source."organization_id"
           AND job."source_id" = source."id"
           AND job."desired_commit_sha" = $3
           AND job."source_sync_revision" = source."sync_revision"
           AND job."manifest" IS NOT NULL
           AND job."state" IN ('queued', 'claimed')
       ) AS "hasDurableJob"
     FROM "workspace_control"."knowledge_source" source
     WHERE source."organization_id" = $1
       AND source."id" = $2::uuid
       AND source."provider" = 'github'
       AND source."revoked_at" IS NULL`,
    [input.organizationId, input.sourceId, observed],
  );
  if (
    current[0]?.commitSha === observed
    && (current[0]?.syncState === "ready" || current[0]?.hasDurableJob === true)
  ) {
    await neonSql.query(
      `UPDATE "workspace_control"."knowledge_source"
       SET "last_reconciled_at" = now()
       WHERE "organization_id" = $1 AND "id" = $2::uuid`,
      [input.organizationId, input.sourceId],
    );
    return;
  }
  const expectedCommitSha = typeof current[0]?.commitSha === "string"
    ? checkedSha(current[0].commitSha)
    : null;
  if (!expectedCommitSha) return;
  const identity = await githubKnowledgeSourceIdentity(
    input.organizationId,
    input.sourceId,
    observed,
  ) ?? await (async () => {
    const rows = await neonSql.query(
      `SELECT installation."installation_id"::text AS "installationId",
         source."repository_full_name" AS "repositoryFullName"
       FROM "workspace_control"."knowledge_source" source
       JOIN "workspace_control"."knowledge_github_installation" installation
         ON installation."organization_id" = source."organization_id"
        AND installation."id" = source."github_installation_id"
        AND installation."status" = 'active'
       WHERE source."organization_id" = $1
         AND source."id" = $2::uuid
         AND source."provider" = 'github'
         AND source."revoked_at" IS NULL`,
      [input.organizationId, input.sourceId],
    );
    const row = rows[0];
    return typeof row?.installationId === "string"
      && /^[1-9][0-9]{0,19}$/.test(row.installationId)
      && typeof row.repositoryFullName === "string"
      ? {
        installationId: BigInt(row.installationId),
        repositoryFullName: row.repositoryFullName,
      }
      : null;
  })();
  if (!identity) return;
  const manifest = await githubKnowledgeManifest(identity, observed);
  await neonSql.query(
    `WITH current_source AS MATERIALIZED (
       SELECT source."commit_sha", source."sync_revision", source."sync_state"
       FROM "workspace_control"."knowledge_source" source
       WHERE source."organization_id" = $1
         AND source."id" = $2::uuid
       AND source."provider" = 'github'
       AND source."commit_sha" = $8
       AND source."revoked_at" IS NULL
       FOR UPDATE
     ), inserted_event AS MATERIALIZED (
       INSERT INTO "workspace_control"."knowledge_source_event" (
         "organization_id", "source_id", "delivery_id", "event_kind",
         "before_commit_sha", "after_commit_sha", "changed_files"
       )
       SELECT $1, $2::uuid, $4, 'repository', current_source."commit_sha", $3, '[]'::jsonb
       FROM current_source
       WHERE current_source."commit_sha" <> $3
       ON CONFLICT ("delivery_id", "source_id") DO NOTHING
       RETURNING "id"
     ), updated_source AS MATERIALIZED (
       UPDATE "workspace_control"."knowledge_source" source
       SET "commit_sha" = CASE
           WHEN source."commit_sha" <> $3 THEN $3
           ELSE source."commit_sha"
         END,
         "sync_state" = CASE
           WHEN source."commit_sha" <> $3 THEN 'pending'
           ELSE source."sync_state"
         END,
         "sync_revision" = CASE
           WHEN source."commit_sha" <> $3 THEN source."sync_revision" + 1
           ELSE source."sync_revision"
         END,
         "last_failure_code" = CASE
           WHEN source."commit_sha" <> $3 THEN NULL
           ELSE source."last_failure_code"
         END,
         "last_reconciled_at" = now(),
         "updated_at" = CASE
           WHEN source."commit_sha" <> $3 THEN now()
           ELSE source."updated_at"
         END
       FROM current_source
       WHERE source."organization_id" = $1
         AND source."id" = $2::uuid
       RETURNING source."sync_revision", source."sync_state"
     ), reset_job AS MATERIALIZED (
       SELECT job."id"
       FROM "workspace_control"."knowledge_source_sync_job" job
       CROSS JOIN updated_source
       WHERE job."source_id" = $2::uuid
         AND job."desired_commit_sha" = $3
         AND (job."state" = 'superseded'
           OR job."source_sync_revision" < updated_source."sync_revision")
     ), queued AS (
     INSERT INTO "workspace_control"."knowledge_source_sync_job" (
       "organization_id", "source_id", "desired_commit_sha",
       "source_sync_revision", "trigger_event_id", "manifest", "total_files",
       "source_revision_sha256"
     )
     SELECT $1, $2::uuid, $3, updated_source."sync_revision", inserted_event."id",
       $5::text::jsonb, $6, $7
     FROM updated_source
     LEFT JOIN inserted_event ON true
     WHERE updated_source."sync_state" <> 'ready'
        OR inserted_event."id" IS NOT NULL
     ON CONFLICT ("source_id", "desired_commit_sha") DO UPDATE SET
       "source_sync_revision" = GREATEST(
         "workspace_control"."knowledge_source_sync_job"."source_sync_revision",
         EXCLUDED."source_sync_revision"
       ),
       "trigger_event_id" = COALESCE(
         EXCLUDED."trigger_event_id",
         "workspace_control"."knowledge_source_sync_job"."trigger_event_id"
       ),
       "phase" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision"
           THEN 'manifest'
         ELSE "workspace_control"."knowledge_source_sync_job"."phase"
       END,
       "state" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision"
           THEN 'queued'
         ELSE "workspace_control"."knowledge_source_sync_job"."state"
       END,
       "available_at" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision"
           THEN now()
         ELSE "workspace_control"."knowledge_source_sync_job"."available_at"
       END,
       "finished_at" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision"
           THEN NULL
         ELSE "workspace_control"."knowledge_source_sync_job"."finished_at"
       END,
       "attempt" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
           < EXCLUDED."source_sync_revision" THEN 0
         ELSE "workspace_control"."knowledge_source_sync_job"."attempt"
       END,
       "total_files" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN EXCLUDED."total_files"
         ELSE "workspace_control"."knowledge_source_sync_job"."total_files"
       END,
       "processed_files" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN 0
         ELSE "workspace_control"."knowledge_source_sync_job"."processed_files"
       END,
       "manifest" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN EXCLUDED."manifest"
         ELSE "workspace_control"."knowledge_source_sync_job"."manifest"
       END,
       "source_revision_sha256" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN EXCLUDED."source_revision_sha256"
         ELSE "workspace_control"."knowledge_source_sync_job"."source_revision_sha256"
       END,
       "activation_graph_revision_id" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN NULL
         ELSE "workspace_control"."knowledge_source_sync_job"."activation_graph_revision_id"
       END,
       "activation_parent_graph_revision_id" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN NULL
         ELSE "workspace_control"."knowledge_source_sync_job"."activation_parent_graph_revision_id"
       END,
       "activation_generated_at" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
             < EXCLUDED."source_sync_revision" THEN NULL
         ELSE "workspace_control"."knowledge_source_sync_job"."activation_generated_at"
       END,
       "claimed_at" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
           < EXCLUDED."source_sync_revision" THEN NULL
         ELSE "workspace_control"."knowledge_source_sync_job"."claimed_at"
       END,
       "lease_expires_at" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
           < EXCLUDED."source_sync_revision" THEN NULL
         ELSE "workspace_control"."knowledge_source_sync_job"."lease_expires_at"
       END,
       "worker_id" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
           < EXCLUDED."source_sync_revision" THEN NULL
         ELSE "workspace_control"."knowledge_source_sync_job"."worker_id"
       END,
       "failure_code" = CASE
         WHEN "workspace_control"."knowledge_source_sync_job"."state" = 'superseded'
           OR "workspace_control"."knowledge_source_sync_job"."source_sync_revision"
           < EXCLUDED."source_sync_revision" THEN NULL
         ELSE "workspace_control"."knowledge_source_sync_job"."failure_code"
       END,
       "updated_at" = now()
     RETURNING "id"
     ), cleared_files AS (
       DELETE FROM "workspace_control"."knowledge_code_index_file" file
       USING queued, reset_job
       WHERE file."job_id" = queued."id" AND reset_job."id" = queued."id"
       RETURNING file."job_id"
     ), cleared_fragments AS (
       DELETE FROM "workspace_control"."knowledge_code_index_activation_fragment" fragment
       USING queued, reset_job
       WHERE fragment."job_id" = queued."id" AND reset_job."id" = queued."id"
       RETURNING fragment."job_id"
     ), cleared_entities AS (
       DELETE FROM "workspace_control"."knowledge_code_index_activation_entity" entity
       USING queued, reset_job
       WHERE entity."job_id" = queued."id" AND reset_job."id" = queued."id"
       RETURNING entity."job_id"
     )
     SELECT count(*)::int AS "queued" FROM queued`,
    [
      input.organizationId,
      input.sourceId,
      observed,
      deliveryId,
      JSON.stringify(manifest),
      manifest.length,
      codeIndexSourceRevisionSha256(manifest),
      expectedCommitSha,
    ],
  );
}

export async function recordGithubKnowledgeReconciliationFailure(input: {
  organizationId: string;
  sourceId: string;
  refMissing: boolean;
}) {
  await neonSql.query(
    `UPDATE "workspace_control"."knowledge_source"
     SET "last_reconciled_at" = now(),
       "sync_state" = CASE WHEN $3 THEN 'stale' ELSE "sync_state" END,
       "last_failure_code" = CASE
         WHEN $3 THEN 'tracked_ref_unavailable'
         ELSE "last_failure_code"
       END,
       "updated_at" = CASE WHEN $3 THEN now() ELSE "updated_at" END
     WHERE "organization_id" = $1
       AND "id" = $2::uuid
       AND "provider" = 'github'
       AND "revoked_at" IS NULL`,
    [input.organizationId, input.sourceId, input.refMissing],
  );
}
