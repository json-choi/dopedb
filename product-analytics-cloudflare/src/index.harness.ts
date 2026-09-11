import { afterEach, describe, expect, it, vi } from "vitest";

import golden from "../../tests/fixtures/product-analytics-v1.json";
import worker, { parseEnvelope } from "./index";
import { AnalyticsBudget } from "./ingest-budget";
import { appendBigQuery } from "./bigquery";

describe("Cloudflare product analytics contract", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

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

    for (const appVersion of ["0.3.98", "1.0.0-alpha.1+darwin-arm64"]) {
      expect(parseEnvelope({ ...value, appVersion }, now), appVersion).not.toBeNull();
    }
    expect(parseEnvelope({ ...value, appVersion: "1.2.3-.." }, now)).toBeNull();
    expect(parseEnvelope({ ...value, appVersion: "01.2.3" }, now)).toBeNull();
    expect(parseEnvelope({
      ...value,
      appVersion: `1.0.0-${"--.".repeat(40)}`,
    }, now)).toBeNull();
    expect(parseEnvelope({ ...value, consentGeneration: 3 }, now)).toBeNull();

    let budgetCalls = 0;
    let budgetAllowed = true;
    let insertErrors: unknown = undefined;
    const inserted: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.redirect).toBe("manual");
      const body = JSON.parse(init.body as string);
      if (url.includes("sts.googleapis.com")) {
        expect(body.audience).toContain("/dopedb-analytics/");
        return Response.json({ access_token: "f".repeat(30) });
      }
      if (url.includes("iamcredentials.googleapis.com")) {
        expect(url).toContain("dopedb-analytics-ingest@");
        expect(body.scope).toEqual(["https://www.googleapis.com/auth/bigquery.insertdata"]);
        return Response.json({ accessToken: "g".repeat(30) });
      }
      expect(url).toBe("https://bigquery.googleapis.com/bigquery/v2/projects/dopedb-503203/datasets/product_analytics/tables/events_raw/insertAll");
      inserted.push(body);
      return Response.json({ kind: "bigquery#tableDataInsertAllResponse", ...(insertErrors === undefined ? {} : { insertErrors }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const request = () => new Request(
      "https://dopedb-product-analytics.test.workers.dev/v1/events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dopedb-product-analytics-contract": "2",
        },
        body: JSON.stringify(value),
      },
    );
    const runtimeEnv = {
      INGEST_BUDGET: {
        idFromName(name: string) { expect(name).toBe("global"); return name; },
        get() { return { async fetch() { budgetCalls++; return new Response(null, { status: budgetAllowed ? 204 : 429 }); } }; },
      },
      ANALYTICS_IDENTITY: { async fetch() { return Response.json({ token: "i".repeat(100) }); } },
      BIGQUERY_PROJECT: "dopedb-503203", BIGQUERY_DATASET: "product_analytics", BIGQUERY_TABLE: "events_raw",
      BIGQUERY_SERVICE_ACCOUNT: "dopedb-analytics-ingest@dopedb-503203.iam.gserviceaccount.com",
      BIGQUERY_WIF_AUDIENCE: "//iam.googleapis.com/projects/461953058911/locations/global/workloadIdentityPools/dopedb-analytics/providers/cloudflare",
    };
    const authorized = request;
    const oldClient = authorized(); oldClient.headers.set("x-dopedb-product-analytics-contract", "1");
    expect((await worker.fetch(oldClient, runtimeEnv)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(budgetCalls).toBe(0);
    expect((await worker.fetch(authorized(), runtimeEnv)).status).toBe(202);
    expect(inserted[0]).toMatchObject({ skipInvalidRows: false, ignoreUnknownValues: false,
      rows: value.events.map((event) => ({ insertId: event.eventId, json: { event_id: event.eventId } })) });
    const writes = inserted.length;
    budgetAllowed = false;
    const rateLimited = await worker.fetch(authorized(), runtimeEnv);
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("retry-after")).toBe("60");
    expect(inserted).toHaveLength(writes);
    budgetAllowed = true;
    insertErrors = [{ index: 0, errors: [{ reason: "backendError" }] }];
    expect((await worker.fetch(authorized(), runtimeEnv)).status).toBe(503);
    insertErrors = "malformed";
    expect((await worker.fetch(authorized(), runtimeEnv)).status).toBe(503);
    insertErrors = [];
    expect((await worker.fetch(authorized(), runtimeEnv)).status).toBe(202);
    expect(inserted[0]).toEqual(inserted[inserted.length - 1]);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect((await worker.fetch(authorized(), runtimeEnv)).status).toBe(503);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://untrusted.invalid/" } }));
    expect((await worker.fetch(authorized(), runtimeEnv)).status).toBe(503);
    await expect(appendBigQuery({ ...runtimeEnv, BIGQUERY_PROJECT: "other-project" }, [])).rejects.toThrow();

    let stored: { minute: number; count: number } | undefined;
    type TestStorage = {
      get<T>(): Promise<T | undefined>;
      put(key: string, value: { minute: number; count: number }): Promise<void>;
      transaction<T>(callback: (tx: TestStorage) => Promise<T>): Promise<T>;
    };
    const storage: TestStorage = {
      async get<T>() { return stored as T | undefined; },
      async put(_key: string, value: { minute: number; count: number }) { stored = value; },
      async transaction<T>(callback: (tx: TestStorage) => Promise<T>): Promise<T> { return callback(storage); },
    };
    const counter = new AnalyticsBudget({ storage });
    const consume = (count: number) => counter.fetch(new Request(`https://budget.internal/?count=${count}`, { method: "POST" }));
    expect((await consume(15)).status).toBe(204);
    expect((await consume(2)).status).toBe(429);
    expect((await consume(1)).status).toBe(204);
    expect(stored?.count).toBe(16);
    vi.setSystemTime(now + 60_000);
    expect((await consume(16)).status).toBe(204);
    expect((await consume(0)).status).toBe(400);
  });
});
