// One status line for the Providers section: the browser authorization in flight
// (opening, waiting, checking, expired or refused) or, once nothing is in flight,
// the last saved outcome. Every state that needs a decision keeps its actions here.
import type { ReactNode } from "react";

import { Icon } from "../../../../components/Icon";
import { Button } from "../../../../design-system/components/Button";
import { InlineNotice, LoadingLabel } from "../../../../design-system/components/Status";
import { useI18n } from "../../../../lib/i18n";
import type { AuthorizationRequest, AuthorizationStatus } from "./useProviderAuthorization";

export type ProvidersNotice =
  | { kind: "connected"; providerName: string }
  | { kind: "repaired" }
  | { kind: "error"; message: string };

function ProgressRow({ label, actions }: { label: string; actions?: ReactNode }) {
  return (
    <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-x-3 tw:gap-y-2 tw:border-b tw:border-border-subtle tw:px-3 tw:py-2 tw:text-xs">
      <LoadingLabel>{label}</LoadingLabel>
      {actions ? <span className="tw:flex tw:flex-wrap tw:gap-2">{actions}</span> : null}
    </div>
  );
}

export default function ProviderStatusNotice({
  status,
  notice,
  databasesVisible,
  onCheckNow,
  onCancel,
  onStart,
  onDismissNotice,
  onOpenDatabases,
}: {
  status: AuthorizationStatus;
  notice: ProvidersNotice | null;
  databasesVisible: boolean;
  onCheckNow: () => void;
  onCancel: () => void;
  onStart: (request: AuthorizationRequest) => void;
  onDismissNotice: () => void;
  onOpenDatabases: () => void;
}) {
  const { t } = useI18n();
  const cancel = (
    <Button size="compact" variant="ghost" onClick={onCancel}>
      {t("common.cancel")}
    </Button>
  );

  switch (status.kind) {
    case "starting":
      return (
        <ProgressRow
          label={t("workspaceProviders.authorizationOpening", {
            provider: status.request.providerName,
          })}
        />
      );
    case "checking":
      return (
        <ProgressRow
          label={t("workspaceProviders.authorizationChecking", {
            provider: status.request.providerName,
          })}
        />
      );
    case "waiting": {
      const checkAgain = (
        <Button size="compact" onClick={onCheckNow}>
          {t("workspaceProviders.checkAgain")}
        </Button>
      );
      if (status.error) {
        return (
          <InlineNotice
            tone="danger"
            icon="alert"
            role="alert"
            action={<span className="tw:flex tw:flex-wrap tw:gap-2">{checkAgain}{cancel}</span>}
          >
            {status.error}
          </InlineNotice>
        );
      }
      if (status.incomplete) {
        return (
          <InlineNotice
            tone="warning"
            icon="alert"
            role="status"
            action={(
              <span className="tw:flex tw:flex-wrap tw:gap-2">
                {checkAgain}
                <Button size="compact" onClick={() => onStart(status.request)}>
                  {t("workspaceProviders.startAgain")}
                </Button>
                {cancel}
              </span>
            )}
          >
            {t("workspaceProviders.authorizationIncomplete", {
              provider: status.request.providerName,
            })}
          </InlineNotice>
        );
      }
      return (
        <ProgressRow
          label={t(status.request.repair
            ? "workspaceProviders.authorizationRepairWaiting"
            : "workspaceProviders.authorizationWaiting", {
            provider: status.request.providerName,
          })}
          actions={<>{checkAgain}{cancel}</>}
        />
      );
    }
    case "expired":
      return (
        <InlineNotice
          tone="warning"
          icon="alert"
          role="status"
          action={(
            <span className="tw:flex tw:flex-wrap tw:gap-2">
              <Button size="compact" onClick={() => onStart(status.request)}>
                {t("workspaceProviders.startAgain")}
              </Button>
              <Button size="compact" variant="ghost" onClick={onCancel}>
                {t("common.close")}
              </Button>
            </span>
          )}
        >
          {t("workspaceProviders.authorizationExpired", {
            provider: status.request.providerName,
          })}
        </InlineNotice>
      );
    case "failed":
      return (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={(
            <span className="tw:flex tw:flex-wrap tw:gap-2">
              <Button size="compact" onClick={() => onStart(status.request)}>
                {t("workspaceAdmin.retry")}
              </Button>
              <Button size="compact" variant="ghost" onClick={onCancel}>
                {t("common.close")}
              </Button>
            </span>
          )}
        >
          {status.message}
        </InlineNotice>
      );
    case "idle":
      break;
  }

  if (!notice) return null;
  const close = (
    <Button size="compact" variant="ghost" onClick={onDismissNotice}>
      {t("common.close")}
    </Button>
  );
  if (notice.kind === "error") {
    return (
      <InlineNotice tone="danger" icon="alert" role="alert" action={close}>
        {notice.message}
      </InlineNotice>
    );
  }
  return (
    <div
      className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2 tw:border-b tw:border-border-subtle tw:px-3 tw:py-2 tw:text-xs"
      role="status"
    >
      <Icon name="check" className="tw:shrink-0 tw:text-success" />
      <span className="tw:min-w-0 tw:flex-1 tw:text-foreground">
        {notice.kind === "connected"
          ? t("workspaceProviders.accountConnected", { provider: notice.providerName })
          : t("workspaceProviders.gcpRepaired")}
      </span>
      <span className="tw:flex tw:flex-wrap tw:gap-2">
        {notice.kind === "connected" && !databasesVisible ? (
          <Button size="compact" onClick={onOpenDatabases}>
            {t("workspaceProviders.openSharedDatabases")}
          </Button>
        ) : null}
        {close}
      </span>
    </div>
  );
}
