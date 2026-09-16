// The reserved dopedb.* extra parameters that carry connection options, the
// engines each one applies to, and the bounds a value must satisfy. Validation
// lives here so the form and the diagnostics share one definition of valid.
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
