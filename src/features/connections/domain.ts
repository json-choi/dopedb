/**
 * Connection wire/domain values.
 *
 * The brand prevents workspace, document, and connection IDs from being exchanged
 * accidentally while preserving the UUID string sent over Tauri.
 */

declare const connectionIdBrand: unique symbol;

export type ConnectionId = string & {
  readonly [connectionIdBrand]: "ConnectionId";
};

export function connectionId(value: string): ConnectionId {
  return value as ConnectionId;
}

export type ConnectionEngine = "postgres" | "mysql" | "sqlite" | "mongodb" | "bigquery";
export type ConnectionProvider =
  | "auto"
  | "generic"
  | "neon"
  | "planetScale"
  | "gcpCloudSql";
export type WorkspaceConnectionAccess =
  | "view"
  | "read"
  | "write"
  | "manage"
  | "local";
export type WorkspaceCredentialMode = "local" | "memberLocal" | "managed";

export type NeonBranchState =
  | "init"
  | "resetting"
  | "ready"
  | "archived"
  | "unknown";

export type ConnectionProviderTarget = {
  provider: "neon";
  projectId: string;
  branchId: string;
  branchName: string | null;
  currentState: NeonBranchState | null;
  pendingState: NeonBranchState | null;
  default: boolean | null;
  protected: boolean | null;
};

export interface ConnectionProfile {
  id: ConnectionId;
  name: string;
  engine: ConnectionEngine;
  provider: ConnectionProvider;
  driverId: string | null;
  host: string;
  port: number;
  database: string;
  username: string;
  sslmode: string;
  extraParams: Record<string, string>;
  readonlyDefault: boolean;
  allowWrites: boolean;
  secretRef: string | null;
  env: string | null;
  schemaGroup: string | null;
  workspaceAccess: WorkspaceConnectionAccess;
  credentialMode: WorkspaceCredentialMode;
  providerTarget: ConnectionProviderTarget | null;
}

export type BigQueryAuthMode = "googleAccount" | "serviceAccount";

export interface BigQueryAuthState {
  mode: BigQueryAuthMode;
  authenticated: boolean;
}

export interface BigQueryProjectSummary {
  id: string;
  name: string;
}

export interface BigQueryDatasetSummary {
  id: string;
}

/**
 * Keep local filesystem ownership out of ordinary database labels. The exact
 * SQLite path remains available in connection settings, while shared chrome,
 * Agent receipts, and Explorer accessibility labels use only the file name.
 */
export function databaseDisplayLabel(
  engine: ConnectionEngine,
  database: string,
): string {
  const value = database.trim();
  if (engine !== "sqlite" || !value) return value;
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

export const CONNECTION_TEST_FAILURE_CODES = [
  "timeoutNetwork",
  "authentication",
  "tls",
  "databaseConfig",
  "sshLaunch",
  "sshHost",
  "sshAuthentication",
  "sshHostKey",
  "sshTimeout",
  "sshUnclassified",
  "unknown",
] as const;

export type ConnectionTestFailureCode =
  (typeof CONNECTION_TEST_FAILURE_CODES)[number];

export const CONNECTION_TEST_FAILURE_FIELDS = [
  "credentials",
  "tls",
  "database",
  "sshAlias",
] as const;

export type ConnectionTestFailureField =
  (typeof CONNECTION_TEST_FAILURE_FIELDS)[number];

export interface ConnectionTestFailure {
  code: ConnectionTestFailureCode;
  field: ConnectionTestFailureField | null;
  detail: string;
}

export type ConnectionTestReceipt =
  | { ok: true; failure: null }
  | { ok: false; failure: ConnectionTestFailure };

/**
 * Read the classified failure Rust attaches to a failed connection attempt.
 *
 * Every path that reports a connection failure reads this instead of the
 * `AppError` message, which is a developer-facing rendering that may quote
 * driver text or a configuration value. Unknown wire values are rejected rather
 * than passed through, so the screen never renders an internal enum.
 */
export function connectionFailureFromError(
  error: unknown,
): ConnectionTestFailure | null {
  if (!error || typeof error !== "object") return null;
  const payload = (error as { connectionFailure?: unknown }).connectionFailure;
  if (!payload || typeof payload !== "object") return null;
  const { code, field, detail } = payload as Record<string, unknown>;
  if (
    !CONNECTION_TEST_FAILURE_CODES.includes(code as ConnectionTestFailureCode)
  ) {
    return null;
  }
  return {
    code: code as ConnectionTestFailureCode,
    field: CONNECTION_TEST_FAILURE_FIELDS.includes(
      field as ConnectionTestFailureField,
    )
      ? (field as ConnectionTestFailureField)
      : null,
    detail: typeof detail === "string" ? detail : "",
  };
}

export type ConnectionAccessIssue = "grant" | "credentials";

/**
 * BigQuery authentication is member-local even when its redacted connection
 * identity is shared by a Project. Only members who can read that resource may
 * start the official Google Cloud CLI recovery flow on their own device.
 */
export function canRecoverBigQueryAuthentication(
  connection: Pick<
    ConnectionProfile,
    "engine" | "credentialMode" | "workspaceAccess"
  >,
): boolean {
  if (connection.engine !== "bigquery") return false;
  if (
    connection.workspaceAccess === "local"
    && connection.credentialMode === "local"
  ) {
    return true;
  }
  return (
    connection.workspaceAccess !== "local"
    && connection.workspaceAccess !== "view"
    && connection.credentialMode === "memberLocal"
  );
}

/** One authority-neutral projection shared by Explorer loading and recovery UI. */
export function connectionAccessIssue(
  connection: Pick<
    ConnectionProfile,
    "engine" | "credentialMode" | "secretRef" | "workspaceAccess"
  >,
): ConnectionAccessIssue | undefined {
  if (connection.workspaceAccess === "view") return "grant";
  if (
    connection.engine !== "bigquery"
    && connection.workspaceAccess !== "local"
    && connection.credentialMode === "memberLocal"
    && connection.secretRef === null
  ) {
    return "credentials";
  }
  return undefined;
}

type DriverInstallMode = "bundled" | "managed" | "system";
type DriverInstallState = "installed" | "available" | "planned";

export type DriverCapability =
  | "sql"
  | "documentQuery"
  | "transactions"
  | "introspection"
  | "collections"
  | "schemaDiff"
  | "monitoring";

export interface DriverDescriptor {
  id: string;
  name: string;
  engine: ConnectionEngine;
  version: string;
  installMode: DriverInstallMode;
  installState: DriverInstallState;
  supportedProviders: ConnectionProvider[];
  capabilities: DriverCapability[];
  recommended: boolean;
}
