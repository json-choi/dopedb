// Group schema comparison workspace. Opening the screen rereads the baseline and the
// selected comparison database live through the shared catalog entry (other members
// are never loaded), shows when each side was read, and keeps the last comparison
// visible with a retry when a reread fails. Only live reads since opening decide it.
// Every failed side shows its own recovery; the comparison scope is always stated.
import { useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { requestConnectionCredentials } from "../../features/connections/connectionEditorShellBridge";
import type { ConnectionProfile } from "../../features/connections/domain";
import { useManagedConnectionRecoveryLauncher } from "../../features/connections/useManagedConnectionRecovery";
import {
  catalogFromSnapshot,
  isPersistedSnapshot,
} from "../../features/catalog/tauriAdapter";
import {
  catalogLoadIssue,
  catalogLoadIssueAction,
  catalogLoadIssueMessage,
  type CatalogLoadIssue,
} from "../../features/catalogExplorer/catalogDomain";
import useRetryCountdown from "../../features/catalogExplorer/useRetryCountdown";
import { refreshDesktopConnections } from "../../features/workspaceAdmin/desktopConnections";
import { requestWorkspaceAdmin } from "../../features/workspaceAdmin/navigationRequest";
import {
  selectSchemaDiffBaseline,
  useSchemaDiffBaselineGroups,
} from "../../features/catalogExplorer/schemaDiffBaseline";
import EngineMark from "../../components/EngineMark";
import { Button } from "../../design-system/components/Button";
import { SelectInput } from "../../design-system/components/FormControls";
import {
  IdeTab,
  IdeTabStrip,
} from "../../design-system/components/IdeTabs";
import {
  InlineNotice,
  LoadingLabel,
} from "../../design-system/components/Status";
import {
  WorkbenchEmptyState,
  WorkbenchPane,
} from "../../design-system/components/Workbench";
import { Icon } from "../../components/Icon";
import { useCatalogScope } from "../../lib/queries";
import { databaseCatalogSnapshotQuery } from "../../lib/catalogQueries";
import {
  compareCatalogs,
  defaultSchemaBaseline,
  diffCounts,
  schemaGroupIsCompatible,
  type SchemaConnectionGroup,
  type SchemaDiffStatus,
} from "../../lib/schemaDiff";
import { useI18n } from "../../lib/i18n";
import { fullTime } from "../../lib/relTime";
import {
  SchemaDiffResults,
  SchemaDiffScope,
  STATUS_LABELS,
} from "./SchemaDiffResults";

type StatusFilter = Exclude<SchemaDiffStatus, "same"> | "all";

/** The one command that fixes a failed side; `retryAt` holds Retry until it may run. */
type FailureRecovery = { label: string; run: () => void; retryAt?: number };

function connectionName(connection: ConnectionProfile) {
  return connection.name || connection.database || connection.host;
}

function SchemaDiffFailure({
  message,
  recovery,
  busy,
}: {
  message: string;
  recovery: FailureRecovery | null;
  busy: boolean;
}) {
  const { t } = useI18n();
  const wait = useRetryCountdown(recovery?.retryAt);
  return (
    <span className="tw:flex tw:flex-wrap tw:items-center tw:justify-center tw:gap-2">
      <span className="tw:min-w-0 tw:break-words">{message}</span>
      {recovery ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={busy || wait > 0}
          disabledBehavior="focusable"
          aria-busy={busy}
          onClick={recovery.run}
        >
          {wait > 0 ? t("schema.retryIn", { seconds: wait }) : recovery.label}
        </Button>
      ) : null}
    </span>
  );
}

