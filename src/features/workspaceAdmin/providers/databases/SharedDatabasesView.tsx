// Shared databases of the active workspace in Workspace management → Providers: the inventory
// joined with each managed connection's provider target, removal, the managed-access
// repair entry, the inline add-database flow and Neon branch administration. Reads
// come from the shared provider queries; this view owns the removal mutation and its
// notices, and asks the shell to pull each committed change into this device.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../../../components/Icon";
import { useToast } from "../../../../components/Toast";
import { Button } from "../../../../design-system/components/Button";
import {
  SettingsList,
  SettingsSectionHeader,
} from "../../../../design-system/components/SettingsList";
import { InlineNotice, LoadingLabel } from "../../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../../lib/i18n";
import { useCatalogScope } from "../../../../lib/queries";
import { useEventCallback } from "../../../../lib/useEventCallback";
import type { WorkspaceAdminScope } from "../../domain";
import { runWorkspaceAdmin, workspaceAdminErrorMessage } from "../../requests";
import { refreshDesktopConnections } from "../../desktopConnections";
import { invalidateProviderReads } from "../accounts/providerReads";
import type { ManagedConnection, SharedConnection } from "../domain";
import NeonBranchManager from "../neonBranches/NeonBranchManager";
import { providerInventoryQuery, sharedConnectionsQuery } from "../queries";
import AddManagedDatabase from "./AddManagedDatabase";
import { canRepairManagedAccess } from "./model";
import {
  providerErrorMessage,
  removalFailure,
  type RemovalFailure,
} from "./serverMessages";
import SharedDatabaseRow from "./SharedDatabaseRow";
import type { ImportedDatabase } from "./useManagedDatabaseImport";

export interface SharedDatabasesViewProps {
  scope: WorkspaceAdminScope;
  /** Switches the Providers section to its account connection view. */
  onConnectAccount: () => void;
  /** Starts the provider re-authorization repair owned by the account view. */
  onRepair: (managed: ManagedConnection) => void;
  /** Connection currently being repaired, if any. */
  repairingConnectionId: string | null;
  /** Database to reveal once, e.g. from a managed-connection recovery request. */
  focusConnectionId: string | null;
  /** Opens the add-database flow on mount, e.g. from the data source catalog. */
  initiallyAdding?: boolean;
  /** Reports whether a mutation is running so the panel can lock view changes. */
  onBusyChange: (busy: boolean) => void;
}

type ViewNotice = Readonly<{ tone: "warning" | "danger"; message: string }>;

const REMOVAL_FAILURES: Record<RemovalFailure, I18nKey> = {
  conflictRecorded: "workspaceProviderDatabases.removeConflict",
  changed: "workspaceProviderDatabases.removeChanged",
  missing: "workspaceProviderDatabases.removeMissing",
  revocationPending: "workspaceProviderDatabases.removeRevocationPending",
  busy: "workspaceProviderDatabases.removeBusy",
};

