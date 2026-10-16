// Presentational rows for the catalog tree. Virtualization keys and expansion
// policy stay in CatalogTree; these components only render one bounded row, and a
// relation's metadata groups and items are separate rows so each is a tree item.
import type {
  CatalogColumn,
  CatalogConstraint,
  CatalogIndex,
  CatalogObject,
  CatalogTable,
} from "../../ipc/types";
import type { ConnectionProfile } from "../../features/connections/domain";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { TreeSectionButton } from "../../design-system/components/TreeControls";
import { LoadingLabel } from "../../design-system/components/Status";
import { isDocumentEngine } from "../../lib/capabilities";
import { useI18n, type I18nKey } from "../../lib/i18n";
import { tableDiffTone, type TableSchemaDiff } from "../../lib/schemaDiff";
import { tableKey, tableLabel } from "../../lib/tableRef";
import {
  catalogObjectLabel,
  compareCatalogNames,
} from "../../features/catalogExplorer/catalogDomain";
import { isCatalogSearchResultActive } from "../../features/catalogExplorer/state";
import { schemaTableDiffTitle } from "./schemaDiffPresentation";

interface CatalogRelationRowProps {
  connection: ConnectionProfile;
  table: CatalogTable;
  tableDiff?: TableSchemaDiff;
  fullCatalogLoaded: boolean;
  detailsOpen: boolean;
  searchResultKey?: string;
  activeSearchResultKey?: string;
  selected: boolean;
  showRowCounts: boolean;
  onToggleDetails: () => void;
  onOpen: () => void;
}

export type CatalogMetadataSection = "columns" | "keys" | "indexes";

const KEY_KIND_ORDER: Record<CatalogConstraint["kind"], number> = {
  primary: 0,
  unique: 1,
  foreign: 2,
  check: 3,
};

const KEY_KIND_LABELS: Record<CatalogConstraint["kind"], I18nKey> = {
  primary: "schema.keyPrimary",
  unique: "schema.keyUnique",
  foreign: "schema.keyForeign",
  check: "schema.keyCheck",
};

/** Every key in one order: primary, unique, foreign (with target), then check. */
export function catalogTableKeys(table: CatalogTable): CatalogConstraint[] {
  return [...table.constraints].sort(
    (left, right) =>
      KEY_KIND_ORDER[left.kind] - KEY_KIND_ORDER[right.kind]
      || compareCatalogNames(left.name, right.name),
  );
}

/** The metadata sections a loaded relation shows, in tree order, with item counts. */
export function catalogMetadataSections(table: CatalogTable) {
  return [
    { section: "columns", count: table.columns.length },
    { section: "keys", count: table.constraints.length },
    { section: "indexes", count: table.indexes.length },
  ] as const satisfies ReadonlyArray<{
    section: CatalogMetadataSection;
    count: number;
  }>;
}

function keyDefinition(constraint: CatalogConstraint) {
  const columns = `(${constraint.columns.join(", ")})`;
  if (constraint.kind === "check") return constraint.checkExpression ?? columns;
  if (constraint.kind !== "foreign" || !constraint.referencedRelation) {
    return columns;
  }
  const target = [
    constraint.referencedRelation.namespace,
    constraint.referencedRelation.name,
  ]
    .filter(Boolean)
    .join(".");
  return `${columns} → ${target}(${constraint.referencedColumns.join(", ")})`;
}

function indexDefinition(index: CatalogIndex) {
  const keys = index.keys.length > 0
    ? index.keys.map((key) => key.column ?? key.expression).filter(Boolean)
    : index.columns;
  return `(${keys.join(", ")})`;
}

// SQL clauses the compact definition leaves out. Tooltips and screen readers carry
// them, since a row only paints the name and key list.
function definitionClauses(clauses: ReadonlyArray<string | null | undefined | false>) {
  return clauses.filter((clause): clause is string => Boolean(clause)).join(" ");
}

function indexClauses(index: CatalogIndex) {
  return definitionClauses([
    index.method && `USING ${index.method}`,
    index.includedColumns.length > 0
      && `INCLUDE (${index.includedColumns.join(", ")})`,
    index.predicate && `WHERE ${index.predicate}`,
  ]);
}

function foreignKeyClauses(constraint: CatalogConstraint) {
  return constraint.kind === "foreign"
    ? definitionClauses([
        constraint.deleteAction && `ON DELETE ${constraint.deleteAction}`,
        constraint.updateAction && `ON UPDATE ${constraint.updateAction}`,
      ])
    : "";
}

const METADATA_SECTION_PRESENTATION = {
  columns: { icon: "columns", label: "connections.columns" },
  keys: { icon: "key", label: "connections.keys" },
  indexes: { icon: "list", label: "connections.indexes" },
} as const satisfies Record<
  CatalogMetadataSection,
  { icon: IconName; label: I18nKey }
