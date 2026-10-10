// Defines reserved connection option keys and their engine-specific validation bounds.

import type {
  ConnectionEngine,
  ConnectionProfile,
} from "./domain";

export const CONNECTION_INPUT_MODE_PARAMETER =
  "dopedb.connectionInputMode";
export const CONNECTION_TIME_ZONE_PARAMETER = "dopedb.timeZone";
export const CONNECTION_KEEP_ALIVE_SECONDS_PARAMETER =
  "dopedb.keepAliveSeconds";
export const CONNECTION_AUTO_DISCONNECT_SECONDS_PARAMETER =
  "dopedb.autoDisconnectSeconds";
export const CONNECTION_STARTUP_SCRIPT_PARAMETER =
  "dopedb.startupScript";
export const CONNECTION_SSH_ALIAS_PARAMETER = "dopedb.sshAlias";
/** Set by hand for a transaction-mode pooler DopeDB cannot recognize by host. */
export const CONNECTION_TRANSACTION_POOLER_PARAMETER =
  "dopedb.transactionPooler";

export const CONNECTION_KEEP_ALIVE_MIN_SECONDS = 10;
export const CONNECTION_KEEP_ALIVE_MAX_SECONDS = 86_400;
export const CONNECTION_AUTO_DISCONNECT_MIN_SECONDS = 30;
export const CONNECTION_AUTO_DISCONNECT_MAX_SECONDS = 86_400;
export const CONNECTION_STARTUP_SCRIPT_MAX_LENGTH = 4_096;

const CONNECTION_OPTION_PARAMETERS = new Set([
  CONNECTION_INPUT_MODE_PARAMETER,
  CONNECTION_TIME_ZONE_PARAMETER,
  CONNECTION_KEEP_ALIVE_SECONDS_PARAMETER,
  CONNECTION_AUTO_DISCONNECT_SECONDS_PARAMETER,
  CONNECTION_STARTUP_SCRIPT_PARAMETER,
  CONNECTION_SSH_ALIAS_PARAMETER,
]);

export function isConnectionOptionParameter(key: string): boolean {
  return CONNECTION_OPTION_PARAMETERS.has(key);
}

export function isConnectionOptionSupported(
  key: string,
  engine: ConnectionEngine,
): boolean {
  if (
    key === CONNECTION_TIME_ZONE_PARAMETER ||
    key === CONNECTION_KEEP_ALIVE_SECONDS_PARAMETER
  ) {
    return engine === "postgres" || engine === "mysql";
  }
  if (key === CONNECTION_STARTUP_SCRIPT_PARAMETER) {
    return engine === "postgres" || engine === "mysql";
  }
  if (key === CONNECTION_SSH_ALIAS_PARAMETER) {
    return engine !== "sqlite" && engine !== "bigquery";
  }
  return isConnectionOptionParameter(key);
}

/**
 * Whether PostgreSQL traffic goes through a transaction-mode pooler, where server
 * sessions are shared and DopeDB runs no session statement such as the startup
 * script. Mirrors `pg_transaction_pooler` in `src-tauri/src/connection/providers.rs`.
 */
export function isPostgresTransactionPooler(
  profile: ConnectionProfile,
): boolean {
  const host = profile.host.trim().toLowerCase();
  return (
    (host.includes("pooler.supabase.com") && profile.port === 6543) ||
    (host.includes("-pooler.") && host.endsWith(".neon.tech")) ||
    profile.extraParams[CONNECTION_TRANSACTION_POOLER_PARAMETER]
      ?.trim()
      .toLowerCase() === "true"
  );
}

export function isSshHostAlias(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length > 0 &&
    normalized.length <= 255 &&
    !normalized.startsWith("-") &&
    /^[A-Za-z0-9._-]+$/u.test(normalized)
  );
}

export function connectionOption(
  profile: ConnectionProfile,
  key: string,
): string {
  return profile.extraParams[key] ?? "";
}

export function isBoundedConnectionOptionSeconds(
  value: string,
  min: number,
  max: number,
): boolean {
  if (!/^\d+$/u.test(value.trim())) return false;
  const seconds = Number(value);
  return (
    Number.isSafeInteger(seconds) &&
    seconds >= min &&
    seconds <= max
  );
}

export function isConnectionTimeZone(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length > 0 &&
    normalized.length <= 64 &&
    /^[A-Za-z0-9_./:+-]+$/u.test(normalized)
  );
}
