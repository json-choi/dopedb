// Exact-commit GitHub source revision updates. Webhook deliveries advance only
// the pinned commit; graph construction is intentionally outside this path.
import "server-only";

import { neonSql } from "../db";

const SHA1 = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SOURCE_REVISION_BATCH = 10_000;

type GithubSourceRevisionInput = {
  organizationId: string;
  sourceId: string;
  deliveryId: string;
  beforeCommitSha: string;
  afterCommitSha: string | null;
};

function checkedSha(value: string) {
  if (!SHA1.test(value)) throw new Error("Invalid GitHub commit identity");
  return value;
}

// The delivery row makes webhook replay idempotent and the locked before-SHA
// prevents an older delivery from rolling a source back after a newer push.
export async function recordGithubSourceRevisions(
  inputs: readonly GithubSourceRevisionInput[],
) {
  if (inputs.length > MAX_SOURCE_REVISION_BATCH) {
    throw new Error("Too many GitHub source revisions");
  }
  const requested = new Map<string, GithubSourceRevisionInput>();
  for (const input of inputs) {
    if (!UUID.test(input.organizationId) || !UUID.test(input.sourceId)) {
      throw new Error("Invalid GitHub source scope");
    }
    if (!/^[A-Za-z0-9-]{1,128}$/.test(input.deliveryId)) {
      throw new Error("Invalid GitHub delivery identity");
    }
    requested.set(`${input.organizationId}:${input.sourceId}`, {
      ...input,
      beforeCommitSha: checkedSha(input.beforeCommitSha),
      afterCommitSha: input.afterCommitSha ? checkedSha(input.afterCommitSha) : null,
    });
  }
  if (requested.size === 0) return [];
  return await neonSql.query(
    `WITH requested AS MATERIALIZED (
       SELECT *
       FROM jsonb_to_recordset($1::text::jsonb) AS item(
         "organizationId" text, "sourceId" text, "deliveryId" text,
         "beforeCommitSha" text, "afterCommitSha" text
       )
     ), current_source AS MATERIALIZED (
       SELECT source."organization_id", source."id", source."commit_sha",
         requested."deliveryId", requested."beforeCommitSha", requested."afterCommitSha"
       FROM requested
       JOIN "workspace_control"."knowledge_source" source
         ON source."organization_id" = requested."organizationId"
        AND source."id" = requested."sourceId"::uuid
       WHERE source."provider" = 'github'
         AND source."revoked_at" IS NULL
       ORDER BY source."organization_id", source."id"
       FOR UPDATE OF source
     ), inserted_event AS MATERIALIZED (
       INSERT INTO "workspace_control"."knowledge_source_event" (
         "organization_id", "source_id", "delivery_id", "event_kind",
         "before_commit_sha", "after_commit_sha", "changed_files", "state", "consumed_at"
       )
       SELECT current_source."organization_id", current_source."id",
         current_source."deliveryId", 'push', current_source."beforeCommitSha",
         current_source."afterCommitSha", '[]'::jsonb,
         CASE WHEN current_source."commit_sha" = current_source."beforeCommitSha"
           THEN 'consumed' ELSE 'failed' END,
         now()
       FROM current_source
       ON CONFLICT ("delivery_id", "source_id") DO NOTHING
       RETURNING "organization_id", "source_id", "id", "state"
     ), advanced AS (
       UPDATE "workspace_control"."knowledge_source" source
       SET "commit_sha" = COALESCE(current_source."afterCommitSha", source."commit_sha"),
         "sync_state" = CASE WHEN current_source."afterCommitSha" IS NULL
           THEN 'stale' ELSE 'ready' END,
         "sync_revision" = source."sync_revision" + 1,
         "last_failure_code" = CASE
           WHEN current_source."afterCommitSha" IS NULL THEN 'github_ref_deleted'
           ELSE NULL
         END,
         "last_reconciled_at" = CASE WHEN current_source."afterCommitSha" IS NULL
           THEN NULL ELSE now() END,
         "updated_at" = now()
       FROM current_source
       JOIN inserted_event
         ON inserted_event."organization_id" = current_source."organization_id"
        AND inserted_event."source_id" = current_source."id"
       WHERE source."organization_id" = current_source."organization_id"
         AND source."id" = current_source."id"
         AND current_source."commit_sha" = current_source."beforeCommitSha"
         AND inserted_event."state" = 'consumed'
       RETURNING source."organization_id", source."id"
     )
     SELECT inserted_event."id"::text AS "eventId",
       inserted_event."source_id"::text AS "sourceId",
       EXISTS(
         SELECT 1 FROM advanced
         WHERE advanced."organization_id" = inserted_event."organization_id"
           AND advanced."id" = inserted_event."source_id"
       ) AS "advanced"
     FROM inserted_event`,
    [JSON.stringify([...requested.values()])],
  ) as Array<{ eventId: string; sourceId: string; advanced: boolean }>;
}
