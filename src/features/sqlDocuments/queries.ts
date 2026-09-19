// Read options for a connection's saved SQL documents, so a screen can list what a
// member may reopen without owning the gateway call or inventing its own cache key.

import { queryOptions } from "@tanstack/react-query";

import { connectionId } from "./domain";
import { tauriSqlDocumentGateway } from "./tauriAdapter";

export const sqlDocumentQueryKeys = {
  all: (scopeKey: string, id: string) =>
    ["sqlDocuments", scopeKey, id] as const,
};

export function sqlDocumentsQuery(scopeKey: string, id: string) {
  return queryOptions({
    queryKey: sqlDocumentQueryKeys.all(scopeKey, id),
    queryFn: () => tauriSqlDocumentGateway.list(connectionId(id)),
    staleTime: 5_000,
    retry: false,
  });
}
