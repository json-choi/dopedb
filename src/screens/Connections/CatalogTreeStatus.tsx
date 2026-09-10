// Renders the database tree's mutually exclusive access, load, and empty states.
import { Button } from "../../design-system/components/Button";
import { LoadingLabel } from "../../design-system/components/Status";
import { TreeInlineStatus } from "../../design-system/components/TreeControls";
import {
  distinctCatalogDetailIssue,
  isAuthenticationRequired,
  isManagedConnectionRecoveryRequired,
  type CatalogLoadIssue,
} from "../../features/catalogExplorer/catalogDomain";
import type {
  BigQueryAuthMode,
  ConnectionAccessIssue,
} from "../../features/connections/domain";
import { useI18n } from "../../lib/i18n";

interface CatalogTreeStatusProps {
  accessIssue?: ConnectionAccessIssue;
  error?: CatalogLoadIssue;
  detailError?: CatalogLoadIssue;
  catalogLoaded: boolean;
  empty: boolean;
  normalizedFilter: string;
  databaseTreeKey: string;
  treeLevel: number;
  authenticationMode?: BigQueryAuthMode;
  authenticationRecoveryPending?: boolean;
  authenticationRecoveryError?: CatalogLoadIssue;
  onResolveAccess?: () => void;
  onRecoverAuthentication?: () => void;
  onRecoverManagedConnection?: () => void;
  managedConnectionRecoveryPending?: boolean;
  onRetryOverview: () => void;
  onRequestDetails: () => void;
}

export function CatalogTreeStatus({
  accessIssue,
  error,
  detailError,
  catalogLoaded,
  empty,
  normalizedFilter,
  databaseTreeKey,
  treeLevel,
  authenticationMode,
  authenticationRecoveryPending = false,
  authenticationRecoveryError,
  onResolveAccess,
  onRecoverAuthentication,
  onRecoverManagedConnection,
  managedConnectionRecoveryPending = false,
  onRetryOverview,
  onRequestDetails,
}: CatalogTreeStatusProps) {
  const { t } = useI18n();
  const authenticationIssue = isAuthenticationRequired(error)
    ? error
    : isAuthenticationRequired(detailError)
      ? detailError
      : undefined;
  const canRecoverAuthentication = Boolean(
    authenticationIssue && onRecoverAuthentication,
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
    ? authenticationRecoveryError.kind === "timeout"
      ? t("connections.bigQueryErrorTimeout")
      : authenticationRecoveryError.kind === "network"
        ? t("connections.bigQueryErrorNetwork")
        : authenticationRecoveryError.kind === "blocked"
          ? t("connections.bigQueryAuthenticationPermissionError")
          : t("connections.bigQueryAuthenticationFailed")
    : null;
  const primaryErrorMessage = managedRecoveryIssue
    ? canRecoverManagedConnection
      ? t("connections.managedWorkspace.recoveryRequiredManagerCompact")
      : t("connections.managedWorkspace.recoveryRequiredMemberCompact")
    : authenticationIssue
      ? authenticationRecoveryMessage
        ?? t("connections.bigQueryAuthenticationExpired")
      : error?.message;
  const uniqueDetailError = distinctCatalogDetailIssue(error, detailError);
  const primaryAction = canRecoverManagedConnection && onRecoverManagedConnection
    ? onRecoverManagedConnection
    : canRecoverAuthentication && onRecoverAuthentication
      ? onRecoverAuthentication
      : managedRecoveryIssue
        ? undefined
        : onRetryOverview;
  const primaryActionPending = managedConnectionRecoveryPending
    || authenticationRecoveryPending;
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
              disabled={primaryActionPending}
              onClick={primaryAction}
              role="treeitem"
              aria-level={treeLevel + 1}
              data-explorer-tree-item
              data-explorer-tree-key={`${databaseTreeKey}:${canRecoverManagedConnection ? "recover-managed-connection" : canRecoverAuthentication ? "recover-authentication" : "retry-overview"}`}
              data-explorer-tree-parent-key={databaseTreeKey}
              data-tree-primary-action
              tabIndex={-1}
            >
              {canRecoverManagedConnection
                ? managedConnectionRecoveryPending
                  ? t("connections.managedWorkspace.opening")
                  : t("connections.managedWorkspace.recover")
                : canRecoverAuthentication
                  ? authenticationRecoveryPending
                    ? t("connections.bigQueryReconnecting")
                    : authenticationMode === "serviceAccount"
                      ? t("connections.bigQueryReplaceCredentialFile")
                      : t("connections.bigQueryReconnectGoogleAccount")
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
          action={<Button
            size="xs"
            variant="ghost"
            onClick={onRequestDetails}
            role="treeitem"
            aria-level={treeLevel + 1}
            data-explorer-tree-item
            data-explorer-tree-key={`${databaseTreeKey}:retry-details`}
            data-explorer-tree-parent-key={databaseTreeKey}
            data-tree-primary-action
            tabIndex={-1}
          >
            {t("app.retry")}
          </Button>}
        >
          {uniqueDetailError.message}
        </TreeInlineStatus>
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
