const MAX_BODY_BYTES = 32 * 1024;
const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const RAW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
const INGEST_BUDGET_WINDOW_MS = 60_000;
const INGEST_BUDGET_EVENTS = 16;
const MAX_DELETE_ROWS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64 = /^[0-9a-f]{64}$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

type D1Result = { meta?: { changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};
type D1Database = {
  prepare(query: string): D1Statement;
  batch<T = D1Result>(statements: D1Statement[]): Promise<T[]>;
};

type Env = {
  ANALYTICS_DB: D1Database;
  INGEST_TOKEN: string;
};

type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };

type PropertyRule = readonly (string | boolean)[] | "boolean";
type EventRule = {
  properties: Readonly<Record<string, PropertyRule>>;
  identity: "installation" | "authentication" | "workspace" | "team";
};

const EVENTS = {
  desktop_installation_ready: { properties: {}, identity: "installation" },
  workspace_authentication_completed: {
    properties: { outcome: ["success", "denied", "expired", "failed"] },
    identity: "authentication",
  },
  workspace_scope_ready: { properties: {}, identity: "workspace" },
  knowledge_environment_created: {
    properties: { creationKind: ["project_default", "additional"] },
    identity: "workspace",
  },
  connection_verification_completed: {
    properties: {
      outcome: ["success", "failed"],
      engine: ["postgres", "mysql", "sqlite", "mongodb"],
      credentialMode: ["local", "managed", "none"],
      ssh: "boolean",
    },
    identity: "workspace",
  },
  environment_connection_bound: {
    properties: {
      accessMode: ["local", "managed"],
      engine: ["postgres", "mysql", "sqlite", "mongodb"],
    },
    identity: "workspace",
  },
  query_execution_completed: {
    properties: {
      outcome: ["success", "failed", "cancelled", "unknown"],
      statementClass: ["select", "explain", "show", "other_read", "write", "script"],
      rowCountBucket: ["zero", "one", "2_10", "11_100", "101_1000", "over_1000", "unknown"],
      durationBucket: ["under_100ms", "100ms_1s", "1s_10s", "10s_60s", "over_60s", "unknown"],
      approvalRequired: "boolean",
    },
    identity: "workspace",
  },
  knowledge_source_sync_completed: {
    properties: {
      outcome: ["success", "failed"],
      sourceKind: ["github", "local_folder"],
      syncReason: ["initial", "manual"],
    },
    identity: "workspace",
  },
  agent_session_initialization_completed: {
    properties: { outcome: ["success", "failed"], provider: ["claude", "codex"] },
    identity: "workspace",
  },
  agent_turn_completed: {
    properties: {
      outcome: ["success", "failed", "cancelled"],
      provider: ["claude", "codex"],
      durationBucket: ["under_100ms", "100ms_1s", "1s_10s", "10s_60s", "over_60s", "unknown"],
    },
    identity: "workspace",
  },
  analysis_article_run_completed: {
    properties: {
      outcome: ["success", "failed", "cancelled", "stale"],
      trigger: ["manual"],
      durationBucket: ["under_100ms", "100ms_1s", "1s_10s", "10s_60s", "over_60s", "unknown"],
    },
    identity: "workspace",
  },
  workspace_membership_ready: {
    properties: { role: ["viewer", "analyst", "editor", "admin", "owner"] },
    identity: "team",
  },
  shared_connection_access_ready: {
    properties: {
      accessMode: ["local", "managed"],
      engine: ["postgres", "mysql", "sqlite", "mongodb"],
    },
    identity: "workspace",
  },
} as const satisfies Record<string, EventRule>;

