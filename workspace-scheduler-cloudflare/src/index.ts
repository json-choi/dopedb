const CONTRACT_VERSION = "2";
const MAX_KICK_BODY_BYTES = 1_024;
const MAX_UPSTREAM_BODY_BYTES = 16 * 1_024;
const MAX_NOT_BEFORE_MS = 366 * 24 * 60 * 60_000;
const PAST_SKEW_MS = 5 * 60_000;
const LEASE_MS = 90_000;
const UPSTREAM_TIMEOUT_MS = 55_000;
const MIN_RETRY_MS = 60_000;
const MAX_RETRY_MS = 15 * 60_000;
const CIRCUIT_BREAKER_FAILURES = 5;
const CIRCUIT_BREAKER_RETRY_MS = 6 * 60 * 60_000;
const DORMANT_DUE_AT_MS = Date.UTC(3000, 0, 1);
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

const TASKS = {
  credential: "/api/internal/cron/credential-leases",
  maintenance: "/api/internal/cron/maintenance",
} as const;

type Task = keyof typeof TASKS;
type D1Result = { meta: { changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
};
type D1Database = { prepare(query: string): D1Statement };
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type Env = {
  SCHEDULER_DB: D1Database;
  KICK_TOKEN: string;
  WORKSPACE_CRON_SECRET: string;
  WORKSPACE_ORIGIN: string;
};

type ClaimedTask = {
  task: Task;
  generation: number;
  failure_count: number;
  lease_token: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validCapability(value: string) {
  return /^[0-9a-f]{64}$/.test(value);
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function validRfc3339(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return null;
  const match = RFC3339.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 || month > 12 || day < 1 || day > days[month - 1]!
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59
  ) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

async function boundedJson(request: Request, maxBytes: number): Promise<unknown | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    await request.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - total) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      total += value.byteLength;
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
}

async function boundedResponseJson(response: Response): Promise<unknown | null> {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_UPSTREAM_BODY_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > MAX_UPSTREAM_BODY_BYTES - total) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      total += value.byteLength;
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
}

async function sameSecret(candidate: string, expected: string) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

function response(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export function parseKick(value: unknown, nowMs = Date.now()) {
  if (!exact(value, ["task", "notBefore"])) return null;
  if (typeof value.task !== "string" || !Object.hasOwn(TASKS, value.task)) return null;
  const dueAtMs = validRfc3339(value.notBefore);
  if (
    dueAtMs === null
    || dueAtMs < nowMs - PAST_SKEW_MS
    || dueAtMs > nowMs + MAX_NOT_BEFORE_MS
  ) return null;
  return { task: value.task as Task, dueAtMs: Math.max(dueAtMs, nowMs) };
}

export function parseSchedulerReceipt(value: unknown, nowMs = Date.now()) {
  if (!record(value) || !exact(value.scheduler, ["contractVersion", "nextRunAt"])) return null;
  if (value.scheduler.contractVersion !== 2) return null;
  if (value.scheduler.nextRunAt === null) return DORMANT_DUE_AT_MS;
  const nextRunAtMs = validRfc3339(value.scheduler.nextRunAt);
  if (
    nextRunAtMs === null
    || nextRunAtMs < nowMs - PAST_SKEW_MS
    || nextRunAtMs > nowMs + MAX_NOT_BEFORE_MS
  ) return null;
  return Math.max(nextRunAtMs, nowMs + MIN_RETRY_MS);
}

function workspaceOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.hostname !== "app.dopedb.dev"
    || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash
  ) throw new Error("invalid workspace origin");
  return url.origin;
}

