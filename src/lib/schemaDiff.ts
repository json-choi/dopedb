// Pure schema-group construction and catalog comparison. The diff model feeds both
// compact sidebar summaries and the full group comparison workspace, and matches the
// CLI/Agent `schema_diff` projection, scope and object order: relation identity is the
// (schema, name) pair, shown as `schema.table` and never including the database name,
// so `app_dev.public.orders` and `app_prod.public.orders` are one relation.
import type { Catalog, CatalogTable } from "../ipc/types";
import type { ConnectionProfile } from "../features/connections/domain";
import { tableKey } from "./tableRef";

const ENV_ORDER: Record<string, number> = {
  prod: 0,
  staging: 1,
  dev: 2,
};

export interface SchemaConnectionGroup {
  key: string;
  label: string;
  connections: ConnectionProfile[];
  /** The member's chosen comparison baseline; absent means the product default. */
  baselineId?: string;
}

export type ConnectionSection =
  | { kind: "group"; group: SchemaConnectionGroup }
  | { kind: "single"; connection: ConnectionProfile };

/**
 * What the comparison covers, in the exact order of the Rust `SchemaDiff.scope`. A
 * primary key compares column membership (not order); a foreign key compares each
 * column's referenced relation and column. Anything in `notCompared` can differ while
 * the comparison reports no difference.
 */
export const SCHEMA_DIFF_SCOPE = {
  compared: [
    "relationPresence",
    "relationKind",
    "columnPresence",
    "columnType",
    "columnNullability",
    "primaryKey",
    "indexPresence",
    "indexKeys",
    "indexUniqueness",
    "foreignKeyTargets",
  ],
  notCompared: [
    "columnOrder",
    "columnDefault",
    "generatedColumn",
    "identity",
    "collation",
    "checkConstraint",
    "uniqueConstraint",
    "indexMethod",
    "indexPredicate",
    "indexInclude",
    "indexSortOrder",
    "indexValidity",
    "foreignKeyAction",
    "foreignKeyDeferrable",
    "foreignKeyValidation",
    "viewDefinition",
    "partitioning",
    "comment",
    "trigger",
    "routine",
    "type",
    "sequence",
  ],
} as const;

export type SchemaDiffAspect =
  | (typeof SCHEMA_DIFF_SCOPE.compared)[number]
  | (typeof SCHEMA_DIFF_SCOPE.notCompared)[number];

export type SchemaDiffStatus = "added" | "missing" | "changed" | "same";
export type SchemaObjectType =
  | "table"
  | "view"
  | "materializedView"
  | "column"
  | "index"
  | "foreignKey";

export interface SchemaObjectDiff {
  id: string;
  /** Database-qualified Explorer lookup key of the side that owns the object. */
  tableKey: string;
  objectType: SchemaObjectType;
  /** Cross-environment relation identity: the (schema, name) pair, so a name that
   * contains a dot never matches or groups as another relation. */
  relationKey: string;
  /** Display path shared with the CLI `table` field: `schema.table`. */
  relation: string;
  /** The owning relation's kind: the target side's when present, else the baseline's. */
  relationType: RelationObjectType;
  /** `relation` for relation-level entries, otherwise `relation.object`. */
  path: string;
  label: string;
  status: Exclude<SchemaDiffStatus, "same">;
  baselineValue: string;
  targetValue: string;
}

type RelationObjectType = Extract<SchemaObjectType, "table" | "view" | "materializedView">;

export interface TableSchemaDiff {
  key: string;
  added: boolean;
  missing: boolean;
  relationChanged: boolean;
  addedColumns: string[];
  missingColumns: string[];
  changedColumns: string[];
  objectDiffs: SchemaObjectDiff[];
}

export interface SchemaDiffSummary {
  addedTables: CatalogTable[];
  missingTables: CatalogTable[];
  changedTables: CatalogTable[];
  addedColumns: number;
  missingColumns: number;
  changedColumns: number;
  relationChangedTables: number;
  total: number;
  tableDiffs: Record<string, TableSchemaDiff>;
  objects: SchemaObjectDiff[];
}

function schemaGroupLabel(conn: ConnectionProfile): string {
  return conn.schemaGroup?.trim() ?? "";
}

function schemaGroupKey(conn: ConnectionProfile): string | null {
  const label = schemaGroupLabel(conn);
  return label ? label.toLocaleLowerCase() : null;
}

