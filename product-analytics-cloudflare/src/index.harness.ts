import { afterEach, describe, expect, it, vi } from "vitest";

import golden from "../../tests/fixtures/product-analytics-v1.json";
import worker, { parseEnvelope } from "./index";

describe("Cloudflare product analytics contract", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts the shared v1 golden and rejects free-form or stale mutations", async () => {
    const now = Date.parse("2026-08-14T00:01:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const value = structuredClone(golden);
    for (const event of value.events) event.occurredAt = "2026-08-14T00:00:00Z";
    const parsed = parseEnvelope(value, now);
    expect(parsed?.events).toHaveLength(golden.events.length);
    expect(parsed?.events.map((event) => event.name)).toEqual(
      golden.events.map((event) => event.name),
    );

    const freeForm = structuredClone(value);
    (freeForm.events[0] as unknown as { properties: Record<string, unknown> }).properties = {
      url: "https://private.example",
    };
    expect(parseEnvelope(freeForm, now)).toBeNull();

    const stale = structuredClone(value);
    stale.events[0].occurredAt = "2026-08-01T00:00:00Z";
    expect(parseEnvelope(stale, now)).toBeNull();

    const normalizedDate = structuredClone(value);
    normalizedDate.events[0].occurredAt = "2026-02-30T00:00:00Z";
    expect(parseEnvelope(normalizedDate, Date.parse("2026-03-01T00:00:00Z"))).toBeNull();

    expect(parseEnvelope({ ...value, appVersion: "1.2.3-.." }, now)).toBeNull();
    expect(parseEnvelope({ ...value, consentGeneration: 3 }, now)).toBeNull();

    let prepareCalls = 0;
    let batchSize = 0;
    let budgetAllowed = true;
    const database = {
      prepare(_query: string) {
        prepareCalls += 1;
        return {
          bind() { return this; },
          async first<T>() {
            return (budgetAllowed ? { event_count: value.events.length } : null) as T | null;
          },
        };
      },
      async batch<T>(statements: unknown[]): Promise<T[]> {
        batchSize = statements.length;
        return [];
      },
    };
    const request = (authorization: string) => new Request(
      "https://dopedb-product-analytics.test.workers.dev/v1/events",
      {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
          "x-dopedb-product-analytics-contract": "1",
        },
        body: JSON.stringify(value),
      },
    );
    const runtimeEnv = {
      ANALYTICS_DB: database,
      INGEST_TOKEN: "a".repeat(64),
    };
    const unauthorized = await worker.fetch(
      request(`Bearer ${"b".repeat(64)}`),
      runtimeEnv,
    );
    expect(unauthorized.status).toBe(401);
    expect(prepareCalls).toBe(0);

    const accepted = await worker.fetch(
      request(`Bearer ${"a".repeat(64)}`),
      runtimeEnv,
    );
    expect(accepted.status).toBe(202);
    expect(batchSize).toBe(value.events.length);
    expect(prepareCalls).toBe(value.events.length + 1);

    budgetAllowed = false;
    const rateLimited = await worker.fetch(
      request(`Bearer ${"a".repeat(64)}`),
      runtimeEnv,
    );
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("retry-after")).toBe("60");
    expect(batchSize).toBe(value.events.length);
    expect(prepareCalls).toBe(value.events.length + 2);
  });
});
