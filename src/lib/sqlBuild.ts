// Pure SQL + export string builders for the data grid. No React, no IPC — everything
// here is unit-testable. Engine-aware identifier quoting is reused from tableRef;
// literal escaping + WHERE/ORDER BY/paging/DML builders live here so pagination is
// stable (always ordered) and generated writes are injection-safe.
import type { CatalogColumn, CatalogTable, Engine } from "../ipc/types";
import { decodeGridValueFilter } from "./gridValueFilter";
import { quoteIdent, tableRef } from "./tableRef";

export interface GridSort {
  col: string;
  dir: "asc" | "desc";
}

export type GridExpressionKind = "where" | "orderBy";

export type GridExpressionIssue =
  | "tooLong"
  | "statementBoundary"
  | "unbalanced"
  | "clauseBoundary";

// The data editor accepts SQL-dialect fragments in its WHERE and ORDER BY fields. These
// fragments still pass through the backend read-only proposal gate, but we also keep
// them inside their generated clause: comments, statement separators and clause
// escapes must not be able to swallow the mandatory LIMIT or append a second query.
export function gridExpressionIssue(
  kind: GridExpressionKind,
  raw: string,
): GridExpressionIssue | null {
  if (raw.length > 2_048) return "tooLong";
  let visible = "";
  let quote: "'" | '"' | "`" | "]" | null = null;
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (quote) {
      visible += " ";
      if (quote === "]") {
        if (char === "]") quote = null;
      } else if (char === quote) {
        if (next === quote) {
          visible += " ";
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      visible += " ";
      continue;
    }
    if (char === "[") {
      quote = "]";
      visible += " ";
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth < 0) return "unbalanced";
    }
    visible += char;
  }
  if (quote || depth !== 0) return "unbalanced";
  if (
    visible.includes("\0") ||
    visible.includes(";") ||
    visible.includes("--") ||
    visible.includes("/*") ||
    visible.includes("*/") ||
    /(^|\s)#/.test(visible)
  ) {
    return "statementBoundary";
  }
  const clauseEscape =
    kind === "where"
      ? /\b(?:union|intersect|except|order\s+by|limit|offset|fetch|returning)\b/i
      : /\b(?:select|from|where|group\s+by|having|union|intersect|except|limit|offset|fetch|returning)\b/i;
  return clauseEscape.test(visible) ? "clauseBoundary" : null;
}

function assertGridExpression(kind: GridExpressionKind, raw: string) {
  const issue = gridExpressionIssue(kind, raw);
  if (issue) {
    throw new Error(`invalid ${kind === "where" ? "WHERE" : "ORDER BY"} expression: ${issue}`);
  }
}