type EventName = keyof typeof EVENTS;
type Event = {
  eventId: string;
  name: EventName;
  occurredAt: string;
  actorKey?: string;
  workspaceKey?: string;
  workspaceKind?: "personal" | "team";
  properties: Record<string, string | boolean>;
};
type Envelope = {
  schemaVersion: 1;
  installationId: string;
  sessionId: string;
  appVersion: string;
  platform: "macos" | "windows" | "linux" | "unknown";
  locale: "ko" | "en";
  events: Event[];
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exact(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!record(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function validProperties(name: EventName, value: unknown) {
  const rules: Readonly<Record<string, PropertyRule>> = EVENTS[name].properties;
  const keys = Object.keys(rules);
  if (!exact(value, keys)) return false;
  for (const key of keys) {
    const child = (value as Record<string, unknown>)[key];
    const rule = rules[key];
    if (rule === "boolean" ? typeof child !== "boolean" : !rule.includes(child as never)) {
      return false;
    }
  }
  return true;
}

function validIdentity(name: EventName, value: Record<string, unknown>) {
  const hasActor = Object.hasOwn(value, "actorKey");
  const hasWorkspace = Object.hasOwn(value, "workspaceKey")
    && Object.hasOwn(value, "workspaceKind");
  const rule = EVENTS[name].identity;
  if (rule === "installation") return !hasActor && !hasWorkspace;
  if (rule === "authentication") {
    const success = (value.properties as Record<string, unknown>).outcome === "success";
    return !hasWorkspace && hasActor === success;
  }
  if (!hasWorkspace) return false;
  if (value.workspaceKind === "personal") return !hasActor && rule !== "team";
  return value.workspaceKind === "team" && hasActor;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function rfc3339Epoch(value: unknown) {
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
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59
  ) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

export function parseEnvelope(value: unknown, nowMs = Date.now()): Envelope | null {
  if (!exact(value, [
    "schemaVersion", "installationId", "sessionId", "appVersion", "platform", "locale", "events",
  ])) return null;
  if (
    value.schemaVersion !== 1
    || typeof value.installationId !== "string" || !UUID.test(value.installationId)
    || typeof value.sessionId !== "string" || !UUID.test(value.sessionId)
    || typeof value.appVersion !== "string" || value.appVersion.length > 128 || !SEMVER.test(value.appVersion)
    || !["macos", "windows", "linux", "unknown"].includes(value.platform as string)
    || !["ko", "en"].includes(value.locale as string)
    || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 16
  ) return null;
  const eventIds = new Set<string>();
  const events: Event[] = [];
  for (const candidate of value.events) {
    if (!exact(candidate, ["eventId", "name", "occurredAt", "properties"], ["actorKey", "workspaceKey", "workspaceKind"])) return null;
    if (
      typeof candidate.eventId !== "string" || !HEX_64.test(candidate.eventId)
      || typeof candidate.name !== "string" || !Object.hasOwn(EVENTS, candidate.name)
      || typeof candidate.occurredAt !== "string" || candidate.occurredAt.length > 40
      || !validProperties(candidate.name as EventName, candidate.properties)
      || (Object.hasOwn(candidate, "actorKey") && (typeof candidate.actorKey !== "string" || !HEX_64.test(candidate.actorKey)))
      || (Object.hasOwn(candidate, "workspaceKey") && (typeof candidate.workspaceKey !== "string" || !HEX_64.test(candidate.workspaceKey)))
      || (Object.hasOwn(candidate, "workspaceKind") && !["personal", "team"].includes(candidate.workspaceKind as string))
      || !validIdentity(candidate.name as EventName, candidate)
    ) return null;
    const occurredAtMs = rfc3339Epoch(candidate.occurredAt);
    if (occurredAtMs === null || occurredAtMs < nowMs - EVENT_TTL_MS || occurredAtMs > nowMs + EVENT_FUTURE_SKEW_MS) return null;
    const eventId = candidate.eventId.toLowerCase();
    if (eventIds.has(eventId)) return null;
    eventIds.add(eventId);
    events.push({
      eventId,
      name: candidate.name as EventName,
      occurredAt: candidate.occurredAt,
      ...(Object.hasOwn(candidate, "actorKey") ? { actorKey: candidate.actorKey as string } : {}),
      ...(Object.hasOwn(candidate, "workspaceKey") ? { workspaceKey: candidate.workspaceKey as string } : {}),
      ...(Object.hasOwn(candidate, "workspaceKind") ? { workspaceKind: candidate.workspaceKind as "personal" | "team" } : {}),
      properties: candidate.properties as Record<string, string | boolean>,
    });
  }
  return {
    schemaVersion: 1,
    installationId: value.installationId.toLowerCase(),
    sessionId: value.sessionId.toLowerCase(),
    appVersion: value.appVersion,
    platform: value.platform as Envelope["platform"],
    locale: value.locale as Envelope["locale"],
    events,
  };
}

async function boundedJson(request: Request): Promise<unknown | null> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
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

function json(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...headers },
  });
}

async function consumeIngestBudget(
  database: D1Database,
  eventCount: number,
  nowMs: number,
) {
  const minuteBucket = Math.floor(nowMs / INGEST_BUDGET_WINDOW_MS);
  const receipt = await database.prepare(`
    INSERT INTO product_analytics_ingest_budget (minute_bucket, event_count)
    VALUES (?, ?)
    ON CONFLICT(minute_bucket) DO UPDATE SET
      event_count = product_analytics_ingest_budget.event_count + excluded.event_count
    WHERE product_analytics_ingest_budget.event_count + excluded.event_count <= ?
    RETURNING event_count
  `).bind(minuteBucket, eventCount, INGEST_BUDGET_EVENTS).first<{ event_count: number }>();
  return receipt !== null;
}

async function ingest(request: Request, env: Env) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([0-9a-f]{64})$/.exec(authorization);
  if (!match || !env.INGEST_TOKEN || !await sameSecret(match[1], env.INGEST_TOKEN)) {
    return json({ accepted: false, retryable: false }, 401);
  }
  if (request.headers.get("x-dopedb-product-analytics-contract") !== "1") {
    return json({ accepted: false, retryable: false }, 400);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return json({ accepted: false, retryable: false }, 415);
  }
  const value = await boundedJson(request);
  const envelope = parseEnvelope(value);
  if (!envelope) return json({ accepted: false, retryable: false }, 400);
  const receivedAtMs = Date.now();
  try {
    if (!await consumeIngestBudget(env.ANALYTICS_DB, envelope.events.length, receivedAtMs)) {
      return json(
        { accepted: false, retryable: true, retryAfterMs: INGEST_BUDGET_WINDOW_MS },
        429,
        { "retry-after": "60" },
      );
    }
  } catch {
    return json(
      { accepted: false, retryable: true, retryAfterMs: INGEST_BUDGET_WINDOW_MS },
      503,
      { "retry-after": "60" },
    );
  }
  const statements = envelope.events.map((event) => env.ANALYTICS_DB.prepare(`
    INSERT OR IGNORE INTO product_analytics_event (
      event_id, name, occurred_at, occurred_at_ms, received_at_ms,
      installation_id, session_id, app_version, platform, locale,
      actor_key, workspace_key, workspace_kind, properties_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    event.eventId,
    event.name,
    event.occurredAt,
    Date.parse(event.occurredAt),
    receivedAtMs,
    envelope.installationId,
    envelope.sessionId,
    envelope.appVersion,
    envelope.platform,
    envelope.locale,
    event.actorKey ?? null,
    event.workspaceKey ?? null,
    event.workspaceKind ?? null,
    JSON.stringify(event.properties),
  ));
  try {
    await env.ANALYTICS_DB.batch(statements);
    return json({ accepted: true, retryable: false }, 202);
  } catch {
    return json({ accepted: false, retryable: true, retryAfterMs: 60_000 }, 503);
  }
}

async function maintain(env: Env, nowMs = Date.now()) {
  const refreshCutoff = nowMs - REFRESH_WINDOW_MS;
  const rawCutoff = nowMs - RAW_RETENTION_MS;
  const refreshDay = new Date(refreshCutoff).toISOString().slice(0, 10);
  await env.ANALYTICS_DB.batch([
    env.ANALYTICS_DB.prepare(
      "DELETE FROM product_analytics_ingest_budget WHERE minute_bucket < ?",
    ).bind(Math.floor(refreshCutoff / INGEST_BUDGET_WINDOW_MS)),
    env.ANALYTICS_DB.prepare("DELETE FROM product_analytics_daily WHERE day >= ?").bind(refreshDay),
    env.ANALYTICS_DB.prepare(`
      INSERT INTO product_analytics_daily (
        day, name, workspace_kind, platform, locale, outcome, event_count
      )
      SELECT
        substr(occurred_at, 1, 10),
        name,
        coalesce(workspace_kind, ''),
        platform,
        locale,
        coalesce(json_extract(properties_json, '$.outcome'), ''),
        count(*)
      FROM product_analytics_event
      WHERE occurred_at_ms >= ?
      GROUP BY 1, 2, 3, 4, 5, 6
    `).bind(refreshCutoff),
    env.ANALYTICS_DB.prepare(`
      DELETE FROM product_analytics_event
      WHERE event_id IN (
        SELECT event_id FROM product_analytics_event
        WHERE received_at_ms < ?
        ORDER BY received_at_ms, event_id
        LIMIT ?
      )
    `).bind(rawCutoff, MAX_DELETE_ROWS),
  ]);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }
    if (request.method === "POST" && url.pathname === "/v1/events") {
      return ingest(request, env);
    }
    return json({ accepted: false, retryable: false }, 404);
  },
  scheduled(_controller: unknown, env: Env, context: ExecutionContext) {
    context.waitUntil(maintain(env));
  },
};

export const __test = { maintain };
