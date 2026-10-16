// Pure labels and display projections shared by the Job panel controller and
// presentation leaves. This module never owns React state or Tauri commands.
import type { I18nKey } from "../../lib/i18n";
import { errDetails, type CatalogObjectRef } from "../../ipc/types";
import type { Job, JobFormat } from "./domain";
import type { StatusTone } from "../../design-system/components/Status";

/**
 * Translate a Job command failure. The Job Engine's refusals are a closed set of
 * reasons, so the panel explains them in the user's language and never shows
 * backend text; anything else falls back to a generic retry message.
 */
export function jobErrorKey(cause: unknown): I18nKey {
  const { kind, message } = errDetails(cause);
  const text = message.toLowerCase();
  if (text.includes("schema changes are disabled")) return "jobs.errorSchemaDisabled";
  if (text.includes("does not permit schema changes")) return "jobs.errorSchemaRole";
  if (text.includes("writes are disabled")) return "jobs.errorWritesDisabled";
  if (text.includes("read-only database access")) return "jobs.errorReadOnlyRole";
  if (text.includes("no longer allows this import")) return "jobs.errorPolicyChanged";
  if (kind === "outcomeUnknown") return "jobs.errorOutcomeUnknown";
  return "jobs.errorGeneric";
}

export const JOB_FORMATS: JobFormat[] = [
  "csv",
  "tsv",
  "json",
  "ndjson",
  "sql",
  "xlsx",
  "csv_gzip",
  "json_gzip",
  "ndjson_gzip",
  "sql_gzip",
];

export const DEFAULT_JOB_BATCH_SIZE = 1_000;

export const JOB_STATE_KEYS: Record<Job["state"], I18nKey> = {
  cancel_requested: "jobs.stateCancelRequested",
  cancelled: "jobs.stateCancelled",
  failed: "jobs.stateFailed",
  pause_requested: "jobs.statePauseRequested",
  paused: "jobs.statePaused",
  queued: "jobs.stateQueued",
  running: "jobs.stateRunning",
  succeeded: "jobs.stateSucceeded",
};

export function jobFileExtension(format: JobFormat): string {
  return format.endsWith("_gzip")
    ? `${format.replace("_gzip", "")}.gz`
    : format;
}

export function formatJobBytes(value: number | null): string {
  if (value == null) return "—";
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MiB`;
  return `${(value / 1_073_741_824).toFixed(1)} GiB`;
}

export function jobProgress(job: Job): number | null {
  if (job.state === "succeeded") return 100;
  if (job.rowsTotal && job.rowsTotal > 0) {
    return Math.min(100, (job.rowsProcessed / job.rowsTotal) * 100);
  }
  if (job.bytesTotal && job.bytesTotal > 0) {
    return Math.min(100, (job.bytesProcessed / job.bytesTotal) * 100);
  }
  return null;
}

export function jobRelationLabel(relation: CatalogObjectRef): string {
  return relation.namespace
    ? `${relation.namespace}.${relation.name}`
    : relation.name;
}

export function jobPreviewCell(row: unknown, field: string): string {
  if (!row || typeof row !== "object" || Array.isArray(row)) return "";
  const value = (row as Record<string, unknown>)[field];
  if (value == null) return "NULL";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function jobStateTone(state: Job["state"]): StatusTone {
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "cancelled") return "danger";
  if (
    state === "paused"
    || state === "pause_requested"
    || state === "cancel_requested"
  ) {
    return "warning";
  }
  return "neutral";
}
