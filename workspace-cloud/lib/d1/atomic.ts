import "server-only";

import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";
import { createWorkspaceD1, workspaceD1 } from "./database";

/**
 * Materialize a validated authority/resource snapshot inside the same D1 batch
 * that consumes it. `scope` must select at most one JSON object named `payload`.
 * Every mutation must select from the supplied relation; no matching scope then
 * means no mutations. The scratch row is deleted in that batch, never later.
 */
export async function atomicD1(input: {
  scope: SQL;
  statements: (scope: SQL) => readonly SQL[];
}, binding: D1Database = workspaceD1()) {
  const id = randomUUID();
  const context = sql`SELECT payload FROM workspace_atomic_scope WHERE id = ${id}`;
  const mutations = input.statements(context);
  if (mutations.length === 0 || mutations.length > 998) {
    throw new Error("Invalid Workspace atomic operation");
  }
  const db = createWorkspaceD1(binding);
  const results = await binding.batch<Record<string, unknown>>([
    db.statement(sql`INSERT INTO workspace_atomic_scope (id, payload)
      SELECT ${id}, payload FROM (${input.scope}) RETURNING id`),
    ...mutations.map((statement) => db.statement(statement)),
    db.statement(sql`DELETE FROM workspace_atomic_scope WHERE id = ${id}`),
  ]);
  if (results.some((result) => !result.success)) throw new Error("Workspace atomic operation failed");
  return { matched: results[0].results.length === 1, rows: results.slice(1, -1).map((result) => result.results) };
}
