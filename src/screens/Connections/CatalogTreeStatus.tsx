// Renders the database tree's mutually exclusive access, load, and empty states, plus
// the capture time of a persisted catalog shown while the live read replaces it.
// A cooling-down connection keeps Retry disabled with a countdown until it may open;
// disabled actions stay focusable so tree arrow keys and the roving stop pass them.
import { Button } from "../../design-system/components/Button";
import { LoadingLabel } from "../../design-system/components/Status";
import { TreeInlineStatus } from "../../design-system/components/TreeControls";
import {
  catalogLoadIssueAction,
  catalogLoadIssueMessage,
  distinctCatalogDetailIssue,
  isAuthenticationRequired,
  isManagedConnectionRecoveryRequired,
  type CatalogLoadIssue,
} from "../../features/catalogExplorer/catalogDomain";
import useRetryCountdown from "../../features/catalogExplorer/useRetryCountdown";
import type {
  BigQueryAuthMode,
  ConnectionAccessIssue,
} from "../../features/connections/domain";
import { useI18n } from "../../lib/i18n";
import { fullTime } from "../../lib/relTime";

interface CatalogTreeStatusProps {
  /** Capture time of the persisted catalog currently shown, if any. */
  persistedAt?: string | null;
  accessIssue?: ConnectionAccessIssue;
  error?: CatalogLoadIssue;
  detailError?: CatalogLoadIssue;
  catalogLoaded: boolean;
  empty: boolean;
  normalizedFilter: string;
  /** An explicit refresh of this connection's catalog is running. */
  refreshing?: boolean;
  databaseTreeKey: string;
  treeLevel: number;
  authenticationMode?: BigQueryAuthMode;
  authenticationRecoveryPending?: boolean;
  authenticationRecoveryError?: CatalogLoadIssue;
  onResolveAccess?: () => void;
  onRecoverAuthentication?: () => void;
  onRecoverManagedConnection?: () => void;
  /** Opens workspace sign-in; present for a shared connection, whose expired
   * workspace session (not a provider sign-in) blocks the read. */
  onSignInWorkspace?: () => void;
  onEdit?: () => void;
  /** Reloads workspace data through the shell, then retries this catalog. */
  onRefreshWorkspace?: () => void;
  onRetryOverview: () => void;
  onRequestDetails: () => void;
}

