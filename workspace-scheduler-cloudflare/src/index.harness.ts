import { describe, expect, it, vi } from "vitest";

import worker, { __test, parseKick, parseSchedulerReceipt } from "./index";

type SchedulerRow = {
  task: "credential" | "maintenance";
  dueAtMs: number;
  leaseUntilMs: number;
  leaseToken: string | null;
  generation: number;
  failureCount: number;
};

function fakeDatabase(row: SchedulerRow) {
  return {
    prepare(query: string) {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) {
          values = bound;
          return this;
        },
        async first<T>() {
          const [leaseUntilMs, leaseToken, , task, dueAtMs, nowMs] = values;
          if (
            query.includes("RETURNING task, generation")
            && row.task === task
            && row.dueAtMs <= Number(dueAtMs)
            && row.leaseUntilMs <= Number(nowMs)
          ) {
            row.leaseUntilMs = Number(leaseUntilMs);
            row.leaseToken = String(leaseToken);
            row.generation += 1;
            return {
              task: row.task,
              generation: row.generation,
              failure_count: row.failureCount,
              lease_token: row.leaseToken,
            } as T;
          }
          return null;
        },
        async run() {
          if (query.includes("INSERT INTO workspace_background_task_v1")) {
            row.dueAtMs = Math.min(row.dueAtMs, Number(values[1]));
            row.generation += 1;
            row.failureCount = 0;
            return { meta: { changes: 1 } };
          }
          if (query.includes("WHERE task = ? AND generation = ?")) {
            const [nextRunAtMs, failureCount, , , task, generation, leaseToken] = values;
            if (
              row.task === task
              && row.generation === generation
              && row.leaseToken === leaseToken
            ) {
              row.dueAtMs = Number(nextRunAtMs);
              row.failureCount = Number(failureCount);
              row.leaseUntilMs = 0;
              row.leaseToken = null;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (query.includes("WHERE task = ? AND lease_token = ?")) {
            const [, task, leaseToken] = values;
            if (row.task === task && row.leaseToken === leaseToken) {
              row.leaseUntilMs = 0;
              row.leaseToken = null;
              return { meta: { changes: 1 } };
            }
          }
          return { meta: { changes: 0 } };
        },
      };
    },
  };
}

