//! Shared, bounded request-budget storage for public and authenticated routes.

import "server-only";

import { sql } from "drizzle-orm";

import { db } from "./db";
import { rateLimit } from "./schema";
import { canonicalHash } from "./workspace-versioning";

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1_000;
const OPPORTUNISTIC_CLEANUP_ROWS = 16;

export function forwardedClientKey(headers: Pick<Headers, "get">) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || headers.get("x-real-ip")?.trim()
    || "unknown";
  return canonicalHash({ forwarded });
}

export async function consumeRateLimit(input: {
  namespace: string;
  discriminator: string;
  limit: number;
  cost?: number;
  windowMs?: number;
  retentionMs?: number;
}) {
  const now = Date.now();
  const windowMs = input.windowMs ?? 60_000;
  const retentionMs = input.retentionMs ?? DEFAULT_RETENTION_MS;
  const cost = input.cost ?? 1;
  if (
    !/^[a-z][a-z0-9-]{1,63}$/.test(input.namespace)
    || !input.discriminator
    || !Number.isSafeInteger(input.limit)
    || input.limit < 1
    || !Number.isSafeInteger(cost)
    || cost < 1
    || cost > input.limit
    || !Number.isSafeInteger(windowMs)
    || windowMs < 1_000
    || !Number.isSafeInteger(retentionMs)
    || retentionMs < windowMs
  ) {
    throw new Error("Invalid rate-limit boundary");
  }
  // A fixed-window bucket must encode the window itself. Reusing one row while
  // moving `last_request` on every hit turns low steady traffic into an eternal
  // lockout because the reset condition is never reached. Reclaim a tiny,
  // oldest-first batch inside this same already-active database statement so
  // rate-limit hygiene never needs an idle background wake-up.
  const windowStartedAt = Math.floor(now / windowMs) * windowMs;
  const key = `${input.namespace}:${input.discriminator}:${windowStartedAt}`;
  const cutoff = now - retentionMs;
  const result = await db.execute<{ value: number }>(sql`
    WITH expired AS MATERIALIZED (
      SELECT ${rateLimit.id}
      FROM ${rateLimit}
      WHERE ${rateLimit.lastRequest} < ${cutoff}
      ORDER BY ${rateLimit.lastRequest} ASC, ${rateLimit.id} ASC
      LIMIT ${OPPORTUNISTIC_CLEANUP_ROWS}
      FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM ${rateLimit}
      USING expired
      WHERE ${rateLimit.id} = expired."id"
    ), consumed AS (
      INSERT INTO ${rateLimit} ("id", "key", "count", "last_request")
      VALUES (${crypto.randomUUID()}, ${key}, ${cost}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = ${rateLimit.count} + ${cost},
        "last_request" = ${now}
      RETURNING "count" AS "value"
    )
    SELECT "value" FROM consumed
  `);
  return Number(result.rows[0]?.value ?? Number.POSITIVE_INFINITY) <= input.limit;
}
