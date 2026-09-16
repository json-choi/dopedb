// Resolves the caret's SQL namespace from the selected mode and preceding script statements.

import type { ConnectionEngine } from "../connections/domain";

export type SqlResolveMode = "playground" | "script";

export const DEFAULT_SQL_RESOLVE_MODE: SqlResolveMode = "playground";

function maskNonCode(sql: string): string {
  let masked = "";
  let index = 0;
  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];
    if (current === "'" || current === '"') {
      const quote = current;
      masked += quote;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            masked += quote.repeat(2);
            index += 2;
            continue;
          }
          masked += quote;
          index += 1;
          break;
        }
        masked += quote === "'" ? " " : sql[index];
        index += 1;
      }
      continue;
    }
    if (current === "`") {
      masked += current;
      index += 1;
      while (index < sql.length) {
        masked += sql[index];
        if (sql[index] === "`") {
          if (sql[index + 1] === "`") {
            masked += "`";
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (current === "-" && next === "-") {
      masked += "  ";
      index += 2;
      while (index < sql.length && sql[index] !== "\n") {
        masked += " ";
        index += 1;
      }
      continue;
    }
    if (current === "/" && next === "*") {
      masked += "  ";
      index += 2;
      while (
        index < sql.length &&
        !(sql[index] === "*" && sql[index + 1] === "/")
      ) {
        masked += sql[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index < sql.length) {
        masked += "  ";
        index += 2;
      }
      continue;
    }
    if (current === "$") {
      const tag = /^\$[A-Za-z_]?[A-Za-z0-9_]*\$/.exec(sql.slice(index))?.[0];
      if (tag) {
        masked += " ".repeat(tag.length);
        index += tag.length;
        const end = sql.indexOf(tag, index);
        const contentEnd = end < 0 ? sql.length : end;
        masked += sql
          .slice(index, contentEnd)
          .replace(/[^\n]/g, " ");
        if (end < 0) break;
        masked += " ".repeat(tag.length);
        index = end + tag.length;
        continue;
      }
    }
    masked += current;
    index += 1;
  }
  return masked;
}

function identifier(value: string): string {
  if (value.startsWith('"')) {
    return value.slice(1, -1).replace(/""/g, '"');
  }
  if (value.startsWith("`")) {
    return value.slice(1, -1).replace(/``/g, "`");
  }
  return value;
}

function lastMatch(
  sql: string,
  pattern: RegExp,
): { index: number; namespace: string } | null {
  let latest: { index: number; namespace: string } | null = null;
  for (const match of sql.matchAll(pattern)) {
    const raw = match[1];
    if (!raw || match.index === undefined) continue;
    latest = { index: match.index, namespace: identifier(raw) };
  }
  return latest;
}

/**
 * Resolve the default namespace used by editor completion at the current caret.
 * Execution remains authoritative in Rust; this preserves the code-resolution
 * distinction without treating a UI mode as an execution-policy bypass.
 */
export function resolveSqlNamespaceAtCaret({
  sqlBeforeCaret,
  engine,
  mode,
  selectedNamespace,
  namespaceOptions,
}: {
  sqlBeforeCaret: string;
  engine: ConnectionEngine;
  mode: SqlResolveMode;
  selectedNamespace: string;
  namespaceOptions: readonly string[];
}): string {
  if (mode === "playground") return selectedNamespace;

  const sql = maskNonCode(sqlBeforeCaret);
  const directive =
    engine === "postgres"
      ? lastMatch(
          sql,
          /\bSET\s+(?:(?:LOCAL|SESSION)\s+)?search_path\s*(?:TO|=)\s*("(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)/gi,
        )
      : engine === "mysql"
        ? lastMatch(
            sql,
            /\bUSE\s+(`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_$]*)/gi,
          )
        : null;

  return directive && namespaceOptions.includes(directive.namespace)
    ? directive.namespace
    : selectedNamespace;
}
