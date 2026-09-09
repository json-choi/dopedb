import { sql, type SQLWrapper } from "drizzle-orm";

/** Compare JSON values by path, scalar value and container kind, ignoring object key order. */
export function jsonEqual(left: SQLWrapper, right: SQLWrapper) {
  const nodes = (value: SQLWrapper) => sql`SELECT fullkey,
    CASE WHEN type IN ('integer', 'real') THEN 'number' ELSE type END AS kind, atom
    FROM json_tree(${value})`;
  return sql`(${left} IS NOT NULL AND ${right} IS NOT NULL
    AND NOT EXISTS (${nodes(left)} EXCEPT ${nodes(right)})
    AND NOT EXISTS (${nodes(right)} EXCEPT ${nodes(left)}))`;
}

/** Keep a bounded ID inventory in one binding instead of one parameter per ID. */
export function inD1Strings(column: SQLWrapper, values: readonly string[]) {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}
