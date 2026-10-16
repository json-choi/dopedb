// SQL console namespace projection. The catalog supplies selectable values while
// the persisted document owns the current choice. Empty schemas the server lists
// (PostgreSQL's default `public` often holds no tables) stay selectable, and a new
// console starts in the server default rather than the alphabetically first schema.

import type { Catalog } from "../../ipc/types";
import type { ConnectionProfile } from "../connections/domain";

export function defaultSqlNamespace(connection: ConnectionProfile): string {
  if (connection.engine === "sqlite") return "main";
  if (connection.engine === "mysql") return connection.database;
  if (connection.engine === "bigquery") return connection.database;
  if (connection.engine === "postgres") return "public";
  return connection.database;
}

export function sqlNamespaceOptions(
  connection: ConnectionProfile,
  catalog: Catalog | undefined,
  serverNamespaces: readonly string[] = [],
): string[] {
  if (connection.engine === "sqlite") return ["main"];
  if (connection.engine === "mysql") return [connection.database].filter(Boolean);
  if (connection.engine === "bigquery") {
    return [connection.database].filter(Boolean);
  }

  const discovered = new Set<string>(
    serverNamespaces.map((namespace) => namespace.trim()).filter(Boolean),
  );
  for (const table of catalog?.tables ?? []) {
    if (table.schema?.trim()) discovered.add(table.schema.trim());
  }
  for (const object of catalog?.objects ?? []) {
    if (object.schema?.trim()) discovered.add(object.schema.trim());
  }
  const namespaces = [...discovered].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "accent" }),
  );
  return namespaces.length > 0
    ? namespaces
    : [defaultSqlNamespace(connection)].filter(Boolean);
}

export function effectiveSqlNamespace(
  connection: ConnectionProfile,
  requested: string | null,
  options: readonly string[],
): string {
  if (requested && options.includes(requested)) return requested;
  const fallback = defaultSqlNamespace(connection);
  // PostgreSQL schemas are not databases: never prefer one named like the database.
  if (
    connection.engine !== "postgres" &&
    options.includes(connection.database)
  ) {
    return connection.database;
  }
  if (options.includes(fallback)) return fallback;
  return options[0] ?? fallback;
}