export function buildConnectionSections(connections: ConnectionProfile[]): ConnectionSection[] {
  const groups = new Map<string, SchemaConnectionGroup & { firstIndex: number }>();

  connections.forEach((conn, index) => {
    const key = schemaGroupKey(conn);
    if (!key) return;
    const existing = groups.get(key);
    if (existing) {
      existing.connections.push(conn);
    } else {
      groups.set(key, {
        key,
        label: schemaGroupLabel(conn),
        connections: [conn],
        firstIndex: index,
      });
    }
  });

  const seenGroups = new Set<string>();
  const sections: Array<ConnectionSection & { index: number }> = [];
  connections.forEach((conn, index) => {
    const key = schemaGroupKey(conn);
    if (!key) {
      sections.push({ kind: "single", connection: conn, index });
      return;
    }
    if (seenGroups.has(key)) return;
    seenGroups.add(key);
    const group = groups.get(key);
    if (!group) return;
    const ordered = [...group.connections].sort(compareConnectionsInGroup);
    sections.push({
      kind: "group",
      group: { key: group.key, label: group.label, connections: ordered },
      index: group.firstIndex,
    });
  });

  return sections
    .sort((a, b) => a.index - b.index)
    .map(({ index: _index, ...section }) => section);
}

export function schemaGroupIsCompatible(group: SchemaConnectionGroup): boolean {
  const engine = group.connections[0]?.engine;
  return !!engine && group.connections.every((connection) => connection.engine === engine);
}

/** The chosen baseline when it is still a member, else production, else the first member. */
export function defaultSchemaBaseline(group: SchemaConnectionGroup): ConnectionProfile | null {
  return (
    group.connections.find((connection) => connection.id === group.baselineId) ??
    group.connections.find((connection) => connection.env === "prod") ??
    group.connections[0] ??
    null
  );
}

// Catalog projections are memoized per live snapshot, so identity is a safe cache key:
// group chips, row chips and the diff screen reuse one comparison per catalog pair.
const comparisons = new WeakMap<Catalog, WeakMap<Catalog, SchemaDiffSummary>>();

export function compareCatalogs(current: Catalog, baseline: Catalog): SchemaDiffSummary {
  let byBaseline = comparisons.get(current);
  const cached = byBaseline?.get(baseline);
  if (cached) return cached;
  const summary = computeCatalogDiff(current, baseline);
  if (!byBaseline) {
    byBaseline = new WeakMap();
    comparisons.set(current, byBaseline);
  }
  byBaseline.set(baseline, summary);
  return summary;
}

/**
 * Unicode code-point order, the order of Rust `str`, so Desktop lists objects exactly
 * like the CLI. Natural or locale order is not shared with Rust, and UTF-16 unit order
 * would misplace astral characters against U+E000–U+FFFF.
 */
function codePointOrder(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex) ?? 0;
    const rightPoint = right.codePointAt(rightIndex) ?? 0;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return Number(leftIndex < left.length) - Number(rightIndex < right.length);
}

const OBJECT_TYPE_ORDER: Record<SchemaObjectType, number> = {
  table: 0,
  view: 0,
  materializedView: 0,
  column: 1,
  index: 2,
  foreignKey: 3,
};

