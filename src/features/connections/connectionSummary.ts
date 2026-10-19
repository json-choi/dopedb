// The one human-readable description of where a connection points, shared by the
// connection picker, action search and Settings so they never disagree.
import { databaseDisplayLabel, type ConnectionProfile } from "./domain";

/** Host and port, or the database file for SQLite, which has no network endpoint. */
export function connectionEndpoint(connection: ConnectionProfile): string {
  if (connection.engine === "sqlite") {
    return databaseDisplayLabel(
      connection.engine,
      connection.database || connection.host,
    )
      || "sqlite";
  }
  return `${connection.host}${connection.port ? `:${connection.port}` : ""}`;
}

/** `engine · branch · host · database`, omitting whatever the connection lacks. */
export function connectionSummary(connection: ConnectionProfile): string {
  const parts = [
    connection.engine,
    connection.providerTarget?.branchName ?? connection.providerTarget?.branchId,
    connectionEndpoint(connection),
    databaseDisplayLabel(connection.engine, connection.database),
  ].filter(Boolean);
  return [...new Set(parts)].join(" · ");
}
