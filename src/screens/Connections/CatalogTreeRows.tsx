// Presentational rows for the catalog tree. Virtualization keys and expansion
// policy stay in CatalogTree; these components only render one bounded row.
import type {
  CatalogConstraint,
  CatalogForeignKey,
  CatalogIndex,
  CatalogObject,
  CatalogTable,
} from "../../ipc/types";
import type { ConnectionProfile } from "../../features/connections/domain";
import { Icon } from "../../components/Icon";
import { TreeSectionButton } from "../../design-system/components/TreeControls";
import { LoadingLabel } from "../../design-system/components/Status";
import { isDocumentEngine } from "../../lib/capabilities";
import { useI18n } from "../../lib/i18n";
import { tableDiffTone, type TableSchemaDiff } from "../../lib/schemaDiff";
import { tableKey, tableLabel } from "../../lib/tableRef";
import { catalogObjectLabel } from "../../features/catalogExplorer/catalogDomain";
import { isCatalogSearchResultActive } from "../../features/catalogExplorer/state";
import { schemaTableDiffTitle } from "./schemaDiffPresentation";

interface CatalogRelationRowProps {
  connection: ConnectionProfile;
  table: CatalogTable;
  tableDiff?: TableSchemaDiff;
  fullCatalogLoaded: boolean;
  detailsOpen: boolean;
  collapsedMetadataSections: ReadonlySet<string>;
  searchResultKey?: string;
  activeSearchResultKey?: string;
  selected: boolean;
  showRowCounts: boolean;
  onToggleDetails: () => void;
  onToggleMetadataSection: (section: string) => void;
  onOpen: () => void;
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

function indexLabel(index: CatalogIndex) {
  const columns = index.keys.length > 0
    ? index.keys.map((key) => key.column ?? key.expression).filter(Boolean)
    : index.columns;
  return `${index.name} (${columns.join(", ")})`;
}

function CatalogTableDetails({
  table,
  fullCatalogLoaded,
  collapsedSections,
  onToggleSection,
}: {
  table: CatalogTable;
  fullCatalogLoaded: boolean;
  collapsedSections: ReadonlySet<string>;
  onToggleSection: (section: string) => void;
}) {
  const { t } = useI18n();
  if (!fullCatalogLoaded) {
    return (
      <div className="tw:pl-5 tw:text-xs tw:text-muted-foreground">
        <LoadingLabel>{t("connections.loadingMetadata")}</LoadingLabel>
      </div>
    );
  }

  const metadata = {
    columns: table.columns.map((column) => (
      <div
        className="ds-object-row tw:cursor-default tw:gap-1 tw:rounded-xs tw:pl-4 tw:text-ui"
        key={`${tableKey(table)}:column:${column.ordinal}:${column.name}`}
        title={[
          column.dataType,
          column.nullable ? t("connections.nullable") : t("connections.notNull"),
          column.defaultExpression
            ? `${t("connections.defaultValue")}: ${column.defaultExpression}`
            : null,
        ].filter(Boolean).join(" · ")}
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
    )),
    keys: (table.constraints.length > 0
      ? table.constraints
      : table.foreignKeys).map((constraint, index) => (
      <div
        className="ds-object-row tw:cursor-default tw:gap-1 tw:rounded-xs tw:pl-4 tw:text-ui"
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
        {"kind" in constraint ? (
          <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
            {constraint.kind}
          </span>
        ) : null}
      </div>
    )),
    indexes: table.indexes.map((index) => (
      <div
        className="ds-object-row tw:cursor-default tw:gap-1 tw:rounded-xs tw:pl-4 tw:text-ui"
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
        {index.unique ? (
          <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
            {t("connections.unique")}
          </span>
        ) : null}
      </div>
    )),
  };
  const sections = [
    ["columns", table.columns.length, "columns", "connections.columns"],
    [
      "keys",
      table.constraints.length || table.foreignKeys.length,
      "key",
      "connections.keys",
    ],
    ["indexes", table.indexes.length, "list", "connections.indexes"],
  ] as const;
  const itemCount = sections.reduce((total, section) => total + section[1], 0);

  return (
    <div className="tw:flex tw:flex-col tw:gap-px tw:pl-3">
      {sections.map(([section, count, icon, label]) => {
        if (count === 0) return null;
        const key = `${tableKey(table)}:${section}`;
        const expanded = !collapsedSections.has(key);
        return (
          <div className="tw:flex tw:flex-col tw:gap-px" key={key}>
            <TreeSectionButton
              expanded={expanded}
              icon={icon}
              treeItemContent
              onToggle={() => onToggleSection(section)}
            >
              {t(label, { count })}
            </TreeSectionButton>
            {expanded ? metadata[section] : null}
          </div>
        );
      })}
      {itemCount === 0 ? (
        <div className="tw:pl-5 tw:text-xs tw:text-muted-foreground">
          {t("connections.noMetadata")}
        </div>
      ) : null}
    </div>
  );
}

export function CatalogRelationRow({
  connection,
  table,
  tableDiff,
  fullCatalogLoaded,
  detailsOpen,
  collapsedMetadataSections,
  searchResultKey,
  activeSearchResultKey,
  selected,
  showRowCounts,
  onToggleDetails,
  onToggleMetadataSection,
  onOpen,
}: CatalogRelationRowProps) {
  const { t } = useI18n();
  const key = tableKey(table);
  const tone = tableDiffTone(tableDiff);
  return (
    <div className="tw:flex tw:flex-col tw:gap-px">
      <div
        className="ds-object-row tw:group tw:relative tw:gap-1 tw:rounded-xs tw:select-none tw:text-ui tw:data-[search-active=true]:bg-selection tw:data-[search-active=true]:text-selection-foreground"
        data-table-key={key}
        data-explorer-search-result={searchResultKey}
        data-search-active={
          isCatalogSearchResultActive(searchResultKey, activeSearchResultKey)
            || undefined
        }
        data-diff={tone ?? "none"}
        aria-selected={selected}
        title={
          tableDiff
            ? schemaTableDiffTitle(t, tableDiff)
            : fullCatalogLoaded
              ? t("connections.columns", { count: table.columns.length })
              : undefined
        }
      >
        {!isDocumentEngine(connection.engine) ? (
          <button
            type="button"
            className="tw:grid tw:size-3 tw:shrink-0 tw:cursor-pointer tw:place-items-center tw:rounded-xs tw:border-0 tw:bg-transparent tw:p-0 tw:text-2xs tw:text-muted-foreground tw:hover:text-foreground"
            aria-expanded={detailsOpen}
            data-tree-expander
            tabIndex={-1}
            aria-label={t(
              detailsOpen
                ? "connections.collapseMetadata"
                : "connections.expandMetadata",
              { table: table.name },
            )}
            onClick={onToggleDetails}
          >
            <Icon name={detailsOpen ? "chevronDown" : "chevronRight"} />
          </button>
        ) : null}
        <span
          data-diff={tone ?? "none"}
          className="tw:size-[7px] tw:shrink-0 tw:rounded-full tw:bg-transparent tw:data-[diff=added]:bg-success tw:data-[diff=missing]:bg-danger tw:data-[diff=changed]:bg-warning tw:data-[diff=mixed]:border tw:data-[diff=mixed]:border-danger tw:data-[diff=mixed]:bg-warning"
          title={tableDiff ? schemaTableDiffTitle(t, tableDiff) : undefined}
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
          data-tree-primary-action
          tabIndex={-1}
          onClick={onOpen}
        >
          {table.schema ? table.name : tableLabel(connection.engine, table)}
        </button>
        {showRowCounts && table.rowEstimate != null && table.rowEstimate >= 0 ? (
          <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-xs tw:text-muted-foreground tw:opacity-60 tw:[font-variant-numeric:tabular-nums] tw:group-hover:opacity-100">
            ~{table.rowEstimate.toLocaleString()}
          </span>
        ) : null}
      </div>
      {detailsOpen ? (
        <CatalogTableDetails
          table={table}
          fullCatalogLoaded={fullCatalogLoaded}
          collapsedSections={collapsedMetadataSections}
          onToggleSection={onToggleMetadataSection}
        />
      ) : null}
    </div>
  );
}

export function CatalogMissingRelationRow({
  connection,
  table,
}: {
  connection: ConnectionProfile;
  table: CatalogTable;
}) {
  const { t } = useI18n();
  return (
    <div
      className="ds-object-row tw:cursor-default tw:gap-1 tw:rounded-xs tw:text-muted-foreground"
      title={t("connections.schemaDiffTableMissing")}
    >
      <span className="tw:size-[7px] tw:shrink-0 tw:rounded-full tw:bg-danger" aria-hidden="true" />
      <Icon
        className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground"
        name={table.kind === "view" ? "view" : "table"}
      />
      <span className="tbl-name tw:min-w-[10ch] tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
        {tableLabel(connection.engine, table)}
      </span>
      <span className="tw:shrink-0 tw:text-2xs tw:font-bold tw:tracking-[0.04em] tw:text-muted-foreground tw:uppercase">
        {t(table.kind === "view" ? "schemaDiff.objectView" : "schemaDiff.objectTable")}
      </span>
      <span className="tw:shrink-0 tw:text-2xs tw:font-bold tw:text-danger">base</span>
    </div>
  );
}

export function CatalogObjectRow({
  object,
  icon,
  insideSchema,
  searchResultKey,
  activeSearchResultKey,
}: {
  object: CatalogObject;
  icon: Parameters<typeof Icon>[0]["name"];
  insideSchema: boolean;
  searchResultKey?: string;
  activeSearchResultKey?: string;
}) {
  const { t } = useI18n();
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
      className="ds-object-row tw:cursor-default tw:gap-1 tw:rounded-xs tw:text-ui tw:data-[search-active=true]:bg-selection tw:data-[search-active=true]:text-selection-foreground"
      data-explorer-search-result={searchResultKey}
      data-search-active={
        isCatalogSearchResultActive(searchResultKey, activeSearchResultKey)
          || undefined
      }
      title={[
        catalogObjectLabel(object),
        object.parent ? `${t("connections.objectOn")} ${object.parent}` : null,
        object.detail && object.kind === "trigger" ? object.detail : null,
      ].filter(Boolean).join(" · ")}
    >
      <Icon
        className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground"
        name={icon}
      />
      <span className="tbl-name tw:min-w-[10ch] tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
        {label}
      </span>
      {object.parent ? (
        <span className="tw:max-w-[42%] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-xs tw:text-muted-foreground">
          {t("connections.objectOn")} {object.parent}
        </span>
      ) : null}
    </div>
  );
}
