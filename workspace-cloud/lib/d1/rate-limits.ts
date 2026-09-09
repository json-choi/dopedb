import type { D1Database } from "@cloudflare/workers-types";

export async function consumeD1Budget(database: D1Database, input: {
  id: string;
  key: string;
  now: number;
  cutoff: number;
  limit: number;
  cost: number;
}) {
  if (![input.now, input.cutoff, input.limit, input.cost].every(Number.isSafeInteger)
    || input.limit < 1 || input.cost < 1 || input.cost > input.limit
    || input.cutoff >= input.now || !input.id || !input.key) {
    throw new Error("Invalid D1 request budget");
  }
  const results = await database.batch<{ value: number }>([
    database.prepare(`DELETE FROM rate_limit WHERE id IN (
      SELECT id FROM rate_limit WHERE last_request < ?
      ORDER BY last_request, id LIMIT 16
    )`).bind(input.cutoff),
    database.prepare(`INSERT INTO rate_limit (id, key, count, last_request)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET count = rate_limit.count + excluded.count,
        last_request = excluded.last_request
      WHERE rate_limit.count <= ? - excluded.count
      RETURNING count AS value
    `).bind(input.id, input.key, input.cost, input.now, input.limit),
  ]);
  const value = results[1]?.results[0]?.value;
  return results.every((result) => result.success)
    && typeof value === "number" && Number.isSafeInteger(value) && value <= input.limit;
}
