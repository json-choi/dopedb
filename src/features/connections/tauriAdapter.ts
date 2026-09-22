// The only frontend owner of saved-connection Tauri command names. Screens depend on
// these typed functions and never invoke the connection transport directly.
import type { DatabaseSummary } from "../../ipc/types";
import { invoke } from "../../ipc/core";

import type {
  BigQueryAuthState,
  BigQueryDatasetSummary,
  BigQueryProjectSummary,
  CloudflareD1AccountSummary,
  CloudflareD1AuthState,
  CloudflareD1DatabaseSummary,
  ConnectionId,
  ConnectionProfile,
  ConnectionTestReceipt,
  DriverDescriptor,
  LocalDatabaseListener,
} from "./domain";

export function listConnections(): Promise<ConnectionProfile[]> {
  return invoke("list_connections");
}

export function listDrivers(): Promise<DriverDescriptor[]> {
  return invoke("list_drivers");
}

export function installDriver(id: string): Promise<DriverDescriptor> {
  return invoke("install_driver", { id });
}

export function createDemoSqlite(): Promise<string> {
  return invoke("create_demo_sqlite");
}

export function upsertConnection(
  profile: ConnectionProfile,
  password?: string,
): Promise<ConnectionProfile> {
  return invoke("upsert_connection", { profile, password });
}

export function setConnectionsSchemaGroup(
  ids: ConnectionId[],
  schemaGroup: string | null,
): Promise<ConnectionProfile[]> {
  return invoke("set_connections_schema_group", { ids, schemaGroup });
}

export function deleteConnection(id: ConnectionId): Promise<void> {
  return invoke("delete_connection", { id });
}

export function testConnection(id: ConnectionId): Promise<ConnectionTestReceipt> {
  return invoke("test_connection", { id });
}

export function testConnectionProfile(
  profile: ConnectionProfile,
  password?: string,
): Promise<ConnectionTestReceipt> {
  return invoke("test_connection_profile", { profile, password });
}

export function discoverConnectionProfileDatabases(
  profile: ConnectionProfile,
  password?: string,
): Promise<DatabaseSummary[]> {
  return invoke("discover_connection_profile_databases", {
    profile,
    password,
  });
}

export function discoverLocalDatabaseListeners(): Promise<
  LocalDatabaseListener[]
> {
  return invoke("discover_local_database_listeners");
}

export function getBigQueryAuthState(
  profile: ConnectionProfile,
): Promise<BigQueryAuthState> {
  return invoke("get_bigquery_auth_state", { profile });
}

export function authenticateBigQueryGoogleAccount(
  profile: ConnectionProfile,
): Promise<BigQueryAuthState> {
  return invoke("authenticate_bigquery_google_account", { profile });
}

export function authenticateBigQueryServiceAccount(
  profile: ConnectionProfile,
  credentialFile: string,
): Promise<BigQueryAuthState> {
  return invoke("authenticate_bigquery_service_account", {
    profile,
    credentialFile,
  });
}

export function clearBigQueryServiceAccountAuth(
  profile: ConnectionProfile,
): Promise<void> {
  return invoke("clear_bigquery_service_account_auth", { profile });
}

export function discoverBigQueryProjects(
  profile: ConnectionProfile,
): Promise<BigQueryProjectSummary[]> {
  return invoke("discover_bigquery_projects", { profile });
}

export function discoverBigQueryDatasets(
  profile: ConnectionProfile,
  projectId: string,
): Promise<BigQueryDatasetSummary[]> {
  return invoke("discover_bigquery_datasets", { profile, projectId });
}

export function getCloudflareD1AuthState(
  profile: ConnectionProfile,
): Promise<CloudflareD1AuthState> {
  return invoke("get_cloudflare_d1_auth_state", { profile });
}

export function authenticateCloudflareD1Account(
  profile: ConnectionProfile,
): Promise<CloudflareD1AuthState> {
  return invoke("authenticate_cloudflare_d1_account", { profile });
}

export function clearCloudflareD1Auth(
  profile: ConnectionProfile,
): Promise<void> {
  return invoke("clear_cloudflare_d1_auth", { profile });
}

export function discoverCloudflareD1Accounts(
  profile: ConnectionProfile,
): Promise<CloudflareD1AccountSummary[]> {
  return invoke("discover_cloudflare_d1_accounts", { profile });
}

export function discoverCloudflareD1Databases(
  profile: ConnectionProfile,
  accountId: string,
): Promise<CloudflareD1DatabaseSummary[]> {
  return invoke("discover_cloudflare_d1_databases", { profile, accountId });
}

/** Native picker for SQLite and certificate paths; null means user cancellation. */
export function pickConnectionFile(): Promise<string | null> {
  return invoke("pick_file");
}
