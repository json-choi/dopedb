import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Catalog,
  CatalogObject,
  CatalogOverview,
  CatalogTable,
} from "../../ipc/types";
import {
  databaseDisplayLabel,
  type ConnectionAccessIssue,
  type ConnectionProfile,
} from "../../features/connections/domain";
import { bigQueryAuthMode } from "../../features/connections/bigQueryOnboardingModel";
import type { CatalogLoadIssue } from "../../features/catalogExplorer/catalogDomain";
import { Icon } from "../../components/Icon";
import { TreeSectionButton } from "../../design-system/components/TreeControls";
import {
  VirtualTreeRows,
  type VirtualTreeRow,
} from "../../design-system/components/VirtualTreeRows";
import { isDocumentEngine } from "../../lib/capabilities";
import { useI18n } from "../../lib/i18n";
import type { SchemaConnectionGroup } from "../../lib/schemaDiff";
import { tableKey } from "../../lib/tableRef";
import {
  CatalogMissingRelationRow,
  CatalogObjectRow,
  CatalogRelationRow,
} from "./CatalogTreeRows";
import { useCatalogTreeProjection } from "./useCatalogTreeProjection";
import { CatalogTreeStatus } from "./CatalogTreeStatus";

type Props = {
  connection: ConnectionProfile;
  accessIssue?: ConnectionAccessIssue;
  selected: boolean;
  selectedTableKey: string | null;
  overview?: CatalogOverview;
  fullCatalog?: Catalog;
  error?: CatalogLoadIssue;
  detailError?: CatalogLoadIssue;
  applySchemaScope?: boolean;
  initiallyOpen?: boolean;
  scrollElement: HTMLDivElement | null;
  filter: string;
  activeSearchResultKey?: string | null;
  onSearchResultsChange?: (
    catalogKey: string,
    results: CatalogTreeSearchResult[],
  ) => void;
  showRowCounts: boolean;
  groupByConnectionId: Map<string, SchemaConnectionGroup>;
  catalogs: Record<string, Catalog>;
  collapsedSections: Set<string>;
  objectSectionsOpen: Set<string>;
  onOpenTable: (table: CatalogTable) => void;
  onRequestOverview: () => void;
  onForgetOverview: () => void;
  onRequestDetails: () => void;
  onRetryOverview: () => void;
  onResolveAccess?: () => void;
  onRecoverAuthentication?: () => void;
  onRecoverManagedConnection?: () => void;
  managedConnectionRecoveryPending?: boolean;
  authenticationRecoveryPending?: boolean;
  authenticationRecoveryError?: CatalogLoadIssue;
  onToggleRelationSection: (key: string) => void;
  onToggleObjectSection: (kind: string) => void;
  revealRequest: number;
  revealDatabase: string | null;
  revealNamespace: string | null;
  treeParentKey: string;
  treeLevel: number;
};

export type CatalogTreeSearchResult = {
  key: string;
  rowKey: string;
  treeKey: string;
  kind: "relation" | "object";
  connectionId: string;
  database: string;
  table?: CatalogTable;
};

