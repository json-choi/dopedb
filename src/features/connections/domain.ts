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
  | "gcpCloudSql"
  | "cloudflareD1";
export type WorkspaceConnectionAccess =
  | "view"
  | "read"
  | "write"
  | "manage"
  | "local";
/**
 * `provisioned` is a shared database whose per-member account DopeDB created. The
 * workspace still reports `member_local`; Desktop projects it into its own mode
 * because the username is the generated principal (empty until the account is
 * ready) and the password is generated, never typed.
 */
export type WorkspaceCredentialMode =
  | "local"
  | "memberLocal"
  | "managed"
  | "provisioned";

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
  schemaAccessAvailable?: boolean;
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

export interface CloudflareD1AuthState {
  authenticated: boolean;
  email: string | null;
}

export interface CloudflareD1AccountSummary {
  id: string;
  name: string;
}

export interface CloudflareD1DatabaseSummary {
  id: string;
  name: string;
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
  "sshClientMissing",
  "sshConfiguration",
  "sshHostKey",
  "sshAuthentication",
  "sshForwarding",
  "sshTimeout",
  "sshUnknown",
  "timeoutNetwork",
  "authentication",
  "authenticationIdentity",
  "tls",
  "databaseConfig",
  "unknown",
] as const;

export type ConnectionTestFailureCode =
  (typeof CONNECTION_TEST_FAILURE_CODES)[number];

export const CONNECTION_TEST_FAILURE_FIELDS = [
  "ssh",
  "credentials",
  "tls",
  "database",
] as const;

export type ConnectionTestFailureField =
  (typeof CONNECTION_TEST_FAILURE_FIELDS)[number];

/**
 * A probe refused before contacting any server: a saved password is reused only
 * for the engine, host, port, user, and SSH alias it was saved with, over TLS at
 * least as strict; a managed open cools down after a failure; and a changed
 * shared connection is never opened from its stale revision.
 */
export type ConnectionProbeRefusal =
  | "savedCredentialEndpointChanged"
  | "retryLater"
  | "sharedConnectionChanged"
  | "workspaceSignInRequired"
  | "credentialStoreDenied"
  | "lockTimeout";

export interface ConnectionTestFailure {
  code: ConnectionTestFailureCode;
  field: ConnectionTestFailureField | null;
  detail: string;
  /** Present only when the check was refused before contacting the server. */
  refusal?: ConnectionProbeRefusal;
  /** Whole seconds left in a `retryLater` cooldown. */
  retryAfterSeconds?: number;
}

/** Safe UI identity projected from the wire receipt without backend detail text. */
export type ConnectionTestIssue = Readonly<
  Pick<ConnectionTestFailure, "code" | "field" | "refusal">
>;

export type ConnectionTestReceipt =
  | { ok: true; failure: null }
  | { ok: false; failure: ConnectionTestFailure };

/** Databases a draft reaches, or why discovery refused before connecting. */
export type DatabaseDiscoveryReceipt = {
  databases: { name: string }[];
  refusal?: ConnectionProbeRefusal;
};

export type ConnectionAccessIssue = "grant" | "credentials" | "provisioning";

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

/**
 * BigQuery and Cloudflare D1 authenticate through the member's own official CLI
 * login (Google Cloud CLI, Wrangler), so no username or password is ever bound.
 */
export function usesCliAuthentication(
  connection: Pick<ConnectionProfile, "engine" | "provider">,
): boolean {
  return (
    connection.engine === "bigquery" ||
    (connection.engine === "sqlite" && connection.provider === "cloudflareD1")
  );
}

/**
 * A shared member-local connection whose credential this member binds by hand.
 * Provisioned connections are excluded: their credential is generated and tracked
 * by the provisioning status, so no surface may offer a manual password path.
 */
export function canBindMemberCredentials(
  connection: Pick<
    ConnectionProfile,
    "engine" | "provider" | "credentialMode" | "workspaceAccess"
  >,
): boolean {
  return connection.credentialMode === "memberLocal"
    && connection.workspaceAccess !== "view"
    && connection.workspaceAccess !== "local"
    && !usesCliAuthentication(connection);
}

/** A provisioned connection opens only once its generated account is ready (named). */
export function provisioningNotReady(
  connection: Pick<ConnectionProfile, "credentialMode" | "username">,
): boolean {
  return connection.credentialMode === "provisioned" && connection.username === "";
}

/** One authority-neutral projection shared by Explorer loading and recovery UI. */
export function connectionAccessIssue(
  connection: Pick<
    ConnectionProfile,
    "engine" | "provider" | "credentialMode" | "secretRef" | "username" | "workspaceAccess"
  >,
): ConnectionAccessIssue | undefined {
  if (connection.workspaceAccess === "view") return "grant";
  if (provisioningNotReady(connection)) return "provisioning";
  if (
    !usesCliAuthentication(connection)
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

/**
 * One database server that answered a credential-free handshake on this
 * machine's loopback address. It is a suggestion for the connection editor: it
 * carries no credential, names no database, and grants no authority.
 */
export type LocalDatabaseListener = {
  engine: ConnectionEngine;
  host: string;
  port: number;
  /** Only set when the protocol reports it before authentication. */
  serverVersion: string | null;
};

/**
 * Canonical display name for one engine, shared by every surface that names a
 * database without also naming its provider. Provider-specific wording (a
 * Cloudflare D1 file, for example) stays in `STANDARD_CONNECTION_SOURCES`.
 */
export function databaseEngineLabel(engine: ConnectionEngine): string {
  switch (engine) {
    case "postgres":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "sqlite":
      return "SQLite";
    case "mongodb":
      return "MongoDB";
    case "bigquery":
      return "BigQuery";
  }
}
