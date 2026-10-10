// Pure rules for the shared database view and its add flow: which provider levels
// Desktop may browse, the exact discovery request for each level, provider target
// paths, response checks for discovery, receipts and imports, and the import name
// policy. No React, I/O or query cache access.
import type { I18nKey } from "../../../../lib/i18n";
import type {
  EnvironmentClassification,
  ProviderResourceKind,
  ProviderSelectionKey,
} from "../../domain";
import type {
  ManagedConnection,
  NeonEnvironmentClassification,
  Provider,
  Resource,
  SharedConnection,
} from "../domain";

/** Selection proofs expire after five minutes; reuse a discovered list for at most four. */
export const PROOF_REUSE_MS = 4 * 60_000;

/** Every provider exposes exactly three levels; the last one is the importable leaf. */
export const LEVEL_INDEXES = [0, 1, 2] as const;
export const LEAF_INDEX = 2;

const RESOURCE_KINDS: readonly string[] = [
  "organizations",
  "projects",
  "databases",
  "branches",
  "instances",
  "brokers",
  "targets",
] satisfies readonly ProviderResourceKind[];

const SELECTION_KEYS: readonly string[] = [
  "organization",
  "project",
  "database",
  "branch",
  "instance",
  "engine",
  "networkMode",
  "broker",
  "target",
] satisfies readonly ProviderSelectionKey[];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export type BrowsableLevel = Readonly<{
  key: ProviderSelectionKey;
  kind: ProviderResourceKind;
  label: string;
}>;

export type WizardError = Readonly<{
  message: string;
  /** The refusal names an account problem the provider accounts view can fix. */
  reconnect: boolean;
}>;

export const RESOURCE_LEVEL_LABELS: Readonly<Record<ProviderResourceKind, I18nKey>> = {
  organizations: "workspaceProviderDatabases.level.organizations",
  projects: "workspaceProviderDatabases.level.projects",
  instances: "workspaceProviderDatabases.level.instances",
  databases: "workspaceProviderDatabases.level.databases",
  branches: "workspaceProviderDatabases.level.branches",
  brokers: "workspaceProviderDatabases.level.brokers",
  targets: "workspaceProviderDatabases.level.targets",
};

function isResourceKind(value: string): value is ProviderResourceKind {
  return RESOURCE_KINDS.includes(value);
}

function isSelectionKey(value: string): value is ProviderSelectionKey {
  return SELECTION_KEYS.includes(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !CONTROL.test(value);
}

/**
 * The provider's three levels when every kind and selection key belongs to the closed
 * IPC contract; otherwise Desktop cannot browse this provider and returns null.
 */
export function browsableLevels(provider: Provider | null): readonly BrowsableLevel[] | null {
  if (!provider || !Array.isArray(provider.resourceLevels)) return null;
  if (provider.resourceLevels.length !== LEVEL_INDEXES.length) return null;
  const levels: BrowsableLevel[] = [];
  for (const level of provider.resourceLevels) {
    if (!isResourceKind(level.kind) || !isSelectionKey(level.key)) return null;
    levels.push({ key: level.key, kind: level.kind, label: level.label });
  }
  return new Set(levels.map((level) => level.key)).size === levels.length ? levels : null;
}

/**
 * The parent selection a level is discovered with: exactly the values chosen above
 * it, in level order. Null until every parent level has a value.
 */
export function discoverySelection(
  levels: readonly BrowsableLevel[],
  selection: Readonly<Record<string, string>>,
  index: number,
): Partial<Record<ProviderSelectionKey, string>> | null {
  const request: Partial<Record<ProviderSelectionKey, string>> = {};
  for (const level of levels.slice(0, index)) {
    const value = selection[level.key];
    if (!value) return null;
    request[level.key] = value;
  }
  return request;
}

/** `level1 / level2 / level3` of the provider resource a managed connection is pinned to. */
export function managedTargetPath(managed: ManagedConnection, provider: Provider | null): string {
  if (!provider) return "";
  const resource = record(managed.resource) ?? {};
  return provider.resourceLevels
    .map((level) => resource[level.key])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" / ");
}