function computeCatalogDiff(current: Catalog, baseline: Catalog): SchemaDiffSummary {
  // A schema group intentionally compares equivalent databases from different
  // environments. Their database names commonly differ (`app_dev` vs
  // `app_prod`), so database cannot be part of the cross-catalog identity. Keep
  // the full tableKey for Explorer lookups below, but match relations by the
  // namespace and object name that are meaningful inside each database.
  const currentTables = new Map(
    current.tables.map((table) => [relationIdentity(table), table]),
  );
  const baselineTables = new Map(
    baseline.tables.map((table) => [relationIdentity(table), table]),
  );
  const addedTables: CatalogTable[] = [];
  const missingTables: CatalogTable[] = [];
  const changedTables: CatalogTable[] = [];
  const tableDiffs: Record<string, TableSchemaDiff> = {};
  // Each relation's objects stay together, ordered by the (schema, name) pair rather
  // than the dotted path, so names containing dots order like the CLI's tuples.
  const relations: Array<{ order: RelationOrder; objects: SchemaObjectDiff[] }> = [];
  let addedColumns = 0;
  let missingColumns = 0;
  let changedColumns = 0;
  let relationChangedTables = 0;

  for (const [comparisonKey, table] of currentTables) {
    const key = tableKey(table);
    const base = baselineTables.get(comparisonKey);
    if (!base) {
      addedTables.push(table);
      const object = tableObjectDiff(table, "added");
      const diff = emptyTableDiff(key, { added: true });
      diff.objectDiffs.push(object);
      tableDiffs[key] = diff;
      relations.push({ order: relationOrder(table), objects: [object] });
      continue;
    }

    const diff = diffTable(table, base);
    if (hasTableDiff(diff)) {
      tableDiffs[key] = diff;
      changedTables.push(table);
      relations.push({ order: relationOrder(table), objects: diff.objectDiffs });
      addedColumns += diff.addedColumns.length;
      missingColumns += diff.missingColumns.length;
      changedColumns += diff.changedColumns.length;
      if (diff.relationChanged) relationChangedTables += 1;
    }
  }

  for (const [comparisonKey, table] of baselineTables) {
    if (currentTables.has(comparisonKey)) continue;
    const key = tableKey(table);
    missingTables.push(table);
    const object = tableObjectDiff(table, "missing");
    const diff = emptyTableDiff(key, { missing: true });
    diff.objectDiffs.push(object);
    tableDiffs[key] = diff;
    relations.push({ order: relationOrder(table), objects: [object] });
  }

  // The CLI's order: relation (schema, name), then relation, column, index and
  // foreign-key entries by name. The sort is stable, so several entries for one
  // foreign-key column keep their additions-before-missing order.
  relations.sort((a, b) =>
    a.order[0] - b.order[0]
    || codePointOrder(a.order[1], b.order[1])
    || codePointOrder(a.order[2], b.order[2]),
  );
  const objects = relations.flatMap((relation) =>
    [...relation.objects].sort((a, b) =>
      OBJECT_TYPE_ORDER[a.objectType] - OBJECT_TYPE_ORDER[b.objectType]
      || codePointOrder(a.label, b.label),
    ),
  );

  return {
    addedTables,
    missingTables,
    changedTables,
    addedColumns,
    missingColumns,
    changedColumns,
    relationChangedTables,
    total: objects.length,
    tableDiffs,
    objects,
  };
}

/** Rust orders `(Option<schema>, name)`: a schema-less relation sorts first. */
type RelationOrder = readonly [hasSchema: number, schema: string, name: string];

/** The (schema, name) pair as one key; a schema-less relation stays distinct from "". */
function relationIdentity(table: CatalogTable): string {
  return JSON.stringify([table.schema ?? null, table.name]);
}

function relationOrder(table: CatalogTable): RelationOrder {
  return [table.schema == null ? 0 : 1, table.schema ?? "", table.name];
}

/** Display path shared with the CLI: `schema.table`, or `table` without a schema. */
function relationPath(table: CatalogTable): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name;
}

export function tableDiffTone(
  diff: TableSchemaDiff | undefined,
): "added" | "missing" | "changed" | "mixed" | null {
  if (!diff) return null;
  if (diff.added) return "added";
  if (diff.missing) return "missing";
  const hasAdd = diff.objectDiffs.some((object) => object.status === "added");
  const hasMissing = diff.objectDiffs.some((object) => object.status === "missing");
  const hasChange = diff.objectDiffs.some((object) => object.status === "changed");
  const kinds = [hasAdd, hasMissing, hasChange].filter(Boolean).length;
  if (kinds > 1) return "mixed";
  if (hasAdd) return "added";
  if (hasMissing) return "missing";
  if (hasChange) return "changed";
  return null;
}

export function diffCounts(diff: SchemaDiffSummary) {
  return {
    added: diff.objects.filter((object) => object.status === "added").length,
    missing: diff.objects.filter((object) => object.status === "missing").length,
    changed: diff.objects.filter((object) => object.status === "changed").length,
  };
}

export function orderTablesBySchemaDiff(
  tables: CatalogTable[],
  diff: SchemaDiffSummary | null,
): CatalogTable[] {
  if (!diff) return tables;
  return tables
    .map((table, index) => ({
      table,
      index,
      changed: tableDiffTone(diff.tableDiffs[tableKey(table)]) !== null,
    }))
    .sort((a, b) => Number(b.changed) - Number(a.changed) || a.index - b.index)
    .map(({ table }) => table);
}

function compareConnectionsInGroup(a: ConnectionProfile, b: ConnectionProfile) {
  const envA = ENV_ORDER[a.env ?? ""] ?? 9;
  const envB = ENV_ORDER[b.env ?? ""] ?? 9;
  if (envA !== envB) return envA - envB;
  return (a.name || a.database).localeCompare(b.name || b.database);
}

function emptyTableDiff(
  key: string,
  flags: Partial<Pick<TableSchemaDiff, "added" | "missing">> = {},
): TableSchemaDiff {
  return {
    key,
    added: flags.added ?? false,
    missing: flags.missing ?? false,
    relationChanged: false,
    addedColumns: [],
    missingColumns: [],
    changedColumns: [],
    objectDiffs: [],
  };
}

