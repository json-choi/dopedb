// Loads native catalog metadata and projects snapshots into the catalog shapes used by the UI.
// Desktop reads every catalog live through one command; the projection is memoized per
// snapshot object so every cached view of the same snapshot shares one Catalog.

import { invoke } from "../../ipc/core";
import type {
  Catalog,
  CatalogObject,
  CatalogObjectRef,
  CatalogOverview,
  CatalogOverviewRelation,
  CatalogSnapshot,
  CatalogTable,
  DatabaseSummary,
} from "../../ipc/types";

function objectKind(kind: CatalogSnapshot["relations"][number]["object"]["kind"]) {
  return kind === "routine" ? "function" : kind;
}

function tableFromSnapshot(
  relation: CatalogSnapshot["relations"][number],
  database: string,
): CatalogTable {
  const primaryColumns = new Set(
    relation.constraints
      .filter((constraint) => constraint.kind === "primary")
      .flatMap((constraint) => constraint.columns),
  );
  return {
    database,
    schema: relation.object.namespace ?? null,
    name: relation.object.name,
    kind: objectKind(relation.object.kind),
    nativeId: relation.object.nativeId ?? null,
    comment: relation.comment ?? null,
    partitionParent: relation.partitionParent ?? null,
    partitionChildren: relation.partitionChildren,
    columns: relation.columns.map((column) => ({
      name: column.name,
      dataType: column.nativeType,
      nullable: column.nullable,
      pk: primaryColumns.has(column.name),
      ordinal: column.ordinal,
      length: column.length ?? null,
      precision: column.precision ?? null,
      scale: column.scale ?? null,
      defaultExpression: column.defaultExpression ?? null,
      generatedExpression: column.generatedExpression ?? null,
      identity: column.identity,
      autoIncrement: column.autoIncrement,
      collation: column.collation ?? null,
      comment: column.comment ?? null,
    })),
    foreignKeys: relation.constraints
      .filter(
        (constraint) =>
          constraint.kind === "foreign" && constraint.referencedRelation,
      )
      .flatMap((constraint) =>
        constraint.columns.map((column, index) => ({
          name: constraint.name,
          ordinal: index + 1,
          column,
          referencesTable: constraint.referencedRelation!.name,
          referencesColumn: constraint.referencedColumns[index] ?? "",
          referencesSchema:
            constraint.referencedRelation!.namespace ?? null,
          updateAction: constraint.updateAction ?? null,
          deleteAction: constraint.deleteAction ?? null,
          deferrable: constraint.deferrable,
          validated: constraint.validated,
        })),
      ),
    // Every key constraint in catalog order; the primary key keeps its key order.
    constraints: relation.constraints,
    indexes: relation.indexes.map((index) => ({
      name: index.name,
      // Expression keys stay in key order so `(lower(email), qty)` never reads as `(qty)`.
      columns: index.keys.flatMap((key) => {
        const part = key.column ?? key.expression;
        return part === undefined || part === null ? [] : [part];
      }),
      unique: index.unique,
      method: index.method ?? null,
      keys: index.keys,
      includedColumns: index.includedColumns,
      predicate: index.predicate ?? null,
      valid: index.valid,
    })),
    rowEstimate: relation.rowEstimate ?? null,
  };
}

function routineFromSnapshot(
  routine: CatalogSnapshot["routines"][number],
): CatalogObject {
  return {
    schema: routine.object.namespace ?? null,
    name: routine.object.name,
    kind: routine.nativeKind ?? "function",
    nativeId: routine.object.nativeId ?? null,
    detail:
      routine.detail
      ?? (routine.arguments.length > 0 ? routine.arguments.join(", ") : null),
    parent: routine.parent ?? null,
    arguments: routine.arguments,
    returnType: routine.returnType ?? null,
    language: routine.language ?? null,
    comment: routine.comment ?? null,
  };
}

function objectFromSnapshot(
  object: CatalogSnapshot["otherObjects"][number],
): CatalogObject {
  return {
    schema: object.object.namespace ?? null,
    name: object.object.name,
    kind: object.nativeKind ?? objectKind(object.object.kind),
    nativeId: object.object.nativeId ?? null,
    detail: object.detail ?? object.comment ?? null,
    parent: object.parent ?? null,
    arguments: [],
    returnType: null,
    language: null,
    comment: object.comment ?? null,
  };
}

const catalogsBySnapshot = new WeakMap<CatalogSnapshot, Catalog>();
// Snapshots read from the persisted cache are shown only while a live read runs.
// Marking them lets surfaces label their capture time or refuse them (row editing).
const persistedSnapshots = new WeakSet<object>();

/**
 * A `Catalog` projected from a persisted snapshot carries its capture time as data.
 * Structural sharing (query data, `select`, `useQueries` combine) keeps the previous
 * object whenever the next value is deep-equal, so an identity marker would outlive
 * the live read of an unchanged schema; a data field leaves with the persisted value.
 */
type PersistedCatalog = Catalog & { readonly persistedCapturedAt: string };

