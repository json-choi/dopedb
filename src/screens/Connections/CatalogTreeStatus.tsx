// Renders the database tree's mutually exclusive access, load, and empty states.
// A failed read is shown through the same classified receipt the connection
// editor uses, so the tree never renders an untranslated driver or OS string.
import type { ReactNode } from "react";

import { Button } from "../../design-system/components/Button";
import { LoadingLabel } from "../../design-system/components/Status";
import { TreeInlineStatus } from "../../design-system/components/TreeControls";
import {
  distinctCatalogDetailIssue,
  isAuthenticationRequired,
  isManagedConnectionRecoveryRequired,
  type CatalogLoadIssue,
} from "../../features/catalogExplorer/catalogDomain";
import { connectionFailureDetailMessage } from "../../features/connections/connectionFailureDetail";
import {
  connectionTestFailureAction,
  connectionTestFailureRecovery,
  connectionTestFailureTitle,
} from "../../features/connections/connectionTestFailure";
import type {
  BigQueryAuthMode,
  ConnectionAccessIssue,
  ConnectionProfile,
} from "../../features/connections/domain";
import { useI18n, type I18nKey } from "../../lib/i18n";

interface CatalogTreeStatusProps {
  connection: Pick<ConnectionProfile, "credentialMode" | "workspaceAccess">;
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
  onEditConnection?: () => void;
  onRetryOverview: () => void;
  onRequestDetails: () => void;
}

/** Title and recovery sentence for a classified load failure. */
function failureCopy(
  t: (key: I18nKey) => string,
  issue: CatalogLoadIssue,
  connection: CatalogTreeStatusProps["connection"],
) {
  const code = issue.failure?.code ?? "unknown";
  return {
    code,
    title: connectionTestFailureTitle(t, code, connection),
    recovery: connectionTestFailureRecovery(t, code, connection),
    detail: connectionFailureDetailMessage(t, issue.failure?.detail ?? null),
  };
}

function FailureBody({
  title,
  recovery,
  detail,
  detailsLabel,
}: {
  title: string;
  recovery: string;
  detail: string;
  detailsLabel: string;
}) {
  return (
    <span className="tw:grid tw:gap-0.5">
      <strong className="tw:text-foreground">{title}</strong>
      <span>{recovery}</span>
      {detail ? (
        <details className="tw:min-w-0">
          <summary className="tw:cursor-pointer tw:text-muted-foreground">
            {detailsLabel}
          </summary>
          <p className="tw:mt-1 tw:mb-0 tw:wrap-break-word">{detail}</p>
        </details>
      ) : null}
    </span>
  );
}

export function CatalogTreeStatus({
  connection,
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
  onEditConnection,
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
  const loadFailure =
    !managedRecoveryIssue && !authenticationIssue && error
      ? failureCopy(t, error, connection)
      : null;
  // Managed access and BigQuery keep their own provider recovery. Only a
  // connection this member can actually edit here may offer the editor.
  const canOpenEditor = Boolean(onEditConnection);
  const primaryErrorBody: ReactNode = managedRecoveryIssue ? (
    canRecoverManagedConnection
      ? t("connections.managedWorkspace.recoveryRequiredManagerCompact")
      : t("connections.managedWorkspace.recoveryRequiredMemberCompact")
  ) : authenticationIssue ? (
    authenticationRecoveryMessage ?? t("connections.bigQueryAuthenticationExpired")
  ) : loadFailure ? (
    <FailureBody
      title={loadFailure.title}
      recovery={loadFailure.recovery}
      detail={loadFailure.detail}
      detailsLabel={t("connections.testFailure.technicalDetails")}
    />
  ) : null;
  const opensEditor = Boolean(
    loadFailure &&
      canOpenEditor &&
      connectionTestFailureAction(loadFailure.code) === "edit",
  );
  const primaryAction = canRecoverManagedConnection && onRecoverManagedConnection
    ? onRecoverManagedConnection
    : canRecoverAuthentication && onRecoverAuthentication
      ? onRecoverAuthentication
      : managedRecoveryIssue
        ? undefined
        : opensEditor
          ? onEditConnection
          : onRetryOverview;
  const primaryActionPending = managedConnectionRecoveryPending
    || authenticationRecoveryPending;
  const uniqueDetailError = distinctCatalogDetailIssue(error, detailError);
  const detailFailure =
    uniqueDetailError && !authenticationIssue && !managedRecoveryIssue
      ? failureCopy(t, uniqueDetailError, connection)
      : null;
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
      {primaryErrorBody ? (
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
              data-explorer-tree-key={`${databaseTreeKey}:${canRecoverManagedConnection ? "recover-managed-connection" : canRecoverAuthentication ? "recover-authentication" : opensEditor ? "edit-connection" : "retry-overview"}`}
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
                  : opensEditor
                    ? t("connections.edit")
                    : t("app.retry")}
            </Button>
          ) : undefined}
        >
          {primaryErrorBody}
        </TreeInlineStatus>
      ) : null}
      {detailFailure ? (
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
          <FailureBody
            title={detailFailure.title}
            recovery={detailFailure.recovery}
            detail={detailFailure.detail}
            detailsLabel={t("connections.testFailure.technicalDetails")}
          />
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
