// Generated from src-tauri/src/model.rs by ts-rs 12.0.1.
// Keep this checked-in wire contract synchronized with the Rust DTOs.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export type Engine = "postgres" | "mysql" | "sqlite" | "mongodb" | "bigquery";
export type Provider = "auto" | "generic" | "neon" | "planetScale" | "gcpCloudSql";
export type WorkspaceConnectionAccess = "view" | "read" | "write" | "manage" | "local";
export type WorkspaceCredentialMode = "local" | "memberLocal" | "managed";
export type NeonBranchState = "init" | "resetting" | "ready" | "archived" | "unknown";
export type ConnectionProviderTarget = { provider: "neon", projectId: string, branchId: string, branchName: string | null, currentState: NeonBranchState | null, pendingState: NeonBranchState | null, default: boolean | null, protected: boolean | null };
export type ConnectionProfile = { id: string, name: string, engine: Engine,
/**
 * Provider overlay selected by the user; `Auto` resolves from the endpoint.
 */
provider: Provider,
/**
 * Explicit driver selection. `None` asks the registry for its best compatible driver.
 */
driverId: string | null, host: string, port: number, database: string, username: string, sslmode: string, extraParams: { [key in string]: string },
/**
 * Open connections read-only by default.
 */
readonlyDefault: boolean,
/**
 * Master per-connection gate for the write path (default false).
 */
allowWrites: boolean,
/**
 * Credential-store item id for the secret, if one has been stored.
 */
secretRef: string | null,
/**
 * Environment label ("dev" | "staging" | "prod") — drives the sidebar/header chip.
 */
env: string | null,
/**
 * Shared schema family. Connections with the same value are compared as
 * dev/staging/prod siblings, using prod as the default baseline when present.
 */
schemaGroup: string | null,
/**
 * Local cache of the authenticated workspace member's effective permission.
 */
workspaceAccess: WorkspaceConnectionAccess,
/**
 * Personal, member-local OS credential, or server-brokered in-memory lease.
 */
credentialMode: WorkspaceCredentialMode,
/**
 * Provider-owned target identity cached from the authenticated workspace.
 * Local connections never populate this field.
 */
providerTarget: ConnectionProviderTarget | null, };
export type SafetySettings = {
allowWrites: boolean,
/**
 * Device-local opt-in for DDL. This can only narrow a local owner credential
 * or a workspace-managed schema lease authorized by an exact manage grant.
 */
allowSchemaChanges: boolean, wrapWritesInTx: boolean, explainPreview: boolean, autoRunReads: boolean,
/**
 * Row cap applied to read result sets.
 */
maxRows: number,
/**
 * L3 gate (design-review #4): skip execute-preview when the EXPLAIN row estimate
 * exceeds this and show the estimate only ("would lock ~N rows").
 */
execPreviewRowLimit: number, };
export type MonitoringStatus = { engine: Engine,
/**
 * "full" when pg_monitor is granted, "limited" without it, "basic" for
 * engines that do not use PostgreSQL's predefined monitoring roles.
 */
coverage: string, roleAvailable: boolean, roleGranted: boolean, currentUser: string | null,
/**
 * Best-effort hint only. The server remains authoritative when GRANT/REVOKE runs.
 */
canManage: boolean, note: string, };
export type QueryKind = "read" | "write" | "ddl" | "privilege";
export type RiskLevel = "low" | "medium" | "high";
export type Classification = { kind: QueryKind, risk: RiskLevel,
/**
 * Number of top-level statements parsed. `> 1` is rejected.
 */
statementCount: number,
/**
 * UPDATE/DELETE without a WHERE clause (high-risk flag).
 */
noWhere: boolean, tables: Array<string>, notes: Array<string>,
/**
 * True ONLY for exactly one cleanly-parsed top-level INSERT/UPDATE/DELETE —
 * i.e. a statement the exact write executor can handle as bounded DML.
 * Fail-safe, parse-error, multi-statement, DDL, and utility writes are false.
 */
directDml: boolean, };
export type PreviewMode = "explain" | "skipped";
export type PreviewReport = { mode: PreviewMode,
/**
 * EXPLAIN-derived row estimate.
 */
estimatedRows: number | null,
/**
 * Raw/formatted plan text, if captured.
 */
plan: string | null,
/**
 * Human note, e.g. "would lock ~120000 rows — preview skipped".
 */
note: string | null, };
export type QueryResult = { columns: Array<string>, rows: Array<Array<JsonValue>>, rowCount: number,
/**
 * True if the result was cut off at the row cap.
 */
truncated: boolean, durationMs: number, };
export type DocumentQuery = { "op": "find", collection: string, filter?: JsonValue | null, projection?: JsonValue | null, sort?: JsonValue | null, skip?: number | null, limit?: number | null, } | { "op": "aggregate", collection: string, pipeline: Array<JsonValue>, } | { "op": "count", collection: string, filter?: JsonValue | null, };
export type DocumentPage = { documents: Array<JsonValue>, docCount: number,
/**
 * True if the result was cut off at the row cap.
 */
truncated: boolean, durationMs: number, };
export type ExecOutcome = { result: QueryResult | null, affected: number | null,
/**
 * True only when a write actually committed.
 */
committed: boolean, manualTransaction: boolean, };
export type ScriptStatement = { sql: string, result: QueryResult | null, affected: number | null, error: string | null, };
export type ScriptOutcome = { statements: Array<ScriptStatement>, committed: boolean, allReads: boolean, manualTransaction: boolean, };
export type AuditEntry = { id: string, connectionId: string, ts: string, engine: Engine, agentPrompt: string | null, sql: string, kind: QueryKind,
/**
 * e.g. "propose" | "approve" | "reject" | "execute" | "blocked".
 */
action: string, approvedBy: string | null, affectedEstimate: number | null, error: string | null, prevHash: string | null,
/**
 * SHA256(prev_hash ‖ canonical_row) — tamper-evidence chain link.
 */
hash: string, };
export type HistoryEntry = { id: string, connectionId: string, sql: string, kind: QueryKind,
/**
 * "ok" | "error" | "blocked".
 */
status: string, rowCount: number | null, durationMs: number | null, error: string | null, executedAt: string,
/**
 * "agent" | "manual" | "analysis_article" | surface id.
 */
origin: string, };
