//! Strict product-outcome validation and the optional Cloudflare analytics sink.
//! This boundary accepts only the reviewed v1 enums and never persists raw analytics.
import "server-only";

import { createHash } from "node:crypto";

import { env } from "./env";
import { consumeRateLimit, forwardedClientKey } from "./rate-limit";

const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const EVENT_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 60;
const GLOBAL_RATE_LIMIT_REQUESTS = 400;
const GLOBAL_RATE_LIMIT_EVENTS = 16;
const CLOUDFLARE_TIMEOUT_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64 = /^[0-9a-f]{64}$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const enumRule = <const Values extends readonly string[]>(...values: Values) => ({
  kind: "enum" as const,
  values,
});
const booleanRule = { kind: "boolean" as const };
const engineRule = enumRule("postgres", "mysql", "sqlite", "mongodb", "bigquery");
const accessModeRule = enumRule("local", "managed");
const durationBucketRule = enumRule(
  "under_100ms",
  "100ms_1s",
  "1s_10s",
  "10s_60s",
  "over_60s",
  "unknown",
);

type PropertyRule =
  | ReturnType<typeof enumRule>
  | typeof booleanRule
  | { kind: "integer"; min: number; max: number };
type PropertySchema = Readonly<Record<string, PropertyRule>>;

const PRODUCT_EVENT_PROPERTIES = {
  desktop_installation_ready: {
  },
  workspace_authentication_completed: {
    outcome: enumRule("success", "denied", "expired", "failed"),
  },
  workspace_scope_ready: {
  },
  knowledge_environment_created: {
    creationKind: enumRule("project_default", "additional"),
  },
  connection_verification_completed: {
    outcome: enumRule("success", "failed"),
    engine: engineRule,
    credentialMode: enumRule("local", "managed", "none"),
    ssh: booleanRule,
  },
  environment_connection_bound: {
    accessMode: accessModeRule,
    engine: engineRule,
  },
  query_execution_completed: {
    outcome: enumRule("success", "failed", "cancelled", "unknown"),
    statementClass: enumRule("select", "explain", "show", "other_read", "write", "script"),
    rowCountBucket: enumRule(
      "zero",
      "one",
      "2_10",
      "11_100",
      "101_1000",
      "over_1000",
      "unknown",
    ),
    durationBucket: durationBucketRule,
    approvalRequired: booleanRule,
  },
  knowledge_source_sync_completed: {
    outcome: enumRule("success", "failed"),
    sourceKind: enumRule("github", "local_folder"),
    syncReason: enumRule("initial", "manual"),
  },
  agent_session_initialization_completed: {
    outcome: enumRule("success", "failed"),
    provider: enumRule("claude", "codex"),
  },
  agent_turn_completed: {
    outcome: enumRule("success", "failed", "cancelled"),
    provider: enumRule("claude", "codex"),
    durationBucket: durationBucketRule,
  },
  analysis_article_proposal_completed: {
  },
  analysis_article_run_completed: {
    outcome: enumRule("success", "failed", "cancelled", "stale"),
    trigger: enumRule("manual"),
    durationBucket: durationBucketRule,
  },
  workspace_membership_ready: {
    role: enumRule("viewer", "analyst", "editor", "admin", "owner"),
  },
  shared_connection_access_ready: {
    accessMode: accessModeRule,
    engine: engineRule,
  },
} as const satisfies Record<string, PropertySchema>;

export type ProductEventName = keyof typeof PRODUCT_EVENT_PROPERTIES;
export type ProductEventPropertyValue = string | boolean | number;

export type ProductAnalyticsEvent = {
  eventId: string;
  name: ProductEventName;
  occurredAt: string;
  actorKey?: string;
  workspaceKey?: string;
  workspaceKind?: "personal" | "team";
  properties: Record<string, ProductEventPropertyValue>;
};

export type ProductAnalyticsEnvelope = {
  schemaVersion: 1;
  installationId: string;
  sessionId: string;
  appVersion: string;
  platform: "macos" | "windows" | "linux" | "unknown";
  locale: "ko" | "en";
  events: ProductAnalyticsEvent[];
};

export type ProductAnalyticsRelayResult =
  | "accepted"
  | "not_configured"
  | "retryable_failure"
  | "rejected";

export const PRODUCT_ANALYTICS_CONTRACT_VERSION = "1";

