import type {
  Catalog,
  CatalogOverview,
  CatalogObjectRef,
  CatalogOverviewRelation,
  CatalogTable,
} from "../../ipc/types";

/** Creates a navigation-only table until the full metadata catalog arrives. */
export function catalogOverviewTable(relation: CatalogOverviewRelation): CatalogTable {
  const parent = relation.parent;
  return {
    database: null,
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

function relationKey(schema: string | null, name: string) {
  return `${schema ?? ""}\u0000${name}`;
}

/**
 * Keeps the live overview authoritative for relation identity while hydrating matching
 * rows from the last persisted full-catalog snapshot.
 */
export function catalogFromOverview(
  overview: CatalogOverview,
  details?: Catalog,
): Catalog {
  const detailsByKey = new Map(
    details?.tables.map((table) => [
      relationKey(table.schema, table.name),
      table,
    ]) ?? [],
  );

  return {
    tables: overview.relations.map((relation) => {
      const current = {
        ...catalogOverviewTable(relation),
        database: overview.database,
      };
      const detail = detailsByKey.get(
        relationKey(current.schema, current.name),
      );
      const sameNativeIdentity =
        !current.nativeId
        || !detail?.nativeId
        || current.nativeId === detail.nativeId;
      if (!detail || detail.kind !== current.kind || !sameNativeIdentity) {
        return current;
      }
      return {
        ...detail,
        schema: current.schema,
        name: current.name,
        kind: current.kind,
        nativeId: current.nativeId,
        comment: current.comment,
        partitionParent: current.partitionParent,
        rowEstimate: current.rowEstimate,
      };
    }),
    objects: details?.objects ?? [],
  };
}
