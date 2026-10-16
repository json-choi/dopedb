// Catalog V2 schema explorer. React Flow/ELK owns the relationship canvas while the
// inspector and structured editor consume the same fingerprint-pinned metadata. A
// failed reread keeps the last read schema on screen beside the failure and Retry.
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CatalogRelationV2,
  CatalogSnapshot,
  CatalogTable,
} from "../../ipc/types";
import {
  catalogFromSnapshot,
  isPersistedSnapshot,
} from "../../features/catalog/tauriAdapter";
import { fullTime } from "../../lib/relTime";
import {
  InlineNotice,
  LoadingLabel,
} from "../../design-system/components/Status";
import type { ConnectionProfile } from "../../features/connections/domain";
import {
  catalogLoadIssue,
  catalogLoadIssueMessage,
} from "../../features/catalogExplorer/catalogDomain";
import { Icon } from "../../components/Icon";
import InfoTip from "../../components/InfoTip";
import Skeleton from "../../components/Skeleton";
import { Button } from "../../design-system/components/Button";
import { TextInput } from "../../design-system/components/FormControls";
import {
  WorkbenchEmptyState,
  WorkbenchPane,
  WorkbenchScrollBody,
} from "../../design-system/components/Workbench";
import { useCatalogScope } from "../../lib/queries";
import {
  catalogOverviewQuery,
  databaseCatalogSnapshotQuery,
  refreshConnectionCatalog,
} from "../../lib/catalogQueries";
import { erdRelationKey, relationDisplayName } from "../../lib/erdGraph";
import { useI18n } from "../../lib/i18n";
import { schemaDetailsEnabled } from "./detailLifecycle";
import {
  filterCatalog,
  filterCatalogOverview,
  filterCatalogSnapshot,
} from "../../features/catalogExplorer/scopeFilter";

const ErdCanvas = lazy(() => import("../../features/erd/ErdCanvas"));

function SchemaFrame({ children }: { children: ReactNode }) {
  return (
    <WorkbenchPane>
      <WorkbenchScrollBody>
        <div className="tw:flex tw:min-h-full tw:min-w-0 tw:flex-col tw:gap-3 tw:p-3 tw:[container-name:schema-pane] tw:[container-type:inline-size]">
          {children}
        </div>
      </WorkbenchScrollBody>
    </WorkbenchPane>
  );
}

function selectPersistedAt(snapshot: CatalogSnapshot) {
  return isPersistedSnapshot(snapshot) ? snapshot.capturedAt : null;
}

function catalogTableFor(tables: CatalogTable[], relation: CatalogRelationV2) {
  return (
    tables.find(
      (table) =>
        table.schema === relation.object.namespace &&
        table.name === relation.object.name,
    ) ?? null
  );
}

