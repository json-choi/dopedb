import type { AcpSessionId } from "../agents/domain";
import type { ConnectionId as AgentConnectionId } from "../connections/domain";
import type {
  ConnectionId as JobConnectionId,
  JobId,
} from "../jobs/domain";
import type { KnowledgeSourceSyncProgress } from "../knowledge/domain";

export type BackgroundTaskStatus =
  | "starting"
  | "running"
  | "waitingApproval"
  | "waitingPermission"
  | "pausing"
  | "paused"
  | "cancelling";

type BackgroundTaskBase = {
  key: string;
  title: string;
  status: BackgroundTaskStatus;
  progress: number | null;
  rowsProcessed: number | null;
  updatedAt: number;
};

export type BackgroundTask =
  | (BackgroundTaskBase & {
      kind: "query";
      sessionId: string;
      connectionId: string;
      connectionName: string;
      cancellable: false;
    })
  | (BackgroundTaskBase & {
      kind: "agent";
      sessionId: AcpSessionId;
      connectionId: AgentConnectionId;
      connectionName: string;
      cancellable: true;
    })
  | (BackgroundTaskBase & {
      kind: "job";
      jobId: JobId;
      connectionId: JobConnectionId;
      connectionName: string;
      operation: "import" | "export";
      cancellable: boolean;
    })
  | (BackgroundTaskBase & {
      kind: "knowledge";
      sourceId: string;
      projectEnvironmentId: string;
      projectName: string;
      environmentName: string;
      phase: KnowledgeSourceSyncProgress["phase"];
      totalFiles: number;
      completedFiles: number;
      remainingFiles: number;
      attempt: number;
      retryAt: string | null;
      cancellable: boolean;
    });
