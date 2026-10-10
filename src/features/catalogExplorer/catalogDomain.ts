// Defines Explorer catalog error recovery, object labels, and drag-target contracts.

import {
  errDetails,
  type Catalog,
  type CatalogObject,
  type CatalogObjectKind,
  type CatalogTable,
} from "../../ipc/types";
import type { ConnectionProfile } from "../connections/domain";
import type { IconName } from "../../components/Icon";
import type { I18nKey } from "../../lib/i18n";

type Translate = (
  key: I18nKey,
  vars?: Record<string, string | number>,
) => string;

export type DropTarget =
  | { kind: "connection"; id: string }
  | { kind: "group"; key: string }
  | { kind: "environment"; id: string }
  | {
      kind: "projectDatabaseOrder";
      projectId: string;
      draggedBindingId: string;
      targetBindingId: string;
      placement: "before" | "after";
    }
  | {
      kind: "projectDatabases";
      projectId: string;
      environmentId: string;
    };

export type ProjectDatabaseOrderDrag = {
  projectId: string;
  bindingId: string;
  blockFirstBindingId: string;
  blockLastBindingId: string;
  blockConnectionIds: readonly string[];
  previousBlockBindingId: string | null;
  nextBlockBindingId: string | null;
};

export const CATALOG_LOAD_ISSUE_CODES = [
  "sshClientMissing",
  "sshConfiguration",
  "sshHostKey",
  "sshAuthentication",
  "sshForwarding",
  "sshTimeout",
  "sshUnknown",
  "connectionNetwork",
  "connectionTls",
  "connectionAuthentication",
  "connectionConfiguration",
  "connectionUnknown",
  "cancelled",
  "credentialBindingRequired",
  "authenticationRequired",
  "managedConnectionRecoveryRequired",
  "blocked",
  "network",
  "timeout",
  "notFound",
  "unknown",
  "sharedConnectionChanged",
  "credentialStoreDenied",
  "lockTimeout",
] as const;

export type CatalogLoadIssueCode =
  (typeof CATALOG_LOAD_ISSUE_CODES)[number];

/**
 * Safe identity only: backend message text must not enter Explorer state or UI.
 * `retryAt` (epoch ms) is when the runtime accepts a new open, fixed when it refused.
 */
export type CatalogLoadIssue = Readonly<{
  code: CatalogLoadIssueCode;
  retryAt?: number;
}>;

const CATALOG_LOAD_ISSUE_CODE_SET = new Set<string>(
  CATALOG_LOAD_ISSUE_CODES,
);

function normalizedCatalogIssueCode(kind: string | null): CatalogLoadIssueCode {
  if (kind && CATALOG_LOAD_ISSUE_CODE_SET.has(kind)) {
    return kind as CatalogLoadIssueCode;
  }
  if (kind === "config") return "connectionConfiguration";
  if (kind === "safety") return "blocked";
  // A missing credential arrives as `credentialBindingRequired`; `keychain` means the
  // OS credential store refused access, which is recovered by allowing it and retrying.
  if (kind === "keychain") return "credentialStoreDenied";
  return "unknown";
}

export function isCatalogLoadIssue(error: unknown): error is CatalogLoadIssue {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return typeof error.code === "string"
    && CATALOG_LOAD_ISSUE_CODE_SET.has(error.code);
}

export function catalogLoadIssue(error: unknown): CatalogLoadIssue {
  if (isCatalogLoadIssue(error)) {
    return typeof error.retryAt === "number"
      ? { code: error.code, retryAt: error.retryAt }
      : { code: error.code };
  }
  const details = errDetails(error);
  // The runtime refuses a managed open (`retryLater`) only while it cools down after
  // that open failed on the network. Keep that cause, plus when Retry may run again.
  if (details.kind === "retryLater") {
    return details.retryAfterSeconds === undefined
      ? { code: "connectionNetwork" }
      : {
          code: "connectionNetwork",
          retryAt: Date.now() + details.retryAfterSeconds * 1_000,
        };
  }
  return { code: normalizedCatalogIssueCode(details.kind) };
}

/** Drops raw transport/driver text before TanStack Query retains a failure. */
export async function readWithCatalogIssue<T>(
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw catalogLoadIssue(error);
  }
}

/** A refusal that names when the runtime accepts a new open is not retried before it. */
export function isTransientCatalogIssue(error: unknown): boolean {
  const { code, retryAt } = catalogLoadIssue(error);
  return retryAt === undefined
    && (code === "network"
      || code === "timeout"
      || code === "connectionNetwork"
      || code === "sshTimeout");
}

