// Group schema comparison workspace. Loads every member through the shared catalog
// query cache, summarizes all targets against one baseline, and exposes object-level
// before/after details without coupling the workflow to sidebar expansion state.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { Catalog } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import type { ConnectionProfile } from "../../features/connections/domain";
import EngineMark from "../../components/EngineMark";
import { EnvironmentBadge } from "../../design-system/components/EnvironmentBadge";
import { Button } from "../../design-system/components/Button";
import { TextInput } from "../../design-system/components/FormControls";
import {
  IdeTab,
  IdeTabStrip,
  IdeToolTab,
  IdeToolTabStrip,
} from "../../design-system/components/IdeTabs";
import {
  WorkbenchEmptyState,
  WorkbenchPane,
  WorkbenchSelect,
  WorkbenchToolbar,
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
  type SchemaObjectDiff,
  type SchemaObjectType,
} from "../../lib/schemaDiff";
import { useI18n, type I18nKey } from "../../lib/i18n";

type StatusFilter = Exclude<SchemaDiffStatus, "same"> | "all";

const OBJECT_LABELS: Record<SchemaObjectType, I18nKey> = {
  table: "schemaDiff.objectTable",
  view: "schemaDiff.objectView",
  column: "schemaDiff.objectColumn",
  index: "schemaDiff.objectIndex",
  foreignKey: "schemaDiff.objectForeignKey",
};

const STATUS_LABELS: Record<Exclude<SchemaDiffStatus, "same">, I18nKey> = {
  added: "schemaDiff.statusAdded",
  missing: "schemaDiff.statusMissing",
  changed: "schemaDiff.statusChanged",
};

function connectionName(connection: ConnectionProfile) {
  return connection.name || connection.database || connection.host;
}

function baselineStorageKey(groupKey: string) {
  return `dopedb.schemaDiffBaseline.${groupKey}`;
}