// A SQL string literal. Single quotes are doubled for every engine; backslashes are
// doubled for MySQL, which treats "\" as an escape char unless NO_BACKSLASH_ESCAPES.
function sqlLiteral(engine: Engine, value: string | null): string {
  if (value === null) return "NULL";
  let s = value;
  if (engine === "mysql") s = s.replace(/\\/g, "\\\\");
  s = s.replace(/'/g, "''");
  return `'${s}'`;
}

// Word-boundary anchored so it doesn't match "int" embedded in interval/point/etc.
const NUMERIC_RE =
  /\b(?:big|small|tiny|medium)?int(?:eger)?\d*\b|\b(?:big|small)?serial\d*\b|\b(?:numeric|decimal|dec|real|double|float\d*|money|fixed)\b/i;
export function isNumericType(dataType: string): boolean {
  return NUMERIC_RE.test(dataType);
}

// A value literal for a column: NULL keyword, a bare number for numeric columns when
// the text is a valid number, else a quoted string literal (safe for any type).
function sqlValue(engine: Engine, dataType: string, value: string | null): string {
  if (value === null) return "NULL";
  if (isNumericType(dataType)) {
    const t = value.trim();
    // A cleared numeric field is NULL, never the invalid literal '' (PG/MySQL reject it).
    if (t === "") return "NULL";
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return t;
  }
  return sqlLiteral(engine, value);
}

// CAST target for text comparison (MySQL uses CHAR; TEXT is invalid there).
function castText(engine: Engine): string {
  if (engine === "mysql") return "CHAR";
  if (engine === "bigquery") return "STRING";
  return "TEXT";
}

// Convert a raw cell value (from QueryResult.rows) to the editor/literal string form.
// null/undefined → SQL NULL; objects → JSON; everything else → String().
export function cellToInput(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function typeOf(table: CatalogTable, col: string): string {
  return table.columns.find((c) => c.name === col)?.dataType ?? "text";
}

const VERSION_COLUMN_RE =
  /^(?:version|row_version|lock_version|revision|updated_at|updatedat|modified_at)$/i;

function comparison(
  engine: Engine,
  table: CatalogTable,
  column: string,
  value: string | null,
): string {
  const identifier = quoteIdent(engine, column);
  return value === null
    ? `${identifier} IS NULL`
    : `${identifier} = ${sqlValue(engine, typeOf(table, column), value)}`;
}

function optimisticColumns(
  table: CatalogTable,
  originalValues: Record<string, string | null>,
  changedColumns?: Set<string>,
): string[] {
  const version = table.columns.find(
    (column) =>
      VERSION_COLUMN_RE.test(column.name) && column.name in originalValues,
  );
  if (version) return [version.name];
  return table.columns
    .filter(
      (column) =>
        !column.pk &&
        column.name in originalValues &&
        (!changedColumns || changedColumns.has(column.name)),
    )
    .map((column) => column.name);
}

export function pkColumns(table: CatalogTable): CatalogColumn[] {
  return table.columns.filter((c) => c.pk);
}

// Non-scalar PK types: the grid reads the PK cell as a backend-rendered hex/JSON string
// and sqlValue emits it as a plain quoted literal, which never matches the real bytes/value
// → a WHERE that silently deletes/updates nothing. We block row editing on such PKs rather
// than attempt per-engine binary/composite literal encoding.
const NON_SCALAR_PK_RE = /\b(?:bytea|(?:tiny|medium|long)?blob|(?:var)?binary|json|jsonb|array|composite|record)\b|\[\]/i;
export function hasNonScalarPk(table: CatalogTable): boolean {
  return pkColumns(table).some((c) => NON_SCALAR_PK_RE.test(c.dataType));
}

// One column's filter → a boolean SQL fragment, or null for "no filter":
//   "null" / "not null"  → IS [NOT] NULL
//   "=abc"               → col = <typed literal>            (exact)
//   "abc"                → CAST(col AS text) [I]LIKE '%abc%' (contains, case-insensitive)
function filterClause(engine: Engine, col: CatalogColumn, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const q = quoteIdent(engine, col.name);
  const selectedValues = decodeGridValueFilter(raw);
  if (selectedValues) {
    const values = selectedValues.filter(
      (value): value is string => value !== null,
    );
    const clauses: string[] = [];
    if (values.length > 0) {
      clauses.push(
        `${q} IN (${values
          .map((value) => sqlValue(engine, col.dataType, value))
          .join(", ")})`,
      );
    }
    if (selectedValues.includes(null)) clauses.push(`${q} IS NULL`);
    if (clauses.length === 0) return null;
    return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
  }
  const low = v.toLowerCase();
  if (low === "null") return `${q} IS NULL`;
  if (low === "not null") return `${q} IS NOT NULL`;
  if (v.startsWith("=")) return `${q} = ${sqlValue(engine, col.dataType, v.slice(1))}`;
  // ponytail: % and _ in the search act as LIKE wildcards (not escaped). Injection is
  // still prevented by literal quoting; add wildcard escaping + ESCAPE if users complain.
  const op = engine === "postgres" ? "ILIKE" : "LIKE";
  return `CAST(${q} AS ${castText(engine)}) ${op} ${sqlLiteral(engine, `%${v}%`)}`;
}

function buildWhere(
  engine: Engine,
  columns: CatalogColumn[],
  filters: Record<string, string>,
  whereExpression = "",
): string {
  const parts: string[] = [];
  for (const col of columns) {
    const c = filterClause(engine, col, filters[col.name] ?? "");
    if (c) parts.push(c);
  }
  const expression = whereExpression.trim();
  if (expression) {
    assertGridExpression("where", expression);
    parts.push(`(${expression})`);
  }
  return parts.join(" AND ");
}

// PK columns as trailing ASC tiebreakers, minus any already named as the sort col, so
// duplicate sort values order deterministically and LIMIT/OFFSET paging can't repeat/skip.
function pkTiebreakers(engine: Engine, table: CatalogTable, exclude?: string): string[] {
  return pkColumns(table)
    .filter((c) => c.name !== exclude)
    .map((c) => quoteIdent(engine, c.name));
}

function buildOrderBy(
  engine: Engine,
  table: CatalogTable,
  sort: GridSort | null,
  orderByExpression = "",
): string {
  const expression = orderByExpression.trim();
  if (expression) {
    assertGridExpression("orderBy", expression);
    return `ORDER BY ${expression}`;
  }
  if (sort) {
    const dir = sort.dir === "desc" ? "DESC" : "ASC";
    const keys = [`${quoteIdent(engine, sort.col)} ${dir}`, ...pkTiebreakers(engine, table, sort.col)];
    return `ORDER BY ${keys.join(", ")}`;
  }
  // Preserve the database's native scan order until the user asks for sorting.
  // An implicit first-column sort can force a full filesort on large tables, and
  // overview-only metadata may not know the real primary key on the first page.
  return "";
}

function nn(n: number): number {
  return Math.max(0, Math.floor(n));
}

export function buildPageQuery(
  engine: Engine,
  table: CatalogTable,
  opts: {
    filters: Record<string, string>;
    whereExpression?: string;
    orderByExpression?: string;
    sort: GridSort | null;
    limit: number;
    offset: number;
  },
): string {
  const where = buildWhere(
    engine,
    table.columns,
    opts.filters,
    opts.whereExpression,
  );
  const order = buildOrderBy(
    engine,
    table,
    opts.sort,
    opts.orderByExpression,
  );
  return (
    `SELECT * FROM ${tableRef(engine, table)}` +
    (where ? ` WHERE ${where}` : "") +
    (order ? ` ${order}` : "") +
    ` LIMIT ${nn(opts.limit)} OFFSET ${nn(opts.offset)}`
  );
}

export function buildCountQuery(
  engine: Engine,
  table: CatalogTable,
  filters: Record<string, string>,
  whereExpression = "",
): string {
  const where = buildWhere(
    engine,
    table.columns,
    filters,
    whereExpression,
  );
  return `SELECT COUNT(*) AS n FROM ${tableRef(engine, table)}` + (where ? ` WHERE ${where}` : "");
}

// SET / WHERE assignments preserving column order; only columns present in `values`.
function assignments(engine: Engine, table: CatalogTable, values: Record<string, string | null>): string[] {
  return table.columns
    .filter((c) => c.name in values)
    .map((c) => `${quoteIdent(engine, c.name)} = ${sqlValue(engine, c.dataType, values[c.name])}`);
}

export function buildInsert(engine: Engine, table: CatalogTable, values: Record<string, string | null>): string {
  const cols = table.columns.filter((c) => c.name in values);
  if (!cols.length) throw new Error("INSERT with no columns");
  const idents = cols.map((c) => quoteIdent(engine, c.name)).join(", ");
  const vals = cols.map((c) => sqlValue(engine, c.dataType, values[c.name])).join(", ");
  return `INSERT INTO ${tableRef(engine, table)} (${idents}) VALUES (${vals})`;
}

export function buildUpdate(
  engine: Engine,
  table: CatalogTable,
  pkValues: Record<string, string | null>,
  setValues: Record<string, string | null>,
  originalValues?: Record<string, string | null>,
): string {
  const where = Object.keys(pkValues).map((column) =>
    comparison(engine, table, column, pkValues[column]),
  );
  if (!where.length) throw new Error("refusing UPDATE without a primary key");
  const set = assignments(engine, table, setValues);
  if (!set.length) throw new Error("UPDATE with no changed columns");
  if (originalValues) {
    for (const column of optimisticColumns(
      table,
      originalValues,
      new Set(Object.keys(setValues)),
    )) {
      if (!(column in pkValues)) {
        where.push(comparison(engine, table, column, originalValues[column]));
      }
    }
  }
  return `UPDATE ${tableRef(engine, table)} SET ${set.join(", ")} WHERE ${where.join(" AND ")}`;
}

export function buildDelete(
  engine: Engine,
  table: CatalogTable,
  pkValues: Record<string, string | null>,
  originalValues?: Record<string, string | null>,
): string {
  const where = Object.keys(pkValues).map((column) =>
    comparison(engine, table, column, pkValues[column]),
  );
  if (!where.length) throw new Error("refusing DELETE without a primary key");
  if (originalValues) {
    for (const column of optimisticColumns(table, originalValues)) {
      if (!(column in pkValues)) {
        where.push(comparison(engine, table, column, originalValues[column]));
      }
    }
  }
  return `DELETE FROM ${tableRef(engine, table)} WHERE ${where.join(" AND ")}`;
}

// --- CSV / JSON export (pure) --------------------------------------------------------
// Shared export contract (the Rust result exporter follows the same rules):
//   - NULL → empty field (CSV) / null (JSON); records end with CRLF (RFC 4180).
//   - Fields containing , " CR or LF are quoted and internal quotes doubled.
//   - A text cell that a spreadsheet would evaluate (leading = + - @ tab or CR) gets a
//     leading apostrophe, unless the whole value is the database's inert rendering of
//     a number ("-12.50"), ±Infinity, or an interval/duration ("-1 day -02:00:00").
//     Clipboard TSV copies apply the same rule.
//   - Duplicate column names stay distinct in JSON as name, name_2, name_3, ….
const SPREADSHEET_FORMULA_START = /^[=+\-@\t\r]/;
const INERT_VALUE =
  /^(?:[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|[+-]?[Ii]nfinity|-?[0-9]+ (?:years?|mons?|days?)(?: [+-]?[0-9]+ (?:years?|mons?|days?))*(?: [+-]?[0-9]+:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)?|-?[0-9]+:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)$/;

/** Text a spreadsheet would run as a formula, prefixed with an apostrophe. */
export function spreadsheetSafeText(text: string): string {
  return SPREADSHEET_FORMULA_START.test(text) && !INERT_VALUE.test(text)
    ? `'${text}`
    : text;
}

function escapeCsvField(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (typeof v === "string") s = spreadsheetSafeText(s);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: unknown[][]): string {
  const head = columns.map(escapeCsvField).join(",");
  const body = rows.map((r) => r.map(escapeCsvField).join(",")).join("\r\n");
  return body ? `${head}\r\n${body}` : head;
}

/** Deterministic JSON keys for result columns that share a name. */
export function uniqueColumnKeys(columns: string[]): string[] {
  const used = new Set<string>();
  return columns.map((column) => {
    let key = column;
    for (let suffix = 2; used.has(key); suffix += 1) key = `${column}_${suffix}`;
    used.add(key);
    return key;
  });
}

export function toJson(columns: string[], rows: unknown[][]): string {
  const keys = uniqueColumnKeys(columns);
  return JSON.stringify(
    rows.map((r) => Object.fromEntries(keys.map((key, i) => [key, r[i] ?? null]))),
    null,
    2,
  );
}
