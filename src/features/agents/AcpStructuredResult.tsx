import DataGrid from "../queryResults/DataGrid";
import type { JsonValue, QueryResult } from "../../ipc/types";

const MAX_COLUMNS = 18;
const MAX_ROWS = 100;

export default function AcpStructuredResult({ value }: { value: unknown }) {
  const result = tabularResult(value);
  if (!result) return null;
  return (
    <div className="tw:grid tw:max-w-full tw:min-w-0 tw:gap-2 tw:overflow-hidden">
      <div className="tw:max-h-52 tw:max-w-full tw:min-h-0 tw:min-w-0 tw:overflow-auto tw:rounded-sm tw:border tw:border-border-subtle">
        <DataGrid result={result} />
      </div>
    </div>
  );
}

function tabularResult(value: unknown): QueryResult | null {
  const candidate = unwrapResult(value);
  if (Array.isArray(candidate)) {
    const objects = candidate.filter(isRecord);
    if (objects.length !== candidate.length || objects.length === 0) return null;
    const allColumns = [
      ...new Set(objects.flatMap((row) => Object.keys(row))),
    ];
    const columns = allColumns.slice(0, MAX_COLUMNS);
    const rows = objects
      .slice(0, MAX_ROWS)
      .map((row) => columns.map((column) => toJsonValue(row[column] ?? null)));
    return {
      columns,
      rows,
      rowCount: rows.length,
      durationMs: 0,
      truncated:
        candidate.length > MAX_ROWS || allColumns.length > MAX_COLUMNS,
    };
  }
  if (!isRecord(candidate)) return null;
  if (
    Array.isArray(candidate.columns) &&
    candidate.columns.every((column) => typeof column === "string") &&
    Array.isArray(candidate.rows) &&
    candidate.rows.every(Array.isArray)
  ) {
    const columns = candidate.columns.slice(0, MAX_COLUMNS) as string[];
    const rows = (candidate.rows as unknown[][])
      .slice(0, MAX_ROWS)
      .map((row) =>
        row.slice(0, columns.length).map((cell) => toJsonValue(cell)),
      );
    return {
      columns,
      rows,
      rowCount: rows.length,
      durationMs:
        typeof candidate.durationMs === "number" ? candidate.durationMs : 0,
      truncated:
        candidate.rows.length > MAX_ROWS ||
        candidate.columns.length > MAX_COLUMNS ||
        candidate.truncated === true,
    };
  }
  return null;
}

function unwrapResult(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!isRecord(current)) break;
    const next =
      current.result ??
      current.data ??
      current.output ??
      current.rows;
    if (next === undefined || next === current) break;
    if (Array.isArray(current.columns) && Array.isArray(current.rows)) break;
    current = next;
  }
  if (typeof current === "string") {
    try {
      return JSON.parse(current);
    } catch {
      return current;
    }
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)]),
    );
  }
  return String(value);
}
