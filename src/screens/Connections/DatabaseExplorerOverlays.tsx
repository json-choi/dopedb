// Footer, setup dialogs, drag preview, and modal overlays for Database Explorer.
import type { ReactNode, RefObject } from "react";

import EngineMark from "../../components/EngineMark";
import { Button } from "../../design-system/components/Button";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../design-system/components/Modal";
import type { PendingSchemaGroupChange } from "../../features/catalogExplorer/useSchemaGroupDrag";
import { ProviderCredentialDialog } from "../../features/providers/ProviderCredentialDialog";
import type { ProviderKind } from "../../features/providers/domain";
import { EnvironmentSetupDialog } from "../../features/knowledge/components/EnvironmentSetupDialog";
import { ProjectSetupDialog } from "../../features/knowledge/components/ProjectSetupDialog";
import type { KnowledgeProject } from "../../features/knowledge/domain";
import type { WorkspaceDialogState } from "../../features/catalogExplorer/domain";
import type { ConnectionProfile } from "../../features/connections/domain";
import WorkspaceConnectionDialog from "../../features/workspaces/components/WorkspaceConnectionDialog";
import { useI18n } from "../../lib/i18n";

interface DatabaseExplorerOverlaysProps {
  workspaceAccount?: ReactNode;
  catalogScopeKey: string;
  projects: KnowledgeProject[];
  projectSetupOpen: boolean;
  environmentSetupProjectId: string | null;
  dragPreview: {
    id: string;
    connectionIds: readonly string[];
    x: number;
    y: number;
  } | null;
  orderAnnouncement: { id: number; message: string } | null;
  connections: ConnectionProfile[];
  pendingGroupChange: PendingSchemaGroupChange | null;
  workspaceDialog: WorkspaceDialogState | null;
  providerCredentialsOpen: ProviderKind | null;
  providerReturnFocusRef: RefObject<HTMLElement | null>;
  onProjectCreated: (project: KnowledgeProject) => void;
  onEnvironmentCreated: (project: KnowledgeProject) => void;
  onCloseProjectSetup: () => void;
  onCloseEnvironmentSetup: () => void;
  onConnectionUpdated: (connection: ConnectionProfile) => void;
  onConfirmGroupChange: () => void;
  onCancelGroupChange: () => void;
  onCloseWorkspaceDialog: () => void;
  onCloseProviderCredentials: () => void;
}

export function DatabaseExplorerOverlays({
  workspaceAccount,
  catalogScopeKey,
  projects,
  projectSetupOpen,
  environmentSetupProjectId,
  dragPreview,
  orderAnnouncement,
  connections,
  pendingGroupChange,
  workspaceDialog,
  providerCredentialsOpen,
  providerReturnFocusRef,
  onProjectCreated,
  onEnvironmentCreated,
  onCloseProjectSetup,
  onCloseEnvironmentSetup,
  onConnectionUpdated,
  onConfirmGroupChange,
  onCancelGroupChange,
  onCloseWorkspaceDialog,
  onCloseProviderCredentials,
}: DatabaseExplorerOverlaysProps) {
  const { t } = useI18n();
  const draggedConnection = dragPreview
    ? connections.find((connection) => connection.id === dragPreview.id) ?? null
    : null;
  const draggedConnections = dragPreview
    ? dragPreview.connectionIds.flatMap((connectionId) => {
        const connection = connections.find(
          (candidate) => candidate.id === connectionId,
        );
        return connection ? [connection] : [];
      })
    : [];
  const draggedSchemaGroup =
    draggedConnections.length > 1
      ? draggedConnections[0]?.schemaGroup?.trim()
      : null;
  return (
    <>
      {workspaceAccount ? (
        <div className="ds-control-row tw:flex tw:min-w-0 tw:shrink-0 tw:items-center tw:gap-2 tw:border-t tw:border-border-subtle tw:bg-background tw:p-2">
          {workspaceAccount}
        </div>
      ) : null}

      {projectSetupOpen ? (
        <ProjectSetupDialog
          catalogScopeKey={catalogScopeKey}
          onClose={onCloseProjectSetup}
          onCreated={onProjectCreated}
        />
      ) : null}

      {environmentSetupProjectId ? (
        <EnvironmentSetupDialog
          projects={projects}
          preferredProjectId={environmentSetupProjectId}
          catalogScopeKey={catalogScopeKey}
          onClose={onCloseEnvironmentSetup}
          onCreated={onEnvironmentCreated}
        />
      ) : null}

      {dragPreview && draggedConnection ? (
        <div
          className="tw:pointer-events-none tw:fixed tw:top-0 tw:left-0 tw:z-[var(--ds-z-popover)] tw:inline-flex tw:max-w-[min(280px,70vw)] tw:items-center tw:gap-2 tw:rounded-sm tw:border tw:border-border-strong tw:bg-popover tw:p-2 tw:text-ui tw:font-semibold tw:text-popover-foreground tw:shadow-popover"
          style={{
            transform: `translate3d(${Math.round(dragPreview.x + 12)}px, ${Math.round(dragPreview.y + 12)}px, 0)`,
          }}
        >
          <EngineMark engine={draggedConnection.engine} />
          <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
            {draggedSchemaGroup
              ? t("connections.schemaGroupTitle", {
                  group: draggedSchemaGroup,
                })
              : draggedConnection.name || t("app.unnamed")}
          </span>
          {draggedConnections.length > 1 ? (
            <span className="tw:shrink-0 tw:rounded-xs tw:border tw:border-border-subtle tw:px-1.5 tw:py-px tw:font-mono tw:text-2xs tw:text-muted-foreground">
              {t("connections.projectDatabaseCount", {
                count: draggedConnections.length,
              })}
            </span>
          ) : null}
        </div>
      ) : null}

      {orderAnnouncement ? (
        <span
          key={orderAnnouncement.id}
          className="tw:sr-only"
          role="status"
          aria-live="polite"
        >
          {orderAnnouncement.message}
        </span>
      ) : null}

      {pendingGroupChange ? (
        <ModalBackdrop onMouseDown={onCancelGroupChange}>
          <ModalSurface
            size="alert"
            role="alertdialog"
            aria-labelledby="schema-group-change-title"
            aria-describedby="schema-group-change-body"
            onRequestClose={onCancelGroupChange}
          >
            <ModalHeader
              title={t("connections.schemaGroup")}
              titleId="schema-group-change-title"
            />
            <p
              id="schema-group-change-body"
              className="tw:m-0 tw:px-5 tw:py-4 tw:text-ui tw:leading-body"
            >
              {pendingGroupChange.message}
            </p>
            <ModalFooter>
              <Button data-modal-initial-focus onClick={onCancelGroupChange}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={onConfirmGroupChange}>
                {t("common.apply")}
              </Button>
            </ModalFooter>
          </ModalSurface>
        </ModalBackdrop>
      ) : null}
      {workspaceDialog ? (
        <WorkspaceConnectionDialog
          // The latest binding, not the one captured when the dialog opened, decides
          // whether a saved password can be kept.
          connection={
            connections.find(
              (connection) => connection.id === workspaceDialog.connection.id,
            ) ?? workspaceDialog.connection
          }
          mode={workspaceDialog.mode}
          onBound={onConnectionUpdated}
          onClose={onCloseWorkspaceDialog}
        />
      ) : null}
      {providerCredentialsOpen ? (
        <ProviderCredentialDialog
          initialProvider={providerCredentialsOpen}
          onClose={onCloseProviderCredentials}
          returnFocusRef={providerReturnFocusRef}
        />
      ) : null}
    </>
  );
}
