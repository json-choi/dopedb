// Presents manual-transaction actions and feedback from the transaction controller.

import { useEffect } from "react";

import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { WorkbenchButton } from "../../design-system/components/Workbench";
import { useI18n } from "../../lib/i18n";
import type { ManualTransactionController } from "./useManualTransaction";

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
  const status = controller.status;
  const failed = status?.phase === "failed";

  useEffect(() => {
    if (controller.error) toast(controller.error, "error");
  }, [controller.error, toast]);

  if (!status) {
    return (
      <WorkbenchButton
        disabled={
          disabled ||
          controller.busy ||
          controller.loading ||
          !writesEnabled
        }
        onClick={() => void controller.begin()}
        title={
          writesEnabled
            ? t("sql.txManualBeginHint")
            : writesDisabledHint ?? t("sql.txManualWritesRequired")
        }
      >
        <span>{t("sql.tx")}</span>
        <strong>{t("sql.txAuto")}</strong>
      </WorkbenchButton>
    );
  }

  const detail = t("sql.txManualDetail", {
    count: status.statementCount,
  });
  const targetDetail = `${detail} · ${status.database}`;
  return (
    <>
      <WorkbenchButton
        variant="selected"
        disabled
        title={failed ? t("sql.txFailedHint") : targetDetail}
      >
        <span>{t("sql.tx")}</span>
        <strong>
          {failed ? t("sql.txFailed") : t("sql.txManual")}
        </strong>
      </WorkbenchButton>
      <WorkbenchButton
        iconOnly
        tone="success"
        disabled={disabled || controller.busy || failed}
        onClick={() => void controller.commit()}
        title={failed ? t("sql.txFailedHint") : t("sql.txCommit")}
        aria-label={t("sql.txCommit")}
      >
        <Icon name="check" />
      </WorkbenchButton>
      <WorkbenchButton
        iconOnly
        tone="danger"
        disabled={disabled || controller.busy}
        onClick={() => void controller.rollback()}
        title={t("sql.txRollback")}
        aria-label={t("sql.txRollback")}
      >
        <Icon name="history" />
      </WorkbenchButton>
    </>
  );
}
