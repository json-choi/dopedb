// Coordinates one connection's manual transaction commands and query-cache refresh,
// and owns the shared manual-transaction vocabulary: why a transaction ended (from
// `manual-transaction:changed`), translated refusal codes, and the time-limit clock.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { errDetails } from "../../ipc/types";
import { useI18n, type I18nKey } from "../../lib/i18n";
import { qk } from "../../lib/queries";
import type { ManualTransactionStatus } from "./domain";
import {
  beginManualTransaction,
  commitManualTransaction,
  getManualTransaction,
  rollbackManualTransaction,
} from "./tauriAdapter";

/** Why the backend ended a manual transaction. */
export type ManualTransactionEndReason =
  | "committed"
  | "rolledBack"
  | "commitOutcomeUnknown"
  | "expired"
  | "statementCancelled"
  | "statementTimedOut"
  | "authorityChanged"
  | "connectionChanged"
  | "workspaceChanged"
  | "applicationExit";

export type ManualTransactionEnded = {
  connectionId: string;
  transactionId: string;
  database: string;
  reason: ManualTransactionEndReason;
  statementCount: number;
};

/** Status as sent by the backend, including statements rolled back alone. */
export type ManualTransactionStatusDetail = ManualTransactionStatus & {
  rolledBackStatementCount?: number;
};

/** `manual-transaction:changed` payload including the optional end reason. */
export type ManualTransactionChange = {
  connectionId: string;
  status: ManualTransactionStatusDetail | null;
  ended?: Omit<ManualTransactionEnded, "connectionId"> | null;
};

/**
 * Latest end the user did not initiate, per connection. It is workspace-scoped
 * query data (cleared with the workspace) written only by the event listener.
 */
export const manualTransactionEndedKey = (connectionId: string) =>
  ["manualTransactionEnded", connectionId] as const;

/** Ends caused without a user command; these are announced and kept visible. */
const UNANNOUNCED_END_REASONS = new Set<ManualTransactionEndReason>([
  "committed",
  "rolledBack",
]);

export function isAnnouncedEnd(ended: ManualTransactionEnded): boolean {
  return !UNANNOUNCED_END_REASONS.has(ended.reason);
}

const END_MESSAGE_KEYS: Record<
  Exclude<ManualTransactionEndReason, "committed" | "rolledBack">,
  I18nKey
> = {
  applicationExit: "ide.manualTransaction.ended.applicationExit",
  authorityChanged: "ide.manualTransaction.ended.authorityChanged",
  commitOutcomeUnknown: "ide.manualTransaction.ended.commitOutcomeUnknown",
  connectionChanged: "ide.manualTransaction.ended.connectionChanged",
  expired: "ide.manualTransaction.ended.expired",
  statementCancelled: "ide.manualTransaction.ended.statementCancelled",
  statementTimedOut: "ide.manualTransaction.ended.statementTimedOut",
  workspaceChanged: "ide.manualTransaction.ended.workspaceChanged",
};

/** Full sentence explaining an announced end; `null` for a user command. */
export function manualTransactionEndMessageKey(
  reason: ManualTransactionEndReason,
): I18nKey | null {
  return reason === "committed" || reason === "rolledBack"
    ? null
    : END_MESSAGE_KEYS[reason];
}

/** Compact toolbar label for an announced end. */
export function manualTransactionEndShortKey(
  reason: ManualTransactionEndReason,
): I18nKey {
  if (reason === "statementCancelled" || reason === "statementTimedOut") {
    return "ide.manualTransaction.endedShort.cancelled";
  }
  if (reason === "expired") return "ide.manualTransaction.endedShort.expired";
  if (reason === "commitOutcomeUnknown") {
    return "ide.manualTransaction.endedShort.unknown";
  }
  return "ide.manualTransaction.endedShort.access";
}

const REFUSAL_KEYS = {
  unsupported: "ide.manualTransaction.refusal.unsupported",
  readOnlyRole: "ide.manualTransaction.refusal.readOnlyRole",
  writesDisabled: "ide.manualTransaction.refusal.writesDisabled",
  otherDatabase: "ide.manualTransaction.refusal.otherDatabase",
  statementRunning: "ide.manualTransaction.refusal.statementRunning",
  failed: "ide.manualTransaction.refusal.failed",
  ended: "ide.manualTransaction.refusal.ended",
  expired: "ide.manualTransaction.refusal.expired",
  stale: "ide.manualTransaction.refusal.stale",
  unsupportedStatement: "ide.manualTransaction.refusal.unsupportedStatement",
  authorityChanged: "ide.manualTransaction.refusal.authorityChanged",
} as const satisfies Record<string, I18nKey>;

/** Translation key for a backend `manualTransaction` refusal `code`. */
export function manualTransactionRefusalKey(code: unknown): I18nKey | null {
  return typeof code === "string"
    && Object.prototype.hasOwnProperty.call(REFUSAL_KEYS, code)
    ? REFUSAL_KEYS[code as keyof typeof REFUSAL_KEYS]
    : null;
}

/** A translated message for a manual-transaction command failure. */
export function manualTransactionErrorKey(cause: unknown): I18nKey {
  const details = errDetails(cause);
  if (details.kind === "manualTransaction") {
    return manualTransactionRefusalKey(details.code) ?? "ide.manualTransaction.actionFailed";
  }
  if (details.kind === "outcomeUnknown") {
    return "ide.manualTransaction.commitOutcomeUnknown";
  }
  return "ide.manualTransaction.actionFailed";
}

/** Wall clock for time-limit displays: ticks every second in the last minute. */
export function useManualTransactionClock(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const deadline = Date.parse(expiresAt);
    const remaining = deadline - Date.now();
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      remaining <= 60_000 ? 1_000 : Math.min(15_000, remaining - 60_000),
    );
    return () => window.clearTimeout(timer);
  }, [expiresAt, now]);
  return now;
}

/** Remaining time label, or `null` once the limit passed. */
export function manualTransactionRemaining(
  expiresAt: string,
  now: number,
): { key: I18nKey; count: number; soon: boolean } | null {
  const remaining = Date.parse(expiresAt) - now;
  if (!(remaining > 0)) return null;
  const soon = remaining <= 5 * 60_000;
  return remaining < 60_000
    ? { key: "ide.manualTransaction.secondsLeft", count: Math.ceil(remaining / 1_000), soon }
    : { key: "ide.manualTransaction.minutesLeft", count: Math.ceil(remaining / 60_000), soon };
}

export function useManualTransaction(
  connectionId: string,
  database?: string,
) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: qk.manualTransaction(connectionId),
    queryFn: () => getManualTransaction(connectionId),
  });
  // Event-owned: written by the `manual-transaction:changed` listener only.
  const ended = useQuery<ManualTransactionEnded | null>({
    queryKey: manualTransactionEndedKey(connectionId),
    queryFn: () => null,
    enabled: false,
    initialData: null,
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
        queryClient.setQueryData(manualTransactionEndedKey(connectionId), null);
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
      setError(t(manualTransactionErrorKey(cause)));
      await query.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const status = (query.data ?? null) as ManualTransactionStatusDetail | null;
  return {
    status,
    /** The latest end this user did not initiate, until dismissed or a new begin. */
    ended: status ? null : ended.data && isAnnouncedEnd(ended.data) ? ended.data : null,
    dismissEnded: () =>
      queryClient.setQueryData(manualTransactionEndedKey(connectionId), null),
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