export function markPersistedSnapshot(snapshot: CatalogSnapshot) {
  persistedSnapshots.add(snapshot);
}

/** Whether `value` is itself a persisted snapshot; any other value is not. */
export function isPersistedSnapshot(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && persistedSnapshots.has(value);
}

/** Capture time of a `Catalog` projected from a persisted snapshot, else `null`. */
export function persistedCatalogCapturedAt(catalog: Catalog): string | null {
  return (catalog as Partial<PersistedCatalog>).persistedCapturedAt ?? null;
}

/** Whether a cached value is a persisted seed: the snapshot or its `Catalog` projection. */
export function isPersistedCatalogValue(value: unknown): boolean {
  return isPersistedSnapshot(value)
    || (typeof value === "object"
      && value !== null
      && typeof (value as Partial<PersistedCatalog>).persistedCapturedAt === "string");
}

export function catalogFromSnapshot(snapshot: CatalogSnapshot): Catalog {
  const cached = catalogsBySnapshot.get(snapshot);
  if (cached) return cached;
  let catalog: Catalog = {
    tables: snapshot.relations.map((relation) =>
      tableFromSnapshot(relation, snapshot.database),
    ),
    objects: [
      ...snapshot.routines.map(routineFromSnapshot),
      ...snapshot.otherObjects.map(objectFromSnapshot),
    ],
  };
  if (persistedSnapshots.has(snapshot)) {
    const persisted: PersistedCatalog = {
      ...catalog,
      persistedCapturedAt: snapshot.capturedAt,
    };
    catalog = persisted;
  }
  catalogsBySnapshot.set(snapshot, catalog);
  return catalog;
}

/**
 * A navigation-only relation from the bounded tree. Opening it never waits for full
 * metadata; the table surface upgrades it from the shared snapshot when that loads.
 */
export function navigationTableFromOverview(
  relation: CatalogOverviewRelation,
  database: string | null,
): CatalogTable {
  const parent = relation.parent;
  return {
    database,
    schema: relation.schema,
    name: relation.name,
    kind: relation.kind,
    nativeId: relation.nativeId ?? null,
    comment: relation.comment ?? null,
    partitionParent: parent
      ? {
          namespace: parent.schema,
          name: parent.name,
          kind: parent.kind as CatalogObjectRef["kind"],
          nativeId: parent.nativeId ?? null,
        }
      : null,
    partitionChildren: [],
    columns: [],
    foreignKeys: [],
    constraints: [],
    indexes: [],
    rowEstimate: relation.rowEstimate,
  };
}

/**
 * The bounded relation tree implied by a newer full snapshot. Namespaces the
 * previous tree discovered (including empty schemas) are kept until the next
 * overview read, because a snapshot only names namespaces that own objects.
 */
export function overviewFromSnapshot(
  snapshot: CatalogSnapshot,
  knownNamespaces: readonly string[],
): CatalogOverview {
  return {
    database: snapshot.database,
    namespaces: [
      ...new Set([
        ...knownNamespaces,
        ...snapshot.namespaces.map((namespace) => namespace.name),
      ]),
    ].sort(),
    relations: snapshot.relations.map((relation) => ({
      schema: relation.object.namespace ?? null,
      name: relation.object.name,
      kind: objectKind(relation.object.kind),
      nativeId: relation.object.nativeId ?? null,
      comment: relation.comment ?? null,
      rowEstimate: relation.rowEstimate ?? null,
      parent: relation.partitionParent
        ? {
            schema: relation.partitionParent.namespace ?? null,
            name: relation.partitionParent.name,
            kind: objectKind(relation.partitionParent.kind),
            nativeId: relation.partitionParent.nativeId ?? null,
          }
        : null,
    })),
    detailState: "deferred",
  };
}

export function getCatalogOverview(id: string): Promise<CatalogOverview> {
  return invoke("get_catalog_overview", { id });
}

export function listConnectionDatabases(id: string): Promise<DatabaseSummary[]> {
  return invoke("list_connection_databases", { id });
}

export function getDatabaseCatalogOverview(
  id: string,
  database: string,
): Promise<CatalogOverview> {
  return invoke("get_database_catalog_overview", { id, database });
}

/**
 * The persisted configured-database snapshot when still current for the authorized
 * scope. It never connects; callers show it only until a live read replaces it.
 */
export function getPersistedCatalogSnapshot(
  id: string,
): Promise<CatalogSnapshot | null> {
  return invoke("get_catalog_snapshot", { id });
}

/** Live introspection of one exact database; `null` selects the configured one. */
export function getDatabaseCatalogSnapshot(
  id: string,
  database: string | null,
): Promise<CatalogSnapshot> {
  return invoke("get_database_catalog_snapshot", { id, database });
}

export function getTableDdl(
  connectionId: string,
  table: string,
  schema?: string | null,
  database?: string | null,
): Promise<string> {
  if (database) {
    return invoke("get_database_table_ddl", {
      id: connectionId,
      database,
      schema: schema ?? null,
      table,
    });
  }
  return invoke("get_table_ddl", {
    id: connectionId,
    schema: schema ?? null,
    table,
  });
}
