// Projects lightweight catalog overviews into navigation-only table and object entries.

import type { Catalog, CatalogOverview } from "../../ipc/types";
import { navigationTableFromOverview } from "../../features/catalog/tauriAdapter";

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
      const current = navigationTableFromOverview(relation, overview.database);
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
