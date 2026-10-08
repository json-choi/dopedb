// Converts Better Auth endpoint failures raised inside workspace API routes into the
// same bounded `{ error, code? }` JSON every native and browser client already reads.
import "server-only";

import { isAPIError } from "better-auth/api";
import { jsonError } from "./http";

/**
 * Returns a JSON error for a Better Auth `APIError` and rethrows anything else.
 * Unknown failures keep surfacing as server errors instead of being relabelled.
 */
export function betterAuthErrorResponse(error: unknown, fallback: string): Response {
  if (!isAPIError(error)) throw error;
  const status = Number.isInteger(error.statusCode)
    && error.statusCode >= 400
    && error.statusCode <= 599
    ? error.statusCode
    : 400;
  const body = error.body as { message?: unknown; code?: unknown } | undefined;
  const message = typeof body?.message === "string"
    && body.message.length > 0
    && body.message.length <= 512
    ? body.message
    : fallback;
  const code = typeof body?.code === "string" && /^[A-Z0-9_]{1,96}$/.test(body.code)
    ? body.code
    : undefined;
  return jsonError(message, status, code);
}
