import {
  errDetails,
  type AppErrorDetails,
  type Catalog,
  type CatalogObject,
  type CatalogObjectKind,
  type CatalogTable,
} from "../../ipc/types";
import type { ConnectionProfile } from "../connections/domain";
import type { IconName } from "../../components/Icon";

export type DropTarget =
  | { kind: "connection"; id: string }
  | { kind: "group"; key: string }
  | { kind: "environment"; id: string }
  | {
      kind: "projectDatabases";
      projectId: string;
      environmentId: string;
    };

export type CatalogLoadIssue = Pick<AppErrorDetails, "kind" | "message">;

export function catalogLoadIssue(error: unknown): CatalogLoadIssue {
  const { kind, message } = errDetails(error);
  return { kind, message };
}

export function isAuthenticationRequired(
  issue: CatalogLoadIssue | undefined,
): boolean {
  return issue?.kind === "authenticationRequired";
}

/** One failed backend read may feed both overview and detail observers. */
export function distinctCatalogDetailIssue(
  overview: CatalogLoadIssue | undefined,
  detail: CatalogLoadIssue | undefined,
): CatalogLoadIssue | undefined {
  return detail?.kind === overview?.kind && detail?.message === overview?.message
    ? undefined
    : detail;
}

export const SQL_OBJECT_SECTIONS: Array<{
  kind: CatalogObjectKind;
  icon: IconName;
  label:
    | "connections.materializedViews"
    | "connections.functions"
    | "connections.procedures"
    | "connections.sequences"
    | "connections.triggers";
}> = [
  {
    kind: "materialized_view",
    icon: "materializedView",
    label: "connections.materializedViews",
  },
  { kind: "function", icon: "function", label: "connections.functions" },
  { kind: "procedure", icon: "procedure", label: "connections.procedures" },
  { kind: "sequence", icon: "sequence", label: "connections.sequences" },
  { kind: "trigger", icon: "trigger", label: "connections.triggers" },
];

export function supportedObjectKinds(engine: ConnectionProfile["engine"]) {
  if (engine === "postgres") {
    return new Set<CatalogObjectKind>([
      "materialized_view",
      "function",
      "procedure",
      "sequence",
      "trigger",
    ]);
  }
  if (engine === "mysql") {
    return new Set<CatalogObjectKind>(["function", "procedure", "trigger"]);
  }
  if (engine === "bigquery") {
    return new Set<CatalogObjectKind>(["materialized_view"]);
  }
  if (engine === "sqlite") return new Set<CatalogObjectKind>(["trigger"]);
  return new Set<CatalogObjectKind>();
}

export function catalogObjectLabel(object: CatalogObject) {
  const qualified = object.schema
    ? `${object.schema}.${object.name}`
    : object.name;
  if (
    (object.kind === "function" || object.kind === "procedure") &&
    object.detail != null
  ) {
    return `${qualified}(${object.detail})`;
  }
  return qualified;
}

function stripEnvironmentTokens(value: string): string {
  return value
    .replace(
      /\b(development|staging|production|local|dev|stage|prod|qa|test)\b/gi,
      "",
    )
    .replace(
      /(^|[-_.\s]+)(development|staging|production|local|dev|stage|prod|qa|test)([-_.\s]+|$)/gi,
      "$1",
    )
    .replace(/[-_.\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

export function fallbackSchemaGroupName(
  first: ConnectionProfile,
  second: ConnectionProfile,
  connections: ConnectionProfile[],
): string {
  const candidates = [
    stripEnvironmentTokens(first.name),
    stripEnvironmentTokens(second.name),
    stripEnvironmentTokens(first.database),
    stripEnvironmentTokens(second.database),
    stripEnvironmentTokens(first.host.split(".")[0] ?? ""),
    stripEnvironmentTokens(second.host.split(".")[0] ?? ""),
  ].filter(Boolean);
  const base =
    candidates.find((candidate) => candidate.length >= 2) ?? "schema-group";
  const used = new Set(
    connections
      .map((connection) => connection.schemaGroup?.trim().toLocaleLowerCase())
      .filter(Boolean) as string[],
  );
  if (!used.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base}-${suffix}`;
}

export function tableMatchesFilter(table: CatalogTable, filter: string) {
  return (
    table.name.toLowerCase().includes(filter) ||
    (table.schema ?? "").toLowerCase().includes(filter)
  );
}

export function objectMatchesFilter(
  object: CatalogObject,
  filter: string,
) {
  return [
    object.schema,
    object.name,
    object.kind,
    object.detail,
    object.parent,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(filter);
}

export function filterLoadedCatalogObjects(
  catalog: Catalog | undefined,
  filter: string,
) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!catalog) {
    return {
      normalizedFilter,
      tables: [] as CatalogTable[],
      objects: [] as CatalogObject[],
    };
  }
  if (!normalizedFilter) {
    return {
      normalizedFilter,
      tables: catalog.tables,
      objects: catalog.objects,
    };
  }
  return {
    normalizedFilter,
    tables: catalog.tables.filter((table) =>
      tableMatchesFilter(table, normalizedFilter),
    ),
    objects: catalog.objects.filter((object) =>
      objectMatchesFilter(object, normalizedFilter),
    ),
  };
}
