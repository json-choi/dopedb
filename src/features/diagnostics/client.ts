// Captures opt-in frontend diagnostics without serializing command arguments,
// results, console objects, SQL, or Agent payloads. A bounded queue drains only
// to the Desktop memory buffer; failures never recurse through logging.
import type { FrontendDiagnostic } from "./domain";

type Sink = (generation: number, entries: FrontendDiagnostic[]) => Promise<void>;
let enabled = false;
let generation = 0;
let queue: FrontendDiagnostic[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sink: Sink | null = null;
let sending = false;

export function configureDiagnosticCapture(nextEnabled: boolean, nextGeneration: number) {
  if (enabled !== nextEnabled || generation !== nextGeneration) queue = [];
  enabled = nextEnabled;
  generation = nextGeneration;
}

export function recordFrontendDiagnostic(level: string, source: string, text: string) {
  if (!enabled || !sink) return;
  // Keep the queue bounded even while native IPC is stalled.
  if (queue.length === 50) queue.shift();
  queue.push({ level, source, text: text.slice(0, 4096) });
  schedule();
}

function schedule() {
  if (timer !== null || sending || queue.length === 0) return;
  timer = setTimeout(() => {
    timer = null;
    if (!enabled || !sink || queue.length === 0) return;
    const batch = queue;
    queue = [];
    sending = true;
    void sink(generation, batch).catch(() => undefined).finally(() => {
      sending = false;
      schedule();
    });
  }, 250);
}

export function recordDiagnosticIpc(command: string, elapsed: number, failed: boolean) {
  if (command.startsWith("diagnostics_")) return;
  recordFrontendDiagnostic(failed ? "ERROR" : "DEBUG", "ipc",
    `${command} outcome=${failed ? "failed" : "succeeded"} duration_ms=${Math.round(elapsed)}`);
}

function consoleText(value: unknown) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "[object omitted]";
}

export function installDiagnosticCapture(nextSink: Sink) {
  sink = nextSink;
  const onError = (event: ErrorEvent) => recordFrontendDiagnostic("ERROR", "frontend",
    `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`);
  const onRejection = (event: PromiseRejectionEvent) => recordFrontendDiagnostic("ERROR", "frontend",
    `Unhandled rejection: ${consoleText(event.reason)}`);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const originalWarn = console.warn;
  const originalError = console.error;
  const warn: typeof console.warn = (...values) => {
    originalWarn.apply(console, values);
    if (enabled) recordFrontendDiagnostic("WARN", "console", values.slice(0, 8).map(consoleText).join(" "));
  };
  const error: typeof console.error = (...values) => {
    originalError.apply(console, values);
    if (enabled) recordFrontendDiagnostic("ERROR", "console", values.slice(0, 8).map(consoleText).join(" "));
  };
  console.warn = warn;
  console.error = error;
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    if (console.warn === warn) console.warn = originalWarn;
    if (console.error === error) console.error = originalError;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    queue = [];
    enabled = false;
    sink = null;
  };
}
