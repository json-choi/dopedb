// Keeps session focus and screen handoffs inside the exact requested resource
// set; another database in the same Environment is not an interchangeable scope.
import type {
  AcpSessionId,
  AcpSessionLifecycle,
  AcpSessionSummary,
  AgentProvider,
  AgentComposerRequest,
} from "./domain";

export function ownsAcpComposerRequest(
  session: AcpSessionSummary,
  request: AgentComposerRequest,
) {
  return isLiveSession(session.lifecycle) && session.knowledgeScopes.some((scope) =>
    scope.projectEnvironmentId === request.projectEnvironmentId
    && scope.connections.some((connection) => connection.connectionId === request.connectionId),
  );
}

export function isLiveSession(lifecycle: AcpSessionLifecycle) {
  return ["starting", "ready", "running", "waitingPermission"].includes(
    lifecycle,
  );
}

export function selectWorkspaceSessions(
  sessions: readonly AcpSessionSummary[],
  enabledProviders: readonly AgentProvider[],
) {
  return sessions
    .filter((session) => enabledProviders.includes(session.provider))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type AcpFocusRequest = {
  requestId: number;
  scopeKey: string;
  selectionGeneration: number;
  selectedSessionId: AcpSessionId | null;
};

export function isCurrentAcpFocusRequest(
  request: AcpFocusRequest,
  current: AcpFocusRequest,
) {
  return (
    request.requestId === current.requestId &&
    request.scopeKey === current.scopeKey &&
    request.selectionGeneration === current.selectionGeneration &&
    request.selectedSessionId === current.selectedSessionId
  );
}

export function ownsStartedAcpSession(
  request: AcpFocusRequest,
  current: AcpFocusRequest,
  startedSessionId: AcpSessionId,
) {
  return (
    isCurrentAcpFocusRequest(request, current) ||
    (request.scopeKey === current.scopeKey &&
      current.selectedSessionId === startedSessionId)
  );
}