describe("Cloudflare workspace scheduler contract", () => {
  it("accepts only bounded closed kicks and a closed scheduler receipt", async () => {
    const now = Date.parse("2026-08-15T00:00:00Z");
    expect(parseKick({
      task: "credential",
      notBefore: "2026-08-15T00:00:30Z",
    }, now)).toEqual({ task: "credential", dueAtMs: now + 30_000 });
    expect(parseKick({
      task: "credential",
      notBefore: "2026-08-15T00:00:30Z",
      workspaceId: crypto.randomUUID(),
    }, now)).toBeNull();
    expect(parseKick({
      task: "unknown",
      notBefore: "2026-08-15T00:00:30Z",
    }, now)).toBeNull();
    expect(parseKick({
      task: "maintenance",
      notBefore: "2027-08-15T00:00:00Z",
    }, now)).toEqual({
      task: "maintenance",
      dueAtMs: Date.parse("2027-08-15T00:00:00Z"),
    });
    expect(parseKick({
      task: "maintenance",
      notBefore: "2027-08-17T00:00:01Z",
    }, now)).toBeNull();
    expect(parseSchedulerReceipt({
      scheduler: { contractVersion: 2, nextRunAt: "2026-08-15T01:00:00Z" },
      ok: true,
    }, now)).toBe(now + 60 * 60_000);
    expect(parseSchedulerReceipt({
      scheduler: { contractVersion: 2, nextRunAt: null },
    }, now)).toBe(Date.UTC(3000, 0, 1));
    expect(parseSchedulerReceipt({
      scheduler: { contractVersion: 1, nextRunAt: null },
    }, now)).toBeNull();
    expect(parseSchedulerReceipt({
      scheduler: {
        contractVersion: 2,
        nextRunAt: "2026-08-15T01:00:00Z",
        sourceId: crypto.randomUUID(),
      },
    }, now)).toBeNull();

    let writes = 0;
    const statement = {
      bind() { return this; },
      async run() { writes += 1; return { meta: { changes: 1 } }; },
    };
    const env = {
      SCHEDULER_DB: { prepare: vi.fn(() => statement) },
      KICK_TOKEN: "a".repeat(64),
      WORKSPACE_CRON_SECRET: "b".repeat(64),
      WORKSPACE_ORIGIN: "https://app.dopedb.dev",
    };
    const request = (token: string, body: string) => new Request(
      "https://dopedb-workspace-scheduler.test.workers.dev/v1/kick",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dopedb-background-scheduler-contract": "2",
          "x-dopedb-background-token": token,
        },
        body,
      },
    );
    const unauthorized = await worker.fetch(request("c".repeat(64), "{}"), env as never);
    expect(unauthorized.status).toBe(401);
    expect(writes).toBe(0);

    vi.spyOn(Date, "now").mockReturnValue(now);
    const accepted = await worker.fetch(request("a".repeat(64), JSON.stringify({
      task: "maintenance",
      notBefore: "2026-08-15T00:00:00Z",
    })), env as never);
    expect(accepted.status).toBe(202);
    expect(writes).toBe(1);
    vi.restoreAllMocks();
  });

  it("preserves a concurrent producer kick instead of overwriting it with an idle receipt", async () => {
    const now = Date.parse("2026-08-15T00:00:00Z");
    const row: SchedulerRow = {
      task: "credential",
      dueAtMs: now,
      leaseUntilMs: 0,
      leaseToken: null,
      generation: 0,
      failureCount: 0,
    };
    const database = fakeDatabase(row);
    const env = {
      SCHEDULER_DB: database,
      KICK_TOKEN: "a".repeat(64),
      WORKSPACE_CRON_SECRET: "b".repeat(64),
      WORKSPACE_ORIGIN: "https://app.dopedb.dev",
    };
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubGlobal("fetch", vi.fn(async () => {
      const kicked = await worker.fetch(new Request(
        "https://dopedb-workspace-scheduler.test.workers.dev/v1/kick",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dopedb-background-scheduler-contract": "2",
            "x-dopedb-background-token": "a".repeat(64),
          },
          body: JSON.stringify({
            task: "credential",
            notBefore: "2026-08-15T00:00:30Z",
          }),
        },
      ), env as never);
      expect(kicked.status).toBe(202);
      return Response.json(
        {
          ok: true,
          scheduler: {
            contractVersion: 2,
            nextRunAt: null,
          },
        },
        { headers: { "x-dopedb-background-scheduler-contract": "2" } },
      );
    }));

    await __test.executeTask(env as never, "credential", now);
    expect(row.dueAtMs).toBe(now);
    expect(row.leaseUntilMs).toBe(0);
    expect(row.leaseToken).toBeNull();
    expect(row.generation).toBe(2);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("never follows a redirect carrying the workspace cron capability", async () => {
    const now = Date.parse("2026-08-15T00:00:00Z");
    const row: SchedulerRow = {
      task: "maintenance",
      dueAtMs: now,
      leaseUntilMs: 0,
      leaseToken: null,
      generation: 0,
      failureCount: 0,
    };
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(null, {
      status: 307,
      headers: { location: "https://attacker.invalid/collect" },
    }));
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubGlobal("fetch", fetchMock);

    await __test.executeTask({
      SCHEDULER_DB: fakeDatabase(row),
      KICK_TOKEN: "a".repeat(64),
      WORKSPACE_CRON_SECRET: "b".repeat(64),
      WORKSPACE_ORIGIN: "https://app.dopedb.dev",
    } as never, "maintenance", now);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(row.failureCount).toBe(1);
    expect(row.dueAtMs).toBe(now + 60_000);

    row.dueAtMs = now;
    row.failureCount = 4;
    await __test.executeTask({
      SCHEDULER_DB: fakeDatabase(row),
      KICK_TOKEN: "a".repeat(64),
      WORKSPACE_CRON_SECRET: "b".repeat(64),
      WORKSPACE_ORIGIN: "https://app.dopedb.dev",
    } as never, "maintenance", now);
    expect(row.failureCount).toBe(5);
    expect(row.dueAtMs).toBe(now + 6 * 60 * 60_000);

    const kicked = await worker.fetch(new Request(
      "https://dopedb-workspace-scheduler.test.workers.dev/v1/kick",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dopedb-background-scheduler-contract": "2",
          "x-dopedb-background-token": "a".repeat(64),
        },
        body: JSON.stringify({
          task: "maintenance",
          notBefore: "2026-08-15T00:00:30Z",
        }),
      },
    ), {
      SCHEDULER_DB: fakeDatabase(row),
      KICK_TOKEN: "a".repeat(64),
      WORKSPACE_CRON_SECRET: "b".repeat(64),
      WORKSPACE_ORIGIN: "https://app.dopedb.dev",
    } as never);
    expect(kicked.status).toBe(202);
    expect(row.failureCount).toBe(0);
    expect(row.dueAtMs).toBe(now + 30_000);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
