// Runtime-neutral validation for one explicit Desktop-triggered Analysis run.
// The control plane stores authority receipts only; result rows remain local.

import { parseLegacyAnalysisRunCompletionEnvelope } from "./workspace-analysis-run-compat";
import type { AnalysisArticleDefinition } from "./workspace-analysis-article-contracts";
import { canonicalHash } from "./workspace-versioning";

export type AnalysisRunRequest = Readonly<{
  id: string;
  articleRevision: number;
  runnerId: string;
  trigger: "manual";
}>;

export type AnalysisQueryReceiptInput = Readonly<{
  queryNodeId: string;
  connectionId: string;
  connectionRevision: number;
  queryRunId: string;
  queryHash: string;
  schemaFingerprint: string;
  state: "succeeded" | "failed" | "cancelled" | "stale";
  rowCount: number;
  byteCount: number;
  durationMs: number;
}>;

export type AnalysisRunCompletion = Readonly<{
  state: "succeeded" | "failed" | "cancelled" | "stale";
  queryReceipts: readonly AnalysisQueryReceiptInput[];
  error: Readonly<{ kind: string; message: string }> | null;
}>;

export function analysisRunResultHash(receipts: readonly AnalysisQueryReceiptInput[]) {
  return canonicalHash({ receipts: [...receipts].sort((left, right) => (
    left.queryNodeId < right.queryNodeId ? -1 : left.queryNodeId > right.queryNodeId ? 1 : 0
  )) });
}

export type AnalysisRunnerRegistration = Readonly<{
  deviceId: string;
  displayName: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const UNSAFE_DISPLAY = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069\ufeff]/u;

function exactRecord(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(record, field))
    ? record
    : null;
}

function safeInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum ? value : null;
}

export function parseAnalysisRunnerRegistration(value: unknown): AnalysisRunnerRegistration {
  const row = exactRecord(value, ["deviceId", "displayName"]);
  if (!row || typeof row.deviceId !== "string" || row.deviceId.trim().length < 1
    || row.deviceId.length > 256 || UNSAFE_DISPLAY.test(row.deviceId)
    || typeof row.displayName !== "string" || row.displayName.trim().length < 1
    || row.displayName.length > 256 || UNSAFE_DISPLAY.test(row.displayName)) {
    throw new Error("Invalid manual Analysis runner registration");
  }
  return {
    deviceId: row.deviceId.trim(),
    displayName: row.displayName.trim(),
  };
}

export function parseAnalysisRunRequest(value: unknown): AnalysisRunRequest {
  const row = exactRecord(value, ["id", "articleRevision", "runnerId", "trigger"]);
  const revision = safeInteger(row?.articleRevision, 1, Number.MAX_SAFE_INTEGER);
  if (!row || typeof row.id !== "string" || !UUID.test(row.id)
    || revision === null || typeof row.runnerId !== "string" || !UUID.test(row.runnerId)
    || row.trigger !== "manual") {
    throw new Error("Invalid manual Analysis Article run request");
  }
  return {
    id: row.id,
    articleRevision: revision,
    runnerId: row.runnerId,
    trigger: "manual",
  };
}

function parseReceipt(value: unknown): AnalysisQueryReceiptInput {
  const row = exactRecord(value, [
    "queryNodeId", "connectionId", "connectionRevision", "queryRunId", "queryHash",
    "schemaFingerprint", "state", "rowCount", "byteCount", "durationMs",
  ]);
  const connectionRevision = safeInteger(row?.connectionRevision, 1, Number.MAX_SAFE_INTEGER);
  const rowCount = safeInteger(row?.rowCount, 0, 50_000);
  const byteCount = safeInteger(row?.byteCount, 0, 16 * 1024 * 1024);
  const durationMs = safeInteger(row?.durationMs, 0, 24 * 60 * 60 * 1_000);
  if (!row || typeof row.queryNodeId !== "string" || !ID.test(row.queryNodeId)
    || typeof row.connectionId !== "string" || !UUID.test(row.connectionId)
    || connectionRevision === null || typeof row.queryRunId !== "string" || !UUID.test(row.queryRunId)
    || typeof row.queryHash !== "string" || !HASH.test(row.queryHash)
    || typeof row.schemaFingerprint !== "string" || !HASH.test(row.schemaFingerprint)
    || typeof row.state !== "string"
    || !["succeeded", "failed", "cancelled", "stale"].includes(row.state)
    || rowCount === null || byteCount === null || durationMs === null) {
    throw new Error("Invalid Analysis Article query receipt");
  }
  return {
    queryNodeId: row.queryNodeId,
    connectionId: row.connectionId,
    connectionRevision,
    queryRunId: row.queryRunId,
    queryHash: row.queryHash,
    schemaFingerprint: row.schemaFingerprint,
    state: row.state as AnalysisQueryReceiptInput["state"],
    rowCount,
    byteCount,
    durationMs,
  };
}

export function parseAnalysisRunCompletion(
  value: unknown,
  definition: AnalysisArticleDefinition,
): AnalysisRunCompletion {
  const row = exactRecord(value, ["state", "queryReceipts", "error"])
    ?? parseLegacyAnalysisRunCompletionEnvelope(value);
  if (!row || typeof row.state !== "string"
    || !["succeeded", "failed", "cancelled", "stale"].includes(row.state)
    || !Array.isArray(row.queryReceipts) || row.queryReceipts.length > 1) {
    throw new Error("Invalid Analysis Article run completion");
  }
  const receipts = row.queryReceipts.map(parseReceipt);
  const query = definition.query;
  if (receipts.some((receipt) => receipt.queryNodeId !== query.id
    || receipt.rowCount > query.maxRows || receipt.byteCount > query.maxBytes)) {
    throw new Error("Analysis Article query receipt exceeds its definition");
  }
  const errorRow = row.error === null ? null : exactRecord(row.error, ["kind", "message"]);
  const error = errorRow && typeof errorRow.kind === "string" && errorRow.kind.length <= 128
    && !UNSAFE_DISPLAY.test(errorRow.kind) && typeof errorRow.message === "string"
    && errorRow.message.length <= 2_000 && !UNSAFE_DISPLAY.test(errorRow.message)
    ? { kind: errorRow.kind, message: errorRow.message }
    : null;
  const succeeded = row.state === "succeeded";
  if ((succeeded && (receipts.length !== 1 || receipts[0]?.state !== "succeeded" || error !== null))
    || (!succeeded && (receipts.length !== 0 || error === null))) {
    throw new Error("Analysis Article completion state is inconsistent");
  }
  return {
    state: row.state as AnalysisRunCompletion["state"],
    queryReceipts: receipts,
    error,
  };
}
