// One relation's generated DDL, cached indefinitely per exact (connection,
// database, schema, table) and never retried, since a failure here is a permission
// or engine answer. Only the transient copy acknowledgement is local state.
import { useState } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";

import { errMessage } from "../../ipc/types";
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
    queryFn: () => getTableDdl(connectionId, table, schema, database),
    staleTime: Infinity,
    retry: false,
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
    error: query.error ? errMessage(query.error) : null,
    copied,
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