function prefersReducedMotion() {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ConnectAccountFirst({
  hasAccounts,
  onCancel,
  onConnectAccount,
}: {
  hasAccounts: boolean;
  onCancel: () => void;
  onConnectAccount: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-primary-flow
      className="tw:grid tw:min-w-0 tw:gap-2 tw:rounded-sm tw:border tw:border-border-subtle tw:p-4"
    >
      <strong className="tw:text-ui tw:font-semibold tw:text-foreground">
        {t("workspaceProviderDatabases.connectFirst")}
      </strong>
      <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
        {t(hasAccounts
          ? "workspaceProviderDatabases.reconnectFirstDescription"
          : "workspaceProviderDatabases.connectFirstDescription")}
      </p>
      <div className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
        <Button size="compact" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="compact" variant="primary" autoFocus onClick={onConnectAccount}>
          {t("workspaceProviderDatabases.openAccounts")}
        </Button>
      </div>
    </div>
  );
}

export default function SharedDatabasesView({
  scope,
  onConnectAccount,
  onRepair,
  repairingConnectionId,
  focusConnectionId,
  initiallyAdding = false,
  onBusyChange,
}: SharedDatabasesViewProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const queryClient = useQueryClient();
  const headingId = useId();
  const connections = useQuery(sharedConnectionsQuery(scope));
  const inventory = useQuery(providerInventoryQuery(scope));
  const catalogScope = useCatalogScope();
  // The wizard renders only once the provider inventory arrives.
  const [adding, setAdding] = useState(initiallyAdding);
  const [wizardBusy, setWizardBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ViewNotice | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const rowNodes = useRef(new Map<string, HTMLDivElement>());
  const revealedId = useRef<string | null>(null);

  const busy = wizardBusy || removingId !== null;
  const locked = busy || repairingConnectionId !== null;
  const reportBusy = useEventCallback(onBusyChange);
  useEffect(() => {
    reportBusy(busy);
  }, [busy, reportBusy]);
  useEffect(() => () => reportBusy(false), [reportBusy]);

  const rows = connections.data;
  const snapshot = inventory.data;
  const managedById = useMemo(
    () => new Map((snapshot?.managedConnections ?? []).map((item) => [item.connectionId, item])),
    [snapshot],
  );
  const providerById = useMemo(
    () => new Map((snapshot?.providers ?? []).map((item) => [item.id, item])),
    [snapshot],
  );
  const integrations = snapshot?.integrations ?? [];
  const hasActiveAccount = integrations.some((item) => item.status === "active");
  const focusRow = focusConnectionId
    ? rows?.find((row) => row.id === focusConnectionId) ?? null
    : null;
  const emphasizeRepair = focusRow !== null
    && !adding
    && canRepairManagedAccess(focusRow, managedById.get(focusRow.id) ?? null);
  const revealTarget = addedId ?? focusConnectionId;

  // Bring the requested (or newly added) database into view once it is listed.
  useEffect(() => {
    if (!revealTarget || revealedId.current === revealTarget) return;
    const node = rowNodes.current.get(revealTarget);
    if (!node) return;
    const frame = requestAnimationFrame(() => {
      revealedId.current = revealTarget;
      node.scrollIntoView({
        block: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
      node.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [revealTarget, rows]);

  function rowAnchor(connectionId: string) {
    return (node: HTMLDivElement | null) => {
      if (node) rowNodes.current.set(connectionId, node);
      else rowNodes.current.delete(connectionId);
    };
  }

  /**
   * Desktop's own connection list only changes through the shell-owned workspace
   * refresh. Best effort and not part of the command: the change is committed, and
   * the next automatic refresh converges the Explorer if this pull cannot finish.
   */
  function pullIntoDevice(staleConnectionIds: readonly string[]) {
    void refreshDesktopConnections(queryClient, catalogScope.key, staleConnectionIds)
      .catch(() => undefined);
  }

  async function remove(connection: SharedConnection) {
    if (locked) return;
    setRemovingId(connection.id);
    setNotice(null);
    try {
      await runWorkspaceAdmin(scope.accountId, {
        kind: "deleteSharedConnection",
        workspaceId: scope.workspaceId,
        connectionId: connection.id,
        expectedRevision: connection.revision,
      });
      toast(t("workspaceProviderDatabases.removed", { name: connection.name }));
      pullIntoDevice([connection.id]);
      // Keep the row locked until the refreshed list no longer shows it.
      await invalidateProviderReads(queryClient, scope);
    } catch (error) {
      const failure = removalFailure(error);
      setNotice({
        tone: "danger",
        message: failure
          ? t(REMOVAL_FAILURES[failure], { name: connection.name })
          : providerErrorMessage(error, i18n, "workspaceProviderDatabases.removeError"),
      });
      // Every documented refusal means this list is stale.
      if (failure) void invalidateProviderReads(queryClient, scope);
    } finally {
      setRemovingId(null);
    }
  }

  function openAdd() {
    if (locked || !snapshot) return;
    setNotice(null);
    setAddedId(null);
    setAdding(true);
  }

  function closeAdd() {
    setAdding(false);
    setWizardBusy(false);
    requestAnimationFrame(() => addButton.current?.focus());
  }

  function imported(database: ImportedDatabase) {
    closeAdd();
    setNotice(null);
    toast(t("workspaceProviderDatabases.imported", { name: database.name }));
    if (database.id) {
      revealedId.current = null;
      setAddedId(database.id);
    }
    void invalidateProviderReads(queryClient, scope);
    pullIntoDevice([]);
  }

  const listError = connections.isError ? (
    <InlineNotice
      tone="danger"
      icon="alert"
      role="alert"
      action={
        <Button
          size="compact"
          disabled={connections.isFetching}
          onClick={() => void connections.refetch()}
        >
          {t("workspaceAdmin.retry")}
        </Button>
      }
    >
      {workspaceAdminErrorMessage(connections.error, i18n, "workspaceProviderDatabases.loadError")}
    </InlineNotice>
  ) : null;

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={busy}
      className="tw:grid tw:min-w-0 tw:content-start tw:gap-3"
    >
      <div className="tw:grid tw:min-w-0 tw:gap-1">
        <SettingsSectionHeader
          title={<span id={headingId}>{t("workspaceProviderDatabases.title")}</span>}
          trailing={adding ? undefined : (
            <Button
              ref={addButton}
              size="compact"
              variant={emphasizeRepair ? "default" : "primary"}
              disabled={locked || !snapshot}
              onClick={openAdd}
            >
              <Icon name="plus" />
              {t("workspaceProviderDatabases.add")}
            </Button>
          )}
        />
        <p className="tw:m-0 tw:max-w-[680px] tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("workspaceProviderDatabases.description")}
        </p>
      </div>

      {adding && snapshot ? (
        hasActiveAccount ? (
          <AddManagedDatabase
            scope={scope}
            providers={snapshot.providers}
            integrations={integrations}
            onCancel={closeAdd}
            onImported={imported}
            onAlreadyShared={() => void invalidateProviderReads(queryClient, scope)}
            onConnectAccount={onConnectAccount}
            onBusyChange={setWizardBusy}
          />
        ) : (
          <ConnectAccountFirst
            hasAccounts={integrations.length > 0}
            onCancel={closeAdd}
            onConnectAccount={onConnectAccount}
          />
        )
      ) : null}

      {notice ? (
        <InlineNotice
          tone={notice.tone}
          icon="alert"
          role={notice.tone === "danger" ? "alert" : "status"}
        >
          {notice.message}
        </InlineNotice>
      ) : null}
      {focusConnectionId && rows && !focusRow ? (
        <InlineNotice tone="warning" icon="info" role="status">
          {t("workspaceProviderDatabases.focusMissing")}
        </InlineNotice>
      ) : null}

      {rows === undefined ? (
        listError ?? (
          <span className="tw:py-2 tw:text-sm">
            <LoadingLabel>{t("workspaceProviderDatabases.loading")}</LoadingLabel>
          </span>
        )
      ) : (
        <>
          {listError}
          {rows.length === 0 ? (
            adding ? null : (
              <div className="tw:grid tw:justify-items-center tw:gap-1 tw:border-y tw:border-border-subtle tw:px-4 tw:py-8 tw:text-center">
                <strong className="tw:text-ui tw:font-semibold tw:text-foreground">
                  {t("workspaceProviderDatabases.emptyTitle")}
                </strong>
                <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
                  {t("workspaceProviderDatabases.emptyDescription")}
                </p>
              </div>
            )
          ) : (
            <div role="list" aria-label={t("workspaceProviderDatabases.listLabel")} className="tw:min-w-0">
              <SettingsList>
                {rows.map((row) => {
                  const managed = managedById.get(row.id) ?? null;
                  return (
                    <SharedDatabaseRow
                      key={row.id}
                      connection={row}
                      managed={managed}
                      provider={managed ? providerById.get(managed.provider) ?? null : null}
                      focused={row.id === focusConnectionId}
                      revealed={row.id === addedId}
                      emphasizeRepair={emphasizeRepair && row.id === focusConnectionId}
                      locked={locked}
                      removing={removingId === row.id}
                      repairing={repairingConnectionId === row.id}
                      anchorRef={rowAnchor(row.id)}
                      onRepair={onRepair}
                      onRemove={(connection) => void remove(connection)}
                      onOpenAccounts={onConnectAccount}
                    />
                  );
                })}
              </SettingsList>
            </div>
          )}
        </>
      )}

      {inventory.isError && !snapshot ? (
        <InlineNotice
          tone="warning"
          icon="alert"
          action={
            <Button
              size="compact"
              disabled={inventory.isFetching}
              onClick={() => void inventory.refetch()}
            >
              {t("workspaceAdmin.retry")}
            </Button>
          }
        >
          {t("workspaceProviderDatabases.inventoryError")}
        </InlineNotice>
      ) : null}

      {snapshot ? (
        <NeonBranchManager
          scope={scope}
          integrations={snapshot.integrations}
          managedConnections={snapshot.managedConnections ?? []}
        />
      ) : null}
    </section>
  );
}