export function retryTransientCatalogIssue(
  failureCount: number,
  error: unknown,
): boolean {
  return failureCount < 3 && isTransientCatalogIssue(error);
}

/**
 * Catalog introspection retries only a dropped connection. A timeout means the scan
 * itself exceeded its bounded budget, which repeats identically: retrying would turn
 * one bounded failure into minutes of loading, so the UI offers a manual retry instead.
 * A managed open the runtime refuses until `retryAt` is shown with that time instead.
 */
export function retryCatalogScanIssue(
  failureCount: number,
  error: unknown,
): boolean {
  const { code, retryAt } = catalogLoadIssue(error);
  return failureCount < 2
    && retryAt === undefined
    && (code === "network" || code === "connectionNetwork");
}

export type CatalogIssueAction =
  | "retry"
  | "edit"
  | "resolveCredentials"
  | "recoverAuthentication"
  | "recoverManaged"
  | "refreshWorkspace";

/**
 * A catalog issue always reads as a complete sentence, also inside a longer message.
 * Connection-test titles are headings without a period, so they gain one here.
 */
export function catalogLoadIssueMessage(
  t: Translate,
  issue: CatalogLoadIssue,
): string {
  const sentence = (title: I18nKey) =>
    t("schema.issueSentence", { message: t(title) });
  switch (issue.code) {
    case "sshClientMissing": return sentence("connections.testFailure.sshClientMissingTitle");
    case "sshConfiguration": return sentence("connections.testFailure.sshConfigurationTitle");
    case "sshHostKey": return sentence("connections.testFailure.sshHostKeyTitle");
    case "sshAuthentication": return sentence("connections.testFailure.sshAuthenticationTitle");
    case "sshForwarding": return sentence("connections.testFailure.sshForwardingTitle");
    case "sshTimeout": return sentence("connections.testFailure.sshTimeoutTitle");
    case "sshUnknown": return sentence("connections.testFailure.sshUnknownTitle");
    case "connectionNetwork": return sentence("connections.testFailure.timeoutNetworkTitle");
    case "connectionTls": return sentence("connections.testFailure.tlsTitle");
    case "connectionAuthentication": return sentence("connections.testFailure.authenticationTitle");
    case "connectionConfiguration": return sentence("connections.testFailure.databaseConfigTitle");
    case "connectionUnknown": return sentence("connections.testFailure.unknownTitle");
    case "cancelled": return t("connections.catalogIssue.cancelled");
    case "credentialBindingRequired": return t("workspace.credentialsRequiredBody");
    case "authenticationRequired": return t("connections.bigQueryAuthenticationExpired");
    case "managedConnectionRecoveryRequired": return t("connections.catalogIssue.managed");
    case "blocked": return t("connections.catalogIssue.blocked");
    case "network": return t("connections.catalogIssue.network");
    case "timeout": return t("connections.catalogIssue.timeout");
    case "notFound": return t("connections.catalogIssue.notFound");
    case "unknown": return t("connections.catalogIssue.unknown");
    case "sharedConnectionChanged": return t("schema.sharedConnectionChanged");
    case "credentialStoreDenied": return t("schema.credentialStoreDenied");
    case "lockTimeout": return t("schema.lockTimeout");
  }
}

export function catalogLoadIssueAction(
  issue: CatalogLoadIssue,
): CatalogIssueAction | null {
  switch (issue.code) {
    case "credentialBindingRequired": return "resolveCredentials";
    case "authenticationRequired": return "recoverAuthentication";
    case "managedConnectionRecoveryRequired": return "recoverManaged";
    case "network":
    case "timeout":
    case "connectionNetwork":
    case "credentialStoreDenied":
    case "lockTimeout": return "retry";
    case "sharedConnectionChanged": return "refreshWorkspace";
    case "sshClientMissing":
    case "sshConfiguration":
    case "sshHostKey":
    case "sshAuthentication":
    case "sshForwarding":
    case "sshTimeout":
    case "sshUnknown":
    case "connectionTls":
    case "connectionAuthentication":
    case "connectionConfiguration":
    case "connectionUnknown": return "edit";
    case "blocked":
    case "cancelled":
    case "notFound":
    case "unknown": return null;
  }
}

export function isAuthenticationRequired(
  issue: CatalogLoadIssue | undefined,
): boolean {
  return issue?.code === "authenticationRequired";
}

export function isManagedConnectionRecoveryRequired(
  issue: CatalogLoadIssue | undefined,
): boolean {
  return issue?.code === "managedConnectionRecoveryRequired";
}

