// Drives one connection's manual transaction and, after a commit or rollback,
// invalidates exactly the row, count, history and audit queries that could have
// changed. It also reports whether the open transaction matches the target database.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { errMessage } from "../../ipc/types";
import { qk } from "../../lib/queries";
import {
  beginManualTransaction,
  commitManualTransaction,
  getManualTransaction,
  rollbackManualTransaction,
} from "./tauriAdapter";

export function useManualTransaction(
  connectionId: string,
  database?: string,
) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: qk.manualTransaction(connectionId),
    queryFn: () => getManualTransaction(connectionId),
  });

  async function mutate(
    action: "begin" | "commit" | "rollback",
  ): Promise<boolean> {
    if (busy) return false;
    const current = query.data;
    if (action !== "begin" && !current) return false;
    setBusy(true);
    setError(null);
    try {
      if (action === "begin") {
        const status = await beginManualTransaction(connectionId, database);
        queryClient.setQueryData(qk.manualTransaction(connectionId), status);
      } else if (action === "commit") {
        await commitManualTransaction(connectionId, current!.transactionId);
        queryClient.setQueryData(qk.manualTransaction(connectionId), null);
      } else {
        await rollbackManualTransaction(connectionId, current!.transactionId);
        queryClient.setQueryData(qk.manualTransaction(connectionId), null);
      }
      if (action !== "begin") {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["tableRows", connectionId],
          }),
          queryClient.invalidateQueries({
            queryKey: ["tableCount", connectionId],
          }),
          queryClient.invalidateQueries({ queryKey: qk.history(connectionId) }),
          queryClient.invalidateQueries({ queryKey: qk.audit(connectionId) }),
        ]);
      }
      return true;
    } catch (cause) {
      setError(errMessage(cause));
      await query.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    status: query.data ?? null,
    loading: query.isPending,
    busy,
    error,
    targetDatabase: database ?? null,
    targetMatches:
      query.data == null
      || database == null
      || query.data.database === database,
    begin: () => mutate("begin"),
    commit: () => mutate("commit"),
    rollback: () => mutate("rollback"),
  };
}

export type ManualTransactionController = ReturnType<
  typeof useManualTransaction
>;
