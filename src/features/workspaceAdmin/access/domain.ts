// Database access contracts for one team workspace: the shared databases the acting
// member manages, each database's member grants, and preserved offline edits that
// conflict with the current version. The pure policies mirror the server's grant
// ordering and conflict-decision eligibility so the screen never guesses which
// request is valid; response validation lives in parsers.ts.
import type { Lang } from "../../../lib/i18n";
import type { ConflictResolution, ConnectionCapability } from "../domain";

export type CredentialMode = "managed" | "member_local";
export type GrantOrigin = "explicit" | "team";

export interface SharedDatabase {
  id: string;
  name: string;
  engine: string;
  /** The acting member's effective access; only "manage" may administer grants. */
  accessMode: string;
  credentialMode: CredentialMode;
  allowWrites: boolean;
  writeAvailable: boolean;
}

export interface MemberGrant {
  memberId: string;
  name: string;
  email: string;
  role: string;
  capability: ConnectionCapability | null;
  origin: GrantOrigin | null;
}

export interface GrantSnapshot {
  connectionId: string;
  actorMemberId: string;
  teamReadEnabled: boolean;
  grants: MemberGrant[];
}

export interface ConflictPayload {
  name: string;
  engine: string;
  provider: string;
  driverId: string | null;
  host: string;
  port: number;
  database: string;
  sslmode: string;
  readonlyDefault: boolean;
  allowWrites: boolean;
  env: string | null;
  schemaGroup: string | null;
  deleted: boolean;
}

export interface ConflictVersion {
  id: string;
  revision: number;
  operation: "create" | "update" | "delete" | "restore";
  payload: ConflictPayload;
}

export interface ConnectionConflict {
  id: string;
  connectionId: string;
  connectionName: string;
  expectedRevision: number;
  createdAt: string;
  current: ConflictVersion;
  server: ConflictVersion;
  candidate: ConflictVersion;
  currentMatchesServer: boolean;
  currentMatchesCandidate: boolean;
}

const CAPABILITY_RANK: Record<ConnectionCapability, number> = {
  view: 0,
  read: 1,
  use: 2,
  manage: 3,
};

export function isConnectionCapability(value: unknown): value is ConnectionCapability {
  return value === "view" || value === "read" || value === "use" || value === "manage";
}

/** Grants and conflicts are administered only where the member holds manage access. */
export function manageableDatabases(databases: readonly SharedDatabase[]): SharedDatabase[] {
  return databases.filter((database) => database.accessMode === "manage");
}

/**
 * The control plane only raises or keeps a grant. Lowering removes the current
 * grant first (draining that member's active credentials), then grants the lower
 * level; choosing no access is the removal alone.
 */
export type GrantChangePlan = {
  remove: boolean;
  grant: ConnectionCapability | null;
};

export function planGrantChange(
  previous: ConnectionCapability | null,
  next: ConnectionCapability | null,
): GrantChangePlan | null {
  if (previous === next) return null;
  if (next === null) return { remove: true, grant: null };
  return {
    remove: previous !== null && CAPABILITY_RANK[next] < CAPABILITY_RANK[previous],
    grant: next,
  };
}

/**
 * Keeping the current version is recorded against what the current version is:
 * the version seen at detection ("server"), a later version that already equals
 * the candidate ("candidate"), or a different later version ("dismissed").
 */
export function keepCurrentResolution(conflict: ConnectionConflict): ConflictResolution {
  if (conflict.currentMatchesServer) return "server";
  return conflict.currentMatchesCandidate ? "candidate" : "dismissed";
}

/** After the candidate is current, only an untouched detection version is kept as "server". */
export function applyCandidateResolution(
  conflict: ConnectionConflict,
): Extract<ConflictResolution, "server" | "candidate"> {
  return conflict.currentMatchesServer && conflict.currentMatchesCandidate
    ? "server"
    : "candidate";
}

/** The existing connection mutation path accepts exactly the template fields. */
export function candidateTemplate(payload: ConflictPayload): Record<string, unknown> {
  return {
    name: payload.name,
    engine: payload.engine,
    provider: payload.provider,
    driverId: payload.driverId,
    host: payload.host,
    port: payload.port,
    database: payload.database,
    sslmode: payload.sslmode,
    readonlyDefault: payload.readonlyDefault,
    allowWrites: payload.allowWrites,
    env: payload.env,
    schemaGroup: payload.schemaGroup,
  };
}

export type ConflictField = Exclude<keyof ConflictPayload, "readonlyDefault">;

export const CONFLICT_FIELDS: readonly ConflictField[] = [
  "name",
  "engine",
  "provider",
  "driverId",
  "host",
  "port",
  "database",
  "sslmode",
  "env",
  "schemaGroup",
  "allowWrites",
  "deleted",
];

export function changedConflictFields(
  current: ConflictPayload,
  candidate: ConflictPayload,
): ConflictField[] {
  return CONFLICT_FIELDS.filter((field) => current[field] !== candidate[field]);
}

const RELATIVE_STEPS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number, number]> = [
  ["second", 1, 45],
  ["minute", 60, 45 * 60],
  ["hour", 60 * 60, 22 * 60 * 60],
  ["day", 24 * 60 * 60, 26 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60, 320 * 24 * 60 * 60],
];

/** A short localized "3 hours ago" label; the absolute time belongs in a title. */
export function relativeTimeLabel(iso: string, lang: Lang, now = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  const seconds = (time - now) / 1000;
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  for (const [unit, size, limit] of RELATIVE_STEPS) {
    if (Math.abs(seconds) < limit) {
      return format.format(unit === "second" ? 0 : Math.round(seconds / size), unit);
    }
  }
  return format.format(Math.round(seconds / (365 * 24 * 60 * 60)), "year");
}

export function absoluteTimeLabel(iso: string, lang: Lang): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  return new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(time));
}
