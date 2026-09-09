import "server-only";
import type { SQL } from "drizzle-orm";
import { d1Db, queryD1 } from "./d1/database";

type WorkspaceDb = Omit<typeof d1Db, "batch"> & {
  execute<T extends Record<string, unknown> = Record<string, unknown>>(query: SQL): Promise<{ rows: T[] }>;
};

// Preserve the application's row envelope while executing native SQLite SQL.
// Mutations spanning statements use atomicD1, never callback transactions.
export const db = new Proxy({} as WorkspaceDb, {
  get(_target, property) {
    if (property === "execute") return async <T extends Record<string, unknown>>(query: SQL) => ({ rows: await queryD1<T>(query) });
    const value = Reflect.get(d1Db, property, d1Db);
    return typeof value === "function" ? value.bind(d1Db) : value;
  },
});
