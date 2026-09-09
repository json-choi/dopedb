// Exact-commit GitHub source revision updates. Webhook deliveries advance only
// the pinned commit; graph construction is intentionally outside this path.
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { batchD1 } from "../d1/database";
import { utcNow } from "../d1/schema/values";

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

// The delivery row makes webhook replay idempotent and the batch-validated before-SHA
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
  const entries = [...requested.values()];
  const result: Array<{ eventId: string; sourceId: string; advanced: boolean }> = [];
  // Each source is independent. Bounded batches stay below D1 payload limits;
  // delivery IDs make retry after a partially completed webhook idempotent.
  for (let offset = 0; offset < entries.length; offset += 256) {
    const batch = JSON.stringify(entries.slice(offset, offset + 256).map((entry) => ({
      ...entry, organizationId: entry.organizationId.toLowerCase(), sourceId: entry.sourceId.toLowerCase(),
      eventId: randomUUID(),
    })));
    const inputs = sql`SELECT value ->> 'organizationId' AS organization_id,
      value ->> 'sourceId' AS source_id, value ->> 'deliveryId' AS delivery_id,
      value ->> 'beforeCommitSha' AS before_sha, value ->> 'afterCommitSha' AS after_sha,
      value ->> 'eventId' AS event_id FROM json_each(${batch})`;
    const rows = await batchD1([
      sql`INSERT INTO knowledge_source_event (id, organization_id, source_id, delivery_id, event_kind,
          before_commit_sha, after_commit_sha, changed_files, state, consumed_at)
        SELECT requested.event_id, source.organization_id, source.id, requested.delivery_id, 'push',
          requested.before_sha, requested.after_sha, '[]',
          CASE WHEN source.commit_sha = requested.before_sha THEN 'consumed' ELSE 'failed' END, ${utcNow}
        FROM (${inputs}) requested JOIN knowledge_source source
          ON source.organization_id = requested.organization_id AND source.id = requested.source_id
        WHERE source.provider = 'github' AND source.revoked_at IS NULL
        ON CONFLICT (delivery_id, source_id) DO NOTHING`,
      sql`UPDATE knowledge_source AS source SET
          commit_sha = COALESCE(requested.after_sha, source.commit_sha),
          sync_state = CASE WHEN requested.after_sha IS NULL THEN 'stale' ELSE 'ready' END,
          sync_revision = source.sync_revision + 1,
          last_failure_code = CASE WHEN requested.after_sha IS NULL THEN 'github_ref_deleted' ELSE NULL END,
          last_reconciled_at = CASE WHEN requested.after_sha IS NULL THEN NULL ELSE ${utcNow} END,
          updated_at = ${utcNow}
        FROM (${inputs}) requested JOIN knowledge_source_event event ON event.id = requested.event_id
        WHERE source.id = requested.source_id AND source.organization_id = requested.organization_id
          AND source.commit_sha = requested.before_sha AND event.state = 'consumed'`,
      sql`SELECT event.id AS eventId, event.source_id AS sourceId, event.state = 'consumed' AS advanced
        FROM knowledge_source_event event JOIN (${inputs}) requested ON event.id = requested.event_id`,
    ]);
    for (const row of rows[2]) result.push({ eventId: String(row.eventId), sourceId: String(row.sourceId), advanced: row.advanced === 1 });
  }
  return result;
}
