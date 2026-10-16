// Owned workspaces whose deletion is scheduled. Scheduling suspends every membership,
// so these workspaces leave the workspace menu and this account-level list is the only
// place to restore one before its purge time. The control plane decides whether the
// cancellation is still allowed; the section stays hidden while nothing is pending.
import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../../components/Toast";
import { Button } from "../../../design-system/components/Button";
import { SettingsSectionHeader } from "../../../design-system/components/SettingsList";
import { InlineNotice } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import type { AccountId, WorkspaceId } from "../../workspaces/domain";
import { requestWorkspaceMembershipRefresh } from "../../workspaces/membershipRefreshRequest";
import {
  runWorkspaceAdmin,
  workspaceAdminErrorMessage,
  WorkspaceAdminRequestError,
} from "../requests";
import { parseWorkspaceLifecycleSnapshot, type DeletionPendingWorkspace } from "./domain";
import { formatMoment } from "./format";
import { deletionPendingWorkspacesQuery, ownedWorkspacesQueryKey } from "./queries";

export default function DeletionPendingWorkspaces({ accountId }: { accountId: AccountId }) {
  const { lang, t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const pending = useQuery(deletionPendingWorkspacesQuery(accountId));
  const [cancelling, setCancelling] = useState<WorkspaceId | null>(null);
  const [failure, setFailure] = useState<{
    workspace: DeletionPendingWorkspace;
    message: string;
  } | null>(null);

  function cancelDeletionError(error: unknown) {
    if (error instanceof WorkspaceAdminRequestError) {
      if (error.status === 409) return t("workspaceAccount.cancelDeletionExpired");
      if (error.status === 403 || error.status === 404) {
        return t("workspaceAccount.cancelDeletionUnavailable");
      }
    }
    return workspaceAdminErrorMessage(error, { lang, t }, "workspaceAccount.cancelDeletionFailed");
  }

  async function cancelDeletion(workspace: DeletionPendingWorkspace) {
    if (cancelling !== null) return;
    setCancelling(workspace.id);
    setFailure(null);
    try {
      // The receipt id that scheduled the deletion is the only accepted cancel request.
      const lifecycle = parseWorkspaceLifecycleSnapshot(
        await runWorkspaceAdmin(accountId, { kind: "getLifecycle", workspaceId: workspace.id }),
      );
      // An active workspace was already restored elsewhere; only the refresh remains.
      if (lifecycle.lifecycleState === "deletion_pending") {
        if (!lifecycle.deletionReceiptId) {
          throw new Error("The scheduled deletion has no cancellable receipt.");
        }
        await runWorkspaceAdmin(accountId, {
          kind: "cancelWorkspaceDeletion",
          workspaceId: workspace.id,
          requestId: lifecycle.deletionReceiptId,
        });
      }
      // The restored membership reaches the workspace menu through the account
      // lifecycle, which retries on its own if this refresh fails.
      await requestWorkspaceMembershipRefresh().catch(() => undefined);
      toast(t("workspaceAccount.deletionCancelled", { name: workspace.name }), "success");
    } catch (error) {
      setFailure({ workspace, message: cancelDeletionError(error) });
    } finally {
      await queryClient.invalidateQueries({ queryKey: ownedWorkspacesQueryKey(accountId) });
      setCancelling(null);
    }
  }

  const workspaces = pending.data ?? [];
  // A refused cancellation stays visible even when the refreshed list no longer
  // carries that workspace, for example after its purge already ran.
  const detachedFailure = failure
    && !workspaces.some((workspace) => workspace.id === failure.workspace.id)
    ? failure
    : null;
  if (
    pending.isPending
    || (workspaces.length === 0 && !pending.isError && !detachedFailure)
  ) {
    return null;
  }

  return (
    <section className="tw:grid tw:min-w-0">
      <SettingsSectionHeader title={t("workspaceAccount.deletionTitle")} />
      <p className="tw:mt-0 tw:mb-3 tw:text-ui tw:leading-body tw:text-muted-foreground">
        {t("workspaceAccount.deletionDescription")}
      </p>
      {pending.isError ? (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={
            <Button
              size="compact"
              disabled={pending.isFetching}
              onClick={() => void pending.refetch()}
            >
              {t("workspaceAdmin.retry")}
            </Button>
          }
        >
          {workspaceAdminErrorMessage(
            pending.error,
            { lang, t },
            "workspaceAccount.deletionLoadFailed",
          )}
        </InlineNotice>
      ) : null}
      {workspaces.map((workspace) => (
        <Fragment key={workspace.id}>
          <InlineNotice
            tone="warning"
            icon="alert"
            action={
              <Button
                size="compact"
                disabled={cancelling !== null}
                aria-busy={cancelling === workspace.id}
                onClick={() => void cancelDeletion(workspace)}
              >
                {t(
                  cancelling === workspace.id
                    ? "workspaceAccount.cancellingDeletion"
                    : "workspaceAccount.cancelDeletion",
                )}
              </Button>
            }
          >
            <span className="tw:grid tw:min-w-0 tw:gap-0.5">
              <span className="tw:truncate tw:text-ui tw:font-medium tw:text-foreground">
                {workspace.name}
              </span>
              <span className="tw:text-muted-foreground">
                {workspace.purgeAfter
                  ? t("workspaceAccount.purgeAt", {
                      date: formatMoment(workspace.purgeAfter, lang),
                    })
                  : t("workspaceAccount.purgeScheduled")}
              </span>
            </span>
          </InlineNotice>
          {failure?.workspace.id === workspace.id ? (
            <InlineNotice tone="danger" icon="alert" role="alert">
              {failure.message}
            </InlineNotice>
          ) : null}
        </Fragment>
      ))}
      {detachedFailure ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          <span className="tw:grid tw:min-w-0 tw:gap-0.5">
            <span className="tw:truncate tw:font-medium tw:text-foreground">
              {detachedFailure.workspace.name}
            </span>
            <span>{detachedFailure.message}</span>
          </span>
        </InlineNotice>
      ) : null}
    </section>
  );
}
