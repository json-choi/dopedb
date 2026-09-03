// Bounded, retry-aware transport shared by Cloud SQL discovery and managed
// credential issuance. Callers retain resource and authorization policy.
import "server-only";

import { boundedJsonResponse } from "../bounded-json-response";
import { logGcpManagedAccessUpstreamRejection } from "../workspace-server-log";
import { normalizeGcpUpstreamStatus } from "./gcp-cloud-sql-core";
import { ProviderRequestError } from "./provider-types";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TRANSIENT_REQUEST_ATTEMPTS = 3;
const TRANSIENT_RETRY_BASE_MS = 500;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1_024;
const MAX_SQL_ADMIN_RESPONSE_BYTES = 512 * 1_024;

type JsonObject = Record<string, unknown>;

export type GcpRequestStage =
  | "federation"
  | "serviceAccount"
  | "iam.serviceAccountPolicy"
  | "cloudSqlAdmin.connectSettings"
  | "cloudSqlAdmin.instance";

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderRequestError("gcpCloudSql", "GCP returned an invalid response", 502);
  }
  return value as JsonObject;
}

function googleErrorReason(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const details = (value as JsonObject).details;
  if (!Array.isArray(details)) return null;
  for (const detail of details) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) continue;
    const reason = (detail as JsonObject).reason;
    if (typeof reason === "string" && /^[A-Z0-9_]{1,128}$/.test(reason)) {
      return reason;
    }
  }
  return null;
}

function transientGcpStatus(status: number) {
  return status === 408
    || status === 429
    || status === 500
    || status === 502
    || status === 503
    || status === 504;
}

// These calls are short-lived token issuance or read-only Cloud SQL
// inspection. Retrying cannot widen authority; callers keep the outer 45s
// provider-authority deadline.
async function waitForTransientRetry(attempt: number, deadline: number) {
  const exponential = TRANSIENT_RETRY_BASE_MS * (2 ** attempt);
  const jitter = Math.floor(Math.random() * TRANSIENT_RETRY_BASE_MS);
  const delay = exponential + jitter;
  if (Date.now() + delay >= deadline) return false;
  await new Promise((resolve) => setTimeout(resolve, delay));
  return true;
}

export async function gcpJsonRequest(
  stage: GcpRequestStage,
  url: string,
  init: RequestInit,
) {
  const responseLimit = stage.startsWith("cloudSqlAdmin.")
    ? MAX_SQL_ADMIN_RESPONSE_BYTES
    : MAX_TOKEN_RESPONSE_BYTES;
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let response: Response | null = null;
  let body: unknown = null;
  for (let attempt = 0; attempt < MAX_TRANSIENT_REQUEST_ATTEMPTS; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(Math.max(1, remainingMs)),
    }).catch(() => null);
    body = response
      ? await boundedJsonResponse(response, responseLimit).catch(() => null)
      : null;
    if (response?.ok) return object(body);
    const retryable = response === null || transientGcpStatus(response.status);
    if (
      !retryable
      || attempt + 1 >= MAX_TRANSIENT_REQUEST_ATTEMPTS
      || !await waitForTransientRetry(attempt, deadline)
    ) break;
  }
  if (!response) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Google Cloud is temporarily unavailable. Retry the query.",
      503,
    );
  }
  const transient = transientGcpStatus(response.status);
  const status = transient ? 503 : normalizeGcpUpstreamStatus(response.status);
  const googleError = body && typeof body === "object" && !Array.isArray(body)
    ? (body as JsonObject).error
    : null;
  const googleStatus = googleError && typeof googleError === "object"
    && !Array.isArray(googleError)
    && typeof (googleError as JsonObject).status === "string"
    ? (googleError as JsonObject).status
    : null;
  const googleReason = googleErrorReason(googleError);
  logGcpManagedAccessUpstreamRejection({
    stage,
    upstreamStatus: response.status,
    googleStatus,
    googleReason,
  });
  const message = transient
    ? "Google Cloud temporarily could not issue managed database access. Retry the query."
    : stage === "federation"
      ? "GCP Workload Identity rejected the DopeDB deployment"
      : stage === "serviceAccount"
        ? "GCP service-account token issuance was denied"
        : stage === "iam.serviceAccountPolicy"
          ? "GCP schema service-account policy could not be verified"
          : "Cloud SQL Admin denied the managed access check";
  throw new ProviderRequestError("gcpCloudSql", message, status);
}