async function kick(request: Request, env: Env) {
  const candidate = request.headers.get("x-dopedb-background-token") ?? "";
  if (
    !validCapability(candidate)
    || !validCapability(env.KICK_TOKEN)
    || !await sameSecret(candidate, env.KICK_TOKEN)
  ) {
    return response({ accepted: false }, 401);
  }
  if (request.headers.get("x-dopedb-background-scheduler-contract") !== CONTRACT_VERSION) {
    return response({ accepted: false }, 400);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return response({ accepted: false }, 415);
  }
  const parsed = parseKick(await boundedJson(request, MAX_KICK_BODY_BYTES));
  if (!parsed) return response({ accepted: false }, 400);
  try {
    await env.SCHEDULER_DB.prepare(`
      INSERT INTO workspace_background_task_v1 (
        task, due_at_ms, lease_until_ms, lease_token, generation,
        failure_count, last_error_kind, updated_at_ms
      ) VALUES (?, ?, 0, NULL, 1, 0, NULL, ?)
      ON CONFLICT(task) DO UPDATE SET
        due_at_ms = min(workspace_background_task_v1.due_at_ms, excluded.due_at_ms),
        generation = workspace_background_task_v1.generation + 1,
        failure_count = 0,
        last_error_kind = NULL,
        updated_at_ms = excluded.updated_at_ms
    `).bind(parsed.task, parsed.dueAtMs, Date.now()).run();
    return response({ accepted: true }, 202);
  } catch {
    return response({ accepted: false }, 503);
  }
}

async function claimTask(env: Env, task: Task, nowMs: number): Promise<ClaimedTask | null> {
  const leaseToken = crypto.randomUUID();
  return env.SCHEDULER_DB.prepare(`
    UPDATE workspace_background_task_v1
    SET lease_until_ms = ?, lease_token = ?, generation = generation + 1,
      updated_at_ms = ?
    WHERE task = ? AND due_at_ms <= ? AND lease_until_ms <= ?
    RETURNING task, generation, failure_count, lease_token
  `).bind(nowMs + LEASE_MS, leaseToken, nowMs, task, nowMs, nowMs).first<ClaimedTask>();
}

function retryDelay(failureCount: number) {
  if (failureCount >= CIRCUIT_BREAKER_FAILURES) return CIRCUIT_BREAKER_RETRY_MS;
  return Math.min(
    MIN_RETRY_MS * (2 ** Math.max(failureCount - 1, 0)),
    MAX_RETRY_MS,
  );
}

function transportDiagnostic(error: unknown, aborted: boolean) {
  if (aborted) return "timeout";
  if (!(error instanceof Error)) return "unknown";
  const message = error.message.toLowerCase();
  if (message.includes("redirect")) return "redirect";
  if (message.includes("capability configuration")) return "invalid_configuration";
  if (message.includes("not implemented") || message.includes("unsupported")) return "unsupported";
  if (message.includes("disallow") || message.includes("forbidden")) return "disallowed";
  if (message.includes("fetch failed") || message.includes("network")) return "network";
  return error.name === "TypeError" ? "type_error" : "unknown";
}

function redirectDiagnostic(response: Response, expectedUrl: URL) {
  const location = response.headers.get("location");
  if (!location) return "redirect_missing_location";
  try {
    const target = new URL(location, expectedUrl);
    if (target.origin !== expectedUrl.origin) return "redirect_cross_origin";
    if (target.pathname === expectedUrl.pathname) return "redirect_canonical";
    if (target.pathname === "/settings") return "redirect_settings";
    if (target.pathname.startsWith("/auth/")) return "redirect_auth";
    return "redirect_same_origin";
  } catch {
    return "redirect_invalid_location";
  }
}

