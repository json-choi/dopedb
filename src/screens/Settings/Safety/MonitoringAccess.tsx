// Compact PostgreSQL monitoring-role control. The backend owns the fixed GRANT/REVOKE
// and Agent planning safety decision; this panel only exposes status, exact approval, and
// a DBA-copy fallback without turning on arbitrary database writes. The grant changes
// the database user, so it is offered only while applied Data changes are on.
import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  proposePostgresMonitoring,
  setPostgresMonitoring,
} from "../../../features/monitoring/tauriAdapter";
import {
  approveOperation,
  rejectOperation,
} from "../../../features/operations/tauriAdapter";
import type { MonitoringOperationProposal } from "../../../ipc/types";
import ConfirmButton from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import Skeleton from "../../../components/Skeleton";
import { useToast } from "../../../components/Toast";
import { Button } from "../../../design-system/components/Button";
import { StatusBadge } from "../../../design-system/components/Status";
import { monitoringStatusQuery, qk } from "../../../lib/queries";
import { useI18n } from "../../../lib/i18n";

const GRANT_SQL = "GRANT pg_monitor TO CURRENT_USER;";

export default function MonitoringAccess({
  connectionId,
  writesEnabled,
}: {
  connectionId: string;
  writesEnabled: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const reasonId = useId();
  const statusQuery = useQuery(monitoringStatusQuery(connectionId));
  const [proposal, setProposal] = useState<MonitoringOperationProposal | null>(null);
  const failed = () => toast(t("safety.monitoringActionFailed"), "error");
  const propose = useMutation({
    mutationFn: (enabled: boolean) => proposePostgresMonitoring(connectionId, enabled),
    onSuccess: (operation) => {
      setProposal(operation);
    },
    onError: failed,
  });
  const apply = useMutation({
    mutationFn: async (operation: MonitoringOperationProposal) => {
      await approveOperation(
        operation.operationId,
        operation.payloadHash,
        operation.confirmationPhrase ?? undefined,
      );
      return setPostgresMonitoring(operation.operationId);
    },
    onSuccess: (status) => {
      setProposal(null);
      queryClient.setQueryData(qk.monitoring(connectionId), status);
      toast(status.roleGranted ? t("safety.monitoringEnabled") : t("safety.monitoringRevoked"));
    },
    onError: failed,
  });
  const reject = useMutation({
    mutationFn: (operation: MonitoringOperationProposal) =>
      rejectOperation(operation.operationId, operation.payloadHash),
    onSuccess: () => {
      setProposal(null);
    },
    onError: failed,
  });

  useEffect(() => {
    setProposal(null);
  }, [connectionId]);

  function copyGrant() {
    if (!navigator.clipboard?.writeText) {
      toast(t("safety.monitoringCopyFailed"), "error");
      return;
    }
    void navigator.clipboard.writeText(GRANT_SQL).then(
      () => toast(t("safety.monitoringCopied")),
      () => toast(t("safety.monitoringCopyFailed"), "error"),
    );
  }

  if (statusQuery.isPending) {
    return (
      <section className="tw:mt-2 tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:py-3">
        <Skeleton lines={2} />
      </section>
    );
  }

  if (statusQuery.error || !statusQuery.data) {
    return (
      <section
        className="tw:mt-2 tw:grid tw:gap-2 tw:border-t tw:border-danger tw:py-3"
        role="alert"
      >
        <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:max-[640px]:flex-col">
          <div className="ds-title-line">
            <Icon name="alert" />
            <h3>{t("safety.monitoringTitle")}</h3>
          </div>
        </div>
        <p className="tw:text-ui tw:text-danger">
          {t("safety.monitoringError")}
        </p>
      </section>
    );
  }

  const status = statusQuery.data;
  const postgres = status.engine === "postgres";
  const coverageLabel = status.roleGranted
    ? t("safety.monitoringCoverageFull")
    : status.coverage === "basic"
      ? t("safety.monitoringCoverageBasic")
      : t("safety.monitoringCoverageLimited");
  const coverageNote = status.roleGranted
    ? t("safety.monitoringFullHint")
    : status.coverage === "basic"
      ? t("safety.monitoringBasicHint")
      : t("safety.monitoringLimitedHint");
  const busy = propose.isPending || apply.isPending || reject.isPending;

  return (
    <section
      data-tone={status.roleGranted ? "trust" : "risk"}
      className="tw:mt-2 tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:py-3 tw:data-[tone=risk]:border-warning tw:data-[tone=trust]:border-success"
    >
      <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:max-[640px]:flex-col">
        <div className="tw:min-w-0">
          <div className="ds-title-line">
            <Icon name="database" />
            <h3>{t("safety.monitoringTitle")}</h3>
          </div>
          <p className="tw:mt-1 tw:mb-0 tw:max-w-[680px] tw:text-ui tw:leading-relaxed tw:text-muted-foreground">
            {t("safety.monitoringBody")}
          </p>
        </div>
        <StatusBadge
          tone={status.roleGranted ? "success" : "warning"}
        >
          {coverageLabel}
        </StatusBadge>
      </div>

      <div className="tw:grid tw:gap-1 tw:border-t tw:border-border-subtle tw:pt-2 tw:text-sm tw:leading-relaxed">
        {status.currentUser && (
          <span>
            {t("safety.monitoringUser")}{" "}
            <code className="tw:ml-1 tw:text-foreground">{status.currentUser}</code>
          </span>
        )}
        <span className="tw:text-muted-foreground">{coverageNote}</span>
        {postgres && !status.canManage && !status.roleGranted && (
          <span className="tw:text-muted-foreground">
            {t("safety.monitoringAdminHint")}
          </span>
        )}
      </div>

      {postgres && status.roleAvailable && !proposal && (
        <div className="ds-action-row ds-control-row tw:items-center">
          {!writesEnabled ? (
            <>
              <Button
                size="compact"
                disabled
                disabledBehavior="focusable"
                aria-describedby={reasonId}
              >
                {status.roleGranted
                  ? t("safety.monitoringRevoke")
                  : t("safety.monitoringEnable")}
              </Button>
              <span id={reasonId} className="tw:text-xs tw:text-muted-foreground">
                {t("safety.monitoringRequiresWrites")}
              </span>
            </>
          ) : status.roleGranted ? (
            <ConfirmButton
              disabled={busy}
              size="compact"
              variant="danger"
              confirmLabel={t("safety.monitoringRevokeConfirm")}
              onConfirm={() => propose.mutate(false)}
            >
              {t("safety.monitoringRevoke")}
            </ConfirmButton>
          ) : (
            <ConfirmButton
              disabled={busy}
              size="compact"
              variant="primary"
              confirmLabel={t("safety.monitoringEnableConfirm")}
              onConfirm={() => propose.mutate(true)}
            >
              {propose.isPending
                ? t("safety.monitoringWorking")
                : t("safety.monitoringEnable")}
            </ConfirmButton>
          )}
          {!status.roleGranted && (
            <Button size="compact" disabled={busy} onClick={copyGrant}>
              <Icon name="copy" />
              {t("safety.monitoringCopyGrant")}
            </Button>
          )}
        </div>
      )}

      {proposal && (
        <div className="tw:grid tw:gap-2 tw:border-t tw:border-border-subtle tw:pt-3">
          <div className="ds-title-line">
            <Icon name="key" />
            <strong>
              {proposal.enabled
                ? t("safety.monitoringReviewGrant")
                : t("safety.monitoringReviewRevoke")}
            </strong>
            <StatusBadge tone="danger">
              {t("approval.riskHigh")}
            </StatusBadge>
          </div>
          <code className="tw:block tw:overflow-x-auto tw:bg-muted tw:p-2 tw:text-sm tw:whitespace-nowrap tw:text-foreground">
            {proposal.sql};
          </code>
          <div className="tw:min-w-0 tw:text-xs tw:text-muted-foreground">
            {t("approval.payloadHash")}{" "}
            <code className="tw:break-all tw:text-foreground">
              {proposal.payloadHash}
            </code>
          </div>
          <div className="ds-action-row ds-control-row">
            <Button
              size="compact"
              variant="primary"
              disabled={busy}
              onClick={() => apply.mutate(proposal)}
            >
              {apply.isPending
                ? t("safety.monitoringWorking")
                : t("safety.monitoringApproveApply")}
            </Button>
            <Button
              size="compact"
              disabled={busy}
              onClick={() => reject.mutate(proposal)}
            >
              {t("approval.reject")}
            </Button>
          </div>
        </div>
      )}

      {postgres && !status.roleAvailable && (
        <p className="tw:text-muted-foreground">
          {t("safety.monitoringRoleUnavailable")}
        </p>
      )}
    </section>
  );
}
