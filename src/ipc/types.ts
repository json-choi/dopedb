// Public shared-contract facade. The issue #10 Rust model/protocol/introspection
// DTOs below are generated from their serde producers via ts-rs; Query receipts
// remain feature-owned. The explicitly marked manual transports later in this file
// are outside that generation boundary and are not schema-parity claims.
import type {
  AuditEntry,
  Engine,
  HistoryEntry,
  QueryKind,
} from "./generated/model";
import type { OperationState as GeneratedOperationState } from "./generated/protocol-contracts";

export type {
  AuditEntry,
  ConnectionProviderTarget,
  ConnectionProfile,
  DocumentPage,
  Engine,
  ExecOutcome,
  HistoryEntry,
  JsonValue,
  MonitoringStatus,
  NeonBranchState,
  Provider,
  QueryKind,
  QueryResult,
  SafetySettings,
  ScriptOutcome,
  ScriptStatement,
  WorkspaceConnectionAccess,
  WorkspaceCredentialMode,
} from "./generated/model";

export type {
  SkillBackup,
  SkillConflict,
  SkillConflictKind,
  SkillInstallState,
  SkillStatusReason,
  SkillSummary,
  SkillTarget,
  SkillTargetExpectation,
  SkillTargetSelection,
  SkillTargetStatus,
  SkillStatusResult as SkillStatus,
  SkillMutationResult as SkillMutationReceipt,
} from "./generated/protocol-contracts";

// This is an alias, not a permissive cache-era mirror: the generated Rust DTO is
// the public schema, including serde's omitted-default request fields and variants.
export type { DocumentQuery } from "./generated/model";
export type {
  CatalogSnapshot,
  Namespace as CatalogNamespace,
  ObjectKind as CatalogObjectKindV2,
  ObjectRef as CatalogObjectRef,
  ConstraintKind as CatalogConstraintKind,
  Constraint as CatalogConstraint,
  IndexKey as CatalogIndexKey,
  Relation as CatalogRelationV2,
} from "./generated/protocol-contracts";
export type {
  Catalog,
  CatalogOverview,
  CatalogOverviewDetailState,
  CatalogOverviewRelation,
  CatalogOverviewRelationRef,
  Column as CatalogColumn,
  ForeignKey as CatalogForeignKey,
  Index as CatalogIndex,
  Table as CatalogTable,
  DatabaseObject as CatalogObject,
  DatabaseSummary,
} from "./generated/catalog-feature-contracts";
export type CatalogObjectKind = import("./generated/catalog-feature-contracts").DatabaseObject["kind"];

// Manual contract outside issue #10's generated boundary (CLI transport).
export interface CliInstallationStatus {
  version: string;
  bundledAvailable: boolean;
  bundledPath: string | null;
  inAppDirectory: string | null;
  installPath: string;
  installed: boolean;
  current: boolean;
  conflict: boolean;
  pathConfigured: boolean;
  pathChangeRequired: boolean;
  pathChangeSupported: boolean;
  pathChangePreview: string | null;
}

export interface CliInstallReceipt {
  status: CliInstallationStatus;
  binaryChanged: boolean;
  pathChanged: boolean;
}

export interface SkillSelfTestReceipt {
  appVersion: string;
  releaseRevision: number;
  guideBytes: number;
}

// Shared Operation projections used by feature-owned SQL, document, script, and
// monitoring adapters. SQL appears only in the proposal request, never run.
export type { OperationState } from "./generated/protocol-contracts";

export interface OperationDecision {
  operationId: string;
  payloadHash: string;
  state: GeneratedOperationState;
}

export interface DocumentOperationProposal {
  operationId: string;
  payloadHash: string;
  state: GeneratedOperationState;
  expiresAt: string;
}

export interface ScriptOperationProposal {
  operationId: string;
  payloadHash: string;
  state: GeneratedOperationState;
  approvalRequired: boolean;
  confirmationPhrase: string | null;
  statementCount: number;
  expiresAt: string;
}

// Manual contract outside issue #10's generated boundary (monitoring transport).
export interface MonitoringOperationProposal {
  operationId: string;
  payloadHash: string;
  state: GeneratedOperationState;
  enabled: boolean;
  sql: string;
  confirmationPhrase: string | null;
  expiresAt: string;
}

export interface AuditVerdict {
  ok: boolean;
  firstBadIndex: number | null;
  firstBadId: string | null;
  entryCount: number;
  tailHash: string | null;
}

export interface HistoryCursor {
  executedAt: string;
  rowId: number;
}

export interface HistoryEntrySummary {
  id: string;
  connectionId: string;
  sqlPreview: string;
  sqlTruncated: boolean;
  kind: QueryKind;
  status: string;
  rowCount: number | null;
  durationMs: number | null;
  errorPreview: string | null;
  errorTruncated: boolean;
  executedAt: string;
  origin: string;
}

export interface HistoryPage {
  items: HistoryEntrySummary[];
  nextCursor: HistoryCursor | null;
  statuses: string[];
  origins: string[];
}

export interface HistoryPageRequest {
  connectionId: string;
  cursor: HistoryCursor | null;
  search: string | null;
  status: string | null;
  origin: string | null;
}

export interface AuditCursor {
  rowId: number;
}

export interface AuditEntrySummary {
  id: string;
  connectionId: string;
  ts: string;
  engine: Engine;
  agentPromptPreview: string | null;
  agentPromptTruncated: boolean;
  sqlPreview: string;
  sqlTruncated: boolean;
  kind: QueryKind;
  action: string;
  approvedBy: string | null;
  affectedEstimate: number | null;
  errorPreview: string | null;
  errorTruncated: boolean;
  prevHash: string | null;
  hash: string;
}

export interface AuditPage {
  items: AuditEntrySummary[];
  nextCursor: AuditCursor | null;
}

export type AuditEntryDetail = AuditEntry;
export type HistoryEntryDetail = HistoryEntry;

// The `{ kind, message, position? }` object AppError serializes to.
interface AppErrorShape {
  kind: string;
  message: string;
  /** 1-based character offset into the executed SQL (Postgres only). */
  position?: number;
}

export function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as AppErrorShape).message);
  }
  return String(e);
}

/** True only when Rust confirmed a non-mutating query cancellation response. */
export function isQueryCancellationError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const shaped = e as Partial<AppErrorShape>;
  return shaped.kind === "safety"
    && typeof shaped.message === "string"
    && shaped.message.includes("query cancelled");
}

export interface AppErrorDetails {
  kind: string | null;
  message: string;
  position: number | null;
  raw: string;
}

export function errDetails(e: unknown): AppErrorDetails {
  if (e && typeof e === "object" && "message" in e) {
    const shaped = e as Partial<AppErrorShape>;
    let raw = String(e);
    try {
      raw = JSON.stringify(e, null, 2) ?? raw;
    } catch {
      // Fall back to String(e).
    }
    return {
      kind: typeof shaped.kind === "string" ? shaped.kind : null,
      message: String(shaped.message),
      position: typeof shaped.position === "number" ? shaped.position : null,
      raw,
    };
  }
  return { kind: null, message: String(e), position: null, raw: String(e) };
}