type ProductAnalyticsBudget = Readonly<{
  namespace: string;
  discriminator: string;
  limit: number;
  windowMs: number;
  cost?: number;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is Record<string, unknown> {
  if (!record(value)) return false;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(value);
  return requiredKeys.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function isEnum<Value extends string>(value: unknown, values: readonly Value[]): value is Value {
  return typeof value === "string" && values.includes(value as Value);
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function rfc3339Epoch(value: unknown): number | null {
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
    month < 1
    || month > 12
    || day < 1
    || day > days[month - 1]
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
  ) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function validProperty(value: unknown, rule: PropertyRule) {
  if (rule.kind === "enum") return isEnum(value, rule.values);
  if (rule.kind === "boolean") return typeof value === "boolean";
  return Number.isSafeInteger(value) && Number(value) >= rule.min && Number(value) <= rule.max;
}

function parseProperties(
  name: ProductEventName,
  value: unknown,
): Record<string, ProductEventPropertyValue> | null {
  const schema: PropertySchema = PRODUCT_EVENT_PROPERTIES[name];
  const keys = Object.keys(schema);
  if (!exactRecord(value, keys)) return null;
  const properties: Record<string, ProductEventPropertyValue> = {};
  for (const key of keys) {
    const child = value[key];
    if (!validProperty(child, schema[key])) return null;
    properties[key] = child as ProductEventPropertyValue;
  }
  return properties;
}

function validEventIdentity(
  name: ProductEventName,
  value: Record<string, unknown>,
  properties: Readonly<Record<string, ProductEventPropertyValue>>,
) {
  const hasActor = Object.hasOwn(value, "actorKey");
  const hasWorkspaceKey = Object.hasOwn(value, "workspaceKey");
  const hasWorkspaceKind = Object.hasOwn(value, "workspaceKind");
  if (name === "desktop_installation_ready") {
    return !hasActor && !hasWorkspaceKey && !hasWorkspaceKind;
  }
  if (name === "workspace_authentication_completed") {
    return !hasWorkspaceKey
      && !hasWorkspaceKind
      && hasActor === (properties.outcome === "success");
  }
  return hasWorkspaceKey
    && hasWorkspaceKind
    && (value.workspaceKind !== "personal" || !hasActor)
    && (value.workspaceKind !== "team" || hasActor)
    && (name !== "workspace_membership_ready" || value.workspaceKind === "team");
}

function parseEvent(value: unknown, nowMs: number): ProductAnalyticsEvent | null {
  if (!exactRecord(
    value,
    ["eventId", "name", "occurredAt", "properties"],
    ["actorKey", "workspaceKey", "workspaceKind"],
  )) return null;
  if (
    typeof value.eventId !== "string"
    || !HEX_64.test(value.eventId)
    || typeof value.name !== "string"
    || !Object.hasOwn(PRODUCT_EVENT_PROPERTIES, value.name)
  ) return null;
  const name = value.name as ProductEventName;
  const occurredAt = rfc3339Epoch(value.occurredAt);
  if (
    occurredAt === null
    || occurredAt < nowMs - EVENT_TTL_MS
    || occurredAt > nowMs + EVENT_FUTURE_SKEW_MS
  ) return null;
  if (
    Object.hasOwn(value, "actorKey")
    && (typeof value.actorKey !== "string" || !HEX_64.test(value.actorKey))
  ) return null;
  if (
    Object.hasOwn(value, "workspaceKey")
    && (typeof value.workspaceKey !== "string" || !HEX_64.test(value.workspaceKey))
  ) return null;
  if (
    Object.hasOwn(value, "workspaceKind")
    && !isEnum(value.workspaceKind, ["personal", "team"] as const)
  ) return null;
  const properties = parseProperties(name, value.properties);
  if (!properties || !validEventIdentity(name, value, properties)) return null;
  return {
    eventId: value.eventId.toLowerCase(),
    name,
    occurredAt: value.occurredAt as string,
    ...(Object.hasOwn(value, "actorKey") ? { actorKey: value.actorKey as string } : {}),
    ...(Object.hasOwn(value, "workspaceKey") ? { workspaceKey: value.workspaceKey as string } : {}),
    ...(Object.hasOwn(value, "workspaceKind")
      ? { workspaceKind: value.workspaceKind as "personal" | "team" }
      : {}),
    properties,
  };
}

export function parseProductAnalyticsEnvelope(
  value: unknown,
  nowMs = Date.now(),
): ProductAnalyticsEnvelope | null {
  if (!Number.isFinite(nowMs)) return null;
  if (!exactRecord(value, [
    "schemaVersion",
    "installationId",
    "sessionId",
    "appVersion",
    "platform",
    "locale",
    "events",
  ])) return null;
  if (
    value.schemaVersion !== 1
    || typeof value.installationId !== "string"
    || !UUID.test(value.installationId)
    || typeof value.sessionId !== "string"
    || !UUID.test(value.sessionId)
    || typeof value.appVersion !== "string"
    || value.appVersion.length > 128
    || !SEMVER.test(value.appVersion)
    || !isEnum(value.platform, ["macos", "windows", "linux", "unknown"] as const)
    || !isEnum(value.locale, ["ko", "en"] as const)
    || !Array.isArray(value.events)
    || value.events.length < 1
    || value.events.length > 16
  ) return null;
  const events: ProductAnalyticsEvent[] = [];
  const eventIds = new Set<string>();
  for (const candidate of value.events) {
    const event = parseEvent(candidate, nowMs);
    if (!event) return null;
    const eventId = event.eventId.toLowerCase();
    if (eventIds.has(eventId)) return null;
    eventIds.add(eventId);
    events.push(event);
  }
  return {
    schemaVersion: 1,
    installationId: value.installationId.toLowerCase(),
    sessionId: value.sessionId.toLowerCase(),
    appVersion: value.appVersion,
    platform: value.platform,
    locale: value.locale,
    events,
  };
}

export function acceptsProductAnalyticsContract(headers: Pick<Headers, "get">) {
  return headers.get("x-dopedb-product-analytics-contract")
    === PRODUCT_ANALYTICS_CONTRACT_VERSION;
}

/**
 * Ingress budgets execute before any body read. The IP budget cannot be reset
 * by rotating caller-controlled installation UUIDs, and malformed envelopes
 * still consume both a global and source budget.
 */
export function productAnalyticsIngressBudgetPlan(
  headers: Pick<Headers, "get">,
): readonly ProductAnalyticsBudget[] {
  const ipHash = forwardedClientKey(headers);
  const globalRequestHash = createHash("sha256")
    .update("product-analytics-global-requests")
    .digest("hex");
  return [
    {
      namespace: "product-analytics-global-requests",
      discriminator: globalRequestHash,
      limit: GLOBAL_RATE_LIMIT_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    },
    {
      namespace: "product-analytics-ip",
      discriminator: ipHash,
      limit: RATE_LIMIT_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    },
  ];
}

/**
 * Only a valid envelope may allocate an installation bucket or consume the
 * event-volume circuit. Identifiers enter rate-limit storage only as hashes.
 */
export function productAnalyticsEnvelopeBudgetPlan(
  installationId: string,
  eventCount: number,
): readonly ProductAnalyticsBudget[] {
  const installationHash = createHash("sha256").update(installationId).digest("hex");
  const globalEventHash = createHash("sha256")
    .update("product-analytics-global-events")
    .digest("hex");
  return [
    {
      namespace: "product-analytics-global-events",
      discriminator: globalEventHash,
      limit: GLOBAL_RATE_LIMIT_EVENTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
      cost: eventCount,
    },
    {
      namespace: "product-analytics-installation",
      discriminator: installationHash,
      limit: RATE_LIMIT_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    },
  ];
}

async function consumeBudgets(budgets: readonly ProductAnalyticsBudget[]) {
  for (const budget of budgets) {
    if (!await consumeRateLimit(budget)) return false;
  }
  return true;
}

export function consumeProductAnalyticsIngressBudget(
  headers: Pick<Headers, "get">,
): Promise<boolean> {
  return consumeBudgets(productAnalyticsIngressBudgetPlan(headers));
}

export function consumeProductAnalyticsEnvelopeBudget(
  installationId: string,
  eventCount: number,
): Promise<boolean> {
  return consumeBudgets(productAnalyticsEnvelopeBudgetPlan(installationId, eventCount));
}

export async function relayProductAnalytics(
  envelope: ProductAnalyticsEnvelope,
): Promise<ProductAnalyticsRelayResult> {
  let token: string | null;
  let url: string | null;
  try {
    token = env.productAnalyticsCloudflareToken();
    url = env.productAnalyticsCloudflareUrl();
  } catch {
    return "not_configured";
  }
  if (!token || !url) return "not_configured";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-dopedb-product-analytics-contract": PRODUCT_ANALYTICS_CONTRACT_VERSION,
      },
      body: JSON.stringify(envelope),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
    });
    const accepted = response.status === 202;
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    if (accepted) return "accepted";
    return status === 429 || status >= 500
      ? "retryable_failure"
      : "rejected";
  } catch {
    return "retryable_failure";
  }
}
