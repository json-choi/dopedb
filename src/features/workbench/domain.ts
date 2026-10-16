// Workbench document domain. Stable ids describe singleton resources, while query
// documents use unique ids and retain their connection scope. A History entry
// reopens in the database and schema its run recorded.

import type { CatalogTable, HistoryEntry } from "../../ipc/types";
import type { SqlDocument } from "../sqlDocuments/domain";
import { sqlRecoveryKey } from "../sqlDocuments/domain";
import { tableKey } from "../../lib/tableRef";
import {
  DEFAULT_SQL_RESOLVE_MODE,
  type SqlResolveMode,
} from "../queries/resolveMode";

export type WorkbenchDocument =
  | {
      id: string;
      connectionId: string;
      kind: "data";
      table: CatalogTable;
    }
  | {
      id: string;
      connectionId: string;
      kind: "welcome" | "schema" | "activity" | "results";
    }
  | {
      id: string;
      connectionId: string;
      kind: "sql";
      draft: string;
      title: string;
      selectedDatabase: string;
      selectedSchema: string | null;
      resolveMode: SqlResolveMode;
      persistedId: string | null;
      revision: number;
      recovered: boolean;
    }
  | {
      id: string;
      connectionId: string;
      kind: "documents";
      draft: string | null;
    };

export type QueryDocument = Extract<
  WorkbenchDocument,
  { kind: "sql" | "documents" }
>;

let sequence = 0;

export function stableDocument(
  connectionId: string,
  kind: "welcome" | "schema" | "activity" | "results",
): WorkbenchDocument {
  return { id: `${connectionId}:${kind}`, connectionId, kind };
}

export function tableDocument(
  connectionId: string,
  table: CatalogTable,
): WorkbenchDocument {
  return {
    id: `${connectionId}:data:${tableKey(table)}`,
    connectionId,
    kind: "data",
    table,
  };
}

export function queryDocument(
  connectionId: string,
  kind: QueryDocument["kind"],
  draft?: string | null,
  database = "",
  untitledTitle = "Untitled query",
): QueryDocument {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}-${sequence.toString(36)}`;
  return kind === "sql"
      ? {
        id: `${connectionId}:sql:${suffix}`,
        connectionId,
        kind,
        draft: draft ?? "SELECT 1;",
        title: untitledTitle,
        selectedDatabase: database,
        selectedSchema: null,
        resolveMode: DEFAULT_SQL_RESOLVE_MODE,
        persistedId: null,
        revision: 0,
        recovered: false,
      }
    : {
        id: `${connectionId}:documents:${suffix}`,
        connectionId,
        kind,
        draft: draft ?? null,
      };
}

interface SqlRecoverySnapshot {
  revision: number;
  title: string;
  draft: string;
  selectedDatabase: string;
  selectedSchema: string | null;
  resolveMode: SqlResolveMode;
}

function readRecovery(document: SqlDocument): SqlRecoverySnapshot | null {
  try {
    const raw = localStorage.getItem(sqlRecoveryKey(document.id));
    if (!raw) return null;
    const recovery = JSON.parse(raw) as Partial<SqlRecoverySnapshot>;
    if (
      recovery.revision !== document.localRevision ||
      typeof recovery.title !== "string" ||
      typeof recovery.draft !== "string" ||
      !(
        recovery.selectedDatabase === undefined ||
        typeof recovery.selectedDatabase === "string"
      ) ||
      !(
        recovery.selectedSchema === undefined ||
        recovery.selectedSchema === null ||
        typeof recovery.selectedSchema === "string"
      ) ||
      !(
        recovery.resolveMode === undefined ||
        recovery.resolveMode === "playground" ||
        recovery.resolveMode === "script"
      )
    ) {
      return null;
    }
    return {
      revision: recovery.revision,
      title: recovery.title,
      draft: recovery.draft,
      selectedDatabase:
        recovery.selectedDatabase ?? document.selectedDatabase,
      selectedSchema: recovery.selectedSchema ?? null,
      resolveMode: recovery.resolveMode ?? DEFAULT_SQL_RESOLVE_MODE,
    };
  } catch {
    return null;
  }
}

export function persistedQueryDocument(document: SqlDocument): QueryDocument {
  const recovery = readRecovery(document);
  return {
    id: `${document.connectionId}:sql:${document.id}`,
    connectionId: document.connectionId,
    kind: "sql",
    draft: recovery?.draft ?? document.content,
    title: recovery?.title ?? document.title,
    selectedDatabase:
      recovery?.selectedDatabase ?? document.selectedDatabase,
    selectedSchema: recovery?.selectedSchema ?? document.selectedSchema,
    resolveMode: recovery?.resolveMode ?? document.resolveMode,
    persistedId: document.id,
    revision: document.localRevision,
    recovered:
      !!recovery &&
      (recovery.draft !== document.content ||
        recovery.title !== document.title ||
        recovery.selectedDatabase !== document.selectedDatabase ||
        recovery.selectedSchema !== document.selectedSchema ||
        recovery.resolveMode !== document.resolveMode),
  };
}

/** The console title, database, and schema a History entry reopens into. */
export type HistoryQueryTarget = {
  title: string;
  /** Null keeps the connection's default database. */
  database: string | null;
  /** Null lets the console resolve the server's default schema. */
  schema: string | null;
};

/**
 * A History entry reopens under `title` in the database and schema its run
 * recorded. Entries recorded without a target (runs on the connection's default,
 * other surfaces, older rows) open in the connection's default target.
 */
export function historyQueryTarget(
  entry: Pick<HistoryEntry, "database" | "namespace">,
  title: string,
): HistoryQueryTarget {
  return {
    title,
    database: entry.database || null,
    schema: entry.namespace || null,
  };
}
