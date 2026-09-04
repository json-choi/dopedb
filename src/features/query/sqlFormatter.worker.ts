import { format } from "sql-formatter";
import type { SqlFormatRequest, SqlFormatResponse } from "./sqlFormatter";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<SqlFormatRequest>) => void) | null;
  postMessage(message: SqlFormatResponse): void;
};

// This is a dedicated Worker, not a Window message channel: only its creating
// document can send messages and MessageEvent.origin is empty by specification.
// codeql[js/missing-origin-check]
workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({
      requestId: event.data.requestId,
      formatted: format(event.data.sql, {
        language: event.data.language,
        keywordCase: "upper",
        tabWidth: 2,
        linesBetweenQueries: 2,
      }),
      error: null,
    });
  } catch (error) {
    workerScope.postMessage({
      requestId: event.data.requestId,
      formatted: null,
      error: error instanceof Error ? error.message : "SQL formatting failed",
    });
  }
};

export {};