function relationObjectType(kind: string): RelationObjectType {
  if (kind === "view") return "view";
  if (kind === "materialized_view") return "materializedView";
  return "table";
}

function tableObjectDiff(
  table: CatalogTable,
  status: "added" | "missing",
): SchemaObjectDiff {
  const key = tableKey(table);
  const relation = relationPath(table);
  const relationKey = relationIdentity(table);
  return {
    id: `${relationKey}:${table.kind}`,
    tableKey: key,
    objectType: relationObjectType(table.kind),
    relationKey,
    relation,
    // Only one side has the relation: the target for an addition, else the baseline.
    relationType: relationObjectType(table.kind),
    path: relation,
    label: table.name,
    status,
    baselineValue: status === "missing" ? table.kind : "—",
    targetValue: status === "added" ? table.kind : "—",
  };
}

function diffTable(current: CatalogTable, baseline: CatalogTable): TableSchemaDiff {
  const key = tableKey(current);
  const relation = relationPath(current);
  const relationKey = relationIdentity(current);
  // `current` is the target side, which owns the relation kind every entry reports.
  const relationType = relationObjectType(current.kind);
  const diff = emptyTableDiff(key);
  const currentColumns = new Map(current.columns.map((column) => [column.name, column]));
  const baselineColumns = new Map(baseline.columns.map((column) => [column.name, column]));

  if (current.kind !== baseline.kind) {
    diff.objectDiffs.push({
      id: `${relationKey}:kind`,
      tableKey: key,
      objectType: relationType,
      relationKey,
      relation,
      relationType,
      path: relation,
      label: current.name,
      status: "changed",
      baselineValue: baseline.kind,
      targetValue: current.kind,
    });
  }

  const owner: DiffOwner = { tableKey: key, relationKey, relation, relationType };
  for (const [name, column] of currentColumns) {
    const base = baselineColumns.get(name);
    if (!base) {
      diff.addedColumns.push(name);
      diff.objectDiffs.push(objectDiff(owner, "column", name, "added", "—", columnValue(column)));
    } else if (columnSignature(column) !== columnSignature(base)) {
      diff.changedColumns.push(name);
      diff.objectDiffs.push(
        objectDiff(owner, "column", name, "changed", columnValue(base), columnValue(column)),
      );
    }
  }

  for (const [name, column] of baselineColumns) {
    if (currentColumns.has(name)) continue;
    diff.missingColumns.push(name);
    diff.objectDiffs.push(objectDiff(owner, "column", name, "missing", columnValue(column), "—"));
  }

  appendNamedObjectDiffs(
    diff.objectDiffs,
    owner,
    "index",
    new Map(current.indexes.map((index) => [index.name, indexValue(index)])),
    new Map(baseline.indexes.map((index) => [index.name, indexValue(index)])),
  );
  appendForeignKeyDiffs(diff.objectDiffs, owner, current.foreignKeys, baseline.foreignKeys);

  // Anything beyond the columns changed the relation itself: its kind (view → table),
  // an index or a foreign key. A kind-only change therefore never summarizes as ~0.
  diff.relationChanged = diff.objectDiffs.some((object) => object.objectType !== "column");
  return diff;
}

type DiffOwner = {
  tableKey: string;
  relationKey: string;
  relation: string;
  relationType: RelationObjectType;
};

function appendNamedObjectDiffs(
  objects: SchemaObjectDiff[],
  table: DiffOwner,
  objectType: "index" | "foreignKey",
  current: Map<string, string>,
  baseline: Map<string, string>,
) {
  for (const [name, value] of current) {
    const base = baseline.get(name);
    if (base == null) {
      objects.push(objectDiff(table, objectType, name, "added", "—", value));
    } else if (base !== value) {
      objects.push(objectDiff(table, objectType, name, "changed", base, value));
    }
  }
  for (const [name, value] of baseline) {
    if (!current.has(name)) {
      objects.push(objectDiff(table, objectType, name, "missing", value, "—"));
    }
  }
}