export default function SchemaExplorer({
  connection,
  selectedTable,
  onOpenTable,
}: {
  connection: ConnectionProfile;
  selectedTable: CatalogTable | null;
  onOpenTable: (table: CatalogTable) => void;
}) {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const [detailsRequested, setDetailsRequested] = useState(false);
  const overviewQuery = useQuery({
    ...catalogOverviewQuery(connection.id, catalogScope),
    select: (overview) => filterCatalogOverview(connection, overview),
  });
  // The flat catalog and the ERD snapshot observe one shared live read of the
  // configured database, the same entry the Explorer and table surfaces use.
  const detailsEnabled = schemaDetailsEnabled(
    detailsRequested,
    catalogScope.ready,
  );
  const selectCatalog = useCallback(
    (loaded: CatalogSnapshot) =>
      filterCatalog(connection, catalogFromSnapshot(loaded)),
    [connection],
  );
  const selectSnapshot = useCallback(
    (loaded: CatalogSnapshot) => filterCatalogSnapshot(connection, loaded),
    [connection],
  );
  const catalogQueryResult = useQuery({
    ...databaseCatalogSnapshotQuery(
      connection.id,
      connection.database,
      detailsEnabled,
      catalogScope,
    ),
    select: selectCatalog,
  });
  const snapshotQuery = useQuery({
    ...databaseCatalogSnapshotQuery(
      connection.id,
      connection.database,
      detailsEnabled,
      catalogScope,
    ),
    select: selectSnapshot,
  });
  // A persisted snapshot is shown only while the live read runs; label its age.
  const persistedAt = useQuery({
    ...databaseCatalogSnapshotQuery(
      connection.id,
      connection.database,
      detailsEnabled,
      catalogScope,
    ),
    select: selectPersistedAt,
  }).data;
  const snapshot = snapshotQuery.data;
  const [filter, setFilter] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    const preferred = selectedTable
      ? snapshot.relations.find(
          (relation) =>
            relation.object.namespace === selectedTable.schema &&
            relation.object.name === selectedTable.name,
        )
      : null;
    setSelectedKey((current) => {
      if (preferred) return erdRelationKey(preferred.object);
      if (
        current &&
        snapshot.relations.some(
          (relation) => erdRelationKey(relation.object) === current,
        )
      ) {
        return current;
      }
      return snapshot.relations[0]
        ? erdRelationKey(snapshot.relations[0].object)
        : null;
    });
  }, [selectedTable, snapshot]);

  const selected = useMemo(
    () =>
      snapshot?.relations.find(
        (relation) => erdRelationKey(relation.object) === selectedKey,
      ) ?? null,
    [selectedKey, snapshot],
  );
  const physicalRelationshipCount =
    snapshot?.relations.reduce(
      (count, relation) =>
        count +
        relation.constraints.filter(
          (constraint) => constraint.kind === "foreign",
        ).length,
      0,
    ) ?? 0;

  function openRelation(relation: CatalogRelationV2) {
    const table = catalogTableFor(
      catalogQueryResult.data?.tables ?? [],
      relation,
    );
    if (table) onOpenTable(table);
  }

  async function retryCatalogLoad() {
    // Both observers share one entry, so one refetch retries the single live read.
    await snapshotQuery.refetch();
  }

  // The shared refresh rereads every open catalog view of this connection once.
  function rereadSchema() {
    void refreshConnectionCatalog(queryClient, connection.id);
  }

  // Details the Explorer or a table already read are shown without another request.
  if (!detailsRequested && !(snapshot && catalogQueryResult.data)) {
    if (overviewQuery.error) {
      return (
        <SchemaFrame>
          <div className="tw:text-ui tw:text-danger">
            {catalogLoadIssueMessage(t, catalogLoadIssue(overviewQuery.error))}
          </div>
          <span className="tw:self-start">
          <Button
            size="compact"
            type="button"
            disabled={overviewQuery.isFetching}
            onClick={() => void overviewQuery.refetch()}
          >
            <Icon name="refresh" />
            {t("common.refresh")}
          </Button>
          </span>
        </SchemaFrame>
      );
    }
    if (!overviewQuery.data) {
      return (
        <SchemaFrame>
          <Skeleton lines={8} />
        </SchemaFrame>
      );
    }
    if (overviewQuery.data.relations.length === 0) {
      return (
        <SchemaFrame>
          <WorkbenchEmptyState icon="database">
            {t("schema.empty")}
          </WorkbenchEmptyState>
        </SchemaFrame>
      );
    }
    return (
      <SchemaFrame>
        <WorkbenchEmptyState icon="database">
          <strong>
            {t("schema.detailsDeferredTitle", {
              count: overviewQuery.data.relations.length,
            })}
          </strong>
          <span>{t("schema.detailsDeferredDescription")}</span>
          <Button
            variant="primary"
            type="button"
            onClick={() => setDetailsRequested(true)}
          >
            {t("schema.loadDetails")}
          </Button>
        </WorkbenchEmptyState>
      </SchemaFrame>
    );
  }

  const error = snapshotQuery.error ?? catalogQueryResult.error;
  const rereading = catalogQueryResult.isFetching || snapshotQuery.isFetching;
  // A failed reread keeps the last read schema; only a first read that failed blocks.
  if (error && !(snapshot && catalogQueryResult.data)) {
    return (
      <SchemaFrame>
        <div className="tw:text-ui tw:text-danger">
          {catalogLoadIssueMessage(t, catalogLoadIssue(error))}
        </div>
        <span className="tw:self-start">
        <Button
          size="compact"
          type="button"
          disabled={rereading}
          disabledBehavior="focusable"
          aria-busy={rereading}
          onClick={() => void retryCatalogLoad()}
        >
          <Icon name="refresh" />
          {t("common.refresh")}
        </Button>
        </span>
      </SchemaFrame>
    );
  }
  if (!snapshot || !catalogQueryResult.data) {
    return (
      <SchemaFrame>
        <Skeleton lines={8} />
      </SchemaFrame>
    );
  }

  return (
    <SchemaFrame>
      <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:@max-[760px]:flex-col tw:@max-[760px]:items-start">
        <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-2 tw:text-sm tw:text-muted-foreground">
          <span>
            {t("schema.tableCount", { count: snapshot.relations.length })}
            {" · "}
            {t("schema.fkCount", { count: physicalRelationshipCount })}
          </span>
          {persistedAt && !error ? (
            <LoadingLabel>
              {t("schema.persistedRefreshing", { time: fullTime(persistedAt, lang) })}
            </LoadingLabel>
          ) : persistedAt || error ? (
            <span>
              {t("schema.persistedShown", {
                time: fullTime(persistedAt ?? snapshot.capturedAt, lang),
              })}
            </span>
          ) : null}
        </span>
        <div className="ds-control-row tw:ml-auto tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:@max-[760px]:ml-0 tw:@max-[760px]:w-full">
          <Button
            iconOnly
            size="compact"
            disabled={rereading}
            disabledBehavior="focusable"
            aria-busy={rereading}
            title={t(rereading ? "schema.rereading" : "schema.reread")}
            aria-label={t(rereading ? "schema.rereading" : "schema.reread")}
            onClick={rereadSchema}
          >
            <Icon name="refresh" />
          </Button>
          <span className="tw:w-[min(320px,42vw)] tw:min-w-0 tw:@max-[760px]:flex-1">
            <TextInput
              density="compact"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("schema.filterPlaceholder")}
              type="search"
            />
          </span>
          <Button
            aria-expanded={inspectorOpen}
            aria-controls="schema-inspector"
            iconOnly
            title={t(
              inspectorOpen ? "schema.hideDetails" : "schema.showDetails",
            )}
            aria-label={t(
              inspectorOpen ? "schema.hideDetails" : "schema.showDetails",
            )}
            onClick={() => setInspectorOpen((open) => !open)}
            size="compact"
          >
            <Icon name="panelRight" />
          </Button>
        </div>
      </div>

      {error ? (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={(
            <Button
              size="xs"
              variant="ghost"
              disabled={rereading}
              disabledBehavior="focusable"
              aria-busy={rereading}
              onClick={rereadSchema}
            >
              {t("app.retry")}
            </Button>
          )}
        >
          {t("schema.rereadFailed", {
            error: catalogLoadIssueMessage(t, catalogLoadIssue(error)),
          })}
        </InlineNotice>
      ) : null}

      {snapshot.relations.length === 0 ? (
        <WorkbenchEmptyState icon="database">
          {t("schema.empty")}
        </WorkbenchEmptyState>
      ) : (
        <div
          data-inspector={inspectorOpen}
          className="tw:grid tw:min-h-[320px] tw:min-w-0 tw:flex-1 tw:grid-cols-[minmax(0,1fr)] tw:data-[inspector=true]:grid-cols-[minmax(0,1fr)_320px] tw:@max-[1100px]:data-[inspector=true]:flex-none tw:@max-[1100px]:data-[inspector=true]:grid-cols-[minmax(0,1fr)]"
        >
          <Suspense fallback={<Skeleton lines={8} />}>
            <ErdCanvas
              snapshot={snapshot}
              filter={filter}
              selectedKey={selectedKey}
              onSelect={(relation) =>
                setSelectedKey(erdRelationKey(relation.object))
              }
              onOpen={openRelation}
            />
          </Suspense>
          {inspectorOpen && (
            <aside
              className="tw:min-w-0 tw:overflow-auto tw:border-l tw:border-border-subtle tw:py-3 tw:pr-0 tw:pl-4 tw:[&_h3]:mt-4 tw:@max-[1100px]:overflow-visible tw:@max-[1100px]:border-t tw:@max-[1100px]:border-l-0 tw:@max-[1100px]:px-0 tw:@max-[1100px]:pt-3"
              id="schema-inspector"
            >
              {selected ? (
                <>
                  <div className="tw:flex tw:items-start tw:justify-between tw:gap-3">
                    <div className="tw:grid tw:min-w-0 tw:gap-1">
                      <h3 className="tw:mt-0 tw:text-foreground tw:normal-case tw:tracking-normal">
                        {relationDisplayName(selected.object)}
                      </h3>
                      <span
                        className="badge"
                        title={t("schema.columnCount", {
                          count: selected.columns.length,
                        })}
                      >
                        <Icon name="table" />
                        {selected.columns.length}
                      </span>
                    </div>
                    {catalogTableFor(
                      catalogQueryResult.data.tables,
                      selected,
                    ) && (
                      <Button
                        size="compact"
                        onClick={() => openRelation(selected)}
                      >
                        {t("schema.openData")}
                      </Button>
                    )}
                  </div>
                  <div className="tw:mt-3 tw:grid tw:gap-0 tw:border-t tw:border-border-subtle">
                    {selected.columns.map((column) => (
                      <div
                        className="tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(90px,auto)] tw:items-center tw:gap-3 tw:border-b tw:border-border-subtle tw:py-2 tw:text-sm tw:@max-[760px]:grid-cols-1 tw:@max-[760px]:gap-1"
                        key={column.name}
                      >
                        <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                          <code className="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                            {column.name}
                          </code>
                          {selected.constraints.some(
                            (constraint) =>
                              constraint.kind === "primary" &&
                              constraint.columns.includes(column.name),
                          ) && (
                            <b className="tw:rounded-xs tw:bg-primary/10 tw:px-1 tw:text-2xs tw:leading-4 tw:text-primary">
                              {t("schema.pk")}
                            </b>
                          )}
                        </span>
                        <em className="tw:text-right tw:text-muted-foreground tw:not-italic tw:@max-[760px]:text-left">
                          {column.nativeType}
                        </em>
                      </div>
                    ))}
                  </div>
                  <h3>{t("schema.relationships")}</h3>
                  {selected.constraints.some(
                    (constraint) => constraint.kind === "foreign",
                  ) ? (
                    <ul className="tw:mt-2 tw:grid tw:list-none tw:gap-2 tw:p-0 tw:text-sm tw:leading-[1.45] tw:text-muted-foreground">
                      {selected.constraints
                        .filter((constraint) => constraint.kind === "foreign")
                        .map((constraint) => (
                          <li key={constraint.name}>
                            {constraint.name}: {constraint.columns.join(", ")}
                            {" → "}
                            {constraint.referencedRelation
                              ? relationDisplayName(
                                  constraint.referencedRelation,
                                )
                              : "?"}
                            .{constraint.referencedColumns.join(", ")}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="tw:text-muted-foreground">
                      {t("schema.noForeignKeys")}
                    </p>
                  )}
                  <h3>{t("schema.indexes")}</h3>
                  {selected.indexes.length ? (
                    <ul className="tw:mt-2 tw:grid tw:list-none tw:gap-2 tw:p-0 tw:text-sm tw:leading-[1.45] tw:text-muted-foreground">
                      {selected.indexes.map((index) => (
                        <li key={index.name}>
                          {index.name}:{" "}
                          {index.keys
                            .map((key) => key.column ?? key.expression ?? "?")
                            .join(", ")}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="tw:text-muted-foreground">
                      {t("common.none")}
                    </p>
                  )}
                </>
              ) : (
                <InfoTip label={t("schema.selectTable")} />
              )}
            </aside>
          )}
        </div>
      )}
    </SchemaFrame>
  );
}
