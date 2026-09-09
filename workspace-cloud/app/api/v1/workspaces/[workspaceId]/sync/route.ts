// Ordered, payload-free workspace change cursor. The response only selects which
// authoritative collections need reconciliation; collection routes independently
// recheck the live member and per-connection grants before returning any resource.
import { sql } from "drizzle-orm";

import { workspaceSyncPage } from "../../../../../../lib/control-plane-contracts";
import { db } from "../../../../../../lib/db";
import { isUuid, jsonError, privateJson } from "../../../../../../lib/http";
import { authorizeWorkspace } from "../../../../../../lib/workspace-authorization";

type RouteContext = { params: Promise<{ workspaceId: string }> };

type RawSyncEvent = Readonly<{
  head: number | string;
  sequence: number | string | null;
  resourceType: string | null;
  tombstone: number | null;
}>;

const PAGE_LIMIT = 128;
const MAX_INCREMENTAL_EVENTS = PAGE_LIMIT * 8;
const MAX_SAFE_CURSOR = 9_007_199_254_740_991;

function safeCursor(value: unknown, allowZero = true) {
  const cursor = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(cursor) && (allowZero ? cursor >= 0 : cursor >= 1)
    ? cursor
    : null;
}

function requestedCursor(request: Request) {
  const value = new URL(request.url).searchParams.get("cursor");
  if (value === null) return { cursor: null } as const;
  if (!/^(0|[1-9][0-9]{0,15})$/.test(value)) return { error: true } as const;
  const cursor = safeCursor(value);
  if (cursor === null || cursor > MAX_SAFE_CURSOR) return { error: true } as const;
  return { cursor } as const;
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const parsed = requestedCursor(request);
  if ("error" in parsed) return jsonError("Invalid workspace sync cursor", 400);

  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);

  const cursor = parsed.cursor;
  const result = await db.execute<RawSyncEvent>(sql`
    WITH head AS MATERIALIZED (
      SELECT COALESCE((
        SELECT "last_sequence"
        FROM "workspace_sync_head"
        WHERE "organization_id" = ${workspaceId}
      ), 0) AS "value"
    ), page AS MATERIALIZED (
      SELECT event."sequence", event."resource_type", event."tombstone"
      FROM "workspace_sync_event" event
      JOIN head ON TRUE
      WHERE ${cursor} IS NOT NULL
        AND ${cursor} <= head."value"
        AND event."organization_id" = ${workspaceId}
        AND event."sequence" > ${cursor}
        AND event."sequence" <= head."value"
      ORDER BY event."sequence" ASC
      LIMIT ${PAGE_LIMIT}
    )
    SELECT head."value" AS "head",
      page."sequence" AS "sequence",
      page."resource_type" AS "resourceType",
      page."tombstone" AS "tombstone"
    FROM head
    LEFT JOIN page ON TRUE
    ORDER BY page."sequence" ASC NULLS LAST
  `);
  const head = safeCursor(result.rows[0]?.head);
  if (head === null) throw new Error("Invalid workspace sync head");

  // A restored server can move the head behind a desktop cursor. A long-offline
  // desktop can also be far enough behind that replaying every category marker is
  // wasteful. Both cases rebase through one full authorized collection snapshot.
  const reset = cursor !== null && (
    cursor > head || head - cursor > MAX_INCREMENTAL_EVENTS
  );
  const bootstrap = cursor === null || reset;
  let nextCursor = bootstrap ? head : cursor;
  let refreshConnections = bootstrap;
  let refreshAnalyses = bootstrap;
  let connectionTombstone = false;
  let analysisTombstone = false;

  if (!bootstrap) {
    for (const row of result.rows) {
      if (row.sequence === null) continue;
      const sequence = safeCursor(row.sequence, false);
      if (sequence === null || sequence <= nextCursor || sequence > head) {
        throw new Error("Invalid ordered workspace sync event");
      }
      nextCursor = sequence;
      if (row.resourceType === "connection") {
        refreshConnections = true;
        refreshAnalyses = true;
        connectionTombstone ||= row.tombstone === 1;
      } else if (row.resourceType === "analysis_article") {
        refreshAnalyses = true;
        analysisTombstone ||= row.tombstone === 1;
      } else {
        // Membership, workspace, and provider authority changes can narrow any
        // projection. Reconcile all secret-free collections rather than guessing.
        refreshConnections = true;
        refreshAnalyses = true;
      }
    }
  }

  return privateJson(workspaceSyncPage({
    workspaceId,
    previousCursor: cursor,
    nextCursor,
    hasMore: nextCursor < head,
    reset,
    refresh: {
      connections: refreshConnections,
      analyses: refreshAnalyses,
    },
    tombstones: {
      connections: connectionTombstone,
      analyses: analysisTombstone,
    },
  }));
}