function appendForeignKeyDiffs(
  objects: SchemaObjectDiff[],
  table: DiffOwner,
  currentForeignKeys: CatalogTable["foreignKeys"],
  baselineForeignKeys: CatalogTable["foreignKeys"],
) {
  const current = groupForeignKeysByColumn(currentForeignKeys);
  const baseline = groupForeignKeysByColumn(baselineForeignKeys);
  const columns = new Set([...current.keys(), ...baseline.keys()]);

  for (const column of columns) {
    const currentValues = current.get(column) ?? [];
    const baselineValues = baseline.get(column) ?? [];
    if (
      currentValues.length === 1 &&
      baselineValues.length === 1 &&
      currentValues[0] !== baselineValues[0]
    ) {
      objects.push(
        foreignKeyObjectDiff(
          table,
          column,
          "changed",
          baselineValues[0],
          currentValues[0],
          "changed",
        ),
      );
      continue;
    }

    const added = unmatchedValues(currentValues, baselineValues);
    const missing = unmatchedValues(baselineValues, currentValues);
    added.forEach((value, index) => {
      objects.push(
        foreignKeyObjectDiff(table, column, "added", "—", value, `added:${index}:${value}`),
      );
    });
    missing.forEach((value, index) => {
      objects.push(
        foreignKeyObjectDiff(table, column, "missing", value, "—", `missing:${index}:${value}`),
      );
    });
  }
}

function groupForeignKeysByColumn(
  foreignKeys: CatalogTable["foreignKeys"],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const foreignKey of foreignKeys) {
    const values = grouped.get(foreignKey.column) ?? [];
    values.push(foreignKeyValue(foreignKey));
    grouped.set(foreignKey.column, values);
  }
  for (const values of grouped.values()) values.sort(codePointOrder);
  return grouped;
}

function unmatchedValues(source: string[], comparison: string[]): string[] {
  const remaining = [...comparison];
  return source.filter((value) => {
    const match = remaining.indexOf(value);
    if (match < 0) return true;
    remaining.splice(match, 1);
    return false;
  });
}

function foreignKeyObjectDiff(
  table: DiffOwner,
  column: string,
  status: "added" | "missing" | "changed",
  baselineValue: string,
  targetValue: string,
  identity: string,
): SchemaObjectDiff {
  return {
    id: `${table.relationKey}:foreignKey:${column}:${identity}`,
    tableKey: table.tableKey,
    objectType: "foreignKey",
    relationKey: table.relationKey,
    relation: table.relation,
    relationType: table.relationType,
    path: `${table.relation}.${column}`,
    label: column,
    status,
    baselineValue,
    targetValue,
  };
}

function objectDiff(
  table: DiffOwner,
  objectType: "column" | "index" | "foreignKey",
  name: string,
  status: "added" | "missing" | "changed",
  baselineValue: string,
  targetValue: string,
): SchemaObjectDiff {
  return {
    id: `${table.relationKey}:${objectType}:${name}`,
    tableKey: table.tableKey,
    objectType,
    relationKey: table.relationKey,
    relation: table.relation,
    relationType: table.relationType,
    path: `${table.relation}.${name}`,
    label: name,
    status,
    baselineValue,
    targetValue,
  };
}

function hasTableDiff(diff: TableSchemaDiff): boolean {
  return diff.added || diff.missing || diff.objectDiffs.length > 0;
}

/**
 * Type spelling ignores outer whitespace and letter case, except inside quoted text:
 * MySQL `ENUM`/`SET` members and quoted identifiers are case-sensitive, so
 * `enum('A','b')` and `enum('a','B')` differ. A doubled quote stays quoted. Each
 * character is lowered on its own (locale-independent), exactly like the Rust engine.
 */
function typeSignature(dataType: string): string {
  let signature = "";
  let quote: string | null = null;
  for (const character of dataType.trim()) {
    if (quote !== null) {
      if (character === quote) quote = null;
      signature += character;
    } else if (character === "'" || character === "\"") {
      quote = character;
      signature += character;
    } else {
      signature += character.toLowerCase();
    }
  }
  return signature;
}

function columnSignature(column: CatalogTable["columns"][number]): string {
  return [
    typeSignature(column.dataType),
    column.nullable ? "null" : "not-null",
    column.pk ? "pk" : "no-pk",
  ].join("|");
}

function columnValue(column: CatalogTable["columns"][number]): string {
  return [column.dataType, column.nullable ? "NULL" : "NOT NULL", column.pk ? "PK" : ""]
    .filter(Boolean)
    .join(" · ");
}

function indexValue(index: CatalogTable["indexes"][number]): string {
  return `${index.unique ? "UNIQUE " : ""}(${index.columns.join(", ")})`;
}

function foreignKeyValue(foreignKey: CatalogTable["foreignKeys"][number]): string {
  const schema = foreignKey.referencesSchema ? `${foreignKey.referencesSchema}.` : "";
  return `${foreignKey.column} → ${schema}${foreignKey.referencesTable}.${foreignKey.referencesColumn}`;
}
