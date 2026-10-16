// Workspace-level observer for connection-scoped manual transactions. Individual
// query and data editors share the same TanStack Query keys, while this hook gives
// the status bar one recovery surface for transactions left outside the active view.
// It also announces what the user did not initiate: an approaching 30-minute limit
// and a transaction the backend ended (expiry, cancel, access change).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useToast } from "../../components/Toast";
import type { ConnectionProfile } from "../connections/domain";
import { useI18n } from "../../lib/i18n";
import { qk } from "../../lib/queries";
import { usePostPaintReady } from "../../lib/usePostPaintReady";
import type { ManualTransactionStatus } from "./domain";
import {
  commitManualTransaction,
  listManualTransactions,
  rollbackManualTransaction,
} from "./tauriAdapter";
import {
  manualTransactionEndMessageKey,
  manualTransactionErrorKey,
  type ManualTransactionEnded,
  type ManualTransactionStatusDetail,
} from "./useManualTransaction";

const ACTIVE_TRANSACTION_RECONCILIATION_MS = 30_000;
const EXPIRY_WARNING_MS = 5 * 60_000;

export type WorkspaceManualTransaction = ManualTransactionStatusDetail & {
  connectionName: string;
};

export function useWorkspaceManualTransactions(
  connections: ConnectionProfile[],
  onOpenActivity?: () => void,
) {
  const queryClient = useQueryClient();
  const postPaintReady = usePostPaintReady();
  const transactionConnections = useMemo(
    () =>
      connections.filter(
        (connection) =>
          connection.engine !== "mongodb" && connection.engine !== "bigquery",
      ),
    [connections],
  );
  const [settlingIds, setSettlingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const snapshot = useQuery({
    queryKey: qk.manualTransactions(),
    queryFn: listManualTransactions,
    enabled: postPaintReady,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.length
      && globalThis.document?.visibilityState === "visible"
        ? ACTIVE_TRANSACTION_RECONCILIATION_MS
        : false,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!snapshot.data) return;
    const statuses = new Map(
      snapshot.data.map((status) => [status.connectionId, status]),
    );
    for (const connection of transactionConnections) {
      queryClient.setQueryData(
        qk.manualTransaction(connection.id),
        statuses.get(connection.id) ?? null,
      );
    }
  }, [queryClient, snapshot.data, transactionConnections]);

  const connectionNames = new Map<string, string>(
    transactionConnections.map((connection) => [connection.id, connection.name]),
  );
  const transactions = (snapshot.data ?? []).flatMap((status) => {
    const connectionName = connectionNames.get(status.connectionId);
    return connectionName ? [{ ...status, connectionName }] : [];
  });

  const { t } = useI18n();
  const toast = useToast();
  const namesRef = useRef(connectionNames);
  namesRef.current = connectionNames;
  const openActivityRef = useRef(onOpenActivity);
  openActivityRef.current = onOpenActivity;

  // Announce a backend-ended transaction once: the listener writes the reason
  // into the query cache, and the shell is the one place with a toast surface.
  // Activity holds the forced-rollback audit entry, so the toast links to it.
  useEffect(() => {
    const announced = new Set<string>();
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (event.query.queryKey[0] !== "manualTransactionEnded") return;
      const ended = event.query.state.data as ManualTransactionEnded | null | undefined;
      if (!ended) return;
      const key = manualTransactionEndMessageKey(ended.reason);
      const identity = `${ended.transactionId}:${ended.reason}`;
      if (!key || announced.has(identity)) return;
      announced.add(identity);
      toast(
        t(key, {
          connection: namesRef.current.get(ended.connectionId) ?? ended.database,
        }),
        "error",
        openActivityRef.current
          ? {
              label: t("ide.manualTransaction.openActivity"),
              onClick: () => openActivityRef.current?.(),
            }
          : undefined,
      );
    });
  }, [queryClient, t, toast]);

  // Warn once, five minutes before the backend's 30-minute rollback.
  const warnedRef = useRef(new Set<string>());
  const expiryWatch = JSON.stringify(
    transactions.map((transaction) => [
      transaction.transactionId,
      transaction.expiresAt,
      transaction.connectionName,
    ]),
  );
  useEffect(() => {
    const watched = JSON.parse(expiryWatch) as [string, string, string][];
    const timers = watched.map(([transactionId, expiresAt, connectionName]) => {
      const warnAt = Date.parse(expiresAt) - EXPIRY_WARNING_MS;
      return window.setTimeout(() => {
        if (warnedRef.current.has(transactionId)) return;
        warnedRef.current.add(transactionId);
        const minutes = Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / 60_000));
        toast(
          t("ide.manualTransaction.expiringSoon", {
            connection: connectionName,
            count: minutes,
          }),
          "error",
        );
      }, Math.max(0, warnAt - Date.now()));
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [expiryWatch, t, toast]);

  async function settle(
    transaction: WorkspaceManualTransaction,
    action: "commit" | "rollback",
  ) {
    if (settlingIds.has(transaction.transactionId)) return;
    setSettlingIds((current) => {
      const next = new Set(current);
      next.add(transaction.transactionId);
      return next;
    });
    try {
      try {
        if (action === "commit") {
          await commitManualTransaction(
            transaction.connectionId,
            transaction.transactionId,
          );
        } else {
          await rollbackManualTransaction(
            transaction.connectionId,
            transaction.transactionId,
          );
        }
      } catch (cause) {
        // The shell shows this message; never surface backend English.
        await queryClient.invalidateQueries({
          queryKey: qk.manualTransactions(),
          exact: true,
        });
        throw new Error(t(manualTransactionErrorKey(cause)));
      }
      queryClient.setQueryData(
        qk.manualTransaction(transaction.connectionId),
        null,
      );
      queryClient.setQueryData<ManualTransactionStatus[]>(
        qk.manualTransactions(),
        (current) =>
          current?.filter(
            (status) => status.connectionId !== transaction.connectionId,
          ),
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["tableRows", transaction.connectionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tableCount", transaction.connectionId],
        }),
        queryClient.invalidateQueries({
          queryKey: qk.history(transaction.connectionId),
        }),
        queryClient.invalidateQueries({
          queryKey: qk.audit(transaction.connectionId),
        }),
      ]);
    } finally {
      setSettlingIds((current) => {
        const next = new Set(current);
        next.delete(transaction.transactionId);
        return next;
      });
    }
  }

  return {
    transactions,
    settlingIds,
    commit: (transaction: WorkspaceManualTransaction) =>
      settle(transaction, "commit"),
    rollback: (transaction: WorkspaceManualTransaction) =>
      settle(transaction, "rollback"),
  };
}