export function CatalogTreeStatus({
  persistedAt = null,
  accessIssue,
  error,
  detailError,
  catalogLoaded,
  empty,
  normalizedFilter,
  refreshing = false,
  databaseTreeKey,
  treeLevel,
  authenticationMode,
  authenticationRecoveryPending = false,
  authenticationRecoveryError,
  onResolveAccess,
  onRecoverAuthentication,
  onRecoverManagedConnection,
  onSignInWorkspace,
  onEdit,
  onRefreshWorkspace,
  onRetryOverview,
  onRequestDetails,
}: CatalogTreeStatusProps) {
  const { t, lang } = useI18n();
  const authenticationIssue = isAuthenticationRequired(error)
    ? error
    : isAuthenticationRequired(detailError)
      ? detailError
      : undefined;
  const workspaceSignIn = Boolean(authenticationIssue && onSignInWorkspace);
  const recoverAuthentication = workspaceSignIn
    ? onSignInWorkspace
    : onRecoverAuthentication;
  const canRecoverAuthentication = Boolean(
    authenticationIssue && recoverAuthentication,
  );
  const managedRecoveryIssue = isManagedConnectionRecoveryRequired(error)
    ? error
    : isManagedConnectionRecoveryRequired(detailError)
      ? detailError
      : undefined;
  const canRecoverManagedConnection = Boolean(
    managedRecoveryIssue && onRecoverManagedConnection,
  );
  const authenticationRecoveryMessage = authenticationRecoveryError
    ? authenticationRecoveryError.code === "timeout"
      || authenticationRecoveryError.code === "sshTimeout"
      ? t("connections.bigQueryErrorTimeout")
      : authenticationRecoveryError.code === "network"
        || authenticationRecoveryError.code === "connectionNetwork"
        ? t("connections.bigQueryErrorNetwork")
        : authenticationRecoveryError.code === "blocked"
          ? t("connections.bigQueryAuthenticationPermissionError")
          : t("connections.bigQueryAuthenticationFailed")
    : null;
  const primaryErrorMessage = managedRecoveryIssue
    ? canRecoverManagedConnection
      ? t("connections.managedWorkspace.recoveryRequiredManagerCompact")
      : t("connections.managedWorkspace.recoveryRequiredMemberCompact")
    : authenticationIssue
      ? workspaceSignIn
        ? t("schema.workspaceSignInRequired")
        : authenticationRecoveryMessage
          ?? t("connections.bigQueryAuthenticationExpired")
      : error
        ? catalogLoadIssueMessage(t, error)
        : undefined;
  const uniqueDetailError = distinctCatalogDetailIssue(error, detailError);
  const primaryIssue = managedRecoveryIssue ?? authenticationIssue ?? error;
  const issueActionKind = primaryIssue
    ? catalogLoadIssueAction(primaryIssue)
    : null;
  // A member who cannot repair a managed connection can still retry it once an
  // admin has; only the admin keeps the Recover action.
  const primaryActionKind = issueActionKind === "recoverManaged"
    && !canRecoverManagedConnection
    ? "retry"
    : issueActionKind;
  const primaryAction = primaryActionKind === "recoverManaged"
    ? onRecoverManagedConnection
    : primaryActionKind === "recoverAuthentication"
      ? canRecoverAuthentication ? recoverAuthentication : undefined
      : primaryActionKind === "resolveCredentials"
        ? onResolveAccess
        : primaryActionKind === "edit"
          ? onEdit
          : primaryActionKind === "refreshWorkspace"
            ? onRefreshWorkspace
            : primaryActionKind === "retry"
              ? onRetryOverview
              : undefined;
  const detailActionKind = uniqueDetailError
    ? catalogLoadIssueAction(uniqueDetailError)
    : null;
  const detailAction = detailActionKind === "edit"
    ? onEdit
    : detailActionKind === "refreshWorkspace"
      ? onRefreshWorkspace
      : detailActionKind === "retry"
        ? onRequestDetails
        : undefined;
  const primaryRetryWait = useRetryCountdown(
    primaryActionKind === "retry" ? primaryIssue?.retryAt : undefined,
  );
  const detailRetryWait = useRetryCountdown(
    detailActionKind === "retry" ? uniqueDetailError?.retryAt : undefined,
  );
  return (
    <>
      {accessIssue ? (
        <TreeInlineStatus
          icon={accessIssue === "grant" ? "lock" : "key"}
          action={accessIssue === "credentials" && onResolveAccess ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={onResolveAccess}
              role="treeitem"
              aria-level={treeLevel + 1}
              data-explorer-tree-item
              data-explorer-tree-key={`${databaseTreeKey}:resolve-access`}
              data-explorer-tree-parent-key={databaseTreeKey}
              data-tree-primary-action
              tabIndex={-1}
            >
              {t("workspace.bindCredentialsShort")}
            </Button>
          ) : undefined}
        >
          <span className="tw:grid tw:gap-0.5">
            <strong className="tw:text-foreground">
              {accessIssue === "grant"
                ? t("workspace.connectionUseRequired")
                : t("workspace.credentialsRequiredTitle")}
            </strong>
            <span>
              {accessIssue === "grant"
                ? t("workspace.connectionUseRequiredBody")
                : t("workspace.credentialsRequiredBody")}
            </span>
          </span>
        </TreeInlineStatus>
      ) : null}
      {primaryErrorMessage ? (
        <TreeInlineStatus
          tone="danger"
          icon="alert"
          role="alert"
          action={primaryAction ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={authenticationRecoveryPending || primaryRetryWait > 0}
              disabledBehavior="focusable"
              onClick={primaryAction}
              role="treeitem"
              aria-level={treeLevel + 1}
              data-explorer-tree-item
              data-explorer-tree-key={`${databaseTreeKey}:${canRecoverManagedConnection ? "recover-managed-connection" : canRecoverAuthentication ? "recover-authentication" : "retry-overview"}`}
              data-explorer-tree-parent-key={databaseTreeKey}
              data-tree-primary-action
              tabIndex={-1}
            >
              {primaryActionKind === "recoverManaged"
                ? t("connections.managedWorkspace.recover")
                : primaryActionKind === "recoverAuthentication"
                  ? workspaceSignIn
                    ? t("workspace.login")
                    : authenticationRecoveryPending
                      ? t("connections.bigQueryReconnecting")
                      : authenticationMode === "serviceAccount"
                        ? t("connections.bigQueryReplaceCredentialFile")
                        : t("connections.bigQueryReconnectGoogleAccount")
                  : primaryActionKind === "resolveCredentials"
                    ? t("workspace.bindCredentialsShort")
                    : primaryActionKind === "edit"
                      ? t("connections.edit")
                      : primaryActionKind === "refreshWorkspace"
                        ? t("schema.refreshWorkspace")
                        : primaryRetryWait > 0
                          ? t("schema.retryIn", { seconds: primaryRetryWait })
                          : t("app.retry")}
            </Button>
          ) : undefined}
        >
          {primaryErrorMessage}
        </TreeInlineStatus>
      ) : null}
      {uniqueDetailError && !authenticationIssue && !managedRecoveryIssue ? (
        <TreeInlineStatus
          icon="alert"
          action={detailAction ? <Button
            size="xs"
            variant="ghost"
            disabled={detailRetryWait > 0}
            disabledBehavior="focusable"
            onClick={detailAction}
            role="treeitem"
            aria-level={treeLevel + 1}
            data-explorer-tree-item
            data-explorer-tree-key={`${databaseTreeKey}:retry-details`}
            data-explorer-tree-parent-key={databaseTreeKey}
            data-tree-primary-action
            tabIndex={-1}
          >
            {detailActionKind === "edit"
              ? t("connections.edit")
              : detailActionKind === "refreshWorkspace"
                ? t("schema.refreshWorkspace")
                : detailRetryWait > 0
                  ? t("schema.retryIn", { seconds: detailRetryWait })
                  : t("app.retry")}
          </Button> : undefined}
        >
          {catalogLoadIssueMessage(t, uniqueDetailError)}
        </TreeInlineStatus>
      ) : null}
      {persistedAt ? (
        <div className="tw:px-2 tw:py-1 tw:text-xs tw:text-muted-foreground">
          {detailError ? (
            t("schema.persistedShown", { time: fullTime(persistedAt, lang) })
          ) : (
            <LoadingLabel>
              {t("schema.persistedRefreshing", {
                time: fullTime(persistedAt, lang),
              })}
            </LoadingLabel>
          )}
        </div>
      ) : null}
      {refreshing && catalogLoaded && !persistedAt ? (
        <div className="tw:px-2 tw:py-1 tw:text-xs tw:text-muted-foreground">
          <LoadingLabel>{t("schema.rereading")}</LoadingLabel>
        </div>
      ) : null}
      {!catalogLoaded && !error && !detailError && !accessIssue ? (
        <div className="tw:px-2 tw:py-1 tw:text-sm">
          <LoadingLabel>{t("connections.loadingSchema")}</LoadingLabel>
        </div>
      ) : null}
      {catalogLoaded && empty ? (
        <div className="tw:px-2 tw:py-1 tw:text-sm tw:text-muted-foreground">
          {normalizedFilter
            ? t("connections.noTablesMatch", { filter: normalizedFilter })
            : t("connections.noObjects")}
        </div>
      ) : null}
    </>
  );
}
