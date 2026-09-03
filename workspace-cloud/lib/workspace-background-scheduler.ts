//! Event-driven wake-up boundary for durable workspace background work.

import "server-only";

import { boundedJsonResponse } from "./bounded-json-response";
import { neonSql } from "./db";
import { env } from "./env";

const CONTRACT_VERSION = "2";
const KICK_TIMEOUT_MS = 5_000;
const MAX_KICK_RESPONSE_BYTES = 1_024;
const MIN_WAKE_DELAY_MS = 60_000;
const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60_000;

export type WorkspaceBackgroundTask = "credential" | "maintenance";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function acceptedKick(value: unknown) {
  return record(value)
    && Object.keys(value).length === 1
    && value.accepted === true;
}

function checkedNotBefore(value: Date) {
  const now = Date.now();
  const epoch = value.valueOf();
  if (!Number.isFinite(epoch) || epoch < now - MIN_WAKE_DELAY_MS || epoch > now + MAX_SCHEDULE_AHEAD_MS) {
    throw new Error("Invalid workspace background wake time");
  }
  return value.toISOString();
}

/**
 * Producer wake-up. PostgreSQL remains the durable work authority while D1
 * stores only the earliest task-level due time. Provider-enforced lease expiry
 * is independent of this best-effort wake-up, and active requests repair missed
 * credential cleanup without reintroducing an idle polling loop.
 */
export async function kickWorkspaceBackgroundTask(input: {
  task: WorkspaceBackgroundTask;
  notBefore?: Date;
}) {
  try {
    if (!env.workspaceBackgroundSchedulerEnabled()) return false;
    const url = env.workspaceBackgroundSchedulerUrl();
    const token = env.workspaceBackgroundSchedulerToken();
    if (!url || !token) return false;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dopedb-background-scheduler-contract": CONTRACT_VERSION,
        "x-dopedb-background-token": token,
      },
      body: JSON.stringify({
        task: input.task,
        notBefore: checkedNotBefore(input.notBefore ?? new Date()),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
    });
    const body = await boundedJsonResponse(response, MAX_KICK_RESPONSE_BYTES)
      .catch(() => null);
    return response.status === 202 && acceptedKick(body);
  } catch {
    return false;
  }
}

export function workspaceSchedulerBoundedWakeAt(candidate: unknown, now = new Date()) {
  if (candidate === null || candidate === undefined) return null;
  const parsed = candidate instanceof Date
    ? candidate
    : typeof candidate === "string" || typeof candidate === "number"
      ? new Date(candidate)
      : null;
  const epoch = parsed?.valueOf();
  if (epoch === undefined || !Number.isFinite(epoch)) {
    throw new Error("Invalid workspace background due time");
  }
  return new Date(Math.min(
    Math.max(epoch, now.getTime() + MIN_WAKE_DELAY_MS),
    now.getTime() + MAX_SCHEDULE_AHEAD_MS,
  ));
}

export async function nextCredentialBackgroundRunAt() {
  const rows = await neonSql.query(
    `SELECT min(CASE
       WHEN lease."cleanup_claimed_at" IS NOT NULL
         AND lease."cleanup_claimed_at" > now() - interval '2 minutes'
         THEN lease."cleanup_claimed_at" + interval '2 minutes'
       ELSE COALESCE(lease."cleanup_next_attempt_at", lease."expires_at")
     END) AS "nextRunAt"
     FROM "workspace_control"."workspace_credential_lease" lease
     WHERE lease."revoked_at" IS NULL`,
  );
  return workspaceSchedulerBoundedWakeAt(rows[0]?.nextRunAt);
}

export async function nextMaintenanceBackgroundRunAt() {
  const rows = await neonSql.query(
    `SELECT min(due."nextRunAt") AS "nextRunAt"
     FROM (
       SELECT receipt."expires_at"
       FROM "workspace_control"."workspace_provider_discovery_receipt" receipt
       WHERE receipt."consumed_at" IS NULL
       UNION ALL
       SELECT receipt."consumed_at" + interval '10 minutes'
       FROM "workspace_control"."workspace_provider_discovery_receipt" receipt
       WHERE receipt."consumed_at" IS NOT NULL
       UNION ALL
       SELECT backup."purge_after"
       FROM "workspace_control"."workspace_metadata_backup" backup
       WHERE backup."deleted_at" IS NOT NULL
       UNION ALL
       SELECT profile."purge_after"
       FROM "workspace_control"."workspace_profile" profile
       WHERE profile."lifecycle_state" = 'deletion_pending'
     ) due`,
  );
  return workspaceSchedulerBoundedWakeAt(rows[0]?.nextRunAt);
}

export function workspaceSchedulerRequest(request: Request) {
  return request.headers.get("x-dopedb-background-scheduler-contract") === CONTRACT_VERSION;
}

export function workspaceSchedulerReceipt(nextRunAt: Date | null) {
  return {
    contractVersion: 2 as const,
    nextRunAt: nextRunAt?.toISOString() ?? null,
  };
}

export function workspaceSchedulerResponseHeaders() {
  return { "x-dopedb-background-scheduler-contract": CONTRACT_VERSION };
}