function statusSymbol(status: Exclude<SchemaDiffStatus, "same">) {
  if (status === "added") return "+";
  if (status === "missing") return "−";
  return "~";
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
  const [search, setSearch] = useState("");
  // "Refresh all" re-introspects every member of the group, so it needs a settled/total
  // counter rather than a boolean the user cannot read progress from.
  const [refreshProgress, setRefreshProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [refreshErrors, setRefreshErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    catalogScopeKeyRef.current = catalogScope.key;
    setRefreshProgress(null);
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
  const visibleObjects = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return (selectedDiff?.objects ?? []).filter((object) => {
      if (statusFilter !== "all" && object.status !== statusFilter) return false;
      if (!normalizedSearch) return true;
      return `${object.path} ${object.objectType} ${object.baselineValue} ${object.targetValue}`
        .toLocaleLowerCase()
        .includes(normalizedSearch);
    });
  }, [search, selectedDiff, statusFilter]);

  function changeBaseline(nextId: string) {
    setBaselineId(nextId);
    setTargetId("");
    localStorage.setItem(baselineStorageKey(group.key), nextId);
  }

  async function refreshAll() {
    const scopeKey = catalogScope.key;
    setRefreshProgress({ completed: 0, total: group.connections.length });
    setRefreshErrors({});
    const results = await Promise.allSettled(
      group.connections.map(async (connection) => {
        try {
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
        } finally {
          if (catalogScopeKeyRef.current === scopeKey) {
            setRefreshProgress((current) =>
              current
                ? { ...current, completed: current.completed + 1 }
                : current,
            );
          }
        }
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
      setRefreshProgress(null);
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

      <WorkbenchToolbar label={t("schemaDiff.detailTitle")}>
        <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">
          {t("schemaDiff.baseline")}
        </span>
        <WorkbenchSelect
          label={t("schemaDiff.baseline")}
          value={baseline?.id ?? ""}
          onChange={changeBaseline}
        >
          {group.connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connectionName(connection)}
              {connection.env ? ` · ${connection.env}` : ""}
            </option>
          ))}
        </WorkbenchSelect>
        <span className="tw:ml-2 tw:shrink-0 tw:text-xs tw:text-muted-foreground">
          {t("schemaDiff.target")}
        </span>
        <WorkbenchSelect
          label={t("schemaDiff.target")}
          value={targetId}
          onChange={setTargetId}
          disabled={targets.length === 0}
        >
          {targets.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connectionName(connection)}
              {connection.env ? ` · ${connection.env}` : ""}
            </option>
          ))}
        </WorkbenchSelect>
        <span className="ds-toolbar-spacer" />
        {refreshProgress ? (
          <span
            aria-live="polite"
            className="tw:shrink-0 tw:text-xs tw:tabular-nums tw:text-muted-foreground"
          >
            {t("schemaDiff.refreshProgress", {
              completed: refreshProgress.completed,
              total: refreshProgress.total,
            })}
          </span>
        ) : null}
        <Button
          disabled={refreshProgress !== null}
          iconOnly
          onClick={() => void refreshAll()}
          size="compact"
          title={
            refreshProgress
              ? t("schemaDiff.refreshing")
              : t("schemaDiff.refreshAll")
          }
          aria-label={
            refreshProgress
              ? t("schemaDiff.refreshing")
              : t("schemaDiff.refreshAll")
          }
        >
          <Icon name="refresh" />
        </Button>
      </WorkbenchToolbar>

      {targets.length === 0 ? (
        <WorkbenchEmptyState icon="database">
          <strong>{t("schemaDiff.needTargetTitle")}</strong>
          <p className="tw:m-0">{t("schemaDiff.needTargetBody")}</p>
        </WorkbenchEmptyState>
      ) : (
        <section className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:overflow-hidden">
          <IdeToolTabStrip label={t("schemaDiff.groupOverview")}>
            {targets.map((target) => {
              const result = queryById.get(target.id);
              const targetError = refreshErrors[target.id] ?? result?.error;
              const error = baselineLoadError ?? targetError;
              const diff = comparisons.get(target.id);
              const counts = diff ? diffCounts(diff) : null;
              const selected = target.id === targetId;
              return (
                <IdeToolTab
                  key={target.id}
                  active={selected}
                  size="document"
                  onClick={() => setTargetId(target.id)}
                >
                  <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                    {connectionName(target)}
                  </span>
                  {target.env ? <EnvironmentBadge environment={target.env} /> : null}
                  {error ? (
                    <Icon name="alert" className="tw:shrink-0 tw:text-danger" />
                  ) : !diff ? (
                    <span className="tw:shrink-0 tw:text-muted-foreground">…</span>
                  ) : diff.total === 0 ? (
                    <Icon name="check" className="tw:shrink-0 tw:text-success" />
                  ) : (
                    <span className="tw:flex tw:shrink-0 tw:items-center tw:gap-1 tw:font-mono tw:text-xs tw:font-bold tw:tabular-nums">
                      <span className="tw:text-success">+{counts?.added ?? 0}</span>
                      <span className="tw:text-danger">−{counts?.missing ?? 0}</span>
                      <span className="tw:text-warning">~{counts?.changed ?? 0}</span>
                    </span>
                  )}
                </IdeToolTab>
              );
            })}
          </IdeToolTabStrip>

          {Object.entries(refreshErrors).length > 0 ? (
            <div className="tw:grid tw:shrink-0 tw:gap-1 tw:border-b tw:border-danger-border tw:bg-danger-muted tw:px-3 tw:py-2 tw:text-ui tw:text-danger">
              {[...Object.entries(refreshErrors)].map(([connectionId, error]) => {
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
            <WorkbenchToolbar label={t("schemaDiff.filterStatus")} compact>
              <div className="ds-control-row tw:inline-flex tw:gap-2" role="group" aria-label={t("schemaDiff.filterStatus")}>
                {(["all", "added", "missing", "changed"] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="tw:min-h-control-sm tw:cursor-pointer tw:border-0 tw:border-b-2 tw:border-b-transparent tw:bg-transparent tw:px-2 tw:font-sans tw:text-xs tw:font-bold tw:text-muted-foreground tw:aria-pressed:border-b-primary tw:aria-pressed:text-primary"
                    aria-pressed={statusFilter === status}
                    onClick={() => setStatusFilter(status)}
                  >
                    {status === "all" ? t("schemaDiff.statusAll") : t(STATUS_LABELS[status])}
                  </button>
                ))}
              </div>
              <label className="tw:ml-auto tw:flex tw:w-[min(320px,42%)] tw:items-center tw:gap-2 tw:text-muted-foreground">
                <Icon name="search" />
                <TextInput
                  density="compact"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("schemaDiff.searchPlaceholder")}
                  aria-label={t("schemaDiff.searchPlaceholder")}
                />
              </label>
            </WorkbenchToolbar>

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
              <SchemaDiffGrid
                objects={visibleObjects}
                baseline={baseline}
                target={selectedTarget}
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
        <span>{group.label}</span>
        <span className="ds-context-badge tw:shrink-0">
          {t("schemaDiff.groupBadge", { count: group.connections.length })}
        </span>
      </IdeTab>
    </IdeTabStrip>
  );
}

function SchemaDiffGrid({
  objects,
  baseline,
  target,
}: {
  objects: SchemaObjectDiff[];
  baseline: ConnectionProfile | null;
  target: ConnectionProfile | null;
}) {
  const { t } = useI18n();
  return (
    <div
      className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:overflow-hidden tw:[&_[role=columnheader]]:min-w-0 tw:[&_[role=columnheader]]:border-r tw:[&_[role=columnheader]]:border-border-subtle tw:[&_[role=columnheader]]:px-3 tw:[&_[role=columnheader]]:py-2 tw:[&_[role=columnheader]:last-child]:border-r-0 tw:[&_[role=row]]:grid tw:[&_[role=row]]:grid-cols-[minmax(220px,1.2fr)_112px_minmax(160px,1fr)_minmax(160px,1fr)] tw:[&_[role=row]]:items-stretch tw:[&_[role=cell]]:min-w-0 tw:[&_[role=cell]]:border-r tw:[&_[role=cell]]:border-border-subtle tw:[&_[role=cell]]:px-3 tw:[&_[role=cell]]:py-2 tw:[&_[role=cell]:last-child]:border-r-0 tw:max-[920px]:overflow-auto tw:max-[920px]:[&_[role=row]]:min-w-[760px]"
      role="table"
      aria-label={t("schemaDiff.detailTitle")}
    >
      <div
        className="tw:shrink-0 tw:border-b tw:border-border-strong tw:bg-muted tw:text-xs tw:font-bold tw:text-muted-foreground"
        role="row"
      >
        <span role="columnheader">{t("schemaDiff.object")}</span>
        <span role="columnheader">{t("schemaDiff.change")}</span>
        <span role="columnheader">{baseline ? connectionName(baseline) : t("schemaDiff.baseline")}</span>
        <span role="columnheader">{target ? connectionName(target) : t("schemaDiff.target")}</span>
      </div>
      <div className="tw:min-h-0 tw:overflow-auto">
        {objects.map((object) => (
          <div
            data-status={object.status}
            className="tw:min-h-12 tw:border-b tw:border-border-subtle tw:bg-background tw:data-[status=added]:shadow-[inset_var(--ds-border-width-bold)_0_0_var(--ds-success)] tw:data-[status=changed]:shadow-[inset_var(--ds-border-width-bold)_0_0_var(--ds-warning)] tw:data-[status=missing]:shadow-[inset_var(--ds-border-width-bold)_0_0_var(--ds-danger)] tw:hover:bg-muted"
            role="row"
            key={object.id}
          >
            <span className="tw:grid tw:content-center tw:gap-1 tw:overflow-hidden" role="cell">
              <span className="tw:text-2xs tw:font-bold tw:tracking-[0.04em] tw:text-muted-foreground tw:uppercase">
                {t(OBJECT_LABELS[object.objectType])}
              </span>
              <code className="tw:overflow-hidden tw:font-mono tw:text-sm tw:text-ellipsis tw:whitespace-nowrap">
                {object.path}
              </code>
            </span>
            <span
              data-status={object.status}
              className="tw:flex tw:items-center tw:gap-1 tw:text-xs tw:font-bold tw:data-[status=added]:text-success tw:data-[status=changed]:text-warning tw:data-[status=missing]:text-danger"
              role="cell"
            >
              <span aria-hidden="true">{statusSymbol(object.status)}</span>
              {t(STATUS_LABELS[object.status])}
            </span>
            <code className="tw:flex tw:items-center tw:overflow-hidden tw:font-mono tw:text-sm tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap" role="cell">
              {object.baselineValue}
            </code>
            <code className="tw:flex tw:items-center tw:overflow-hidden tw:font-mono tw:text-sm tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap" role="cell">
              {object.targetValue}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
