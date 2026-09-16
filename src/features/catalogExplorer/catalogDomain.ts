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
] as const;

export type CatalogLoadIssueCode =
  (typeof CATALOG_LOAD_ISSUE_CODES)[number];

/** Safe identity only: backend message text must not enter Explorer state or UI. */
export type CatalogLoadIssue = Readonly<{ code: CatalogLoadIssueCode }>;

const CATALOG_LOAD_ISSUE_CODE_SET = new Set<string>(
  CATALOG_LOAD_ISSUE_CODES,
);

function normalizedCatalogIssueCode(kind: string | null): CatalogLoadIssueCode {
  if (kind && CATALOG_LOAD_ISSUE_CODE_SET.has(kind)) {
    return kind as CatalogLoadIssueCode;
  }
  if (kind === "config") return "connectionConfiguration";
  if (kind === "safety") return "blocked";
  return "unknown";
}

export function isCatalogLoadIssue(error: unknown): error is CatalogLoadIssue {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return typeof error.code === "string"
    && CATALOG_LOAD_ISSUE_CODE_SET.has(error.code);
}

export function catalogLoadIssue(error: unknown): CatalogLoadIssue {
  if (isCatalogLoadIssue(error)) return { code: error.code };
  return { code: normalizedCatalogIssueCode(errDetails(error).kind) };
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

export function isTransientCatalogIssue(error: unknown): boolean {
  const { code } = catalogLoadIssue(error);
  return code === "network"
    || code === "timeout"
    || code === "connectionNetwork"
    || code === "sshTimeout";
}

export function retryTransientCatalogIssue(
  failureCount: number,
  error: unknown,
): boolean {
  return failureCount < 3 && isTransientCatalogIssue(error);
}

export type CatalogIssueAction =
  | "retry"
  | "edit"
  | "resolveCredentials"
  | "recoverAuthentication"
  | "recoverManaged";

export function catalogLoadIssueMessage(
  t: Translate,
  issue: CatalogLoadIssue,
): string {
  switch (issue.code) {
    case "sshClientMissing": return t("connections.testFailure.sshClientMissingTitle");
    case "sshConfiguration": return t("connections.testFailure.sshConfigurationTitle");
    case "sshHostKey": return t("connections.testFailure.sshHostKeyTitle");
    case "sshAuthentication": return t("connections.testFailure.sshAuthenticationTitle");
    case "sshForwarding": return t("connections.testFailure.sshForwardingTitle");
    case "sshTimeout": return t("connections.testFailure.sshTimeoutTitle");
    case "sshUnknown": return t("connections.testFailure.sshUnknownTitle");
    case "connectionNetwork": return t("connections.testFailure.timeoutNetworkTitle");
    case "connectionTls": return t("connections.testFailure.tlsTitle");
    case "connectionAuthentication": return t("connections.testFailure.authenticationTitle");
    case "connectionConfiguration": return t("connections.testFailure.databaseConfigTitle");
    case "connectionUnknown": return t("connections.testFailure.unknownTitle");
    case "cancelled": return t("connections.catalogIssue.cancelled");
    case "credentialBindingRequired": return t("workspace.credentialsRequiredBody");
    case "authenticationRequired": return t("connections.bigQueryAuthenticationExpired");
    case "managedConnectionRecoveryRequired": return t("connections.catalogIssue.managed");
    case "blocked": return t("connections.catalogIssue.blocked");
    case "network": return t("connections.catalogIssue.network");
    case "timeout": return t("connections.catalogIssue.timeout");
    case "notFound": return t("connections.catalogIssue.notFound");
    case "unknown": return t("connections.catalogIssue.unknown");
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
    case "connectionNetwork": return "retry";
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
    | "connections.triggers";
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
];

export function supportedObjectKinds(engine: ConnectionProfile["engine"]) {
  if (engine === "postgres") {
    return new Set<CatalogObjectKind>([
      "materialized_view",
      "function",
      "procedure",
      "sequence",
      "trigger",
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
