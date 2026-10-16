// Shared result-export helpers. CSV/JSON shaping lives in sqlBuild (pure, tested);
// this file owns clipboard text and the export file text the native save dialog
// writes. Every copy path shares one convention with CSV: NULL is an empty field,
// fields are quoted when they contain a tab, quote, or line break, JSON text keeps
// its digits, and text a spreadsheet would run as a formula gets an apostrophe.
import { spreadsheetSafeText, toCsv, toJson, uniqueColumnKeys } from "./sqlBuild";

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** One tab-separated field that pastes back into a single spreadsheet cell. */
export function tsvField(value: unknown): string {
  const raw = cellText(value);
  const text = typeof value === "string" ? spreadsheetSafeText(raw) : raw;
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Re-indents JSON text without parsing its numbers, so integers past 2^53 and
 * long decimals keep every digit. Returns null for text that is not a JSON
 * object or array.
 */
export function prettyJsonText(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return null;
  try {
    JSON.parse(trimmed);
  } catch {
    return null;
  }
  let out = "";
  let depth = 0;
  let inString = false;
  const newline = () => "\n" + "  ".repeat(depth);
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += trimmed[index + 1] ?? "";
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "{" || char === "[") {
      const close = char === "{" ? "}" : "]";
      let next = index + 1;
      while (/\s/.test(trimmed[next] ?? "")) next += 1;
      if (trimmed[next] === close) {
        out += char + close;
        index = next;
      } else {
        depth += 1;
        out += char + newline();
      }
    } else if (char === "}" || char === "]") {
      depth -= 1;
      out += newline() + char;
    } else if (char === ",") {
      out += "," + newline();
    } else if (char === ":") {
      out += ": ";
    } else if (!/\s/.test(char)) {
      out += char;
    }
  }
  return out;
}

/** Human byte size, e.g. for a value shortened to fit a result page. */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Single-cell clipboard text: NULL empty, JSON pretty-printed losslessly. */
export function cellClipboardText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  const text = String(value);
  return (typeof value === "string" && prettyJsonText(text)) || text;
}

/** CSV file text with a UTF-8 BOM so Excel opens non-ASCII (e.g. Korean) text. */
export function csvExportText(columns: string[], rows: unknown[][]): string {
  return "\uFEFF" + toCsv(columns, rows);
}

/** JSON file text with distinct keys for duplicate column names. */
export function jsonExportText(columns: string[], rows: unknown[][]): string {
  // Pretty-print small exports; skip the 2-space indent past 5000 rows so the JSON string
  // is ~half the size and stringify runs ~2x faster on the main thread. toJson stays the
  // pretty path (its self-test pins that output); large path shapes rows inline & compact.
  const keys = uniqueColumnKeys(columns);
  return rows.length > 5000
    ? JSON.stringify(
        rows.map((r) =>
          Object.fromEntries(keys.map((key, i) => [key, r[i] ?? null])),
        ),
      )
    : toJson(columns, rows);
}

// Tab-separated text for pasting into spreadsheets.
export function toTsv(columns: string[], rows: readonly (readonly unknown[])[]): string {
  return [columns, ...rows].map((r) => r.map(tsvField).join("\t")).join("\n");
}

// Filename-safe local timestamp, e.g. 2026-07-03-14-05-09.
export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
