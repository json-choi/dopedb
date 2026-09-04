import type { ConnectionProfile } from "../connections/domain";
import type {
  Catalog,
  CatalogObject,
  CatalogOverview,
  CatalogSnapshot,
  CatalogTable,
} from "../../ipc/types";

export const SCHEMA_SCOPE_PARAMETER = "dopedb.schemaScope";
export const OBJECT_PATTERN_PARAMETER = "dopedb.objectPattern";

const RESERVED_INTROSPECTION_PARAMETERS = new Set([
  SCHEMA_SCOPE_PARAMETER,
  OBJECT_PATTERN_PARAMETER,
]);

export function isIntrospectionParameter(key: string) {
  return RESERVED_INTROSPECTION_PARAMETERS.has(key);
}

export function selectedSchemaScope(profile: ConnectionProfile): string[] {
  const value = profile.extraParams[SCHEMA_SCOPE_PARAMETER]?.trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((schema): schema is string => typeof schema === "string")
      .map((schema) => schema.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function nextSchemaScopeSelection(
  availableSchemas: string[],
  selectedSchemas: string[],
  schema: string,
  checked: boolean,
): string[] {
  if (selectedSchemas.length === 0) {
    if (checked || availableSchemas.length <= 1) return [];
    return availableSchemas.filter((candidate) => candidate !== schema);
  }
  const next = checked
    ? [...new Set([...selectedSchemas, schema])]
    : selectedSchemas.filter((candidate) => candidate !== schema);
  if (next.length === 0) return selectedSchemas;
  return next.length === availableSchemas.length ? [] : next;
}

export function objectPattern(profile: ConnectionProfile): string {
  return profile.extraParams[OBJECT_PATTERN_PARAMETER]?.trim() ?? "";
}

export function relationNamespace(
  profile: ConnectionProfile,
  schema: string | null | undefined,
) {
  return schema?.trim() || profile.database.trim();
}

function globExpression(pattern: string) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function schemaMatches(
  profile: ConnectionProfile,
  schema: string | null | undefined,
) {
  const selected = selectedSchemaScope(profile);
  if (selected.length === 0) return true;
  const namespace = relationNamespace(profile, schema);
  return selected.some(
    (candidate) =>
      candidate.localeCompare(namespace, undefined, {
        sensitivity: "accent",
      }) === 0,
  );
}

function nameMatches(
  profile: ConnectionProfile,
  schema: string | null | undefined,
  name: string,
) {
  const pattern = objectPattern(profile);
  if (!pattern) return true;
  const qualified = [schema, name].filter(Boolean).join(".");
  const expression = globExpression(
    pattern.includes("*") || pattern.includes("?")
      ? pattern
      : `*${pattern}*`,
  );
  return expression.test(name) || expression.test(qualified);
}

function tableMatches(profile: ConnectionProfile, table: CatalogTable) {
  return (
    schemaMatches(profile, table.schema) &&
    nameMatches(profile, table.schema, table.name)
  );
}

function objectMatches(profile: ConnectionProfile, object: CatalogObject) {
  return (
    schemaMatches(profile, object.schema) &&
    nameMatches(profile, object.schema, object.name)
  );
}

export function filterCatalog(
  profile: ConnectionProfile,
  catalog: Catalog,
): Catalog {
  return {
    tables: catalog.tables.filter((table) => tableMatches(profile, table)),
    objects: catalog.objects.filter((object) => objectMatches(profile, object)),
  };
}

export function filterCatalogOverview(
  profile: ConnectionProfile,
  overview: CatalogOverview,
): CatalogOverview {
  return {
    ...overview,
    namespaces: overview.namespaces.filter((namespace) =>
      schemaMatches(profile, namespace),
    ),
    relations: overview.relations.filter(
      (relation) =>
        schemaMatches(profile, relation.schema) &&
        nameMatches(profile, relation.schema, relation.name),
    ),
  };
}

export function filterCatalogSnapshot(
  profile: ConnectionProfile,
  snapshot: CatalogSnapshot,
): CatalogSnapshot {
  const namespaceAllowed = (namespace: string | null | undefined) =>
    schemaMatches(profile, namespace);
  const objectAllowed = (
    namespace: string | null | undefined,
    name: string,
  ) =>
    namespaceAllowed(namespace) &&
    nameMatches(profile, namespace, name);

  return {
    ...snapshot,
    namespaces: snapshot.namespaces.filter((namespace) =>
      namespaceAllowed(namespace.name),
    ),
    relations: snapshot.relations.filter((relation) =>
      objectAllowed(relation.object.namespace, relation.object.name),
    ),
    routines: snapshot.routines.filter((routine) =>
      objectAllowed(routine.object.namespace, routine.object.name),
    ),
    otherObjects: snapshot.otherObjects.filter((object) =>
      objectAllowed(object.object.namespace, object.object.name),
    ),
  };
}
