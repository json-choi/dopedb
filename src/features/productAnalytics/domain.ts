// Product analytics has a closed event vocabulary. Callers can provide only
// enumerated outcomes and raw UUID identities that are hashed before storage;
// arbitrary metadata, SQL, prompts, database names, and file paths have no type
// path into the wire contract.

export type ProductAnalyticsConsent = "pending" | "granted" | "denied";
export type ProductAnalyticsAvailability =
  | "checking"
  | "available"
  | "unavailable";

export type ProductAnalyticsEngine =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "mongodb"
  | "bigquery";
export type ProductAnalyticsDurationBucket =
  | "under_100ms"
  | "100ms_1s"
  | "1s_10s"
  | "10s_60s"
  | "over_60s"
  | "unknown";
export type ProductAnalyticsPlatform =
  | "macos"
  | "windows"
  | "linux"
  | "unknown";
export type ProductAnalyticsLocale = "ko" | "en";
export type ProductAnalyticsWorkspaceKind = "personal" | "team";

export type ProductEventPropertiesByName = {
  desktop_installation_ready: {
    readonly [key: string]: never;
  };
  workspace_authentication_completed: {
    outcome: "success" | "denied" | "expired" | "failed";
  };
  workspace_scope_ready: {
    readonly [key: string]: never;
  };
  knowledge_environment_created: {
    creationKind: "project_default" | "additional";
  };
  connection_verification_completed: {
    outcome: "success" | "failed";
    engine: ProductAnalyticsEngine;
    credentialMode: "local" | "managed" | "none";
    ssh: boolean;
  };
  environment_connection_bound: {
    accessMode: "local" | "managed";
    engine: ProductAnalyticsEngine;
  };
  query_execution_completed: {
    outcome: "success" | "failed" | "cancelled" | "unknown";
    statementClass:
      | "select"
      | "explain"
      | "show"
      | "other_read"
      | "write"
      | "script";
    rowCountBucket:
      | "zero"
      | "one"
      | "2_10"
      | "11_100"
      | "101_1000"
      | "over_1000"
      | "unknown";
    durationBucket: ProductAnalyticsDurationBucket;
    approvalRequired: boolean;
  };
  knowledge_source_sync_completed: {
    outcome: "success" | "failed";
    sourceKind: "github" | "local_folder";
    syncReason: "initial" | "manual";
  };
  agent_session_initialization_completed: {
    outcome: "success" | "failed";
    provider: "claude" | "codex";
  };
  agent_turn_completed: {
    outcome: "success" | "failed" | "cancelled";
    provider: "claude" | "codex";
    durationBucket: ProductAnalyticsDurationBucket;
  };
  analysis_article_proposal_completed: {
    readonly [key: string]: never;
  };
  analysis_article_run_completed: {
    outcome: "success" | "failed" | "cancelled" | "stale";
    trigger: "manual";
    durationBucket: ProductAnalyticsDurationBucket;
  };
  workspace_membership_ready: {
    role: "viewer" | "analyst" | "editor" | "admin" | "owner";
  };
  shared_connection_access_ready: {
    accessMode: "local" | "managed";
    engine: ProductAnalyticsEngine;
  };
};

export type ProductEventName = keyof ProductEventPropertiesByName;

export type ProductAnalyticsWorkspaceContextInput =
  | {
      workspaceId: string;
      workspaceKind: "personal";
      actorId?: never;
    }
  | {
      workspaceId: string;
      workspaceKind: "team";
      actorId: string;
    };

type WorkspaceEventName = Exclude<
  ProductEventName,
  "desktop_installation_ready" | "workspace_authentication_completed"
>;

type WorkspaceProductEventInput = {
  [Name in WorkspaceEventName]: {
    name: Name;
    properties: ProductEventPropertiesByName[Name];
    context: ProductAnalyticsWorkspaceContextInput;
  };
}[WorkspaceEventName];

type ProductAnalyticsDedupeInput = {
  /** A stable domain receipt UUID used only to derive a wire-safe event ID. */
  dedupeId?: string;
};

