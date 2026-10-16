// Defines the shared task projection and status vocabulary for background-work consumers.

import type { AcpSessionId } from "../agents/domain";
import type { ConnectionId as AgentConnectionId } from "../connections/domain";
import type {
  ConnectionId as JobConnectionId,
  JobId,
} from "../jobs/domain";

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
      /** True while the SQL workbench has registered its own cancel path. */
      cancellable: boolean;
    })
  | (BackgroundTaskBase & {
      kind: "agent";
      sessionId: AcpSessionId;
      connectionId: AgentConnectionId;
      connectionName: string;
      cancellable: true;
    })
  | (BackgroundTaskBase & {
      /** An Agent proposal waiting for a person; it is decided only on its card. */
      kind: "agentProposal";
      operationId: string;
      sessionId: AcpSessionId;
      /** The conversation's anchor connection; AI Chat opens on it. */
      sessionConnectionId: string;
      connectionName: string;
      cancellable: false;
    })
  | (BackgroundTaskBase & {
      /** An Agent proposal a person approved that is executing now. */
      kind: "agentApproval";
      operationId: string;
      connectionId: string;
      connectionName: string;
      /** Stopped through the executor's cancel path until a stop is requested. */
      cancellable: boolean;
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
      /** A stored SQL result being written to the file the person chose. */
      kind: "resultExport";
      operationId: string;
      /** A result is not tied to a listed connection here; shown without one. */
      connectionName: "";
      cancellable: boolean;
    });
