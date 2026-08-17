// Catalog subtree of the Database Explorer tree. Every navigable row is a
// `role="treeitem"` with an `aria-level`; the explorer container owns the single
// roving-focus keyboard handler and reads those rows out of the DOM, so rows
// here only declare their depth, expanded state and `data-tree-toggle`.
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
  CatalogConstraint,
  CatalogForeignKey,
  CatalogIndex,
  CatalogObject,
  CatalogOverview,
  CatalogTable,
} from "../../ipc/types";
import type {
  ConnectionAccessIssue,
  ConnectionProfile,
} from "../../features/connections/domain";
import { Icon } from "../../components/Icon";
import { TreeSectionButton } from "../../design-system/components/TreeControls";
import {
  VirtualTreeRows,
  type VirtualTreeRow,
} from "../../design-system/components/VirtualTreeRows";
import { LoadingLabel } from "../../design-system/components/Status";
import { isDocumentEngine } from "../../lib/capabilities";
import { useI18n } from "../../lib/i18n";
import {
  orderTablesBySchemaDiff,
  tableDiffTone,
  type SchemaConnectionGroup,
} from "../../lib/schemaDiff";
import { tableKey, tableLabel } from "../../lib/tableRef";
import {
  schemaDiffForConnection,
  schemaTableDiffTitle,
} from "./schemaDiffPresentation";
import { catalogFromOverview } from "./catalogOverview";
import {
  catalogObjectLabel,
  objectMatchesFilter,
  SQL_OBJECT_SECTIONS,
  supportedObjectKinds,
  tableMatchesFilter,
} from "../../features/catalogExplorer/catalogDomain";
import { filterCatalog } from "../../features/catalogExplorer/scopeFilter";

type Props = {
  connection: ConnectionProfile;
  accessIssue?: ConnectionAccessIssue;
  selected: boolean;
  selectedTableKey: string | null;
  overview?: CatalogOverview;
  fullCatalog?: Catalog;
  error?: string;
  detailError?: string;
  applySchemaScope?: boolean;
  initiallyOpen?: boolean;
  /** `aria-level` of this catalog's database row inside the explorer tree. */
  level: number;
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
  onToggleRelationSection: (key: string) => void;
  onToggleObjectSection: (kind: string) => void;
  revealRequest: number;
  revealDatabase: string | null;
  revealNamespace: string | null;
};

type SchemaContents = {
  tables: CatalogTable[];
  views: CatalogTable[];
  objectsByKind: Map<string, CatalogObject[]>;
};