export type ProductAnalyticsEventInput = (
  | {
      name: "desktop_installation_ready";
      properties: ProductEventPropertiesByName["desktop_installation_ready"];
      context?: never;
    }
  | {
      name: "workspace_authentication_completed";
      properties: { outcome: "success" };
      context: { actorId: string };
    }
  | {
      name: "workspace_authentication_completed";
      properties: { outcome: "denied" | "expired" | "failed" };
      context?: never;
    }
  | WorkspaceProductEventInput
) & ProductAnalyticsDedupeInput;

type ProductAnalyticsEventBase<Name extends ProductEventName> = {
  eventId: string;
  name: Name;
  occurredAt: string;
  properties: ProductEventPropertiesByName[Name];
};

export type ProductAnalyticsEvent = {
  [Name in ProductEventName]: ProductAnalyticsEventBase<Name> & {
    actorKey?: string;
    workspaceKey?: string;
    workspaceKind?: ProductAnalyticsWorkspaceKind;
  };
}[ProductEventName];

export type ProductAnalyticsBatch = {
  schemaVersion: 1;
  installationId: string;
  consentGeneration: number;
  sessionId: string;
  appVersion: string;
  platform: ProductAnalyticsPlatform;
  locale: ProductAnalyticsLocale;
  events: ProductAnalyticsEvent[];
};

export type ProductAnalyticsStatus = {
  enabled: boolean;
  consent: ProductAnalyticsConsent;
  generation: number;
};
export type ProductAnalyticsSubmitReceipt = {
  accepted: boolean;
  retryable: boolean;
  retryAfterMs?: number;
};

export type QueuedProductAnalyticsEvent = {
  installationId: string;
  consentGeneration: number;
  sessionId: string;
  appVersion: string;
  platform: ProductAnalyticsPlatform;
  locale: ProductAnalyticsLocale;
  event: ProductAnalyticsEvent;
};

export type ProductAnalyticsSnapshot = {
  availability: ProductAnalyticsAvailability;
  consent: ProductAnalyticsConsent;
  queueSize: number;
  sending: boolean;
};

export const PRODUCT_ANALYTICS_MAX_QUEUE = 100;
export const PRODUCT_ANALYTICS_MAX_BATCH = 16;
export const PRODUCT_ANALYTICS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

