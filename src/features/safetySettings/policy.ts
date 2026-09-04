import type { ConnectionProfile } from "../connections/domain";
import type { SafetySettings } from "../../ipc/types";

export type ConnectionWriteAuthority = Pick<
  ConnectionProfile,
  "allowWrites" | "credentialMode" | "workspaceAccess"
> & Partial<Pick<ConnectionProfile, "engine" | "provider">>;

export type WriteBlockRecoveryKind =
  | "deviceSafety"
  | "localSafety"
  | "managedCredential"
  | "schemaSafety"
  | "schemaUnavailable"
  | "workspaceGrant"
  | "workspacePolicy"
  | "workspacePolicyAndDevice";

type WriteBlockError = Readonly<{
  kind: string | null;
  message: string;
  sql?: string;
}>;

function sqlAfterLeadingTrivia(sql: string): string | null {
  let cursor = 0;
  while (cursor < sql.length) {
    const character = sql[cursor] ?? "";
    if (/\s/u.test(character)) {
      cursor += 1;
      continue;
    }
    if (sql.startsWith("--", cursor)) {
      cursor += 2;
      while (
        cursor < sql.length
        && sql[cursor] !== "\r"
        && sql[cursor] !== "\n"
      ) cursor += 1;
      continue;
    }
    if (sql.startsWith("/*", cursor)) {
      const end = sql.indexOf("*/", cursor + 2);
      if (end === -1) return null;
      cursor = end + 2;
      continue;
    }
    break;
  }
  return sql.slice(cursor);
}

function isDdlStatement(sql: string | undefined): boolean {
  if (!sql) return false;
  const statement = sqlAfterLeadingTrivia(sql);
  return statement !== null
    && /^(?:create|alter|drop|truncate|comment|reindex)\b/i.test(statement);
}

function isSchemaAccessError(error: WriteBlockError): boolean {
  const message = error.message.toLocaleLowerCase();
  return (
    message.includes("schema changes are disabled") ||
    message.includes("workspace role does not permit schema changes") ||
    message.includes("managed schema access requires") ||
    message.includes("managed schema access is not supported") ||
    message.includes("schema access requires a separately verified") ||
    message.includes("schema policy owner is unavailable") ||
    (isDdlStatement(error.sql) &&
      (message.includes("permission denied for schema") ||
        message.includes("must be owner of")))
  );
}

function isWritesDisabledError(error: WriteBlockError): boolean {
  if (error.kind !== "blocked" && error.kind !== "safety") return false;
  const message = error.message.toLocaleLowerCase();
  return (
    message.includes("writes are disabled for this connection") ||
    message.includes("writing is disabled for this connection") ||
    message.includes("schema change (ddl) is disabled for this connection")
  );
}

/** Identifies the exact authority layer a write-disabled error must recover. */
export function writeBlockRecoveryKind(
  connection: ConnectionWriteAuthority,
  error: WriteBlockError,
): WriteBlockRecoveryKind | null {
  const schemaAccessError = isSchemaAccessError(error);
  if (!schemaAccessError && !isWritesDisabledError(error)) return null;
  if (connection.credentialMode === "memberLocal") {
    return "managedCredential";
  }
  if (
    connection.workspaceAccess === "view" ||
    connection.workspaceAccess === "read"
  ) {
    return "workspaceGrant";
  }
  if (schemaAccessError) {
    if (
      connection.credentialMode === "managed" &&
      connection.workspaceAccess !== "manage"
    ) {
      return "workspaceGrant";
    }
    return safetySchemaControlAvailable(connection)
      ? "schemaSafety"
      : "schemaUnavailable";
  }
  if (!connection.allowWrites && connection.credentialMode === "managed") {
    return connection.workspaceAccess === "manage"
      ? "workspacePolicyAndDevice"
      : "workspacePolicy";
  }
  if (!connection.allowWrites) return "localSafety";
  return "deviceSafety";
}

export function writeBlockRecoveryOpensSafety(
  kind: WriteBlockRecoveryKind,
): boolean {
  return kind === "deviceSafety"
    || kind === "localSafety"
    || kind === "schemaSafety"
    || kind === "schemaUnavailable"
    || kind === "workspacePolicyAndDevice";
}

/**
 * UI projection of the write authority the Rust runtime enforces.
 *
 * Safety is a narrowing gate. It must never make a connection look writable
 * when its durable policy, workspace grant, or credential mode forbids writes.
 */
export function connectionCanEnterWritePath(
  connection: ConnectionWriteAuthority,
): boolean {
  if (!connection.allowWrites || connection.credentialMode === "memberLocal") {
    return false;
  }
  return (
    connection.workspaceAccess === "local" ||
    connection.workspaceAccess === "write" ||
    connection.workspaceAccess === "manage"
  );
}

/** A manager may change the managed workspace ceiling from the Safety surface. */
export function canManageWorkspaceWritePolicy(
  connection: ConnectionWriteAuthority,
): boolean {
  return (
    connection.credentialMode === "managed" &&
    connection.workspaceAccess === "manage"
  );
}

/** The Safety page owns the local connection's write policy and local consent. */
export function safetyWriteControlAvailable(
  connection: ConnectionWriteAuthority,
): boolean {
  if (
    connection.credentialMode === "local" &&
    connection.workspaceAccess === "local"
  ) {
    return connection.engine !== "bigquery" && connection.engine !== "mongodb";
  }
  return (
    canManageWorkspaceWritePolicy(connection) ||
    connectionCanEnterWritePath(connection)
  );
}

/**
 * DDL is a separate, narrower device opt-in. Personal SQL connections can use
 * their own credential; managed DDL requires an exact manage grant on a
 * PostgreSQL adapter with a verified stable-owner schema lease.
 */
export function safetySchemaControlAvailable(
  connection: ConnectionWriteAuthority,
): boolean {
  if (
    connection.credentialMode === "local" &&
    connection.workspaceAccess === "local"
  ) {
    return connection.engine !== "bigquery" && connection.engine !== "mongodb";
  }
  return (
    connection.credentialMode === "managed" &&
    connection.workspaceAccess === "manage" &&
    (connection.provider === "neon" || connection.provider === "gcpCloudSql") &&
    connection.engine === "postgres"
  );
}

/**
 * Normalize the local form against current authority. A manager can request a
 * coordinated hosted-policy change, but this value alone never widens runtime
 * authority; the dedicated workspace command remains the server gate.
 */
export function requestedSafetySettings(
  connection: ConnectionWriteAuthority,
  settings: SafetySettings,
): SafetySettings {
  const allowWrites = settings.allowWrites && safetyWriteControlAvailable(connection);
  return {
    ...settings,
    allowWrites,
    allowSchemaChanges:
      allowWrites &&
      settings.allowSchemaChanges &&
      safetySchemaControlAvailable(connection),
  };
}

export function effectiveSafetySettings(
  connection: ConnectionWriteAuthority,
  settings: SafetySettings,
): SafetySettings {
  const allowWrites = settings.allowWrites && connectionCanEnterWritePath(connection);
  return {
    ...settings,
    allowWrites,
    allowSchemaChanges:
      allowWrites &&
      settings.allowSchemaChanges &&
      safetySchemaControlAvailable(connection),
  };
}