>;

/** A relation's Columns/Keys/Indexes group, rendered inside its own tree item. */
export function CatalogMetadataSectionRow({
  section,
  count,
  expanded,
  onToggle,
}: {
  section: CatalogMetadataSection;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const presentation = METADATA_SECTION_PRESENTATION[section];
  return (
    <div className="tw:pl-3">
      <TreeSectionButton
        expanded={expanded}
        icon={presentation.icon}
        treeItemContent
        onToggle={onToggle}
      >
        {t(presentation.label, { count })}
      </TreeSectionButton>
    </div>
  );
}

type MetadataRow = {
  key: string;
  treeItem: { key: string; parentKey: string; level: number; expanded?: boolean };
  render: () => ReactNode;
};

/**
 * A relation's expanded metadata as separate tree items: one group row per non-empty
 * section and one row per column, key or index, so keyboard users reach each item.
 */
export function catalogMetadataRows({
  table,
  relationRowKey,
  relationTreeKey,
  level,
  loaded,
  isCollapsed,
  onToggle,
}: {
  table: CatalogTable;
  relationRowKey: string;
  relationTreeKey: string;
  level: number;
  loaded: boolean;
  isCollapsed: (section: CatalogMetadataSection) => boolean;
  onToggle: (section: CatalogMetadataSection) => void;
}): MetadataRow[] {
  const sections = loaded
    ? catalogMetadataSections(table).filter((entry) => entry.count > 0)
    : [];
  if (sections.length === 0) {
    return [{
      key: `${relationRowKey}:metadata:status`,
      treeItem: {
        key: `${relationTreeKey}:metadata:status`,
        parentKey: relationTreeKey,
        level: level + 1,
      },
      render: () => <CatalogMetadataStatusRow loading={!loaded} />,
    }];
  }
  const rows: MetadataRow[] = [];
  for (const { section, count } of sections) {
    const sectionTreeKey = `${relationTreeKey}:metadata:${section}`;
    const expanded = !isCollapsed(section);
    rows.push({
      key: `${relationRowKey}:metadata:${section}`,
      treeItem: {
        key: sectionTreeKey,
        parentKey: relationTreeKey,
        level: level + 1,
        expanded,
      },
      render: () => (
        <CatalogMetadataSectionRow
          section={section}
          count={count}
          expanded={expanded}
          onToggle={() => onToggle(section)}
        />
      ),
    });
    if (!expanded) continue;
    const item = (itemKey: string, render: () => ReactNode) => rows.push({
      key: `${relationRowKey}:metadata:${section}:${itemKey}`,
      treeItem: {
        key: `${sectionTreeKey}:${itemKey}`,
        parentKey: sectionTreeKey,
        level: level + 2,
      },
      render,
    });
    if (section === "columns") {
      for (const column of table.columns) {
        item(`${column.ordinal}:${column.name}`, () => (
          <CatalogColumnRow column={column} />
        ));
      }
    } else if (section === "keys") {
      catalogTableKeys(table).forEach((constraint, index) => {
        item(`${index}:${constraint.name}`, () => (
          <CatalogKeyRow constraint={constraint} />
        ));
      });
    } else {
      for (const index of table.indexes) {
        item(index.name, () => <CatalogIndexRow index={index} />);
      }
    }
  }
  return rows;
}

/** Loading or empty metadata state, announced inside the relation's subtree. */
export function CatalogMetadataStatusRow({ loading }: { loading: boolean }) {
  const { t } = useI18n();
  return (
    <div className="tw:pl-5 tw:text-xs tw:text-muted-foreground">
      {loading ? (
        <LoadingLabel>{t("connections.loadingMetadata")}</LoadingLabel>
      ) : (
        t("connections.noMetadata")
      )}
    </div>
  );
}

export function CatalogColumnRow({ column }: { column: CatalogColumn }) {
  const { t } = useI18n();
  const description = [
    column.dataType,
    column.nullable ? t("connections.nullable") : t("connections.notNull"),
    column.generatedExpression
      ? `${t("schema.generatedValue")}: ${column.generatedExpression}`
      : column.defaultExpression
        ? `${t("connections.defaultValue")}: ${column.defaultExpression}`
        : null,
  ].filter(Boolean).join(" · ");
  return (
    <div
      className="ds-object-row tw:cursor-default tw:pl-7 tw:text-ui"
      title={description}
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
      <span className="tw:sr-only">{description}</span>
    </div>
  );
}

export function CatalogKeyRow({ constraint }: { constraint: CatalogConstraint }) {
  const { t } = useI18n();
  const kind = t(KEY_KIND_LABELS[constraint.kind]);
  const definition = keyDefinition(constraint);
  const clauses = foreignKeyClauses(constraint);
  return (
    <div
      className="ds-object-row tw:cursor-default tw:pl-7 tw:text-ui"
      title={definitionClauses([`${kind} ${constraint.name} ${definition}`, clauses])}
    >
      <Icon
        className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground"
        name="key"
      />
      <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
        {constraint.name}{" "}
        <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
          {definition}
        </span>
        {clauses ? <span className="tw:sr-only"> {clauses}</span> : null}
      </span>
      <span className="tw:shrink-0 tw:text-2xs tw:text-muted-foreground">
        {kind}
      </span>
    </div>
  );
}

export function CatalogIndexRow({ index }: { index: CatalogIndex }) {
  const { t } = useI18n();
  const definition = indexDefinition(index);
  const clauses = indexClauses(index);
  return (
    <div
      className="ds-object-row tw:cursor-default tw:pl-7 tw:text-ui"
      title={definitionClauses([`${index.name} ${definition}`, clauses])}
    >
      <Icon
        className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground"
        name="list"
      />
      <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
        {index.name}{" "}
        <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
          {definition}
        </span>
        {clauses ? <span className="tw:sr-only"> {clauses}</span> : null}
      </span>
      {index.unique ? (
        <span className="tw:shrink-0 tw:text-2xs tw:text-muted-foreground">
          {t("connections.unique")}
        </span>
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
  searchResultKey,
  activeSearchResultKey,
  selected,
  showRowCounts,
  onToggleDetails,
  onOpen,
}: CatalogRelationRowProps) {
  const { t } = useI18n();
  const key = tableKey(table);
  const tone = tableDiffTone(tableDiff);
  const diffDescription = tableDiff ? schemaTableDiffTitle(t, tableDiff) : null;
  return (
    <div className="tw:flex tw:flex-col tw:gap-px">
      <div
        className="ds-object-row tw:group tw:relative tw:select-none tw:text-ui tw:data-[search-active=true]:bg-selection tw:data-[search-active=true]:text-selection-foreground"
        data-table-key={key}
        data-explorer-search-result={searchResultKey}
        data-search-active={
          isCatalogSearchResultActive(searchResultKey, activeSearchResultKey)
            || undefined
        }
        data-diff={tone ?? "none"}
        aria-selected={selected}
        title={
          diffDescription
            ?? (fullCatalogLoaded
              ? t("connections.columns", { count: table.columns.length })
              : undefined)
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
          title={diffDescription ?? undefined}
          aria-hidden="true"
        />
        <Icon
          className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground tw:group-hover:text-current"
          name={relationIcon(connection, table)}
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
        {/* The colored diff dot is decorative; keep the state in the item's name. */}
        {diffDescription ? (
          <span className="tw:sr-only">{diffDescription}</span>
        ) : null}
      </div>
    </div>
  );
}

function relationIcon(
  connection: ConnectionProfile,
  table: CatalogTable,
): IconName {
  if (isDocumentEngine(connection.engine)) return "collection";
  if (table.kind === "view") return "view";
  if (table.kind === "materialized_view") return "materializedView";
  return "table";
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
      className="ds-object-row tw:cursor-default tw:text-muted-foreground"
      title={t("connections.schemaDiffTableMissing")}
    >
      <span className="tw:size-[7px] tw:shrink-0 tw:rounded-full tw:bg-danger" aria-hidden="true" />
      <Icon
        className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground"
        name={relationIcon(connection, table)}
      />
      <span className="tbl-name tw:min-w-[10ch] tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
        {tableLabel(connection.engine, table)}
      </span>
      <span className="tw:shrink-0 tw:text-2xs tw:font-bold tw:text-muted-foreground">
        {t(
          table.kind === "view"
            ? "schemaDiff.objectView"
            : table.kind === "materialized_view"
              ? "schemaDiff.objectMaterializedView"
              : "schemaDiff.objectTable",
        )}
      </span>
      <span className="tw:shrink-0 tw:text-2xs tw:font-bold tw:text-danger">
        {t("schemaDiff.onlyInBaseline")}
      </span>
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
      className="ds-object-row tw:cursor-default tw:text-ui tw:data-[search-active=true]:bg-selection tw:data-[search-active=true]:text-selection-foreground"
      data-explorer-search-result={searchResultKey}
      data-search-active={
        isCatalogSearchResultActive(searchResultKey, activeSearchResultKey)
          || undefined
      }
      title={[
        catalogObjectLabel(object),
        object.parent ? `${t("connections.objectOn")} ${object.parent}` : null,
        object.detail && (object.kind === "trigger" || object.kind === "type")
          ? object.detail
          : null,
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
