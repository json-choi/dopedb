// Status-bar recovery surface for manual transactions across the active
// workspace. It stays hidden when there is nothing to recover and exposes only
// commands backed by the connection-scoped transaction owner, with the time left
// before each transaction's automatic rollback.
import { Icon } from "../../components/Icon";
import ToolbarMenu from "../../components/ToolbarMenu";
import { Button } from "../../design-system/components/Button";
import {
  StatusDot,
  type StatusTone,
} from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import {
  manualTransactionRemaining,
  useManualTransactionClock,
} from "./useManualTransaction";
import type { WorkspaceManualTransaction } from "./useWorkspaceManualTransactions";

export default function ManualTransactionsMenu({
  transactions,
  settlingIds,
  onOpen,
  onCommit,
  onRollback,
}: {
  transactions: WorkspaceManualTransaction[];
  settlingIds: ReadonlySet<string>;
  onOpen: (transaction: WorkspaceManualTransaction) => void;
  onCommit: (transaction: WorkspaceManualTransaction) => Promise<void>;
  onRollback: (transaction: WorkspaceManualTransaction) => Promise<void>;
}) {
  const { t } = useI18n();
  const label = t("ide.manualTransactions", {
    count: transactions.length,
  });
  const earliestExpiry = transactions.reduce<string | null>(
    (earliest, transaction) =>
      earliest === null || transaction.expiresAt < earliest
        ? transaction.expiresAt
        : earliest,
    null,
  );
  const now = useManualTransactionClock(earliestExpiry);

  return (
    <ToolbarMenu
      align="end"
      label={label}
      menuSize="tasks"
      triggerVariant="statusBar"
      trigger={
        <>
          <Icon name="history" />
          <span className="tw:tabular-nums">{transactions.length}</span>
        </>
      }
    >
      <div
        role="presentation"
        className="tw:flex tw:min-h-control-md tw:items-center tw:justify-between tw:gap-3 tw:border-b tw:border-border-subtle tw:px-2 tw:pb-2 tw:text-ui"
      >
        <strong className="tw:text-foreground">
          {t("ide.manualTransaction.title")}
        </strong>
        <span className="tw:text-xs tw:text-muted-foreground">{label}</span>
      </div>
      <div role="presentation" className="tw:grid">
        {transactions.map((transaction) => {
          const settling = settlingIds.has(transaction.transactionId);
          const failed = transaction.phase === "failed";
          const remaining = manualTransactionRemaining(transaction.expiresAt, now);
          const rolledBack = transaction.rolledBackStatementCount ?? 0;
          const tone: StatusTone = failed || remaining?.soon ? "danger" : "warning";
          return (
            <div
              key={transaction.transactionId}
              role="group"
              aria-label={transaction.connectionName}
              className="tw:grid tw:min-w-0 tw:gap-2 tw:border-b tw:border-border-subtle tw:px-2 tw:py-2 tw:last:border-b-0"
            >
              <div className="tw:flex tw:min-w-0 tw:items-start tw:gap-2">
                <Icon
                  name="database"
                  className="tw:mt-0.5 tw:shrink-0 tw:text-muted-foreground"
                />
                <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-1">
                  <strong className="tw:truncate tw:text-ui tw:text-foreground">
                    {transaction.connectionName}
                  </strong>
                  <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-1.5 tw:text-xs tw:text-muted-foreground">
                    <StatusDot tone={tone} />
                    <span className="tw:truncate">
                      {transaction.database} ·{" "}
                      {failed ? t("sql.txFailed") : t("sql.txManual")} ·{" "}
                      {t("sql.txManualDetail", {
                        count: transaction.statementCount,
                      })}
                    </span>
                  </span>
                  {remaining && !failed ? (
                    <span
                      data-tone={remaining.soon ? "danger" : "muted"}
                      className="tw:text-xs tw:tabular-nums tw:text-muted-foreground tw:data-[tone=danger]:text-danger"
                    >
                      {t(remaining.key, { count: remaining.count })} ·{" "}
                      {t("ide.manualTransaction.expiresAt", {
                        time: new Date(transaction.expiresAt).toLocaleTimeString(),
                      })}
                    </span>
                  ) : null}
                  {rolledBack > 0 ? (
                    <span className="tw:text-xs tw:text-muted-foreground">
                      {t("ide.manualTransaction.rolledBackStatements", {
                        count: rolledBack,
                      })}
                    </span>
                  ) : null}
                </span>
              </div>
              <div
                role="presentation"
                className="tw:flex tw:justify-end tw:gap-1"
              >
                <Button
                  role="menuitem"
                  size="xs"
                  variant="ghost"
                  onClick={() => onOpen(transaction)}
                >
                  <Icon name="externalLink" />
                  {t("ide.backgroundTask.open")}
                </Button>
                {!failed ? (
                  <Button
                    role="menuitem"
                    size="xs"
                    variant="ghost"
                    disabled={settling}
                    onClick={() => void onCommit(transaction)}
                  >
                    <Icon name="check" />
                    {t("sql.txCommit")}
                  </Button>
                ) : null}
                <Button
                  role="menuitem"
                  size="xs"
                  variant="dangerGhost"
                  disabled={settling}
                  onClick={() => void onRollback(transaction)}
                >
                  <Icon name="history" />
                  {t("sql.txRollback")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </ToolbarMenu>
  );
}
