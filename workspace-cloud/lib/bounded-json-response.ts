/**
 * Provider-neutral response boundary for JSON fetched from hosted upstreams.
 * It never trusts Content-Length, never decodes replacement characters, and
 * never includes an upstream body in the surfaced error.
 */

export type BoundedJsonResponseFailure =
  | "invalid"
  | "oversized"
  | "unavailable";

export class BoundedJsonResponseError extends Error {
  readonly failure: BoundedJsonResponseFailure;

  constructor(failure: BoundedJsonResponseFailure) {
    super(`bounded JSON response ${failure}`);
    this.name = "BoundedJsonResponseError";
    this.failure = failure;
  }
}

function jsonMediaType(value: string | null) {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

// Keep the consumed interface structural across browser, Node and Workers types.
type JsonResponseBody = {
  cancel(reason?: unknown): Promise<void>;
  getReader(): {
    read(): Promise<{ done: true; value?: unknown } | { done: false; value: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
  };
} | null;

async function cancel(body: JsonResponseBody) {
  await body?.cancel().catch(() => undefined);
}

/** Reads and parses one JSON response under an exact streamed byte cap. */
export async function boundedJsonResponse(
  response: { headers: Pick<Headers, "get">; body: JsonResponseBody },
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    await cancel(response.body);
    throw new BoundedJsonResponseError("invalid");
  }
  if (!jsonMediaType(response.headers.get("content-type"))) {
    await cancel(response.body);
    throw new BoundedJsonResponseError("invalid");
  }

  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    if (!/^\d+$/.test(lengthHeader)) {
      await cancel(response.body);
      throw new BoundedJsonResponseError("invalid");
    }
    const declaredLength = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
      await cancel(response.body);
      throw new BoundedJsonResponseError("oversized");
    }
  }
  if (!response.body) {
    throw new BoundedJsonResponseError("invalid");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - total) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedJsonResponseError("oversized");
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof BoundedJsonResponseError) throw error;
    throw new BoundedJsonResponseError("unavailable");
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new BoundedJsonResponseError("invalid");
  }
}