async function finishTask(
  env: Env,
  claim: ClaimedTask,
  nextRunAtMs: number,
  errorKind: "transport" | "response" | "receipt" | "storage" | null,
) {
  const nowMs = Date.now();
  const failed = errorKind !== null;
  const result = await env.SCHEDULER_DB.prepare(`
    UPDATE workspace_background_task_v1
    SET due_at_ms = ?, lease_until_ms = 0, lease_token = NULL,
      failure_count = ?, last_error_kind = ?, updated_at_ms = ?
    WHERE task = ? AND generation = ? AND lease_token = ?
  `).bind(
    nextRunAtMs,
    failed ? Math.min(claim.failure_count + 1, 20) : 0,
    errorKind,
    nowMs,
    claim.task,
    claim.generation,
    claim.lease_token,
  ).run();
  if ((result.meta.changes ?? 0) === 0) {
    // A concurrent kick advanced generation and owns the earlier due_at. Only
    // release this exact lease; never overwrite the producer's wake-up.
    await env.SCHEDULER_DB.prepare(`
      UPDATE workspace_background_task_v1
      SET lease_until_ms = 0, lease_token = NULL, updated_at_ms = ?
      WHERE task = ? AND lease_token = ?
    `).bind(nowMs, claim.task, claim.lease_token).run();
  }
}

async function executeTask(env: Env, task: Task, nowMs: number) {
  let claim: ClaimedTask | null;
  try {
    claim = await claimTask(env, task, nowMs);
  } catch {
    console.error(JSON.stringify({ kind: "background_task_failed", task, errorKind: "storage" }));
    return;
  }
  if (!claim) return;
  let errorKind: "transport" | "response" | "receipt" | null = null;
  let nextRunAtMs = nowMs + retryDelay(claim.failure_count + 1);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let transportKind: string | null = null;
  try {
    if (!validCapability(env.WORKSPACE_CRON_SECRET)) {
      throw new Error("invalid scheduler capability configuration");
    }
    const expectedUrl = new URL(TASKS[task], workspaceOrigin(env.WORKSPACE_ORIGIN));
    const upstream = await fetch(expectedUrl, {
      method: "GET",
      headers: {
        authorization: `Bearer ${env.WORKSPACE_CRON_SECRET}`,
        "x-dopedb-background-scheduler-contract": CONTRACT_VERSION,
      },
      // Never follow a response carrying the cron bearer. Cloudflare recommends
      // manual handling because followed redirects forward sensitive headers.
      redirect: "manual",
      signal: controller.signal,
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      errorKind = "response";
      transportKind = redirectDiagnostic(upstream, expectedUrl);
      await upstream.body?.cancel().catch(() => undefined);
    }
    const hasContract = upstream.headers.get("x-dopedb-background-scheduler-contract")
      === CONTRACT_VERSION;
    const allowedStatus = upstream.status === 200 || upstream.status === 503;
    let value: unknown | null = null;
    if (!errorKind && hasContract && allowedStatus) {
      value = await boundedResponseJson(upstream);
    } else if (!errorKind) {
      await upstream.body?.cancel().catch(() => undefined);
    }
    const receipt = parseSchedulerReceipt(value, Date.now());
    if (!errorKind) {
      if (receipt === null) errorKind = upstream.ok ? "receipt" : "response";
      else nextRunAtMs = receipt;
    }
  } catch (error) {
    errorKind = "transport";
    transportKind = transportDiagnostic(error, controller.signal.aborted);
  } finally {
    clearTimeout(timeout);
  }
  try {
    await finishTask(env, claim, nextRunAtMs, errorKind);
  } catch {
    console.error(JSON.stringify({ kind: "background_task_failed", task, errorKind: "storage" }));
    return;
  }
  if (errorKind) {
    console.error(JSON.stringify({
      kind: "background_task_failed",
      task,
      errorKind,
      ...(transportKind ? { transportKind } : {}),
    }));
  }
}

async function runDueTasks(env: Env, nowMs = Date.now()) {
  for (const task of Object.keys(TASKS) as Task[]) {
    await executeTask(env, task, nowMs);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }
    if (request.method === "POST" && url.pathname === "/v1/kick") {
      return kick(request, env);
    }
    return response({ accepted: false }, 404);
  },
  scheduled(_controller: unknown, env: Env, context: ExecutionContext) {
    context.waitUntil(runDueTasks(env));
  },
};

export const __test = { executeTask, runDueTasks };
