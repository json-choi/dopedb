import { format } from "sql-formatter";
import type { SqlFormatRequest, SqlFormatResponse } from "./sqlFormatter";

const workerScope = self as unknown as {
  location: { origin: string };
  onmessage: ((event: MessageEvent<SqlFormatRequest>) => void) | null;
  postMessage(message: SqlFormatResponse): void;
};

workerScope.onmessage = (event) => {
  // Dedicated workers normally receive an empty origin. Accept a populated
  // origin only when it matches the worker's own immutable script origin.
  if (event.origin !== "" && event.origin !== workerScope.location.origin) return;
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
