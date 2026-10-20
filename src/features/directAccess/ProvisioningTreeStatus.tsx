// Explorer status of the caller's own account on a provisioned team connection: not
// requested, requested, being created by an administrator device, failed with a closed
// reason, or revoked. The first Connect asks once (the account is created on the
// server and the password stays on this device) and then calls the member request; a
// failed or revoked account can be requested again. No password is ever typed here.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ConfirmDialog from "../../components/ConfirmDialog";
import { Button } from "../../design-system/components/Button";
import { LoadingLabel } from "../../design-system/components/Status";
import { TreeInlineStatus } from "../../design-system/components/TreeControls";
import { useI18n, type I18nKey } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import { connectionQueryKeys } from "../connections/queries";
import type { ConnectionId } from "../connections/domain";
import { accountId, workspaceId } from "../workspaces/domain";
import {
  directFailureCodeOf,
  type DirectProvisioningStatus,
  type DirectScope,
} from "./domain";
import { DIRECT_FAILURE_KEYS } from "./messages";
import { directStatusQuery } from "./queries";
import { requestDirectMemberAccount } from "./tauriAdapter";

type Presentation = Readonly<{
  title: I18nKey;
  body: I18nKey | null;
  action: "connect" | "retry" | null;
}>;

/** One closed presentation per provisioning state (the failed reason is added by the view). */
function present(status: DirectProvisioningStatus): Presentation {
  switch (status.state) {
    case "not_requested":
      return {
        title: "directAccess.state.notRequested",
        body: "directAccess.state.notRequestedBody",
        action: "connect",
      };
    case "requested":
      return { title: "directAccess.state.requested", body: "directAccess.state.requestedBody", action: null };
    case "applying":
      return { title: "directAccess.state.applying", body: "directAccess.state.applyingBody", action: null };
    case "failed":
      return { title: "directAccess.state.failed", body: null, action: "retry" };
    case "dropped":
      return { title: "directAccess.state.revoked", body: "directAccess.state.revokedBody", action: "retry" };
    case "drop_pending":
      return { title: "directAccess.state.revoked", body: "directAccess.state.revokedBody", action: null };
    case "ready":
      return status.level === "none"
        ? { title: "directAccess.state.revoked", body: "directAccess.state.revokedBody", action: null }
        : { title: "directAccess.state.ready", body: "directAccess.state.readyBody", action: null };
  }
}

export default function ProvisioningTreeStatus({
  connectionId,
  databaseTreeKey,
  treeLevel,
}: {
  connectionId: ConnectionId;
  databaseTreeKey: string;
  treeLevel: number;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const actionRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const scope: DirectScope | null = catalogScope.workspaceId && catalogScope.accountScope
    ? {
        accountId: accountId(catalogScope.accountScope),
        workspaceId: workspaceId(catalogScope.workspaceId),
        connectionId,
      }
    : null;
  const status = useQuery(directStatusQuery(scope));
  const request = useMutation({
    mutationFn: () => {
      if (!scope) throw new Error("A team connection scope is required.");
      return requestDirectMemberAccount(scope);
    },
    onSuccess: (next) => {
      if (scope) queryClient.setQueryData(directStatusQuery(scope).queryKey, next);
    },
  });

  // A ready account names the saved profile's user; pull the profile so it opens.
  const state = status.data?.provisioning.state;
  useEffect(() => {
    if (state === "ready") {
      void queryClient.invalidateQueries({ queryKey: connectionQueryKeys.all(catalogScope.key) });
    }
  }, [catalogScope.key, queryClient, state]);

  if (!status.data) {
    return status.isError ? (
      <TreeInlineStatus
        tone="danger"
        icon="alert"
        role="alert"
        action={(
          <Button size="xs" variant="ghost" onClick={() => void status.refetch()}>
            {t("app.retry")}
          </Button>
        )}
      >
        {t("directAccess.state.loadError")}
      </TreeInlineStatus>
    ) : (
      <div className="tw:px-2 tw:py-1 tw:text-sm">
        <LoadingLabel>{t("directAccess.state.loading")}</LoadingLabel>
      </div>
    );
  }

  const provisioning = status.data.provisioning;
  const view = present(provisioning);
  const reason = provisioning.failureCode
    ? t(DIRECT_FAILURE_KEYS[provisioning.failureCode])
    : null;
  const requestFailure = request.isError
    ? t(
        DIRECT_FAILURE_KEYS[directFailureCodeOf(request.error) ?? "network"],
      )
    : null;
  const actionLabel = view.action === "connect"
    ? t("directAccess.connect")
    : t("directAccess.requestAgain");

  function act() {
    if (view.action === "connect") setConfirming(true);
    else request.mutate();
  }

  return (
    <>
      <TreeInlineStatus
        icon={provisioning.state === "failed" || provisioning.state === "dropped"
          || provisioning.state === "drop_pending"
          ? "lock"
          : "key"}
        action={view.action ? (
          <Button
            ref={actionRef}
            size="xs"
            variant="ghost"
            disabled={request.isPending}
            disabledBehavior="focusable"
            onClick={act}
            role="treeitem"
            aria-level={treeLevel + 1}
            data-explorer-tree-item
            data-explorer-tree-key={`${databaseTreeKey}:provisioning-action`}
            data-explorer-tree-parent-key={databaseTreeKey}
            data-tree-primary-action
            tabIndex={-1}
          >
            {request.isPending ? t("common.working") : actionLabel}
          </Button>
        ) : undefined}
      >
        <span className="tw:grid tw:gap-0.5">
          <strong className="tw:text-foreground">{t(view.title)}</strong>
          {view.body ? <span>{t(view.body)}</span> : null}
          {reason ? <span>{reason}</span> : null}
        </span>
      </TreeInlineStatus>
      {requestFailure ? (
        <TreeInlineStatus tone="danger" icon="alert" role="alert">
          {requestFailure}
        </TreeInlineStatus>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={t("directAccess.confirm.title")}
          description={t("directAccess.confirm.body")}
          confirmLabel={t("directAccess.connect")}
          confirmVariant="primary"
          returnFocusRef={actionRef}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            request.mutate();
          }}
        />
      ) : null}
    </>
  );
}
