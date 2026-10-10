// Loads one exact relation's DDL through scoped query keys and catalog-error recovery.
// The text stays cached until the shared catalog refresh path retires the `tableDdl` root.

import { useEffect, useState } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";

import {
  catalogLoadIssue,
  readWithCatalogIssue,
  retryCatalogScanIssue,
} from "../catalogExplorer/catalogDomain";
import { getTableDdl } from "./tauriAdapter";

export const tableDdlQueryKey = (
  connectionId: string,
  table: string,
  schema?: string | null,
  database?: string | null,
) => ["tableDdl", connectionId, database ?? null, schema ?? null, table] as const;

export function tableDdlQuery(
  connectionId: string,
  table: string,
  schema?: string | null,
  database?: string | null,
) {
  return queryOptions({
    queryKey: tableDdlQueryKey(connectionId, table, schema, database),
    queryFn: () => readWithCatalogIssue(
      () => getTableDdl(connectionId, table, schema, database),
    ),
    staleTime: Infinity,
    retry: retryCatalogScanIssue,
  });
}

export function useTableDdl(
  connectionId: string,
  table: string,
  schema?: string | null,
  database?: string | null,
) {
  const query = useQuery(tableDdlQuery(connectionId, table, schema, database));
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1_500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  return {
    text: query.data ?? null,
    error: query.error ? catalogLoadIssue(query.error) : null,
    copied: copyState === "copied",
    // Clipboard access can be denied by the OS or WebView; the text stays selectable.
    copyFailed: copyState === "failed",
    retry: query.refetch,
    copy: async () => {
      if (!query.data) return;
      try {
        await navigator.clipboard.writeText(query.data);
        setCopyState("copied");
      } catch {
        setCopyState("failed");
      }
    },
  };
}
