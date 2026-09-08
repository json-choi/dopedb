// Group schema comparison workspace. Loads every member through the shared catalog
// query cache, summarizes all targets against one baseline, and exposes object-level
// before/after details without coupling the workflow to sidebar expansion state.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { Catalog } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import type { ConnectionProfile } from "../../features/connections/domain";
import EngineMark from "../../components/EngineMark";
import { Button } from "../../design-system/components/Button";
import { SelectInput } from "../../design-system/components/FormControls";
import {
  IdeTab,
  IdeTabStrip,
} from "../../design-system/components/IdeTabs";
import {
  WorkbenchEmptyState,
  WorkbenchPane,
} from "../../design-system/components/Workbench";
import { Icon } from "../../components/Icon";
import Skeleton from "../../components/Skeleton";
import {
  catalogQuery,
  fetchFreshCatalog,
  replaceFreshCatalog,
  useCatalogScope,
} from "../../lib/queries";
import {
  compareCatalogs,
  defaultSchemaBaseline,
  diffCounts,
  schemaGroupIsCompatible,
  type SchemaConnectionGroup,
  type SchemaDiffStatus,
} from "../../lib/schemaDiff";
import { useI18n } from "../../lib/i18n";
import { SchemaDiffResults, STATUS_LABELS } from "./SchemaDiffResults";

type StatusFilter = Exclude<SchemaDiffStatus, "same"> | "all";

function connectionName(connection: ConnectionProfile) {
  return connection.name || connection.database || connection.host;
}

function baselineStorageKey(groupKey: string) {
  return `dopedb.schemaDiffBaseline.${groupKey}`;
}

