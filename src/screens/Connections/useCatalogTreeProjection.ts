// Builds the filtered catalog and schema groups consumed by the virtual tree.
// Rendering and expansion state remain in CatalogTree. Names use numeric-aware order,
// and a materialized view is listed once, as an openable relation.
import { useMemo } from "react";
import type {
  Catalog,
  CatalogObject,
  CatalogOverview,
  CatalogTable,
} from "../../ipc/types";
import type { ConnectionProfile } from "../../features/connections/domain";
import {
  compareCatalogNames,
  filterLoadedCatalogObjects,
  SQL_OBJECT_SECTIONS,
  supportedObjectKinds,
  tableMatchesFilter,
} from "../../features/catalogExplorer/catalogDomain";
import { filterCatalog } from "../../features/catalogExplorer/scopeFilter";
import {
  orderTablesBySchemaDiff,
  type SchemaConnectionGroup,
} from "../../lib/schemaDiff";
import { catalogFromOverview } from "./catalogOverview";
import { schemaDiffForConnection } from "./schemaDiffPresentation";

interface SchemaContents {
  tables: CatalogTable[];
  views: CatalogTable[];
  materializedViews: CatalogTable[];
  objectsByKind: Map<string, CatalogObject[]>;
}

const MATERIALIZED_VIEW = "materialized_view";

function compareRelations(left: CatalogTable, right: CatalogTable) {
  return compareCatalogNames(left.schema ?? "", right.schema ?? "")
    || compareCatalogNames(left.name, right.name);
}

function compareObjects(left: CatalogObject, right: CatalogObject) {
  return compareCatalogNames(left.name, right.name)
    || compareCatalogNames(left.detail ?? "", right.detail ?? "");
}

interface CatalogTreeProjectionInput {
  connection: ConnectionProfile;
  overview?: CatalogOverview;
  fullCatalog?: Catalog;
  applySchemaScope?: boolean;
  filter: string;
  groupByConnectionId: Map<string, SchemaConnectionGroup>;
  catalogs: Record<string, Catalog>;
}

export function useCatalogTreeProjection({
  connection,
  overview,
  fullCatalog,
  applySchemaScope,
  filter,
  groupByConnectionId,
  catalogs,
}: CatalogTreeProjectionInput) {
  // Stage 1 follows catalog changes only: projection, schema scope, numeric-aware
  // ordering and materialized-view de-duplication never rerun per search keystroke.
  const { unfilteredCatalog, catalog } = useMemo(() => {
    const unfilteredCatalog = overview
      ? catalogFromOverview(overview, fullCatalog)
      : fullCatalog;
    const scoped = unfilteredCatalog
      ? applySchemaScope === false
        ? unfilteredCatalog
        : filterCatalog(connection, unfilteredCatalog)
      : undefined;
    if (!scoped) return { unfilteredCatalog, catalog: undefined };
    // Some catalogs also report a materialized view as an auxiliary object; the
    // relation row is the openable identity, so keep only unmatched objects.
    const materializedRelations = new Set(
      scoped.tables
        .filter((table) => table.kind === MATERIALIZED_VIEW)
        .map((table) => `${table.schema ?? ""}\u0000${table.name}`),
    );
    const catalog = {
      tables: [...scoped.tables].sort(compareRelations),
      objects: scoped.objects
        .filter(
          (object) =>
            object.kind !== MATERIALIZED_VIEW
            || !materializedRelations.has(
              `${object.schema ?? ""}\u0000${object.name}`,
            ),
        )
        .sort(compareObjects),
    };
    return { unfilteredCatalog, catalog };
  }, [applySchemaScope, connection, fullCatalog, overview]);

  return useMemo(() => {
    const diff = schemaDiffForConnection(
      connection,
      groupByConnectionId,
      catalogs,
    );
    const {
      normalizedFilter,
      tables: filteredTables,
      objects: filteredObjects,
    } = filterLoadedCatalogObjects(catalog, filter);
    const ordered = orderTablesBySchemaDiff(filteredTables, diff);
    const missingTables = diff
      ? normalizedFilter
        ? diff.missingTables.filter((table) =>
            tableMatchesFilter(table, normalizedFilter),
          )
        : diff.missingTables
      : [];
    const tables = ordered.filter(
      (table) => table.kind !== "view" && table.kind !== MATERIALIZED_VIEW,
    );
    const supportedKinds = supportedObjectKinds(connection.engine);
    const objectSections = SQL_OBJECT_SECTIONS.filter((section) =>
      section.kind === MATERIALIZED_VIEW
        // Relation rows own materialized views; this object section only keeps
        // entries a catalog reported without a relation.
        ? filteredObjects.some((object) => object.kind === MATERIALIZED_VIEW)
        : supportedKinds.has(section.kind)
          || filteredObjects.some((object) => object.kind === section.kind),
    );
    const groups = new Map<string, SchemaContents>();
    const contentsFor = (schema: string) => {
      const existing = groups.get(schema);
      if (existing) return existing;
      const created: SchemaContents = {
        tables: [],
        views: [],
        materializedViews: [],
        objectsByKind: new Map(),
      };
      groups.set(schema, created);
      return created;
    };
    for (const table of ordered) {
      const contents = contentsFor(table.schema ?? "");
      if (table.kind === "view") contents.views.push(table);
      else if (table.kind === MATERIALIZED_VIEW) {
        contents.materializedViews.push(table);
      } else contents.tables.push(table);
    }
    for (const object of filteredObjects) {
      const objectsByKind = contentsFor(object.schema ?? "").objectsByKind;
      const objects = objectsByKind.get(object.kind) ?? [];
      objects.push(object);
      objectsByKind.set(object.kind, objects);
    }
    const schemaGroups = [...groups.entries()].sort(
      ([left], [right]) => compareCatalogNames(left, right),
    );
    return {
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
    };
  }, [
    catalog,
    catalogs,
    connection,
    filter,
    groupByConnectionId,
    unfilteredCatalog,
  ]);
}