/** One failed backend read may feed both overview and detail observers. */
export function distinctCatalogDetailIssue(
  overview: CatalogLoadIssue | undefined,
  detail: CatalogLoadIssue | undefined,
): CatalogLoadIssue | undefined {
  return detail?.code === overview?.code
    ? undefined
    : detail;
}

export const SQL_OBJECT_SECTIONS: Array<{
  kind: CatalogObjectKind;
  icon: IconName;
  label:
    | "connections.materializedViews"
    | "connections.functions"
    | "connections.procedures"
    | "connections.sequences"
    | "connections.triggers"
    | "schema.types";
}> = [
  {
    kind: "materialized_view",
    icon: "materializedView",
    label: "connections.materializedViews",
  },
  { kind: "function", icon: "function", label: "connections.functions" },
  { kind: "procedure", icon: "procedure", label: "connections.procedures" },
  { kind: "sequence", icon: "sequence", label: "connections.sequences" },
  { kind: "trigger", icon: "trigger", label: "connections.triggers" },
  // User-defined enum and domain types; `detail` carries their definition.
  { kind: "type", icon: "list", label: "schema.types" },
];

export function supportedObjectKinds(engine: ConnectionProfile["engine"]) {
  if (engine === "postgres") {
    return new Set<CatalogObjectKind>([
      "materialized_view",
      "function",
      "procedure",
      "sequence",
      "trigger",
      "type",
    ]);
  }
  if (engine === "mysql") {
    return new Set<CatalogObjectKind>(["function", "procedure", "trigger"]);
  }
  if (engine === "bigquery") {
    return new Set<CatalogObjectKind>(["materialized_view"]);
  }
  if (engine === "sqlite") return new Set<CatalogObjectKind>(["trigger"]);
  return new Set<CatalogObjectKind>();
}

export function catalogObjectLabel(object: CatalogObject) {
  const qualified = object.schema
    ? `${object.schema}.${object.name}`
    : object.name;
  if (
    (object.kind === "function" || object.kind === "procedure") &&
    object.detail != null
  ) {
    return `${qualified}(${object.detail})`;
  }
  return qualified;
}

function stripEnvironmentTokens(value: string): string {
  return value
    .replace(
      /\b(development|staging|production|local|dev|stage|prod|qa|test)\b/gi,
      "",
    )
    .replace(
      /(^|[-_.\s]+)(development|staging|production|local|dev|stage|prod|qa|test)([-_.\s]+|$)/gi,
      "$1",
    )
    .replace(/[-_.\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

export function fallbackSchemaGroupName(
  first: ConnectionProfile,
  second: ConnectionProfile,
  connections: ConnectionProfile[],
): string {
  const candidates = [
    stripEnvironmentTokens(first.name),
    stripEnvironmentTokens(second.name),
    stripEnvironmentTokens(first.database),
    stripEnvironmentTokens(second.database),
    stripEnvironmentTokens(first.host.split(".")[0] ?? ""),
    stripEnvironmentTokens(second.host.split(".")[0] ?? ""),
  ].filter(Boolean);
  const base =
    candidates.find((candidate) => candidate.length >= 2) ?? "schema-group";
  const used = new Set(
    connections
      .map((connection) => connection.schemaGroup?.trim().toLocaleLowerCase())
      .filter(Boolean) as string[],
  );
  if (!used.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base}-${suffix}`;
}

const catalogNameCollator = new Intl.Collator(undefined, { numeric: true });

/** Numeric-aware locale order for identifiers: `t_2` sorts before `t_10`. */
export function compareCatalogNames(left: string, right: string): number {
  return catalogNameCollator.compare(left, right);
}

export function tableMatchesFilter(table: CatalogTable, filter: string) {
  return (
    table.name.toLowerCase().includes(filter) ||
    (table.schema ?? "").toLowerCase().includes(filter)
  );
}

export function objectMatchesFilter(
  object: CatalogObject,
  filter: string,
) {
  return [
    object.schema,
    object.name,
    object.kind,
    object.detail,
    object.parent,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(filter);
}

export function filterLoadedCatalogObjects(
  catalog: Catalog | undefined,
  filter: string,
) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!catalog) {
    return {
      normalizedFilter,
      tables: [] as CatalogTable[],
      objects: [] as CatalogObject[],
    };
  }
  if (!normalizedFilter) {
    return {
      normalizedFilter,
      tables: catalog.tables,
      objects: catalog.objects,
    };
  }
  return {
    normalizedFilter,
    tables: catalog.tables.filter((table) =>
      tableMatchesFilter(table, normalizedFilter),
    ),
    objects: catalog.objects.filter((object) =>
      objectMatchesFilter(object, normalizedFilter),
    ),
  };
}
