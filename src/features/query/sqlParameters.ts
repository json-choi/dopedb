// Finds SQL parameter tokens and materializes caller-provided expressions at their source ranges.

import type { ConnectionEngine } from "../connections/domain";

export type SqlParameter = {
  key: string;
  label: string;
  token: string;
  start: number;
  end: number;
};

function identifierStart(value: string | undefined) {
  return value !== undefined && /[A-Za-z_]/.test(value);
}

function identifierPart(value: string | undefined) {
  return value !== undefined && /[A-Za-z0-9_.]/.test(value);
}

function skipQuoted(sql: string, start: number, quote: string) {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "\\") {
      index += 2;
      continue;
    }
    if (sql[index] !== quote) {
      index += 1;
      continue;
    }
    if (sql[index + 1] === quote) {
      index += 2;
      continue;
    }
    return index + 1;
  }
  return sql.length;
}

function dollarQuoteTag(sql: string, start: number) {
  return /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(
    sql.slice(start),
  )?.[0] ?? null;
}

function pushNamed(
  parameters: SqlParameter[],
  namedKeys: Map<string, string>,
  label: string,
  token: string,
  start: number,
  end: number,
) {
  const key = namedKeys.get(label) ?? `named:${label}`;
  namedKeys.set(label, key);
  parameters.push({ key, label, token, start, end });
}

/**
 * Finds the parameter shapes supported by DopeDB query documents while
 * ignoring quoted strings, identifiers, comments, and PostgreSQL dollar quotes.
 *
 * Supported shapes:
 * - named: `${name}`, `:name`, `?name`, `?12`, `$1`
 * - positional: `?` (SQLite/MySQL only; each occurrence is independent)
 */
export function findSqlParameters(
  sql: string,
  engine: ConnectionEngine,
): SqlParameter[] {
  const parameters: SqlParameter[] = [];
  const namedKeys = new Map<string, string>();
  let positionalIndex = 0;
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    if (char === "'" || char === '"' || char === "`") {
      index = skipQuoted(sql, index, char);
      continue;
    }
    if (char === "-" && sql[index + 1] === "-") {
      const lineEnd = sql.indexOf("\n", index + 2);
      index = lineEnd < 0 ? sql.length : lineEnd + 1;
      continue;
    }
    if (char === "/" && sql[index + 1] === "*") {
      const commentEnd = sql.indexOf("*/", index + 2);
      index = commentEnd < 0 ? sql.length : commentEnd + 2;
      continue;
    }
    if (engine === "mysql" && char === "#") {
      const lineEnd = sql.indexOf("\n", index + 1);
      index = lineEnd < 0 ? sql.length : lineEnd + 1;
      continue;
    }
    if (char === "$") {
      if (sql[index + 1] === "{") {
        const end = sql.indexOf("}", index + 2);
        if (end > index + 2) {
          const label = sql.slice(index + 2, end).trim();
          if (label) {
            pushNamed(
              parameters,
              namedKeys,
              label,
              sql.slice(index, end + 1),
              index,
              end + 1,
            );
            index = end + 1;
            continue;
          }
        }
      }
      const quoteTag = dollarQuoteTag(sql, index);
      if (quoteTag) {
        const end = sql.indexOf(quoteTag, index + quoteTag.length);
        index = end < 0 ? sql.length : end + quoteTag.length;
        continue;
      }
      if (/[0-9]/.test(sql[index + 1] ?? "")) {
        let end = index + 2;
        while (/[0-9]/.test(sql[end] ?? "")) end += 1;
        const label = sql.slice(index + 1, end);
        pushNamed(
          parameters,
          namedKeys,
          label,
          sql.slice(index, end),
          index,
          end,
        );
        index = end;
        continue;
      }
    }
    if (
      char === ":" &&
      sql[index - 1] !== ":" &&
      sql[index + 1] !== "=" &&
      identifierStart(sql[index + 1])
    ) {
      let end = index + 2;
      while (identifierPart(sql[end])) end += 1;
      const label = sql.slice(index + 1, end);
      pushNamed(
        parameters,
        namedKeys,
        label,
        sql.slice(index, end),
        index,
        end,
      );
      index = end;
      continue;
    }
    if (char === "?") {
      let end = index + 1;
      while (identifierPart(sql[end])) end += 1;
      if (end > index + 1) {
        const label = sql.slice(index + 1, end);
        pushNamed(
          parameters,
          namedKeys,
          label,
          sql.slice(index, end),
          index,
          end,
        );
        index = end;
        continue;
      }
      if (engine !== "postgres") {
        positionalIndex += 1;
        parameters.push({
          key: `positional:${positionalIndex}`,
          label: String(positionalIndex),
          token: "?",
          start: index,
          end: index + 1,
        });
      }
    }
    index += 1;
  }

  return parameters;
}

export function uniqueSqlParameters(parameters: SqlParameter[]) {
  const seen = new Set<string>();
  return parameters.filter((parameter) => {
    if (seen.has(parameter.key)) return false;
    seen.add(parameter.key);
    return true;
  });
}

/**
 * DopeDB query parameters are SQL fragments, not string-only values. The
 * materialized SQL still travels through DopeDB's authoritative classifier,
 * immutable proposal, approval, and execution path.
 */
export function materializeSqlParameters(
  sql: string,
  parameters: SqlParameter[],
  values: Record<string, string>,
) {
  let materialized = sql;
  for (const parameter of [...parameters].reverse()) {
    const value = values[parameter.key]?.trim();
    if (!value) {
      throw new Error(`Missing SQL parameter: ${parameter.label}`);
    }
    materialized =
      materialized.slice(0, parameter.start) +
      value +
      materialized.slice(parameter.end);
  }
  return materialized;
}
