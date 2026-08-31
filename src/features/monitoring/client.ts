// Privacy-bounded desktop error monitoring. DopeDB records stack structure and
// safe surface labels only; database, workspace, and Agent payloads are removed
// before an event can leave the WebView.
import * as Sentry from "@sentry/react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import type { Event } from "@sentry/react";
import type { ErrorInfo } from "react";

const SENTRY_DSN =
  "https://1ef5b6fd989b94471cd7f84e0078529e@o4511867515895808.ingest.us.sentry.io/4512004769316864";
const SAFE_TAGS = new Set([
  "surface",
  "runtime",
  "react_tree",
  "agent_plugin_provider",
  "agent_plugin_operation",
  "agent_plugin_outcome",
]);
const AGENT_PLUGIN_PROVIDERS = new Set(["claude", "codex"]);
const AGENT_PLUGIN_OPERATIONS = new Set([
  "install_update",
  "remove",
  "candidate_initialize",
  "session_initialize",
]);
const AGENT_PLUGIN_OUTCOMES = new Set([
  "started",
  "succeeded",
  "failed",
  "promoted",
  "quarantined",
]);
const SAFE_ERROR_TYPES = new Set([
  "AggregateError",
  "DOMException",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "UnhandledRejection",
]);

export async function initializeClientMonitoring() {
  if (
    !import.meta.env.PROD ||
    import.meta.env.VITE_DOPEDB_PACKAGED_BENCHMARK === "1" ||
    Sentry.isInitialized()
  ) {
    return;
  }

  const appVersion = await getVersion().catch(() => null);
  if (Sentry.isInitialized()) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    release: appVersion ? `dopedb@${appVersion}` : undefined,
    environment: "production",
    sampleRate: 1,
    sendDefaultPii: false,
    sendClientReports: false,
    attachStacktrace: true,
    maxBreadcrumbs: 0,
    enableLogs: false,
    integrations: [
      Sentry.inboundFiltersIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.browserApiErrorsIntegration(),
      Sentry.globalHandlersIntegration({
        onerror: true,
        onunhandledrejection: true,
      }),
      Sentry.linkedErrorsIntegration({ limit: 3 }),
      Sentry.dedupeIntegration(),
    ],
    beforeSend(event) {
      event.user = undefined;
      event.request = undefined;
      event.breadcrumbs = undefined;
      event.extra = undefined;
      event.contexts = undefined;
      event.transaction = undefined;
      event.message = undefined;
      event.logentry = undefined;
      event.server_name = undefined;
      event.modules = undefined;
      event.fingerprint = undefined;
      event.spans = undefined;
      event.measurements = undefined;
      event.transaction_info = undefined;
      event.threads = undefined;
      event.tags = keepSafeTags(event.tags);

      for (const value of event.exception?.values ?? []) {
        const errorType = safeErrorType(value.type);
        value.type = errorType;
        value.value = `${errorType} captured by DopeDB`;
        for (const frame of value.stacktrace?.frames ?? []) {
          frame.context_line = undefined;
          frame.pre_context = undefined;
          frame.post_context = undefined;
          frame.vars = undefined;
          frame.module_metadata = undefined;
        }
      }

      return event;
    },
  });

  Sentry.setTag("runtime", "tauri-webview");
}

export function reportRenderFailure(
  surface: "agent_rich_text" | "ai_chat",
  error: Error,
  errorInfo: ErrorInfo,
) {
  if (!Sentry.isEnabled()) return;

  const errorType = safeErrorType(error.name);
  const monitoredError = new Error(`${errorType} in ${surface}`);
  monitoredError.name = errorType;
  monitoredError.stack = safeStack(error, errorType, monitoredError.message);

  Sentry.withScope((scope) => {
    scope.setTag("surface", surface);
    const componentTree = safeComponentTree(errorInfo.componentStack);
    if (componentTree) scope.setTag("react_tree", componentTree);
    Sentry.captureException(monitoredError);
  });
}

type AgentPluginTelemetry = {
  provider: string;
  operation: string;
  outcome: string;
};

export async function listenForAgentPluginTelemetry() {
  return listen<AgentPluginTelemetry>("agent-plugin:telemetry", (event) => {
    const { provider, operation, outcome } = event.payload;
    if (
      !Sentry.isEnabled() ||
      !AGENT_PLUGIN_PROVIDERS.has(provider) ||
      !AGENT_PLUGIN_OPERATIONS.has(operation) ||
      !AGENT_PLUGIN_OUTCOMES.has(outcome) ||
      outcome === "started" ||
      outcome === "succeeded" ||
      outcome === "promoted"
    ) {
      return;
    }
    Sentry.withScope((scope) => {
      scope.setTag("agent_plugin_provider", provider);
      scope.setTag("agent_plugin_operation", operation);
      scope.setTag("agent_plugin_outcome", outcome);
      Sentry.captureException(new Error("Agent plugin operation failed"));
    });
  });
}

function keepSafeTags(tags: Event["tags"]): Event["tags"] {
  if (!tags) return undefined;
  const safe = Object.entries(tags).filter(([key]) => SAFE_TAGS.has(key));
  return safe.length > 0 ? Object.fromEntries(safe) : undefined;
}

function safeErrorType(type: string | null | undefined) {
  return type && SAFE_ERROR_TYPES.has(type) ? type : "Error";
}

function safeStack(error: Error, errorType: string, message: string) {
  const frames = error.stack?.split("\n").slice(1, 81) ?? [];
  return [`${errorType}: ${message}`, ...frames].join("\n");
}

function safeComponentTree(componentStack: string | null | undefined) {
  if (!componentStack) return "";
  return componentStack
    .split("\n")
    .map((line) => line.match(/^\s*at\s+([^\s(]+)/)?.[1] ?? "")
    .filter(Boolean)
    .slice(0, 12)
    .join(">")
    .slice(0, 180);
}
