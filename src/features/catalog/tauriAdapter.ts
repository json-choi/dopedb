import { invoke } from "../../ipc/core";
import type {
  Catalog,
  CatalogObject,
  CatalogOverview,
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
    constraints: relation.constraints.filter(
      (constraint) =>
        constraint.kind !== "primary" && constraint.kind !== "foreign",
    ),
    indexes: relation.indexes.map((index) => ({
      name: index.name,
      columns: index.keys.flatMap((key) =>
        key.column === undefined || key.column === null ? [] : [key.column],
      ),
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

export function catalogFromSnapshot(snapshot: CatalogSnapshot): Catalog {
  return {
    tables: snapshot.relations.map((relation) =>
      tableFromSnapshot(relation, snapshot.database),
    ),
    objects: [
      ...snapshot.routines.map(routineFromSnapshot),
      ...snapshot.otherObjects.map(objectFromSnapshot),
    ],
  };
}

export async function getCatalog(id: string): Promise<Catalog> {
  return catalogFromSnapshot(await getCatalogSnapshot(id));
}

export async function refreshCatalog(id: string): Promise<Catalog> {
  const snapshot = await invoke<CatalogSnapshot>("refresh_catalog_snapshot", {
    id,
  });
  return catalogFromSnapshot(snapshot);
}

export function getCatalogSnapshot(id: string): Promise<CatalogSnapshot> {
  return invoke("get_catalog_snapshot", { id });
}

export function getCatalogOverview(id: string): Promise<CatalogOverview> {
  return invoke("get_catalog_overview", { id });
}

export function listConnectionDatabases(id: string): Promise<DatabaseSummary[]> {
  return invoke("list_connection_databases", { id });
}

export async function getDatabaseCatalog(
  id: string,
  database: string,
): Promise<Catalog> {
  return catalogFromSnapshot(await getDatabaseCatalogSnapshot(id, database));
}

export function getDatabaseCatalogOverview(
  id: string,
  database: string,
): Promise<CatalogOverview> {
  return invoke("get_database_catalog_overview", { id, database });
}

export function getDatabaseCatalogSnapshot(
  id: string,
  database: string,
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
