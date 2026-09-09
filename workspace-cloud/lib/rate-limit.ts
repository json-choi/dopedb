//! Shared, bounded request-budget storage for public and authenticated routes.

import "server-only";

import { workspaceD1 } from "./d1/database";
import { consumeD1Budget } from "./d1/rate-limits";
import { canonicalHash } from "./workspace-versioning";

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1_000;

export function forwardedClientKey(headers: Pick<Headers, "get">) {
  // Workers supplies this header at the edge. Forwarded chains can contain
  // caller-supplied prefixes; never let them select a fresh rate-limit bucket.
  const forwarded = headers.get("cf-connecting-ip")?.trim() || "unknown";
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
  // oldest-first batch inside this same already-active atomic database batch so
  // rate-limit hygiene never needs an idle background wake-up.
  const windowStartedAt = Math.floor(now / windowMs) * windowMs;
  const key = `${input.namespace}:${input.discriminator}:${windowStartedAt}`;
  const cutoff = now - retentionMs;
  return consumeD1Budget(workspaceD1(), {
    id: crypto.randomUUID(), key, now, cutoff, cost, limit: input.limit,
  });
}
