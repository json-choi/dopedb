/** ACP conversation, credential-free CLI status, and retired archive contracts. */

import type { ConnectionId } from "../connections/domain";

declare const retiredChatThreadIdBrand: unique symbol;
declare const retiredChatMessageIdBrand: unique symbol;
declare const acpSessionIdBrand: unique symbol;

/** Opaque identity for one immutable thread created by the retired in-app chat. */
export type RetiredChatThreadId = string & {
  readonly [retiredChatThreadIdBrand]: "RetiredChatThreadId";
};

/** Opaque identity for one immutable message in the retired chat archive. */
export type RetiredChatMessageId = string & {
  readonly [retiredChatMessageIdBrand]: "RetiredChatMessageId";
};

export type AcpSessionId = string & {
  readonly [acpSessionIdBrand]: "AcpSessionId";
};

export type AgentProvider = "claude" | "codex";
export type AcpPluginId = "dopedb.acp.claude" | "dopedb.acp.codex";
export type AcpPluginInstallationState =
  | "not_installed"
  | "checking"
  | "downloading"
  | "verifying"
  | "staged"
  | "ready"
  | "update_available"
  | "removing"
  | "failed"
  | "rollback_required";

export interface AcpPluginStatus {
  pluginId: AcpPluginId;
  state: AcpPluginInstallationState;
  enabled: boolean;
  installedVersion: string | null;
  installedReleaseId: string | null;
  candidateVersion: string | null;
  lastKnownGoodVersion: string | null;
  availableVersion: string | null;
  availableReleaseId: string | null;
  failure: string | null;
}

export interface AcpPluginMutationReceipt {
  changed: boolean;
  status: AcpPluginStatus;
}

export interface AgentCliInfo {
  id: AgentProvider;
  name: string;
  installed: boolean;
  authenticated: boolean;
  authMethod: string | null;
  detectionError: string | null;
  note: string;
}

export interface AgentKnowledgeEnvironment {
  id: string;
  projectName: string;
  name: string;
  riskClass: "production" | "staging" | "development" | "test" | "custom";
  graphRevisionCount: number;
}

/** One screen-owned handoff into the Environment-pinned Agent composer. */
export type AgentComposerRequest = {
  id: string;
  connectionId: ConnectionId;
  projectEnvironmentId: string;
  prompt: string;
};

/** A persisted, read-only conversation created before Terminal sessions replaced chat. */
export interface RetiredChatArchiveThread {
  id: RetiredChatThreadId;
  provider: AgentProvider;
  connectionId: ConnectionId | null;
  title: string;
  cliSessionId: string | null;
  model: string | null;
  effort: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One persisted, read-only message row from a retired conversation. */
export interface RetiredChatArchiveMessage {
  id: RetiredChatMessageId;
  threadId: RetiredChatThreadId;
  role: "user" | "assistant";
  text: string;
  error: string | null;
  createdAt: string;
}

export type AcpSessionLifecycle =
  | "starting"
  | "ready"
  | "running"
  | "waitingPermission"
  | "failed"
  | "closed";

export interface AgentKnowledgeSourceScope {
  sourceId: string;
  displayName: string;
  repositoryId: string;
  repository: string;
  refName: string;
  commitSha: string;
}

export interface AgentKnowledgeConnectionScope {
  connectionId: ConnectionId;
  connectionRevision: number;
  remoteConnectionId: string | null;
  connectionContentRevision: number;
  role: string;
  alias: string;
}

export interface AgentKnowledgeScope {
  projectId: string;
  knowledgeGrantId: string | null;
  projectEnvironmentId: string;
  environmentRevision: number;
  authorityConnectionId: ConnectionId;
  authorityConnectionRevision: number;
  sources: AgentKnowledgeSourceScope[];
  graphRevisionIds: string[];
  connections: AgentKnowledgeConnectionScope[];
}

/** One exact internal Environment slice of a user-selected Project resource set. */
export interface AgentResourceScopeSelection {
  projectEnvironmentId: string;
  authorityConnectionId: ConnectionId;
  connectionIds: ConnectionId[];
  sourceIds: string[];
}

export interface AcpSessionSummary {
  id: AcpSessionId;
  connectionId: ConnectionId;
  provider: AgentProvider;
  title: string;
  lifecycle: AcpSessionLifecycle;
  acpSessionId: string | null;
  knowledgeGrantId: string | null;
  projectEnvironmentId: string | null;
  environmentRevision: number | null;
  knowledgeSources: AgentKnowledgeSourceScope[];
  graphRevisionIds: string[];
  environmentConnections: AgentKnowledgeConnectionScope[];
  knowledgeScopes: AgentKnowledgeScope[];
  writeConnectionId: ConnectionId | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcpPermissionOption {
  id: string;
  name: string;
  kind:
    | "allowOnce"
    | "allowAlways"
    | "rejectOnce"
    | "rejectAlways"
    | "unknown";
}

type AcpEventBase = {
  sessionId: AcpSessionId;
  sequence: number;
  createdAt: string;
};

export type AcpSessionEvent = AcpEventBase &
  (
    | {
        type: "userMessage";
        text: string;
        attachments: string[];
      }
    | {
        type: "sessionUpdate";
        update: Record<string, unknown>;
      }
    | {
        type: "sessionConfiguration";
        configOptions: AcpSessionConfigOption[];
      }
    | {
        type: "permissionRequest";
        requestId: string;
        toolCall: Record<string, unknown>;
        options: AcpPermissionOption[];
      }
    | {
        type: "permissionResponse";
        requestId: string;
        optionId: string | null;
      }
    | {
        type: "turnEnd";
        stopReason: string;
      }
    | {
        type: "status";
        lifecycle: AcpSessionLifecycle;
      }
    | {
        type: "error";
        message: string;
      }
  );

export interface AcpSessionConfigSelectOption {
  value: string;
  name: string;
  description?: string;
}

export interface AcpSessionConfigSelectGroup {
  group: string;
  name: string;
  options: AcpSessionConfigSelectOption[];
}

export interface AcpSessionConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: "mode" | "model" | "model_config" | "thought_level" | string;
  type: "select" | "boolean" | string;
  currentValue: string | boolean;
  options?: Array<AcpSessionConfigSelectOption | AcpSessionConfigSelectGroup>;
}

export interface AcpSessionFocus {
  session: AcpSessionSummary;
  events: AcpSessionEvent[];
  replayTruncated: boolean;
}

export interface AcpSessionChanged {
  session: AcpSessionSummary;
  event: AcpSessionEvent | null;
}

export interface AcpTableContext {
  database: string | null;
  schema: string | null;
  table: string;
  column: string | null;
  rowIndex: number | null;
  row: Record<string, unknown> | null;
}

export interface AcpPromptContext {
  connectionId: ConnectionId | null;
  database: string | null;
  documentName: string | null;
  documentText: string | null;
  table: AcpTableContext | null;
  responseLanguage?: "en" | "ko";
}
