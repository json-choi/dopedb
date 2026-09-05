/** Durable Job Engine wire/domain contracts. */

declare const connectionIdBrand: unique symbol;
declare const jobIdBrand: unique symbol;
declare const capabilityIdBrand: unique symbol;
declare const artifactIdBrand: unique symbol;
declare const operationIdBrand: unique symbol;

export type ConnectionId = string & { readonly [connectionIdBrand]: true };
export type JobId = string & { readonly [jobIdBrand]: true };
export type JobFileCapabilityId = string & {
  readonly [capabilityIdBrand]: true;
};
export type JobArtifactId = string & { readonly [artifactIdBrand]: true };
export type OperationId = string & { readonly [operationIdBrand]: true };

export function jobConnectionId(value: string): ConnectionId {
  return value as ConnectionId;
}

export type JobKind = "import" | "export";
export type JobFormat =
  | "csv"
  | "tsv"
  | "json"
  | "ndjson"
  | "sql"
  | "xlsx"
  | "csv_gzip"
  | "json_gzip"
  | "ndjson_gzip"
  | "sql_gzip";
export type JobState =
  | "queued"
  | "running"
  | "pause_requested"
  | "paused"
  | "cancel_requested"
  | "cancelled"
  | "succeeded"
  | "failed";
export type JobFileDirection = "input" | "output";
export type JobErrorPolicy = "stop" | "continue";

export type JobRelationKind =
  | "table"
  | "view"
  | "materialized_view"
  | "routine"
  | "sequence"
  | "type"
  | "trigger"
  | "other";

export interface JobRelationRef {
  catalog: string | null;
  namespace: string | null;
  name: string;
  kind: JobRelationKind;
  nativeId: string | null;
}

const jobRelationKinds = new Set<JobRelationKind>([
  "table",
  "view",
  "materialized_view",
  "routine",
  "sequence",
  "type",
  "trigger",
  "other",
]);

export function jobRelationRef(value: {
  catalog?: string | null;
  namespace?: string | null;
  name: string;
  kind: string;
  nativeId?: string | null;
}): JobRelationRef {
  if (!jobRelationKinds.has(value.kind as JobRelationKind)) {
    throw new Error("the selected catalog object is not a supported job relation");
  }
  return {
    catalog: value.catalog ?? null,
    namespace: value.namespace ?? null,
    nativeId: value.nativeId ?? null,
    name: value.name,
    kind: value.kind as JobRelationKind,
  };
}

export interface JobFileCapability {
  id: JobFileCapabilityId;
  connectionId: ConnectionId;
  direction: JobFileDirection;
  displayName: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
  sourceSha256: string | null;
  expiresAt: string;
}

export interface JobInputInspection {
  fields: string[];
  itemCount: number | null;
  sampleRows: unknown[];
  resumable: boolean;
  warnings: string[];
}

export interface JobFieldMapping {
  source: string;
  target: string;
  required: boolean;
}

export interface JobValidation {
  onError: JobErrorPolicy;
  maxErrors: number;
  nullValues: string[];
}

export type JobPlan =
  | {
      kind: "export";
      capabilityId: JobFileCapabilityId;
      relation: JobRelationRef;
      consistency: "per_batch_current";
      columns: string[];
      fieldNames: JobFieldMapping[];
      batchSize: number;
    }
  | {
      kind: "import";
      capabilityId: JobFileCapabilityId;
      targetRelation: JobRelationRef | null;
      mapping: JobFieldMapping[];
      validation: JobValidation;
      batchSize: number;
    };

export interface CreateJobRequest {
  connectionId: ConnectionId;
  format: JobFormat;
  plan: JobPlan;
}

export interface Job {
  id: JobId;
  operationId: OperationId;
  connectionId: ConnectionId;
  kind: JobKind;
  format: JobFormat;
  state: JobState;
  sourceSummary: string;
  targetSummary: string;
  rowsProcessed: number;
  bytesProcessed: number;
  rowsTotal: number | null;
  bytesTotal: number | null;
  resumable: boolean;
  errorCode: string | null;
  redactedError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface JobProposal {
  job: Job;
  payloadHash: string;
  approvalRequired: boolean;
  confirmationPhrase: string | null;
}

export interface JobArtifact {
  id: JobArtifactId;
  jobId: JobId;
  artifactType: string;
  displayName: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface JobDetail {
  job: Job;
  artifacts: JobArtifact[];
  operationState: string;
  payloadHash: string;
  approvalRequired: boolean;
  confirmationPhrase: string | null;
}

export interface JobChangedEvent {
  connectionId: ConnectionId;
  jobId: JobId;
  kind: JobKind;
  state: JobState;
  rowsProcessed: number;
  bytesProcessed: number;
}