const EVENT_NAMES = new Set<ProductEventName>([
  "desktop_installation_ready",
  "workspace_authentication_completed",
  "workspace_scope_ready",
  "knowledge_environment_created",
  "connection_verification_completed",
  "environment_connection_bound",
  "query_execution_completed",
  "knowledge_source_sync_completed",
  "agent_session_initialization_completed",
  "agent_turn_completed",
  "analysis_article_proposal_completed",
  "analysis_article_run_completed",
  "workspace_membership_ready",
  "shared_connection_access_ready",
]);
const ENGINES = new Set<ProductAnalyticsEngine>([
  "postgres",
  "mysql",
  "sqlite",
  "mongodb",
  "bigquery",
]);
const DURATIONS = new Set<ProductAnalyticsDurationBucket>([
  "under_100ms",
  "100ms_1s",
  "1s_10s",
  "10s_60s",
  "over_60s",
  "unknown",
]);
const PLATFORMS = new Set<ProductAnalyticsPlatform>([
  "macos",
  "windows",
  "linux",
  "unknown",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function oneOf<T extends string>(value: unknown, values: ReadonlySet<T>): value is T {
  return typeof value === "string" && values.has(value as T);
}

function fields(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return object(value) && exact(value, keys);
}

function inputFields(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  const hasDedupeId = Object.prototype.hasOwnProperty.call(value, "dedupeId");
  if (
    hasDedupeId &&
    (typeof value.dedupeId !== "string" || !UUID.test(value.dedupeId))
  ) {
    return false;
  }
  return exact(value, hasDedupeId ? [...keys, "dedupeId"] : keys);
}

function enumField(value: unknown, values: readonly string[]) {
  return typeof value === "string" && values.includes(value);
}

function validOccurredAt(value: unknown) {
  if (typeof value !== "string" || value.length > 40 || !RFC3339.test(value)) {
    return false;
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return false;
  const parts = value.slice(0, 19).split(/[-T:]/).map(Number);
  const instant = new Date(epoch);
  return instant.getUTCFullYear() === parts[0] &&
    instant.getUTCMonth() + 1 === parts[1] &&
    instant.getUTCDate() === parts[2] &&
    instant.getUTCHours() === parts[3] &&
    instant.getUTCMinutes() === parts[4] &&
    instant.getUTCSeconds() === parts[5];
}

function validProperties(name: ProductEventName, value: unknown): boolean {
  switch (name) {
    case "desktop_installation_ready":
      return fields(value, []);
    case "workspace_authentication_completed":
      return fields(value, ["outcome"]) && enumField(
        value.outcome,
        ["success", "denied", "expired", "failed"],
      );
    case "workspace_scope_ready":
      return fields(value, []);
    case "knowledge_environment_created":
      return fields(value, ["creationKind"]) && enumField(
        value.creationKind,
        ["project_default", "additional"],
      );
    case "connection_verification_completed":
      return fields(value, ["outcome", "engine", "credentialMode", "ssh"]) &&
        enumField(value.outcome, ["success", "failed"]) &&
        oneOf(value.engine, ENGINES) &&
        enumField(value.credentialMode, ["local", "managed", "none"]) &&
        typeof value.ssh === "boolean";
    case "environment_connection_bound":
    case "shared_connection_access_ready":
      return fields(value, ["accessMode", "engine"]) &&
        enumField(value.accessMode, ["local", "managed"]) &&
        oneOf(value.engine, ENGINES);
    case "query_execution_completed":
      return fields(value, [
        "outcome",
        "statementClass",
        "rowCountBucket",
        "durationBucket",
        "approvalRequired",
      ]) && enumField(
        value.outcome,
        ["success", "failed", "cancelled", "unknown"],
      ) && enumField(
        value.statementClass,
        ["select", "explain", "show", "other_read", "write", "script"],
      ) && enumField(
        value.rowCountBucket,
        ["zero", "one", "2_10", "11_100", "101_1000", "over_1000", "unknown"],
      ) && oneOf(value.durationBucket, DURATIONS) &&
        typeof value.approvalRequired === "boolean";
    case "knowledge_source_sync_completed":
      return fields(value, ["outcome", "sourceKind", "syncReason"]) &&
        enumField(value.outcome, ["success", "failed"]) &&
        enumField(value.sourceKind, ["github", "local_folder"]) &&
        enumField(value.syncReason, ["initial", "manual"]);
    case "agent_session_initialization_completed":
      return fields(value, ["outcome", "provider"]) &&
        enumField(value.outcome, ["success", "failed"]) &&
        enumField(value.provider, ["claude", "codex"]);
    case "agent_turn_completed":
      return fields(value, ["outcome", "provider", "durationBucket"]) &&
        enumField(value.outcome, ["success", "failed", "cancelled"]) &&
        enumField(value.provider, ["claude", "codex"]) &&
        oneOf(value.durationBucket, DURATIONS);
    case "analysis_article_proposal_completed":
      return fields(value, []);
    case "analysis_article_run_completed":
      return fields(value, ["outcome", "trigger", "durationBucket"]) &&
        enumField(value.outcome, ["success", "failed", "cancelled", "stale"]) &&
        value.trigger === "manual" &&
        oneOf(value.durationBucket, DURATIONS);
    case "workspace_membership_ready":
      return fields(value, ["role"]) && enumField(
        value.role,
        ["viewer", "analyst", "editor", "admin", "owner"],
      );
  }
}

function validWireContext(value: Record<string, unknown>, name: ProductEventName) {
  const properties = value.properties as Record<string, unknown>;
  const base = ["eventId", "name", "occurredAt", "properties"];
  if (name === "desktop_installation_ready") return exact(value, base);
  if (name === "workspace_authentication_completed") {
    return properties.outcome === "success"
      ? exact(value, [...base, "actorKey"]) &&
          typeof value.actorKey === "string" &&
          HASH.test(value.actorKey)
      : exact(value, base);
  }
  if (
    value.workspaceKind === "personal" &&
    exact(value, [...base, "workspaceKey", "workspaceKind"])
  ) {
    return typeof value.workspaceKey === "string" && HASH.test(value.workspaceKey);
  }
  return value.workspaceKind === "team" &&
    exact(value, [...base, "actorKey", "workspaceKey", "workspaceKind"]) &&
    typeof value.actorKey === "string" && HASH.test(value.actorKey) &&
    typeof value.workspaceKey === "string" && HASH.test(value.workspaceKey);
}

export function isProductAnalyticsEvent(value: unknown): value is ProductAnalyticsEvent {
  if (!object(value) || !oneOf(value.name, EVENT_NAMES)) return false;
  if (
    typeof value.eventId !== "string" ||
    !HASH.test(value.eventId) ||
    !validOccurredAt(value.occurredAt) ||
    !validProperties(value.name, value.properties)
  ) {
    return false;
  }
  return validWireContext(value, value.name);
}

export function isQueuedProductAnalyticsEvent(
  value: unknown,
): value is QueuedProductAnalyticsEvent {
  return object(value) &&
    exact(value, [
      "installationId",
      "consentGeneration",
      "sessionId",
      "appVersion",
      "platform",
      "locale",
      "event",
    ]) &&
    typeof value.installationId === "string" && UUID.test(value.installationId) &&
    typeof value.consentGeneration === "number" &&
    Number.isInteger(value.consentGeneration) &&
    value.consentGeneration >= 0 && value.consentGeneration <= 0xffff_ffff &&
    typeof value.sessionId === "string" && UUID.test(value.sessionId) &&
    typeof value.appVersion === "string" && value.appVersion.length <= 128 &&
    SEMVER.test(value.appVersion) &&
    oneOf(value.platform, PLATFORMS) &&
    (value.locale === "ko" || value.locale === "en") &&
    isProductAnalyticsEvent(value.event);
}

export function isProductAnalyticsEventInput(
  value: unknown,
): value is ProductAnalyticsEventInput {
  if (
    !object(value) ||
    !oneOf(value.name, EVENT_NAMES) ||
    !validProperties(value.name, value.properties)
  ) {
    return false;
  }
  if (value.name === "desktop_installation_ready") {
    return inputFields(value, ["name", "properties"]);
  }
  if (value.name === "workspace_authentication_completed") {
    const success =
      (value.properties as Record<string, unknown>).outcome === "success";
    if (!success) return inputFields(value, ["name", "properties"]);
    return inputFields(value, ["name", "properties", "context"]) &&
      fields(value.context, ["actorId"]) &&
      typeof value.context.actorId === "string" &&
      UUID.test(value.context.actorId);
  }
  if (
    !inputFields(value, ["name", "properties", "context"]) ||
    !object(value.context)
  ) {
    return false;
  }
  if (
    value.context.workspaceKind === "personal" &&
    exact(value.context, ["workspaceId", "workspaceKind"])
  ) {
    return typeof value.context.workspaceId === "string" &&
      UUID.test(value.context.workspaceId);
  }
  return value.context.workspaceKind === "team" &&
    exact(value.context, ["workspaceId", "workspaceKind", "actorId"]) &&
    typeof value.context.workspaceId === "string" &&
    UUID.test(value.context.workspaceId) &&
    typeof value.context.actorId === "string" &&
    UUID.test(value.context.actorId);
}

export function isProductAnalyticsAppVersion(value: string) {
  return value.length <= 128 && SEMVER.test(value);
}

export function isProductAnalyticsUuid(value: string) {
  return UUID.test(value);
}