export default function SchemaDiff({
  group,
  onClose,
}: {
  group: SchemaConnectionGroup;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const catalogScopeKeyRef = useRef(catalogScope.key);
  const connectionIds = useMemo(
    () => group.connections.map((connection) => connection.id),
    [group.connections],
  );
  const queryResults = useQueries({
    queries: connectionIds.map((connectionId) => catalogQuery(connectionId, catalogScope)),
  });
  const [baselineId, setBaselineId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshErrors, setRefreshErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    catalogScopeKeyRef.current = catalogScope.key;
    setRefreshing(false);
    setRefreshErrors({});
  }, [catalogScope.key]);

  const queryById = useMemo(
    () =>
      new Map(
        connectionIds.map((connectionId, index) => [connectionId, queryResults[index]]),
      ),
    [connectionIds, queryResults],
  );

  useEffect(() => {
    const stored = localStorage.getItem(baselineStorageKey(group.key));
    const saved = group.connections.find((connection) => connection.id === stored);
    const next = saved ?? defaultSchemaBaseline(group);
    setBaselineId(next?.id ?? "");
  }, [group]);

  const baseline =
    group.connections.find((connection) => connection.id === baselineId) ??
    defaultSchemaBaseline(group);
  const targets = useMemo(
    () => group.connections.filter((connection) => connection.id !== baseline?.id),
    [baseline?.id, group.connections],
  );

  useEffect(() => {
    if (!targets.some((connection) => connection.id === targetId)) {
      setTargetId(targets[0]?.id ?? "");
    }
  }, [targetId, targets]);

  const catalogs = useMemo(() => {
    const map = new Map<string, Catalog>();
    for (const connectionId of connectionIds) {
      const catalog = queryById.get(connectionId)?.data;
      if (catalog) map.set(connectionId, catalog);
    }
    return map;
  }, [connectionIds, queryById]);

  const baselineCatalog = baseline ? catalogs.get(baseline.id) : undefined;
  const comparisons = useMemo(() => {
    const map = new Map<string, ReturnType<typeof compareCatalogs>>();
    if (!baselineCatalog) return map;
    for (const target of targets) {
      const catalog = catalogs.get(target.id);
      if (catalog) map.set(target.id, compareCatalogs(catalog, baselineCatalog));
    }
    return map;
  }, [baselineCatalog, catalogs, targets]);

  const selectedTarget = targets.find((connection) => connection.id === targetId) ?? null;
  const selectedDiff = selectedTarget ? comparisons.get(selectedTarget.id) : undefined;
  const counts = selectedDiff ? diffCounts(selectedDiff) : null;
  const baselineLoadError = baseline
    ? refreshErrors[baseline.id] ?? queryById.get(baseline.id)?.error
    : null;
  const selectedLoadError = (() => {
    if (baseline && baselineLoadError) {
      return { connection: baseline, error: errMessage(baselineLoadError) };
    }
    if (selectedTarget) {
      const error = refreshErrors[selectedTarget.id] ?? queryById.get(selectedTarget.id)?.error;
      if (error) return { connection: selectedTarget, error: errMessage(error) };
    }
    return null;
  })();
  const visibleObjects = useMemo(
    () => (selectedDiff?.objects ?? []).filter(
      (object) => statusFilter === "all" || object.status === statusFilter,
    ),
    [selectedDiff, statusFilter],
  );

  function changeBaseline(nextId: string) {
    setBaselineId(nextId);
    setTargetId("");
    localStorage.setItem(baselineStorageKey(group.key), nextId);
  }

  async function refreshAll() {
    const scopeKey = catalogScope.key;
    setRefreshing(true);
    setRefreshErrors({});
    const results = await Promise.allSettled(
      group.connections.map(async (connection) => {
        const catalog = await fetchFreshCatalog(connection.id);
        if (catalogScopeKeyRef.current === scopeKey) {
          await replaceFreshCatalog(
            queryClient,
            connection.id,
            scopeKey,
            catalog,
          );
        }
        return connection.id;
      }),
    );
    const errors: Record<string, string> = {};
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        errors[group.connections[index].id] = errMessage(result.reason);
      }
    });
    if (catalogScopeKeyRef.current === scopeKey) {
      setRefreshErrors(errors);
      setRefreshing(false);
    }
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

  return (
    <WorkbenchPane>
      <SchemaDiffDocumentStrip group={group} onClose={onClose} />

      <div className="ds-control-row tw:grid tw:shrink-0 tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] tw:items-end tw:gap-2 tw:border-b tw:border-border-subtle tw:px-3 tw:py-2">
        <label className="tw:grid tw:min-w-0 tw:gap-1 tw:text-xs tw:text-muted-foreground">
          <span>{t("schemaDiff.baseline")}</span>
          <SelectInput density="compact" value={baseline?.id ?? ""} title={baseline ? connectionName(baseline) : undefined} onChange={(event) => changeBaseline(event.target.value)}>
            {group.connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connectionName(connection)}{connection.env ? ` · ${connection.env}` : ""}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="tw:grid tw:min-w-0 tw:gap-1 tw:text-xs tw:text-muted-foreground">
          <span>{t("schemaDiff.target")}</span>
          <SelectInput density="compact" value={targetId} title={selectedTarget ? connectionName(selectedTarget) : undefined} onChange={(event) => setTargetId(event.target.value)} disabled={targets.length === 0}>
            {targets.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connectionName(connection)}{connection.env ? ` · ${connection.env}` : ""}
              </option>
            ))}
          </SelectInput>
        </label>
        <Button disabled={refreshing} iconOnly onClick={() => void refreshAll()} size="compact" variant="ghost" aria-label={refreshing ? t("schemaDiff.refreshing") : t("schemaDiff.refreshAll")}>
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
          {Object.entries(refreshErrors).some(([id]) => id !== baseline?.id && id !== selectedTarget?.id) ? (
            <div className="tw:grid tw:shrink-0 tw:gap-1 tw:border-b tw:border-danger-border tw:bg-danger-muted tw:px-3 tw:py-2 tw:text-ui tw:text-danger">
              {Object.entries(refreshErrors).filter(([id]) => id !== baseline?.id && id !== selectedTarget?.id).map(([connectionId, error]) => {
                const connection = group.connections.find(
                  (candidate) => candidate.id === connectionId,
                );
                return (
                  <span className="tw:break-all" key={connectionId}>
                    {t("schemaDiff.connectionError", {
                      connection: connection
                        ? connectionName(connection)
                        : connectionId,
                      error,
                    })}
                  </span>
                );
              })}
            </div>
          ) : null}

          <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:overflow-hidden">
            <div className="ds-control-row tw:flex tw:shrink-0 tw:flex-wrap tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:px-3 tw:py-2">
              <div className="ds-control-row tw:flex tw:flex-wrap tw:gap-1" role="group" aria-label={t("schemaDiff.filterStatus")}>
                {(["all", "added", "missing", "changed"] as const).map((status) => (
                  <Button key={status} size="xs" variant={statusFilter === status ? "selected" : "ghost"} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>
                    {status === "all" ? t("schemaDiff.statusAll") : t(STATUS_LABELS[status])}
                    <span className="tw:font-mono tw:tabular-nums">{selectedLoadError ? "—" : status === "all" ? selectedDiff?.total ?? "—" : counts?.[status] ?? "—"}</span>
                  </Button>
                ))}
              </div>
            </div>

            {selectedLoadError ? (
              <WorkbenchEmptyState icon="alert">
                <div className="tw:text-center">
                  <strong>{t("schemaDiff.loadFailed")}</strong>
                  <p className="tw:mt-1 tw:mb-0">
                    {t("schemaDiff.connectionError", {
                      connection: connectionName(selectedLoadError.connection),
                      error: selectedLoadError.error,
                    })}
                  </p>
                </div>
              </WorkbenchEmptyState>
            ) : !baselineCatalog || (selectedTarget && !catalogs.has(selectedTarget.id)) ? (
              <Skeleton lines={7} inset />
            ) : selectedDiff?.total === 0 ? (
              <WorkbenchEmptyState icon="check">
                <div className="tw:text-center">
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
