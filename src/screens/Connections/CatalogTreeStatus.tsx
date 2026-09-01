// Renders the database tree's mutually exclusive access, load, and empty states.
import { Button } from "../../design-system/components/Button";
import { LoadingLabel } from "../../design-system/components/Status";
import {
  distinctCatalogDetailIssue,
  isAuthenticationRequired,
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
  const authenticationRecoveryMessage = authenticationRecoveryError
    ? authenticationRecoveryError.kind === "timeout"
      ? t("connections.bigQueryErrorTimeout")
      : authenticationRecoveryError.kind === "network"
        ? t("connections.bigQueryErrorNetwork")
        : authenticationRecoveryError.kind === "blocked"
          ? t("connections.bigQueryAuthenticationPermissionError")
          : t("connections.bigQueryAuthenticationFailed")
    : null;
  const primaryErrorMessage = authenticationIssue
    ? authenticationRecoveryMessage
      ?? t("connections.bigQueryAuthenticationExpired")
    : error?.message;
  const uniqueDetailError = distinctCatalogDetailIssue(error, detailError);
  return (
    <>
      {accessIssue ? (
        <div className="tw:grid tw:gap-1 tw:px-2 tw:py-2 tw:text-sm">
          <strong className="tw:text-foreground">
            {accessIssue === "grant"
              ? t("workspace.connectionUseRequired")
              : t("workspace.credentialsRequiredTitle")}
          </strong>
          <span className="tw:text-xs tw:leading-body tw:text-muted-foreground">
            {accessIssue === "grant"
              ? t("workspace.connectionUseRequiredBody")
              : t("workspace.credentialsRequiredBody")}
          </span>
          {accessIssue === "credentials" && onResolveAccess ? (
            <div className="tw:mt-1 tw:w-fit">
              <Button
                size="xs"
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
            </div>
          ) : null}
        </div>
      ) : null}
      {primaryErrorMessage ? (
        <div className="tw:flex tw:items-start tw:gap-2 tw:px-2 tw:py-1 tw:text-sm tw:text-danger">
          <span className="tw:min-w-0 tw:flex-1 tw:wrap-break-word">
            {primaryErrorMessage}
          </span>
          <Button
            size="xs"
            disabled={authenticationRecoveryPending}
            onClick={
              canRecoverAuthentication && onRecoverAuthentication
                ? onRecoverAuthentication
                : onRetryOverview
            }
            role="treeitem"
            aria-level={treeLevel + 1}
            data-explorer-tree-item
            data-explorer-tree-key={`${databaseTreeKey}:${canRecoverAuthentication ? "recover-authentication" : "retry-overview"}`}
            data-explorer-tree-parent-key={databaseTreeKey}
            data-tree-primary-action
            tabIndex={-1}
          >
            {canRecoverAuthentication
              ? authenticationRecoveryPending
                ? t("connections.bigQueryReconnecting")
                : authenticationMode === "serviceAccount"
                  ? t("connections.bigQueryReplaceCredentialFile")
                  : t("connections.bigQueryReconnectGoogleAccount")
              : t("common.refresh")}
          </Button>
        </div>
      ) : null}
      {uniqueDetailError && !authenticationIssue ? (
        <div className="tw:flex tw:items-start tw:gap-2 tw:px-2 tw:py-1 tw:text-sm tw:text-muted-foreground">
          <span className="tw:min-w-0 tw:flex-1 tw:wrap-break-word">
            {uniqueDetailError.message}
          </span>
          <Button
            size="xs"
            onClick={onRequestDetails}
            role="treeitem"
            aria-level={treeLevel + 1}
            data-explorer-tree-item
            data-explorer-tree-key={`${databaseTreeKey}:retry-details`}
            data-explorer-tree-parent-key={databaseTreeKey}
            data-tree-primary-action
            tabIndex={-1}
          >
            {t("common.refresh")}
          </Button>
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