/**
 * Members who manage the database can repair its managed access: Cloud SQL by
 * re-authorizing its pinned project and instance, every other provider by
 * reconnecting the account that serves it.
 */
export function canRepairManagedAccess(
  connection: SharedConnection,
  managed: ManagedConnection | null,
): managed is ManagedConnection {
  return managed !== null && connection.accessMode === "manage";
}

export function canRemoveSharedConnection(connection: SharedConnection): boolean {
  return connection.accessMode === "manage"
    && Number.isInteger(connection.revision)
    && connection.revision >= 1;
}

/** Thrown by discovery when the control plane answers with an incompatible list. */
export class ResourceListShapeError extends Error {
  constructor() {
    super("The provider returned an incompatible resource list.");
    this.name = "ResourceListShapeError";
  }
}

function providerResource(value: unknown): Resource | null {
  const row = record(value);
  if (
    !row
    || !boundedText(row.id, 1_024)
    || !boundedText(row.name, 1_024)
    || !boundedText(row.value, 512)
  ) {
    return null;
  }
  const resource: Resource = { id: row.id, name: row.name, value: row.value };
  if (row.kind === "postgres" || row.kind === "mysql") resource.kind = row.kind;
  if (row.production === true || row.production === false || row.production === "unknown") {
    resource.production = row.production;
  }
  if (typeof row.ready === "boolean") resource.ready = row.ready;
  if (typeof row.safeMigrations === "boolean") resource.safeMigrations = row.safeMigrations;
  if (
    typeof row.selectionProof === "string"
    && row.selectionProof.length >= 16
    && row.selectionProof.length <= 16 * 1_024
    && !/\s/.test(row.selectionProof)
  ) {
    resource.selectionProof = row.selectionProof;
  }
  return resource;
}

/** Discovered items with the fields the flow relies on; malformed items are dropped. */
export function parseProviderResources(value: unknown): Resource[] {
  const body = record(value);
  if (!body || !Array.isArray(body.resources)) throw new ResourceListShapeError();
  return body.resources.flatMap((item) => {
    const resource = providerResource(item);
    return resource ? [resource] : [];
  });
}

export function isFutureInstant(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && instant > now;
}

/** The one-use import receipt exchanged for a final-leaf selection proof. */
export function parseClaimReceipt(value: unknown, now = Date.now()) {
  const row = record(value);
  if (
    !row
    || typeof row.receipt !== "string"
    || !UUID.test(row.receipt)
    || typeof row.receiptExpiresAt !== "string"
    || !isFutureInstant(row.receiptExpiresAt, now)
  ) {
    return null;
  }
  return { receipt: row.receipt, receiptExpiresAt: row.receiptExpiresAt };
}

/** The shared connection an import created; only its identity is needed here. */
export function parseImportedConnection(value: unknown): { id: string; name: string } | null {
  const connection = record(record(value)?.connection);
  return connection && boundedText(connection.id, 128) && boundedText(connection.name, 512)
    ? { id: connection.id, name: connection.name }
    : null;
}

/** The control plane accepts one trimmed line of at most 120 UTF-16 units. */
export function importNameIssue(name: string): I18nKey | null {
  const trimmed = name.trim();
  if (!trimmed) return "workspaceProviderDatabases.nameRequired";
  if (trimmed.length > 120 || CONTROL.test(trimmed)) {
    return "workspaceProviderDatabases.nameInvalid";
  }
  return null;
}

/** Idempotency keys stay with one exact request so a retry can never apply twice. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * The environment a Neon branch is prepared as: the provider's protection flag wins,
 * and only an unclassified branch uses the administrator's explicit choice.
 */
export function neonEnvironment(
  branch: Resource | null,
  classification: NeonEnvironmentClassification,
): EnvironmentClassification | null {
  if (branch?.production === true) return "production";
  if (branch?.production === false) return "development";
  return classification || null;
}
