import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import * as schema from "./schema";

const dialect = new SQLiteSyncDialect();

export function workspaceD1(): D1Database {
  const binding = getCloudflareContext().env.WORKSPACE_DB;
  if (!binding) throw new Error("Workspace D1 binding is unavailable");
  return binding;
}

export function createWorkspaceD1(binding: D1Database) {
  const orm = drizzle(binding, { schema });
  return {
    // D1 only supports predeclared atomic batches, not callback transactions.
    orm: orm as Omit<typeof orm, "transaction">,
    statement(query: SQL): D1PreparedStatement {
      const { sql: text, params } = dialect.sqlToQuery(query);
      if (params.length > 100) throw new Error("Workspace query exceeds the D1 parameter limit");
      return binding.prepare(text).bind(...params.map((value: unknown) => {
        if (value instanceof Date) return value.toISOString();
        if (typeof value === "boolean") return value ? 1 : 0;
        if (typeof value === "bigint") {
          const number = Number(value);
          if (!Number.isSafeInteger(number) || BigInt(number) !== value) {
            throw new Error("Workspace integer exceeds the exact D1 range");
          }
          return number;
        }
        return value;
      }));
    },
  };
}

// Bind per operation: a global ORM must not capture a request's Worker binding.
export async function queryD1<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
  const db = createWorkspaceD1(workspaceD1());
  const result = await db.statement(query).all<T>();
  if (!result.success) throw new Error("Workspace query failed");
  return result.results;
}

export async function batchD1(queries: readonly SQL[]): Promise<Record<string, unknown>[][]> {
  if (queries.length === 0 || queries.length > 1000) throw new Error("Invalid Workspace batch size");
  const binding = workspaceD1();
  const db = createWorkspaceD1(binding);
  const results = await binding.batch<Record<string, unknown>>(queries.map((query) => db.statement(query)));
  if (results.some((result) => !result.success)) throw new Error("Workspace atomic batch failed");
  return results.map((result) => result.results);
}

type WorkspaceD1Orm = ReturnType<typeof createWorkspaceD1>["orm"];
export const d1Db = new Proxy({} as WorkspaceD1Orm, {
  get(_target, property) {
    const orm = createWorkspaceD1(workspaceD1()).orm;
    const value = Reflect.get(orm, property, orm);
    return typeof value === "function" ? value.bind(orm) : value;
  },
});
