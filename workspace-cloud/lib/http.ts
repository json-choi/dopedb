/** Prevent browsers and intermediary caches from retaining identity-scoped payloads. */
export function privateJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store");
  return Response.json(data, { ...init, headers });
}

/**
 * Vercel evaluates a legacy `If-Match` request against the response ETag after
 * a Route Handler has already run. Older Desktop builds therefore received a
 * synthetic 412 after a successful mutation. Echo the legacy validator only
 * on the non-cacheable success response while new clients use DopeDB's
 * dedicated expected-revision header.
 */
export function privateRevisionMutationJson(
  request: Request,
  data: unknown,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  const legacyValidator = request.headers.get("if-match");
  if (legacyValidator !== null) headers.set("etag", legacyValidator);
  return privateJson(data, { ...init, headers });
}

export function privateRevisionMutationResponse(
  request: Request,
  body: BodyInit | null,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store");
  const legacyValidator = request.headers.get("if-match");
  if (legacyValidator !== null) headers.set("etag", legacyValidator);
  return new Response(body, { ...init, headers });
}

type JsonPrimitive = string | number | boolean | null;

function normalizedJsonValue(value: unknown, key: string): unknown {
  if (value && typeof value === "object" && "toJSON" in value
    && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return (value as { toJSON(key: string): unknown }).toJSON(key);
  }
  if (value instanceof Number || value instanceof String || value instanceof Boolean) {
    return value.valueOf();
  }
  if (Object.prototype.toString.call(value) === "[object BigInt]") {
    return (value as { valueOf(): bigint }).valueOf();
  }
  return value;
}

function omittedJsonValue(value: unknown) {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

function* jsonTokens(value: unknown, ancestors: Set<object>): Generator<string> {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    yield JSON.stringify(value as JsonPrimitive);
    return;
  }
  if (typeof value === "number") {
    yield Number.isFinite(value) ? JSON.stringify(value) : "null";
    return;
  }
  if (typeof value === "bigint") throw new TypeError("BigInt is not JSON serializable");
  if (!value || typeof value !== "object") throw new TypeError("Value is not JSON serializable");
  if (ancestors.has(value)) throw new TypeError("Converting circular structure to JSON");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      yield "[";
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) yield ",";
        const child = normalizedJsonValue(value[index], String(index));
        if (omittedJsonValue(child)) yield "null";
        else yield* jsonTokens(child, ancestors);
      }
      yield "]";
      return;
    }
    yield "{";
    let emitted = false;
    for (const key of Object.keys(value)) {
      const child = normalizedJsonValue((value as Record<string, unknown>)[key], key);
      if (omittedJsonValue(child)) continue;
      if (emitted) yield ",";
      emitted = true;
      yield JSON.stringify(key);
      yield ":";
      yield* jsonTokens(child, ancestors);
    }
    yield "}";
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Incrementally serializes private JSON. This avoids both Vercel's buffered
 * response ceiling and a second full-size stringify/UTF-8 allocation while the
 * stream's pull contract provides downstream backpressure.
 */
export function privateJsonStream(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  const root = normalizedJsonValue(data, "");
  if (omittedJsonValue(root)) throw new TypeError("Value is not JSON serializable");
  const iterator = jsonTokens(root, new Set<object>());
  const encoder = new TextEncoder();
  let pending: Uint8Array | null = null;
  let pendingOffset = 0;
  let finished = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunkBytes = 64 * 1024;
      try {
        if (pending && pendingOffset < pending.byteLength) {
          const end = Math.min(pendingOffset + chunkBytes, pending.byteLength);
          controller.enqueue(pending.subarray(pendingOffset, end));
          pendingOffset = end;
          if (pendingOffset >= pending.byteLength) {
            pending = null;
            pendingOffset = 0;
          }
          return;
        }
        if (finished) {
          controller.close();
          return;
        }
        const tokens: string[] = [];
        let characters = 0;
        while (characters < 32 * 1024) {
          const next = iterator.next();
          if (next.done) {
            finished = true;
            break;
          }
          tokens.push(next.value);
          characters += next.value.length;
        }
        if (tokens.length === 0) {
          controller.close();
          return;
        }
        pending = encoder.encode(tokens.join(""));
        const end = Math.min(chunkBytes, pending.byteLength);
        controller.enqueue(pending.subarray(0, end));
        pendingOffset = end;
        if (pendingOffset >= pending.byteLength) {
          pending = null;
          pendingOffset = 0;
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(body, { ...init, headers });
}

export function jsonError(message: string, status: number, code?: string) {
  return privateJson(
    code === undefined ? { error: message } : { error: message, code },
    { status },
  );
}

export function mutationAllowed(request: Request, appOrigin: string) {
  if (request.headers.get("authorization")?.startsWith("Bearer ")) return true;
  return request.headers.get("origin") === appOrigin;
}

/** Reads one JSON request without trusting Content-Length or buffering forever. */
export async function boundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid" | "too_large" }
> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !request.body) {
    return { ok: false, reason: "invalid" };
  }
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null) {
    if (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > maxBytes) {
      await request.body.cancel().catch(() => undefined);
      return {
        ok: false,
        reason: /^\d+$/.test(lengthHeader) ? "too_large" : "invalid",
      };
    }
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      ok: true,
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    };
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason: "invalid" };
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

export function isSafeDisplayText(value: string, maxLength: number): boolean {
  return value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function singleLineText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function safeReturnTo(value: string | null, fallback = "/settings"): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (
      decoded.startsWith("//") ||
      decoded.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(decoded)
    ) {
      return fallback;
    }
    const base = "https://return.dopedb.invalid";
    const target = new URL(value, base);
    if (target.origin !== base) return fallback;
    // OAuth callbacks are server requests, so browser-only fragments cannot be
    // round-tripped and Better Auth rejects them as callback URLs.
    return `${target.pathname}${target.search}`;
  } catch {
    return fallback;
  }
}