export default function CatalogTree(props: Props) {
  const { t } = useI18n();
  const treeRef = useRef<HTMLDivElement>(null);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(
    () => new Set(),
  );
  const [databaseOpen, setDatabaseOpen] = useState(
    props.initiallyOpen ?? true,
  );
  const [collapsedMetadataSections, setCollapsedMetadataSections] =
    useState<Set<string>>(() => new Set());
  const {
    connection,
    accessIssue,
    selected,
    selectedTableKey,
    overview,
    fullCatalog,
    error,
    detailError,
    filter,
    showRowCounts,
    groupByConnectionId,
    catalogs,
    collapsedSections,
    objectSectionsOpen,
    onSearchResultsChange,
  } = props;
  const {
    unfilteredCatalog,
    catalog,
    diff,
    normalizedFilter,
    filteredObjects,
    ordered,
    missingTables,
    tables,
    objectSections,
    schemaGroups,
  } = useCatalogTreeProjection({
    connection,
    overview,
    fullCatalog,
    applySchemaScope: props.applySchemaScope,
    filter,
    groupByConnectionId,
    catalogs,
  });
  const databaseSectionKey = (section: string) =>
    `${connection.database}\u0000${section}`;
  const catalogKey = `${connection.id}\u0000${connection.database}`;

  const tableSearchResultKey = useCallback(
    (table: CatalogTable) => `${catalogKey}\u0000relation\u0000${tableKey(table)}`,
    [catalogKey],
  );
  const objectSearchResultKey = useCallback(
    (object: CatalogObject, index: number) =>
      `${catalogKey}\u0000object\u0000${object.schema ?? ""}\u0000${object.kind}\u0000${object.name}\u0000${object.detail ?? index}`,
    [catalogKey],
  );

  const revealSelection = useEffectEvent(() => {
    if (
      !selected ||
      props.revealRequest === 0 ||
      !unfilteredCatalog
    ) {
      return;
    }
    if (
      props.revealDatabase &&
      connection.database !== props.revealDatabase
    ) {
      return;
    }
    const table = selectedTableKey
      ? unfilteredCatalog.tables.find(
          (candidate) => tableKey(candidate) === selectedTableKey,
        )
      : undefined;

    setDatabaseOpen(true);
    props.onRequestOverview();
    const namespace = table?.schema ?? props.revealNamespace;
    const schemaKey = namespace == null
      ? null
      : schemaStateKey(namespace);
    if (schemaKey) {
      setCollapsedSchemas((current) => {
        if (!current.has(schemaKey)) return current;
        const next = new Set(current);
        next.delete(schemaKey);
        return next;
      });
    }
    if (table && schemaKey) {
      const relationSection = isDocumentEngine(connection.engine)
        ? "collections"
        : `${schemaKey}:${table.kind === "view" ? "view" : "table"}`;
      const relationSectionKey = databaseSectionKey(relationSection);
      if (
        collapsedSections.has(
          `${connection.id}:${relationSectionKey}`,
        )
      ) {
        props.onToggleRelationSection(relationSectionKey);
      }
    }

    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        const row = table
          ? [...treeRef.current?.querySelectorAll<HTMLElement>(
              "[data-table-key]",
            ) ?? []].find(
              (candidate) =>
                candidate.dataset.tableKey === selectedTableKey,
            )
          : schemaKey
            ? treeRef.current?.querySelector<HTMLElement>(
                `[data-schema-key="${CSS.escape(schemaKey)}"]`,
              )
            : treeRef.current?.querySelector<HTMLElement>(
                "[data-database-root]",
              );
        row?.scrollIntoView({ block: "nearest" });
        (
          row?.querySelector<HTMLButtonElement>(".tbl-name") ??
          row?.querySelector<HTMLElement>('[role="button"]')
        )?.focus();
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  });

  useEffect(() => {
    // The request counter is the lifecycle trigger; the Effect Event snapshots the
    // latest catalog and tree commands for that request without replaying on each render.
    return revealSelection();
  }, [props.revealRequest]);

  function toggleTableDetails(table: CatalogTable) {
    const key = tableKey(table);
    setExpandedTables((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        props.onRequestDetails();
      }
      return next;
    });
  }

  function toggleSchema(schema: string) {
    setCollapsedSchemas((current) => {
      const next = new Set(current);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });
  }

  function toggleMetadataSection(table: CatalogTable, section: string) {
    const key = `${tableKey(table)}:${section}`;
    setCollapsedMetadataSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderTable(table: CatalogTable) {
    const key = tableKey(table);
    const detailsOpen = expandedTables.has(key);
    return (
      <CatalogRelationRow
        connection={connection}
        table={table}
        tableDiff={diff?.tableDiffs[key]}
        fullCatalogLoaded={Boolean(fullCatalog)}
        detailsOpen={detailsOpen}
        collapsedMetadataSections={collapsedMetadataSections}
        searchResultKey={
          normalizedFilter ? tableSearchResultKey(table) : undefined
        }
        activeSearchResultKey={activeSearchResult?.key}
        selected={selected && selectedTableKey === key}
        showRowCounts={showRowCounts}
        onToggleDetails={() => toggleTableDetails(table)}
        onToggleMetadataSection={(section) =>
          toggleMetadataSection(table, section)
        }
        onOpen={() => props.onOpenTable(table)}
      />
    );
  }

  function renderMissingTable(table: CatalogTable) {
    return (
      <CatalogMissingRelationRow connection={connection} table={table} />
    );
  }

  function renderObject(
    object: CatalogObject,
    icon: Parameters<typeof Icon>[0]["name"],
    index: number,
    insideSchema = false,
  ) {
    return (
      <CatalogObjectRow
        object={object}
        icon={icon}
        insideSchema={insideSchema}
        searchResultKey={
          normalizedFilter ? objectSearchResultKey(object, index) : undefined
        }
        activeSearchResultKey={activeSearchResult?.key}
      />
    );
  }

  function schemaStateKey(schema: string) {
    return schema || "__default__";
  }

  function row(
    key: string,
    depth: 0 | 1,
    treeItem: NonNullable<VirtualTreeRow["treeItem"]> | undefined,
    render: () => ReactNode,
  ): VirtualTreeRow {
    return {
      key,
      treeItem,
      render: () =>
        depth === 1 ? <div className="tw:pl-3">{render()}</div> : render(),
    };
  }

  const tableRowKey = useCallback(
    (table: CatalogTable) => `${connection.database}:table:${tableKey(table)}`,
    [connection.database],
  );
  const objectRowKey = useCallback(
    (object: CatalogObject, index: number) =>
      `${connection.database}:object:${object.schema ?? ""}:${object.kind}:${object.name}:${object.detail ?? index}`,
    [connection.database],
  );
  const databaseTreeKey =
    `connection:${connection.id}:database:${connection.database}`;
  const treeKey = useCallback(
    (key: string) => `${databaseTreeKey}:${key}`,
    [databaseTreeKey],
  );
  const tableTreeKey = useCallback(
    (table: CatalogTable) => treeKey(`relation:${tableKey(table)}`),
    [treeKey],
  );
  const objectTreeKey = useCallback(
    (object: CatalogObject, index: number) =>
      treeKey(
        `object:${object.schema ?? ""}:${object.kind}:${object.name}:${
          object.detail ?? index
        }`,
      ),
    [treeKey],
  );

  const searchResults = useMemo<CatalogTreeSearchResult[]>(() => {
    if (!normalizedFilter) return [];
    return [
      ...ordered.map((table) => ({
        key: tableSearchResultKey(table),
        rowKey: tableRowKey(table),
        treeKey: tableTreeKey(table),
        kind: "relation" as const,
        connectionId: connection.id,
        database: connection.database,
        table,
      })),
      ...filteredObjects.map((object, index) => ({
        key: objectSearchResultKey(object, index),
        rowKey: objectRowKey(object, index),
        treeKey: objectTreeKey(object, index),
        kind: "object" as const,
        connectionId: connection.id,
        database: connection.database,
      })),
    ];
  }, [
    connection.database,
    connection.id,
    filteredObjects,
    normalizedFilter,
    objectRowKey,
    objectSearchResultKey,
    objectTreeKey,
    ordered,
    tableRowKey,
    tableSearchResultKey,
    tableTreeKey,
  ]);

  useEffect(() => {
    onSearchResultsChange?.(catalogKey, searchResults);
  }, [catalogKey, onSearchResultsChange, searchResults]);

  useEffect(
    () => () => onSearchResultsChange?.(catalogKey, []),
    [catalogKey, onSearchResultsChange],
  );

  const activeSearchResult = props.activeSearchResultKey
    ? searchResults.find((result) => result.key === props.activeSearchResultKey)
    : undefined;

  useEffect(() => {
    if (!activeSearchResult) return;
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        const result = treeRef.current?.querySelector<HTMLElement>(
          `[data-explorer-search-result="${CSS.escape(activeSearchResult.key)}"]`,
        );
        result?.scrollIntoView({ block: "nearest" });
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  }, [activeSearchResult]);

  function buildDatabaseRows(): VirtualTreeRow[] {
    const rows: VirtualTreeRow[] = [];
    if (isDocumentEngine(connection.engine)) {
      const collectionSectionKey = databaseSectionKey("collections");
      const collectionsOpen =
        Boolean(normalizedFilter) ||
        !collapsedSections.has(
          `${connection.id}:${collectionSectionKey}`,
        );
      if (tables.length > 0 || (!normalizedFilter && catalog)) {
        const collectionsTreeKey = treeKey("section:collections");
        rows.push(row(
          `${connection.database}:section:collections`,
          0,
          {
            key: collectionsTreeKey,
            parentKey: databaseTreeKey,
            level: props.treeLevel + 1,
            expanded: collectionsOpen,
          },
          () => (
            <TreeSectionButton
              expanded={collectionsOpen}
              icon="collection"
              treeItemContent
              onToggle={() =>
                props.onToggleRelationSection(collectionSectionKey)
              }
            >
              {t("connections.collections", { count: tables.length })}
            </TreeSectionButton>
          ),
        ));
        if (collectionsOpen) {
          for (const table of tables) {
            rows.push(row(
              tableRowKey(table),
              1,
              {
                key: tableTreeKey(table),
                parentKey: collectionsTreeKey,
                level: props.treeLevel + 2,
                selected: selected && selectedTableKey === tableKey(table),
              },
              () => renderTable(table),
            ));
          }
        }
      }
    } else {
      for (const [schema, contents] of schemaGroups) {
        const schemaKey = schemaStateKey(schema);
        const schemaOpen =
          Boolean(normalizedFilter) || !collapsedSchemas.has(schemaKey);
        const schemaTreeKey = treeKey(`schema:${schemaKey}`);
        rows.push(row(
          `${connection.database}:schema:${schemaKey}`,
          0,
          {
            key: schemaTreeKey,
            parentKey: databaseTreeKey,
            level: props.treeLevel + 1,
            expanded: schemaOpen,
          },
          () => (
            <div data-schema-key={schemaKey}>
              <TreeSectionButton
                expanded={schemaOpen}
                icon="folder"
                treeItemContent
                onToggle={() => toggleSchema(schemaKey)}
              >
                {schema || t("connections.defaultSchema")}
              </TreeSectionButton>
            </div>
          ),
        ));
        if (!schemaOpen) continue;

        const tableSectionKey = databaseSectionKey(`${schemaKey}:table`);
        const tablesOpen =
          Boolean(normalizedFilter) ||
          !collapsedSections.has(`${connection.id}:${tableSectionKey}`);
        if (contents.tables.length > 0) {
          const tablesTreeKey = treeKey(
            `schema:${schemaKey}:section:table`,
          );
          rows.push(row(
            `${connection.database}:schema:${schemaKey}:section:table`,
            1,
            {
              key: tablesTreeKey,
              parentKey: schemaTreeKey,
              level: props.treeLevel + 2,
              expanded: tablesOpen,
            },
            () => (
              <TreeSectionButton
                expanded={tablesOpen}
                icon="table"
                treeItemContent
                onToggle={() =>
                  props.onToggleRelationSection(tableSectionKey)
                }
              >
                {t("connections.tables", { count: contents.tables.length })}
              </TreeSectionButton>
            ),
          ));
          if (tablesOpen) {
            for (const table of contents.tables) {
              rows.push(row(
                tableRowKey(table),
                1,
                {
                  key: tableTreeKey(table),
                  parentKey: tablesTreeKey,
                  level: props.treeLevel + 3,
                  expanded: isDocumentEngine(connection.engine)
                    ? undefined
                    : expandedTables.has(tableKey(table)),
                  selected: selected && selectedTableKey === tableKey(table),
                },
                () => renderTable(table),
              ));
            }
          }
        }

        const viewSectionKey = databaseSectionKey(`${schemaKey}:view`);
        const viewsOpen =
          Boolean(normalizedFilter) ||
          !collapsedSections.has(`${connection.id}:${viewSectionKey}`);
        if (contents.views.length > 0) {
          const viewsTreeKey = treeKey(
            `schema:${schemaKey}:section:view`,
          );
          rows.push(row(
            `${connection.database}:schema:${schemaKey}:section:view`,
            1,
            {
              key: viewsTreeKey,
              parentKey: schemaTreeKey,
              level: props.treeLevel + 2,
              expanded: viewsOpen,
            },
            () => (
              <TreeSectionButton
                expanded={viewsOpen}
                icon="view"
                treeItemContent
                onToggle={() =>
                  props.onToggleRelationSection(viewSectionKey)
                }
              >
                {t("connections.views", { count: contents.views.length })}
              </TreeSectionButton>
            ),
          ));
          if (viewsOpen) {
            for (const view of contents.views) {
              rows.push(row(
                tableRowKey(view),
                1,
                {
                  key: tableTreeKey(view),
                  parentKey: viewsTreeKey,
                  level: props.treeLevel + 3,
                  expanded: expandedTables.has(tableKey(view)),
                  selected: selected && selectedTableKey === tableKey(view),
                },
                () => renderTable(view),
              ));
            }
          }
        }

        for (const section of objectSections) {
          const objects = contents.objectsByKind.get(section.kind) ?? [];
          if (normalizedFilter && objects.length === 0) continue;
          const objectSectionKey = databaseSectionKey(
            `${schemaKey}:${section.kind}`,
          );
          const expanded =
            Boolean(normalizedFilter) ||
            objectSectionsOpen.has(
              `${connection.id}:${objectSectionKey}`,
            );
          const objectSectionTreeKey = treeKey(
            `schema:${schemaKey}:section:${section.kind}`,
          );
          rows.push(row(
            `${connection.database}:schema:${schemaKey}:section:${section.kind}`,
            1,
            {
              key: objectSectionTreeKey,
              parentKey: schemaTreeKey,
              level: props.treeLevel + 2,
              expanded,
            },
            () => (
              <TreeSectionButton
                expanded={expanded}
                icon={section.icon}
                treeItemContent
                onToggle={() =>
                  props.onToggleObjectSection(objectSectionKey)
                }
              >
                {t(section.label, { count: objects.length })}
              </TreeSectionButton>
            ),
          ));
          if (expanded) {
            objects.forEach((object, index) => {
              rows.push(row(
                objectRowKey(object, index),
                1,
                {
                  key: objectTreeKey(object, index),
                  parentKey: objectSectionTreeKey,
                  level: props.treeLevel + 3,
                },
                () => renderObject(object, section.icon, index, true),
              ));
            });
          }
        }
      }
    }

    if (missingTables.length > 0) {
      rows.push(row(
        `${connection.database}:section:missing`,
        0,
        undefined,
        () => (
          <div className="tw:mt-1 tw:px-2 tw:py-1 tw:text-xs tw:font-semibold tw:tracking-[0.04em] tw:text-danger tw:uppercase">
            {t("connections.schemaDiffMissingSection", {
              count: missingTables.length,
            })}
          </div>
        ),
      ));
      for (const table of missingTables) {
        rows.push(row(
          `${connection.database}:missing:${tableKey(table)}`,
          0,
          {
            key: treeKey(`missing:${tableKey(table)}`),
            parentKey: databaseTreeKey,
            level: props.treeLevel + 1,
          },
          () => renderMissingTable(table),
        ));
      }
    }
    return rows;
  }

  const databaseDisplayName =
    databaseDisplayLabel(connection.engine, connection.database)
    || connection.name
    || t("connections.database");

  function toggleDatabase() {
    const next = !databaseOpen;
    setDatabaseOpen(next);
    if (next) props.onRequestOverview();
    else props.onForgetOverview();
  }

  const databaseVisible =
    databaseOpen || (Boolean(normalizedFilter) && Boolean(catalog));
  const databaseRows = databaseVisible ? buildDatabaseRows() : [];

  return (
    <div
      ref={treeRef}
      className="tw:flex tw:flex-col tw:gap-px tw:pt-1 tw:pr-0 tw:pb-2 tw:pl-3"
    >
      <div
        className="tw:flex tw:flex-col tw:gap-px"
        data-database-root
      >
        <TreeSectionButton
          expanded={databaseVisible}
          icon="database"
          treeItem={{
            key: databaseTreeKey,
            parentKey: props.treeParentKey,
            level: props.treeLevel,
          }}
          onToggle={toggleDatabase}
        >
          {databaseDisplayName}
        </TreeSectionButton>
        {databaseVisible ? (
          <div className="tw:flex tw:flex-col tw:gap-px tw:pl-3">
            <CatalogTreeStatus
              accessIssue={accessIssue}
              error={error}
              detailError={detailError}
              catalogLoaded={Boolean(catalog)}
              empty={
                ordered.length === 0 &&
                filteredObjects.length === 0 &&
                missingTables.length === 0
              }
              normalizedFilter={normalizedFilter}
              databaseTreeKey={databaseTreeKey}
              treeLevel={props.treeLevel}
              authenticationMode={
                connection.engine === "bigquery"
                  ? bigQueryAuthMode(connection)
                  : undefined
              }
              authenticationRecoveryPending={
                props.authenticationRecoveryPending
              }
              authenticationRecoveryError={props.authenticationRecoveryError}
              onResolveAccess={props.onResolveAccess}
              onRecoverAuthentication={props.onRecoverAuthentication}
              onRecoverManagedConnection={props.onRecoverManagedConnection}
              managedConnectionRecoveryPending={
                props.managedConnectionRecoveryPending
              }
              onRetryOverview={props.onRetryOverview}
              onRequestDetails={props.onRequestDetails}
            />
            {databaseRows.length > 0 ? (
              <VirtualTreeRows
                rows={databaseRows}
                scrollElement={props.scrollElement}
                pinnedKey={
                  activeSearchResult?.rowKey ?? (selectedTableKey
                    ? `${connection.database}:table:${selectedTableKey}`
                    : null)
                }
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
