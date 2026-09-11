export { AnalyticsBudget } from "./ingest-budget";
import { consumeIngestBudget, type BudgetNamespace } from "./ingest-budget";
import { appendBigQuery, BigQueryDeliveryError, type BigQueryEnv } from "./bigquery";

const MAX_BODY_BYTES = 32 * 1024;
const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const INGEST_BUDGET_WINDOW_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64 = /^[0-9a-f]{64}$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function isSemverNumericIdentifier(value: string) {
  if (!value || (value.length > 1 && value[0] === "0")) return false;
  for (const character of value) {
    if (character < "0" || character > "9") return false;
  }
  return true;
}

function isSemverLabel(value: string, rejectNumericLeadingZero: boolean) {
  if (!value) return false;
  let numeric = true;
  for (const character of value) {
    const digit = character >= "0" && character <= "9";
    const upper = character >= "A" && character <= "Z";
    const lower = character >= "a" && character <= "z";
    if (!digit && !upper && !lower && character !== "-") return false;
    if (!digit) numeric = false;
  }
  return !rejectNumericLeadingZero
    || !numeric
    || value.length === 1
    || value[0] !== "0";
}

function isSemanticVersion(value: string) {
  if (!value || value.length > 128) return false;
  const buildParts = value.split("+");
  if (buildParts.length > 2) return false;
  const release = buildParts[0] ?? "";
  const build = buildParts[1];
  if (
    build !== undefined
    && !build.split(".").every((part) => isSemverLabel(part, false))
  ) return false;
  const prereleaseSeparator = release.indexOf("-");
  const core = prereleaseSeparator === -1
    ? release
    : release.slice(0, prereleaseSeparator);
  const prerelease = prereleaseSeparator === -1
    ? undefined
    : release.slice(prereleaseSeparator + 1);
  const coreParts = core.split(".");
  if (
    coreParts.length !== 3
    || !coreParts.every(isSemverNumericIdentifier)
  ) return false;
  return prerelease === undefined
    || prerelease.split(".").every((part) => isSemverLabel(part, true));
}

type Env = BigQueryEnv & {
  INGEST_BUDGET: BudgetNamespace;
};


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
    || typeof value.appVersion !== "string" || !isSemanticVersion(value.appVersion)
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

async function ingest(request: Request, env: Env) {
  if (request.headers.get("x-dopedb-product-analytics-contract") !== "2") {
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
    if (!await consumeIngestBudget(env.INGEST_BUDGET, envelope.events.length)) {
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
  const rows = envelope.events.map((event) => ({
    event_id: event.eventId, name: event.name, occurred_at: event.occurredAt,
    occurred_at_ms: Date.parse(event.occurredAt), received_at_ms: receivedAtMs,
    received_at: new Date(receivedAtMs).toISOString(),
    installation_id: envelope.installationId, session_id: envelope.sessionId,
    app_version: envelope.appVersion, platform: envelope.platform, locale: envelope.locale,
    actor_key: event.actorKey ?? null, workspace_key: event.workspaceKey ?? null,
    workspace_kind: event.workspaceKind ?? null, properties_json: JSON.stringify(event.properties),
  }));
  try {
    await appendBigQuery(env, rows);
    return json({ accepted: true, retryable: false }, 202);
  } catch (error) {
    // Closed operational categories only: never log events, credentials, URLs,
    // upstream response bodies, or arbitrary exception messages.
    console.warn("product-analytics-delivery", error instanceof BigQueryDeliveryError
      ? { stage: error.stage, status: error.status } : { stage: "unavailable", status: 0 });
    return json({ accepted: false, retryable: true, retryAfterMs: 60_000 }, 503);
  }
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
};