export default function SchemaDiff({
  group,
  onClose,
}: {
  group: SchemaConnectionGroup;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const managedRecovery = useManagedConnectionRecoveryLauncher(catalogScope);
  const preferenceScope = catalogScope.preferenceKey ?? catalogScope.key;
  const withBaseline = useSchemaDiffBaselineGroups(preferenceScope);
  const baseline = defaultSchemaBaseline(withBaseline(group));
  const targets = useMemo(
    () => group.connections.filter((connection) => connection.id !== baseline?.id),
    [baseline?.id, group.connections],
  );
  const [targetId, setTargetId] = useState("");
  const selectedTarget =
    targets.find((connection) => connection.id === targetId) ?? targets[0] ?? null;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // A read older than the screen never decides the comparison: each side shown here
  // is read live at least once after opening. An explicit reread keeps the current
  // comparison visible (with its read times) until the new reads replace it.
  const [freshSince] = useState(() => Date.now());
  const sides = [
    { role: "baseline" as const, connection: baseline },
    { role: "target" as const, connection: selectedTarget },
  ];
  const reads = useQueries({
    queries: sides.map(({ connection }) => ({
      ...databaseCatalogSnapshotQuery(
        connection?.id ?? "",
        connection?.database ?? "",
        connection !== null,
        catalogScope,
      ),
      refetchOnMount: (query: { state: { dataUpdatedAt: number } }) =>
        query.state.dataUpdatedAt < freshSince ? ("always" as const) : false,
    })),
  });
  // Only a live read since opening decides the comparison. A persisted snapshot shown
  // while the first read runs (and kept when it fails) or an older read never does.
  const decisiveSnapshot = (index: number) => {
    const read = reads[index];
    return read.data !== undefined
      && !isPersistedSnapshot(read.data)
      && read.dataUpdatedAt >= freshSince
      ? read.data
      : undefined;
  };
  const baselineSnapshot = decisiveSnapshot(0);
  const targetSnapshot = decisiveSnapshot(1);
  const selectedDiff = baselineSnapshot && targetSnapshot
    ? compareCatalogs(
        catalogFromSnapshot(targetSnapshot),
        catalogFromSnapshot(baselineSnapshot),
      )
    : undefined;
  const counts = selectedDiff ? diffCounts(selectedDiff) : null;
  const refreshing = reads.some((read) => read.isFetching);
  const failures = sides.flatMap(({ connection }, index) => {
    const read = reads[index];
    return connection && read.status === "error" && read.error
      ? [{ connection, index, read, issue: catalogLoadIssue(read.error) }]
      : [];
  });

  // The same recovery the Explorer offers for each issue, for the side that failed.
  function recoveryFor(
    connection: ConnectionProfile,
    index: number,
    issue: CatalogLoadIssue,
  ): FailureRecovery | null {
    const rereadSide = () => void reads[index].refetch();
    const openCredentials = () => requestConnectionCredentials(connection.id);
    switch (catalogLoadIssueAction(issue)) {
      case "retry":
        return { label: t("app.retry"), run: rereadSide, retryAt: issue.retryAt };
      case "edit":
        return { label: t("connections.edit"), run: openCredentials };
      case "resolveCredentials":
        return { label: t("workspace.bindCredentialsShort"), run: openCredentials };
      case "recoverAuthentication":
        // A shared connection opens only with this device's workspace session.
        return connection.workspaceAccess !== "local" && connection.engine !== "bigquery"
          ? { label: t("workspace.login"), run: () => requestWorkspaceAdmin("account") }
          : { label: t("connections.edit"), run: openCredentials };
      case "recoverManaged":
        return managedRecovery.canOpenSettings(connection)
          ? {
              label: t("connections.managedWorkspace.recover"),
              run: () => managedRecovery.openSettings(connection, rereadSide),
            }
          : { label: t("app.retry"), run: rereadSide };
      case "refreshWorkspace":
        // Resetting the connection's reads re-reads this side once the resync lands.
        return {
          label: t("schema.refreshWorkspace"),
          run: () => void refreshDesktopConnections(
            queryClient,
            catalogScope.key,
            [connection.id],
          ).catch(() => undefined),
        };
      default:
        return null;
    }
  }
  const awaitingFreshRead = sides.some(({ connection }, index) =>
    connection !== null
    && reads[index].status !== "error"
    && decisiveSnapshot(index) === undefined
  );
  const visibleObjects = useMemo(
    () => (selectedDiff?.objects ?? []).filter(
      (object) => statusFilter === "all" || object.status === statusFilter,
    ),
    [selectedDiff, statusFilter],
  );

  function changeBaseline(nextId: string) {
    selectSchemaDiffBaseline(preferenceScope, group.key, nextId);
    setTargetId("");
  }

  function reread() {
    sides.forEach(({ connection }, index) => {
      if (connection) void reads[index].refetch();
    });
  }

  function captureLabel(index: number) {
    const snapshot = reads[index].data;
    if (!snapshot) return t("schemaDiff.notRead");
    const time = fullTime(snapshot.capturedAt, lang);
    return isPersistedSnapshot(snapshot)
      ? t("schemaDiff.capturedSaved", { time })
      : t("schemaDiff.capturedAt", { time });
  }

  if (!schemaGroupIsCompatible(group)) {
    return (
      <WorkbenchPane>
        <SchemaDiffDocumentStrip group={group} onClose={onClose} />
        <WorkbenchEmptyState icon="alert">
          <strong>{t("schemaDiff.incompatibleTitle")}</strong>
          <p className="tw:m-0">{t("schemaDiff.incompatibleBody")}</p>
        </WorkbenchEmptyState>
      </WorkbenchPane>
    );
  }

  const blocked = failures.length > 0 && !(baselineSnapshot && targetSnapshot);
  const comparisonShown = !blocked && !awaitingFreshRead && selectedDiff !== undefined;

  return (
    <WorkbenchPane>
      <SchemaDiffDocumentStrip group={group} onClose={onClose} />

      <div className="ds-control-row tw:grid tw:shrink-0 tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:px-3 tw:py-2">
        <label className="tw:grid tw:min-w-0 tw:gap-1 tw:text-xs tw:text-muted-foreground">
          <span>{t("schemaDiff.baseline")}</span>
          <SelectInput density="compact" value={baseline?.id ?? ""} title={baseline ? connectionName(baseline) : undefined} onChange={(event) => changeBaseline(event.target.value)}>
            {group.connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connectionName(connection)}{connection.env ? ` · ${connection.env}` : ""}
              </option>
            ))}
          </SelectInput>
          <span className="tw:truncate tw:font-mono tw:tabular-nums">{captureLabel(0)}</span>
        </label>
        <label className="tw:grid tw:min-w-0 tw:gap-1 tw:text-xs tw:text-muted-foreground">
          <span>{t("schemaDiff.target")}</span>
          <SelectInput density="compact" value={selectedTarget?.id ?? ""} title={selectedTarget ? connectionName(selectedTarget) : undefined} onChange={(event) => setTargetId(event.target.value)} disabled={targets.length === 0}>
            {targets.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connectionName(connection)}{connection.env ? ` · ${connection.env}` : ""}
              </option>
            ))}
          </SelectInput>
          <span className="tw:truncate tw:font-mono tw:tabular-nums">{selectedTarget ? captureLabel(1) : "—"}</span>
        </label>
        <Button disabled={refreshing || targets.length === 0} disabledBehavior="focusable" aria-busy={refreshing} iconOnly onClick={reread} size="compact" variant="ghost" aria-label={refreshing ? t("schemaDiff.refreshing") : t("schemaDiff.refreshAll")}>
          <Icon name="refresh" />
        </Button>
      </div>

      {targets.length === 0 ? (
        <WorkbenchEmptyState icon="database">
          <strong>{t("schemaDiff.needTargetTitle")}</strong>
          <p className="tw:m-0">{t("schemaDiff.needTargetBody")}</p>
        </WorkbenchEmptyState>
      ) : (
        <section className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:overflow-hidden">
          {!blocked && failures.length > 0 ? (
            <InlineNotice tone="danger" icon="alert" role="alert">
              {failures.map(({ connection, index, read, issue }) => (
                <SchemaDiffFailure
                  key={connection.id}
                  busy={read.isFetching}
                  recovery={recoveryFor(connection, index, issue)}
                  message={t("schemaDiff.refreshFailed", {
                    connection: connectionName(connection),
                    error: catalogLoadIssueMessage(t, issue),
                    time: read.data ? fullTime(read.data.capturedAt, lang) : "—",
                  })}
                />
              ))}
            </InlineNotice>
          ) : null}

          <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:overflow-hidden">
            <div className="ds-control-row tw:flex tw:shrink-0 tw:flex-wrap tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:px-3 tw:py-2">
              <div className="ds-control-row tw:flex tw:flex-wrap tw:gap-1" role="group" aria-label={t("schemaDiff.filterStatus")}>
                {(["all", "added", "missing", "changed"] as const).map((status) => (
                  <Button key={status} size="xs" variant={statusFilter === status ? "selected" : "ghost"} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>
                    {status === "all" ? t("schemaDiff.statusAll") : t(STATUS_LABELS[status])}
                    <span className="tw:font-mono tw:tabular-nums">{!comparisonShown || !selectedDiff ? "—" : status === "all" ? selectedDiff.total : counts?.[status] ?? "—"}</span>
                  </Button>
                ))}
              </div>
            </div>

            {comparisonShown ? <SchemaDiffScope /> : null}

            {blocked ? (
              <WorkbenchEmptyState icon="alert">
                <div className="tw:grid tw:justify-items-center tw:gap-2 tw:text-center" role="alert">
                  <strong>{t("schemaDiff.loadFailed")}</strong>
                  {failures.map(({ connection, index, read, issue }) => (
                    <SchemaDiffFailure
                      key={connection.id}
                      busy={read.isFetching}
                      recovery={recoveryFor(connection, index, issue)}
                      message={t("schemaDiff.connectionError", {
                        connection: connectionName(connection),
                        error: catalogLoadIssueMessage(t, issue),
                      })}
                    />
                  ))}
                </div>
              </WorkbenchEmptyState>
            ) : awaitingFreshRead || !selectedDiff ? (
              <div className="tw:flex tw:min-h-[200px] tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:gap-1 tw:p-4 tw:text-ui" aria-busy="true">
                {sides.map(({ connection }, index) => (
                  connection && reads[index].isFetching ? (
                    <LoadingLabel key={connection.id}>
                      {t("schemaDiff.reading", { connection: connectionName(connection) })}
                    </LoadingLabel>
                  ) : null
                ))}
              </div>
            ) : selectedDiff.total === 0 ? (
              <WorkbenchEmptyState icon="check">
                <div className="tw:max-w-[60ch] tw:text-center">
                  <strong>{t("schemaDiff.inSync")}</strong>
                  <p className="tw:mt-1 tw:mb-0">
                    {t("schemaDiff.inSyncBody")}
                  </p>
                </div>
              </WorkbenchEmptyState>
            ) : visibleObjects.length === 0 ? (
              <WorkbenchEmptyState>
                {t("schemaDiff.noMatches")}
              </WorkbenchEmptyState>
            ) : (
              <SchemaDiffResults
                key={`${catalogScope.key}:${baseline?.id}:${selectedTarget?.id}`}
                objects={visibleObjects}
              />
            )}
          </div>
        </section>
      )}
    </WorkbenchPane>
  );
}

function SchemaDiffDocumentStrip({
  group,
  onClose,
}: {
  group: SchemaConnectionGroup;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const engine = group.connections[0]?.engine;
  return (
    <IdeTabStrip label={t("schemaDiff.detailTitle")}>
      <IdeTab
        active
        title={`${group.label} · ${t("schemaDiff.subtitle")}`}
        tabIndex={0}
        onActivate={() => undefined}
        trailing={
          <span className="tw:mr-1 tw:flex">
            <Button
              iconOnly
              onClick={onClose}
              size="xs"
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <Icon name="close" />
            </Button>
          </span>
        }
      >
        {engine ? <EngineMark engine={engine} /> : null}
        <span>{t("schemaDiff.tabTitle")}</span>
      </IdeTab>
    </IdeTabStrip>
  );
}
