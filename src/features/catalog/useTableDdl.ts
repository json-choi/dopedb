// Loads one exact relation's DDL through scoped query keys and catalog-error recovery.

import { useState } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";

import {
  catalogLoadIssue,
  readWithCatalogIssue,
  retryTransientCatalogIssue,
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
    retry: retryTransientCatalogIssue,
  });
}

export function useTableDdl(
  connectionId: string,
  table: string,
  schema?: string | null,
  database?: string | null,
) {
  const query = useQuery(tableDdlQuery(connectionId, table, schema, database));
  const [copied, setCopied] = useState(false);

  return {
    text: query.data ?? null,
    error: query.error ? catalogLoadIssue(query.error) : null,
    copied,
    retry: query.refetch,
    copy: async () => {
      if (!query.data) return;
      await navigator.clipboard.writeText(query.data);
      setCopied(true);
      window.setTimeout(
        () => setCopied(false),
        1_500,
      );
    },
  };
}
