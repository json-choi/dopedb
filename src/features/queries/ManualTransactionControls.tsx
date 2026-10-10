// Presents manual-transaction actions and feedback from the transaction controller:
// the remaining time before the backend's automatic rollback, statements rolled
// back on their own, why a transaction ended without a user command, and every
// disabled reason as an accessible description rather than a hover-only title.

import { useEffect, useId } from "react";

import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { WorkbenchButton } from "../../design-system/components/Workbench";
import { useI18n } from "../../lib/i18n";
import {
  manualTransactionEndMessageKey,
  manualTransactionEndShortKey,
  manualTransactionRemaining,
  useManualTransactionClock,
  type ManualTransactionController,
} from "./useManualTransaction";

export default function ManualTransactionControls({
  controller,
  writesEnabled,
  writesDisabledHint,
  disabled = false,
}: {
  controller: ManualTransactionController;
  writesEnabled: boolean;
  writesDisabledHint?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const descriptionId = useId();
  const status = controller.status;
  const failed = status?.phase === "failed";
  const now = useManualTransactionClock(status?.expiresAt ?? null);

  useEffect(() => {
    if (controller.error) toast(controller.error, "error");
  }, [controller.error, toast]);

  const blockedReason = controller.busy
    ? t("ide.manualTransaction.busy")
    : controller.loading
      ? t("ide.manualTransaction.loading")
      : disabled
        ? t("ide.manualTransaction.unavailable")
        : null;

  if (!status) {
    const reason = blockedReason
      ?? (writesEnabled
        ? null
        : writesDisabledHint ?? t("sql.txManualWritesRequired"));
    const ended = controller.ended;
    const endedMessage = ended ? manualTransactionEndMessageKey(ended.reason) : null;
    return (
      <>
        {ended && endedMessage ? (
          <WorkbenchButton
            tone="danger"
            onClick={controller.dismissEnded}
            title={t("ide.manualTransaction.dismissEnded")}
            aria-describedby={`${descriptionId}-ended`}
          >
            <Icon name="alert" />
            <span>{t(manualTransactionEndShortKey(ended.reason))}</span>
            <span id={`${descriptionId}-ended`} className="tw:sr-only">
              {t(endedMessage, { connection: ended.database })}
            </span>
          </WorkbenchButton>
        ) : null}
        <WorkbenchButton
          disabled={reason !== null}
          disabledBehavior="focusable"
          onClick={() => void controller.begin()}
          title={reason ?? t("sql.txManualBeginHint")}
          aria-describedby={`${descriptionId}-begin`}
        >
          <span>{t("sql.tx")}</span>
          <strong>{t("sql.txAuto")}</strong>
          <span id={`${descriptionId}-begin`} className="tw:sr-only">
            {reason ?? t("sql.txManualBeginHint")}
          </span>
        </WorkbenchButton>
      </>
    );
  }

  const remaining = manualTransactionRemaining(status.expiresAt, now);
  const rolledBack = status.rolledBackStatementCount ?? 0;
  const detail = [
    t("sql.txManualDetail", { count: status.statementCount }),
    status.database,
    t("ide.manualTransaction.expiresAt", {
      time: new Date(status.expiresAt).toLocaleTimeString(),
    }),
    rolledBack > 0
      ? t("ide.manualTransaction.rolledBackStatements", { count: rolledBack })
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const commitReason = blockedReason ?? (failed ? t("sql.txFailedHint") : null);
  return (
    <>
      <WorkbenchButton
        variant="selected"
        tone={remaining?.soon ? "danger" : "neutral"}
        disabled
        disabledBehavior="focusable"
        title={failed ? t("sql.txFailedHint") : detail}
        aria-describedby={`${descriptionId}-status`}
      >
        <span>{t("sql.tx")}</span>
        <strong>
          {failed ? t("sql.txFailed") : t("sql.txManual")}
        </strong>
        {remaining && !failed ? (
          <span className="tw:tabular-nums">
            {t(remaining.key, { count: remaining.count })}
          </span>
        ) : null}
        <span id={`${descriptionId}-status`} className="tw:sr-only">
          {failed ? t("sql.txFailedHint") : detail}
        </span>
      </WorkbenchButton>
      <WorkbenchButton
        iconOnly
        tone="success"
        disabled={commitReason !== null}
        disabledBehavior="focusable"
        onClick={() => void controller.commit()}
        title={commitReason ?? t("sql.txCommit")}
        aria-label={t("sql.txCommit")}
        aria-describedby={commitReason ? `${descriptionId}-commit` : undefined}
      >
        <Icon name="check" />
        {commitReason ? (
          <span id={`${descriptionId}-commit`} className="tw:sr-only">
            {commitReason}
          </span>
        ) : null}
      </WorkbenchButton>
      <WorkbenchButton
        iconOnly
        tone="danger"
        disabled={blockedReason !== null}
        disabledBehavior="focusable"
        onClick={() => void controller.rollback()}
        title={blockedReason ?? t("sql.txRollback")}
        aria-label={t("sql.txRollback")}
        aria-describedby={blockedReason ? `${descriptionId}-rollback` : undefined}
      >
        <Icon name="history" />
        {blockedReason ? (
          <span id={`${descriptionId}-rollback`} className="tw:sr-only">
            {blockedReason}
          </span>
        ) : null}
      </WorkbenchButton>
    </>
  );
}
