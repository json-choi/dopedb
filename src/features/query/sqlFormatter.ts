// Formats a SQL document through the Rust formatter, chunked at statement
// boundaries. A compound statement must not be chunked, so that case is detected
// first and falls back to a whole-document path in a worker or inline.
import type { SqlLanguage } from "sql-formatter";
import { isTauri } from "@tauri-apps/api/core";
import { formatSqlFragment } from "../queries/tauriAdapter";

export type SqlFormatRequest = {
  requestId: number;
  sql: string;
  language: SqlLanguage;
};

export type SqlFormatResponse =
  | { requestId: number; formatted: string; error: null }
  | { requestId: number; formatted: null; error: string };

let requestSequence = 0;
const LARGE_DOCUMENT_BYTES = 128 * 1024;
const FORMAT_CHUNK_BYTES = 64 * 1024;

function hasCompoundStatement(sql: string, language: SqlLanguage) {
  if (language === "mysql") {
    return /^\s*delimiter\b/im.test(sql)
      || /\bcreate\s+(?:definer\s*=\s*\S+\s+)?(?:procedure|function|trigger|event)\b/i.test(
        sql,
      );
  }
  if (language === "sqlite") return /\bcreate\s+trigger\b/i.test(sql);
  return false;
}

/**
 * Split only at top-level statement terminators. Large formatter requests are
 * handled as bounded chunks inside one request-scoped worker. Reusing that one
 * worker avoids creating a process for every chunk, while terminating it after
 * the document releases parser scratch memory. Compound MySQL/SQLite statements
 * stay on the conservative single-chunk path.
 */
export function splitSqlFormatChunks(
  sql: string,
  language: SqlLanguage,
): string[] {
  if (sql.length < LARGE_DOCUMENT_BYTES || hasCompoundStatement(sql, language)) {
    return [sql];
  }
  const chunks: string[] = [];
  let start = 0;
  let quote: "single" | "double" | "backtick" | null = null;
  let lineComment = false;
  let blockComment = false;
  let dollarTag: string | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1] ?? "";
    if (lineComment) {
      if (current === "\n" || current === "\r") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (quote !== null) {
      const marker = quote === "single" ? "'" : quote === "double" ? '"' : "`";
      if (current === "\\") {
        index += 1;
      } else if (current === marker && next === marker) {
        index += 1;
      } else if (current === marker) {
        quote = null;
      }
      continue;
    }
    if ((current === "-" && next === "-") || current === "#") {
      lineComment = true;
      if (current === "-") index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === "'") quote = "single";
    else if (current === '"') quote = "double";
    else if (current === "`") quote = "backtick";
    else if (current === "$" && language === "postgresql") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
      if (tag) {
        dollarTag = tag[0];
        index += tag[0].length - 1;
      }
    } else if (current === ";" && index + 1 - start >= FORMAT_CHUNK_BYTES) {
      chunks.push(sql.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < sql.length) chunks.push(sql.slice(start));
  return chunks.length > 1 ? chunks : [sql];
}

function formatWithRequestWorker(
  chunks: readonly string[],
  language: SqlLanguage,
) {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL("./sqlFormatter.worker.ts", import.meta.url), {
      type: "module",
    });
    const formatted: string[] = [];
    let chunkIndex = 0;
    let requestId = 0;
    const stop = () => worker.terminate();
    const fail = (error: Error) => {
      stop();
      reject(error);
    };
    const postNext = () => {
      requestId = ++requestSequence;
      try {
        worker.postMessage({
          requestId,
          sql: chunks[chunkIndex],
          language,
        } satisfies SqlFormatRequest);
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error("SQL formatter request could not be sent"),
        );
      }
    };
    worker.onmessage = (event: MessageEvent<SqlFormatResponse>) => {
      if (event.data.requestId !== requestId) return;
      if (event.data.error !== null) {
        fail(new Error(event.data.error));
        return;
      }
      formatted.push(event.data.formatted);
      chunkIndex += 1;
      if (chunkIndex < chunks.length) {
        postNext();
        return;
      }
      stop();
      resolve(formatted.join("\n\n"));
    };
    worker.onerror = () => fail(new Error("SQL formatter worker failed"));
    worker.onmessageerror = () =>
      fail(new Error("SQL formatter worker returned an invalid response"));
    postNext();
  });
}

async function formatWithNativeRuntime(
  chunks: readonly string[],
  language: SqlLanguage,
) {
  if (
    language !== "sqlite" &&
    language !== "mysql" &&
    language !== "postgresql" &&
    language !== "bigquery"
  ) {
    throw new Error(`SQL formatter language ${language} is unsupported`);
  }
  const formatted: string[] = [];
  for (const chunk of chunks) {
    formatted.push(await formatSqlFragment(chunk, language));
  }
  return formatted.join("\n\n");
}

export async function formatSqlDocument(
  sql: string,
  language: SqlLanguage,
): Promise<string> {
  const compoundStatement = hasCompoundStatement(sql, language);
  const chunks = splitSqlFormatChunks(sql, language);
  if (!compoundStatement && isTauri()) {
    return formatWithNativeRuntime(chunks, language);
  }
  if (typeof Worker === "undefined") {
    const formatter = await import("sql-formatter");
    return formatter.format(sql, {
      language,
      keywordCase: "upper",
      tabWidth: 2,
      linesBetweenQueries: 2,
    });
  }
  return formatWithRequestWorker(chunks, language);
}