export type CatalogTreeSearchResult = {
  key: string;
  rowKey: string;
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
  } = useMemo(() => {
    const nextUnfilteredCatalog = overview
      ? catalogFromOverview(overview, fullCatalog)
      : fullCatalog;
    const nextCatalog = nextUnfilteredCatalog
      ? props.applySchemaScope === false
        ? nextUnfilteredCatalog
        : filterCatalog(connection, nextUnfilteredCatalog)
      : undefined;
    const nextDiff = schemaDiffForConnection(
      connection,
      groupByConnectionId,
      catalogs,
    );
    const nextNormalizedFilter = filter.trim().toLocaleLowerCase();
    const nextFilteredTables = nextCatalog
      ? nextNormalizedFilter
        ? nextCatalog.tables.filter((table) =>
            tableMatchesFilter(table, nextNormalizedFilter),
          )
        : nextCatalog.tables
      : [];
    const nextFilteredObjects = nextCatalog
      ? nextNormalizedFilter
        ? (nextCatalog.objects ?? []).filter((object) =>
            objectMatchesFilter(object, nextNormalizedFilter),
          )
        : (nextCatalog.objects ?? [])
      : [];
    const nextOrdered = orderTablesBySchemaDiff(
      nextFilteredTables,
      nextDiff,
    );
    const nextMissingTables = nextDiff
      ? nextNormalizedFilter
        ? nextDiff.missingTables.filter((table) =>
            tableMatchesFilter(table, nextNormalizedFilter),
          )
        : nextDiff.missingTables
      : [];
    const nextTables = nextOrdered.filter((table) => table.kind !== "view");
    const supportedKinds = supportedObjectKinds(connection.engine);
    const nextObjectSections = SQL_OBJECT_SECTIONS.filter(
      (section) =>
        supportedKinds.has(section.kind) ||
        nextFilteredObjects.some((object) => object.kind === section.kind),
    );
    const groups = new Map<string, SchemaContents>();
    const contentsFor = (schema: string) => {
      const existing = groups.get(schema);
      if (existing) return existing;
      const created: SchemaContents = {
        tables: [],
        views: [],
        objectsByKind: new Map(),
      };
      groups.set(schema, created);
      return created;
    };
    for (const table of nextOrdered) {
      const contents = contentsFor(table.schema ?? "");
      if (table.kind === "view") contents.views.push(table);
      else contents.tables.push(table);
    }
    for (const object of nextFilteredObjects) {
      const objectsByKind = contentsFor(object.schema ?? "").objectsByKind;
      const objects = objectsByKind.get(object.kind) ?? [];
      objects.push(object);
      objectsByKind.set(object.kind, objects);
    }
    const nextSchemaGroups = [...groups.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return {
      unfilteredCatalog: nextUnfilteredCatalog,
      catalog: nextCatalog,
      diff: nextDiff,
      normalizedFilter: nextNormalizedFilter,
      filteredObjects: nextFilteredObjects,
      ordered: nextOrdered,
      missingTables: nextMissingTables,
      tables: nextTables,
      objectSections: nextObjectSections,
      schemaGroups: nextSchemaGroups,
    };
  }, [
    catalogs,
    connection,
    filter,
    fullCatalog,
    groupByConnectionId,
    overview,
    props.applySchemaScope,
  ]);
  const databaseLevel = props.level;
  // Access, overview-failure and detail-failure rows render as siblings of the
  // windowed rows inside the database row's own subtree, so they sit one level
  // below it just like the first schema or collection section does.
  const databaseChildLevel = databaseLevel + 1;
  const schemaLevel = databaseLevel + 1;
  const sectionLevel = isDocumentEngine(connection.engine)
    ? schemaLevel
    : schemaLevel + 1;
  const relationLevel = sectionLevel + 1;
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
        // Rows that carry their own `tabindex` are the treeitem; shared
        // `TreeSectionButton` rows delegate focus to their native toggle.
        (row?.hasAttribute("tabindex")
          ? row
          : row?.querySelector<HTMLElement>("button")
        )?.focus({ preventScroll: true });
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

  function metadataSectionIsOpen(table: CatalogTable, section: string) {
    return !collapsedMetadataSections.has(`${tableKey(table)}:${section}`);
  }

  function renderColumnRows(table: CatalogTable, level: number) {
    return table.columns.map((column) => (
      <div
        className="ds-object-row tw:cursor-default tw:gap-1 tw:rounded-xs tw:pl-4 tw:text-ui tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
        role="treeitem"
        aria-level={level}
        tabIndex={-1}
        key={`${tableKey(table)}:column:${column.ordinal}:${column.name}`}
        title={[
          column.dataType,
          column.nullable ? t("connections.nullable") : t("connections.notNull"),
          column.defaultExpression
            ? `${t("connections.defaultValue")}: ${column.defaultExpression}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <Icon
          className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground"
          name={column.pk ? "key" : "columns"}
        />
        <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
          {column.name}
        </span>
        <span className="tw:max-w-[48%] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-mono tw:text-2xs tw:text-muted-foreground">
          {column.dataType}
        </span>
      </div>
    ));
  }

  function keyLabel(
    constraint: CatalogConstraint | CatalogForeignKey,
    index: number,
  ) {
    if ("kind" in constraint) {
      return constraint.name ||
        `${constraint.kind} (${constraint.columns.join(", ")})`;
    }
    const target = [
      constraint.referencesSchema,
      constraint.referencesTable,
      constraint.referencesColumn,
    ]
      .filter(Boolean)
      .join(".");
    return constraint.name ||
      `${constraint.column} → ${target || `#${index + 1}`}`;
  }

  function renderKeyRows(table: CatalogTable, level: number) {
    const keys: Array<CatalogConstraint | CatalogForeignKey> =
      table.constraints.length > 0
        ? table.constraints
        : table.foreignKeys;
    return keys.map((constraint, index) => (
      <div
        className="ds-object-row tw:cursor-default tw:gap-1 tw:rounded-xs tw:pl-4 tw:text-ui tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
        role="treeitem"
        aria-level={level}
        tabIndex={-1}
        key={`${tableKey(table)}:key:${keyLabel(constraint, index)}:${index}`}
        title={keyLabel(constraint, index)}
      >
        <Icon
          className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground"
          name="key"
        />
        <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
          {keyLabel(constraint, index)}
        </span>
        {"kind" in constraint && (
          <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
            {constraint.kind}
          </span>
        )}
      </div>
    ));
  }

  function indexLabel(index: CatalogIndex) {
    const columns = index.keys.length > 0
      ? index.keys.map((key) => key.column ?? key.expression).filter(Boolean)
      : index.columns;
    return `${index.name} (${columns.join(", ")})`;
  }

  function renderIndexRows(table: CatalogTable, level: number) {
    return table.indexes.map((index) => (
      <div
        className="ds-object-row tw:cursor-default tw:gap-1 tw:rounded-xs tw:pl-4 tw:text-ui tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
        role="treeitem"
        aria-level={level}
        tabIndex={-1}
        key={`${tableKey(table)}:index:${index.name}`}
        title={indexLabel(index)}
      >
        <Icon
          className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground"
          name="list"
        />
        <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
          {indexLabel(index)}
        </span>
        {index.unique && (
          <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
            {t("connections.unique")}
          </span>
        )}
      </div>
    ));
  }

  function renderMetadataSection(
    table: CatalogTable,
    section: "columns" | "keys" | "indexes",
    count: number,
    children: ReturnType<typeof renderColumnRows>,
    level: number,
  ) {
    if (count === 0) return null;
    const expanded = metadataSectionIsOpen(table, section);
    return (
      <div
        className="tw:flex tw:flex-col tw:gap-px"
        key={`${tableKey(table)}:${section}`}
      >
        <div role="treeitem" aria-level={level}>
          <TreeSectionButton
            expanded={expanded}
            icon={section === "keys" ? "key" : section === "indexes" ? "list" : "columns"}
            tabIndex={-1}
            onToggle={() => toggleMetadataSection(table, section)}
          >
            {t(
              section === "keys"
                ? "connections.keys"
                : section === "indexes"
                  ? "connections.indexes"
                  : "connections.columns",
              { count },
            )}
          </TreeSectionButton>
        </div>
        {expanded && children}
      </div>
    );
  }

  function renderTableDetails(table: CatalogTable, level: number) {
    if (!fullCatalog) {
      return (
        <div className="tw:pl-5 tw:text-xs tw:text-muted-foreground">
          <LoadingLabel>{t("connections.loadingMetadata")}</LoadingLabel>
        </div>
      );
    }
    const keyCount = table.constraints.length > 0
      ? table.constraints.length
      : table.foreignKeys.length;
    return (
      <div className="tw:flex tw:flex-col tw:gap-px tw:pl-3">
        {renderMetadataSection(
          table,
          "columns",
          table.columns.length,
          renderColumnRows(table, level + 1),
          level,
        )}
        {renderMetadataSection(
          table,
          "keys",
          keyCount,
          renderKeyRows(table, level + 1),
          level,
        )}
        {renderMetadataSection(
          table,
          "indexes",
          table.indexes.length,
          renderIndexRows(table, level + 1),
          level,
        )}
        {table.columns.length + keyCount + table.indexes.length === 0 && (
          <div className="tw:pl-5 tw:text-xs tw:text-muted-foreground">
            {t("connections.noMetadata")}
          </div>
        )}
      </div>
    );
  }

  function renderTable(table: CatalogTable, level: number) {
    const key = tableKey(table);
    const tableDiff = diff?.tableDiffs[key];
    const tone = tableDiffTone(tableDiff);
    const detailsOpen = expandedTables.has(key);
    const expandable = !isDocumentEngine(connection.engine);
    return (
      <div className="tw:flex tw:flex-col tw:gap-px" key={key}>
        <div
          className="ds-object-row tw:group tw:relative tw:gap-1 tw:rounded-xs tw:select-none tw:text-ui tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:data-[search-active=true]:bg-selection tw:data-[search-active=true]:text-selection-foreground"
          data-table-key={key}
          role="treeitem"
          aria-level={level}
          aria-expanded={expandable ? detailsOpen : undefined}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            props.onOpenTable(table);
          }}
          data-explorer-search-result={
            normalizedFilter ? tableSearchResultKey(table) : undefined
          }
          data-search-active={
            activeSearchResult?.key === tableSearchResultKey(table) || undefined
          }
          data-diff={tone ?? "none"}
          aria-selected={selected && selectedTableKey === key}
          title={
            tableDiff
              ? schemaTableDiffTitle(t, tableDiff)
              : fullCatalog
                ? t("connections.columns", { count: table.columns.length })
                : undefined
          }
        >
          {expandable && (
            <button
              type="button"
              data-tree-toggle
              tabIndex={-1}
              className="tw:grid tw:size-3 tw:shrink-0 tw:cursor-pointer tw:place-items-center tw:rounded-xs tw:border-0 tw:bg-transparent tw:p-0 tw:text-2xs tw:text-muted-foreground tw:hover:text-foreground"
              aria-label={
                detailsOpen
                  ? t("connections.collapseMetadata", { table: table.name })
                  : t("connections.expandMetadata", { table: table.name })
              }
              onClick={() => toggleTableDetails(table)}
            >
              <Icon name={detailsOpen ? "chevronDown" : "chevronRight"} />
            </button>
          )}
          <span
            data-diff={tone ?? "none"}
            className="tw:size-[7px] tw:shrink-0 tw:rounded-full tw:bg-transparent tw:data-[diff=added]:bg-success tw:data-[diff=missing]:bg-danger tw:data-[diff=changed]:bg-warning tw:data-[diff=mixed]:border tw:data-[diff=mixed]:border-danger tw:data-[diff=mixed]:bg-warning"
            title={
              tableDiff ? schemaTableDiffTitle(t, tableDiff) : undefined
            }
            aria-hidden="true"
          />
          <Icon
            className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground tw:group-hover:text-current"
            name={
              isDocumentEngine(connection.engine)
                ? "collection"
                : table.kind === "view"
                  ? "view"
                  : "table"
            }
          />
          <button
            type="button"
            className="tbl-name tw:min-w-[10ch] tw:flex-1 tw:cursor-pointer tw:overflow-hidden tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:font-sans tw:text-inherit tw:text-ellipsis tw:whitespace-nowrap"
            tabIndex={-1}
            onClick={() => props.onOpenTable(table)}
          >
            {table.schema ? table.name : tableLabel(connection.engine, table)}
          </button>
          {showRowCounts &&
            table.rowEstimate != null &&
            table.rowEstimate >= 0 && (
              <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-xs tw:text-muted-foreground tw:opacity-60 tw:[font-variant-numeric:tabular-nums] tw:group-hover:opacity-100">
                ~{table.rowEstimate.toLocaleString()}
              </span>
            )}
        </div>
        {detailsOpen && renderTableDetails(table, level + 1)}
      </div>
    );
  }

  function renderMissingTable(table: CatalogTable, level: number) {
    return (
      <div
        key={`missing-${tableKey(table)}`}
        className="ds-object-row tw:cursor-default tw:gap-1 tw:rounded-xs tw:text-muted-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
        role="treeitem"
        aria-level={level}
        tabIndex={-1}
        title={t("connections.schemaDiffTableMissing")}
      >
        <span
          className="tw:size-[7px] tw:shrink-0 tw:rounded-full tw:bg-danger"
          aria-hidden="true"
        />
        <Icon
          className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground"
          name={table.kind === "view" ? "view" : "table"}
        />
        <span className="tbl-name tw:min-w-[10ch] tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
          {tableLabel(connection.engine, table)}
        </span>
        <span className="tw:shrink-0 tw:text-2xs tw:font-bold tw:tracking-[0.04em] tw:text-muted-foreground tw:uppercase">
          {t(
            table.kind === "view"
              ? "schemaDiff.objectView"
              : "schemaDiff.objectTable",
          )}
        </span>
        <span className="tw:shrink-0 tw:text-2xs tw:font-bold tw:text-danger">
          base
        </span>
      </div>
    );
  }

  function renderObject(
    object: CatalogObject,
    icon: Parameters<typeof Icon>[0]["name"],
    index: number,
    level: number,
    insideSchema = false,
  ) {
    const label =
      insideSchema &&
        (object.kind === "function" || object.kind === "procedure") &&
        object.detail != null
        ? `${object.name}(${object.detail})`
        : insideSchema
          ? object.name
          : catalogObjectLabel(object);
    return (
      <div
        className="ds-object-row tw:cursor-default tw:gap-1 tw:rounded-xs tw:text-ui tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:data-[search-active=true]:bg-selection tw:data-[search-active=true]:text-selection-foreground"
        role="treeitem"
        aria-level={level}
        tabIndex={-1}
        key={`${object.schema ?? ""}:${object.kind}:${object.name}:${
          object.detail ?? index
        }`}
        data-explorer-search-result={
          normalizedFilter ? objectSearchResultKey(object, index) : undefined
        }
        data-search-active={
          activeSearchResult?.key === objectSearchResultKey(object, index) || undefined
        }
        title={[
          catalogObjectLabel(object),
          object.parent
            ? `${t("connections.objectOn")} ${object.parent}`
            : null,
          object.detail && object.kind === "trigger" ? object.detail : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <Icon
          className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground"
          name={icon}
        />
        <span className="tbl-name tw:min-w-[10ch] tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
          {label}
        </span>
        {object.parent && (
          <span className="tw:max-w-[42%] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-xs tw:text-muted-foreground">
            {t("connections.objectOn")} {object.parent}
          </span>
        )}
      </div>
    );
  }

  function schemaStateKey(schema: string) {
    return schema || "__default__";
  }

  function row(
    key: string,
    depth: 0 | 1,
    render: () => ReactNode,
  ): VirtualTreeRow {
    return {
      key,
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

  const searchResults = useMemo<CatalogTreeSearchResult[]>(() => {
    if (!normalizedFilter) return [];
    return [
      ...ordered.map((table) => ({
        key: tableSearchResultKey(table),
        rowKey: tableRowKey(table),
        kind: "relation" as const,
        connectionId: connection.id,
        database: connection.database,
        table,
      })),
      ...filteredObjects.map((object, index) => ({
        key: objectSearchResultKey(object, index),
        rowKey: objectRowKey(object, index),
        kind: "object" as const,
        connectionId: connection.id,
        database: connection.database,
      })),
    ];
  }, [connection.database, connection.id, filteredObjects, normalizedFilter, objectRowKey, objectSearchResultKey, ordered, tableRowKey, tableSearchResultKey]);

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
        rows.push(row(
          `${connection.database}:section:collections`,
          0,
          () => (
            <div role="treeitem" aria-level={sectionLevel}>
              <TreeSectionButton
                expanded={collectionsOpen}
                icon="collection"
                tabIndex={-1}
                onToggle={() =>
                  props.onToggleRelationSection(collectionSectionKey)
                }
              >
                {t("connections.collections", { count: tables.length })}
              </TreeSectionButton>
            </div>
          ),
        ));
        if (collectionsOpen) {
          for (const table of tables) {
            rows.push(row(tableRowKey(table), 1, () =>
              renderTable(table, relationLevel),
            ));
          }
        }
      }
    } else {
      for (const [schema, contents] of schemaGroups) {
        const schemaKey = schemaStateKey(schema);
        const schemaOpen =
          Boolean(normalizedFilter) || !collapsedSchemas.has(schemaKey);
        rows.push(row(
          `${connection.database}:schema:${schemaKey}`,
          0,
          () => (
            <div
              data-schema-key={schemaKey}
              role="treeitem"
              aria-level={schemaLevel}
            >
              <TreeSectionButton
                expanded={schemaOpen}
                icon="folder"
                tabIndex={-1}
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
          rows.push(row(
            `${connection.database}:schema:${schemaKey}:section:table`,
            1,
            () => (
              <div role="treeitem" aria-level={sectionLevel}>
                <TreeSectionButton
                  expanded={tablesOpen}
                  icon="table"
                  tabIndex={-1}
                  onToggle={() =>
                    props.onToggleRelationSection(tableSectionKey)
                  }
                >
                  {t("connections.tables", { count: contents.tables.length })}
                </TreeSectionButton>
              </div>
            ),
          ));
          if (tablesOpen) {
            for (const table of contents.tables) {
              rows.push(row(tableRowKey(table), 1, () =>
                renderTable(table, relationLevel),
              ));
            }
          }
        }

        const viewSectionKey = databaseSectionKey(`${schemaKey}:view`);
        const viewsOpen =
          Boolean(normalizedFilter) ||
          !collapsedSections.has(`${connection.id}:${viewSectionKey}`);
        if (contents.views.length > 0) {
          rows.push(row(
            `${connection.database}:schema:${schemaKey}:section:view`,
            1,
            () => (
              <div role="treeitem" aria-level={sectionLevel}>
                <TreeSectionButton
                  expanded={viewsOpen}
                  icon="view"
                  tabIndex={-1}
                  onToggle={() =>
                    props.onToggleRelationSection(viewSectionKey)
                  }
                >
                  {t("connections.views", { count: contents.views.length })}
                </TreeSectionButton>
              </div>
            ),
          ));
          if (viewsOpen) {
            for (const view of contents.views) {
              rows.push(row(tableRowKey(view), 1, () =>
                renderTable(view, relationLevel),
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
          rows.push(row(
            `${connection.database}:schema:${schemaKey}:section:${section.kind}`,
            1,
            () => (
              <div role="treeitem" aria-level={sectionLevel}>
                <TreeSectionButton
                  expanded={expanded}
                  icon={section.icon}
                  tabIndex={-1}
                  onToggle={() =>
                    props.onToggleObjectSection(objectSectionKey)
                  }
                >
                  {t(section.label, { count: objects.length })}
                </TreeSectionButton>
              </div>
            ),
          ));
          if (expanded) {
            objects.forEach((object, index) => {
              rows.push(row(
                objectRowKey(object, index),
                1,
                () =>
                  renderObject(
                    object,
                    section.icon,
                    index,
                    relationLevel,
                    true,
                  ),
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
          () => renderMissingTable(table, schemaLevel),
        ));
      }
    }
    return rows;
  }

  function databaseDisplayName() {
    const value = connection.database.trim();
    if (!value) return connection.name || t("connections.database");
    if (connection.engine !== "sqlite") return value;
    const segments = value.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] ?? value;
  }

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
      <div className="tw:flex tw:flex-col tw:gap-px">
        <div
          data-database-root
          role="treeitem"
          aria-level={databaseLevel}
        >
          <TreeSectionButton
            expanded={databaseVisible}
            icon="database"
            tabIndex={-1}
            onToggle={toggleDatabase}
          >
            {databaseDisplayName()}
          </TreeSectionButton>
        </div>
        {databaseVisible ? (
          <div className="tw:flex tw:flex-col tw:gap-px tw:pl-3">
            {accessIssue ? (
              <div
                role="treeitem"
                aria-level={databaseChildLevel}
                tabIndex={-1}
                className="tw:grid tw:gap-1 tw:px-2 tw:py-2 tw:text-sm tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  if (accessIssue !== "credentials" || !props.onResolveAccess) {
                    return;
                  }
                  event.preventDefault();
                  props.onResolveAccess();
                }}
              >
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
                {accessIssue === "credentials" && props.onResolveAccess ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="tw:mt-1 tw:w-fit tw:cursor-pointer tw:rounded-xs tw:border tw:border-border-subtle tw:bg-card tw:px-2 tw:py-1 tw:font-sans tw:text-xs tw:text-foreground tw:hover:border-ring"
                    onClick={props.onResolveAccess}
                  >
                    {t("workspace.bindCredentialsShort")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {error ? (
              <div
                role="treeitem"
                aria-level={databaseChildLevel}
                tabIndex={-1}
                className="tw:flex tw:items-start tw:gap-2 tw:px-2 tw:py-1 tw:text-sm tw:text-danger tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  props.onRetryOverview();
                }}
              >
                <span className="tw:min-w-0 tw:flex-1 tw:wrap-break-word">
                  {error}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  className="tw:shrink-0 tw:cursor-pointer tw:rounded-xs tw:border tw:border-border-subtle tw:bg-card tw:px-1.5 tw:py-px tw:font-sans tw:text-2xs tw:text-foreground tw:hover:border-ring"
                  onClick={props.onRetryOverview}
                >
                  {t("common.refresh")}
                </button>
              </div>
            ) : null}
            {detailError ? (
              <div
                role="treeitem"
                aria-level={databaseChildLevel}
                tabIndex={-1}
                className="tw:flex tw:items-start tw:gap-2 tw:px-2 tw:py-1 tw:text-sm tw:text-muted-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  props.onRequestDetails();
                }}
              >
                <span className="tw:min-w-0 tw:flex-1 tw:wrap-break-word">
                  {detailError}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  className="tw:shrink-0 tw:cursor-pointer tw:rounded-xs tw:border tw:border-border-subtle tw:bg-card tw:px-1.5 tw:py-px tw:font-sans tw:text-2xs tw:text-foreground tw:hover:border-ring"
                  onClick={props.onRequestDetails}
                >
                  {t("common.refresh")}
                </button>
              </div>
            ) : null}
            {!catalog && !error && !accessIssue ? (
              <div className="tw:px-2 tw:py-1 tw:text-sm">
                <LoadingLabel>{t("connections.loadingSchema")}</LoadingLabel>
              </div>
            ) : null}
            {catalog &&
            ordered.length === 0 &&
            filteredObjects.length === 0 &&
            missingTables.length === 0 ? (
              <div className="tw:px-2 tw:py-1 tw:text-sm tw:text-muted-foreground">
                {normalizedFilter
                  ? t("connections.noTablesMatch", {
                      filter: normalizedFilter,
                    })
                  : t("connections.noObjects")}
              </div>
            ) : null}
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
