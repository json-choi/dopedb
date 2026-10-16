// Agent SQL approvals still waiting for a person, across every conversation the
// session store holds, so a proposal stays visible while AI Chat is closed.
// Candidates come only from exact in-app `sql_propose` receipts of live
// conversations for their own write target; the trusted review entry the
// approval card itself reads decides whether one still waits. Deciding happens
// only on that card, so this module also carries the one request that brings a
// person from the shell to it.

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import type { SqlApprovalReview } from "../queries/domain";
import type { AcpSessionId, AcpSessionSummary } from "./domain";
import { agentSqlProposalReviewQuery } from "./queryOptions";
import { isLiveSession } from "./sessionFocus";
import { acpSessionStore } from "./sessionStore";
import {
  findAgentSqlProposal,
  isFinalOperationState,
  isSqlProposalTool,
  type AgentSqlProposalReference,
} from "./sqlProposal";
import {
  visibleAcpTranscriptItems,
  type AcpConversationProjection,
} from "./transcript";

/** One proposal waiting for a decision, and the conversation holding its card. */
export type PendingAgentApproval = {
  operationId: string;
  sessionId: AcpSessionId;
  /** The conversation's anchor connection; AI Chat opens on it. */
  sessionConnectionId: string;
  /** The database the change would run against. */
  connectionName: string;
};

type ProposalCandidate = AgentSqlProposalReference & {
  sessionId: AcpSessionId;
  sessionConnectionId: string;
  /** The conversation's own Broker session, when a focus reported it. */
  brokerSessionId: string | null;
};

const NO_CANDIDATES: readonly ProposalCandidate[] = [];
const NO_APPROVALS: readonly PendingAgentApproval[] = [];
// A request older than this found no card to reveal and is ignored.
const FOCUS_REQUEST_TTL_MS = 15_000;

// Transcripts append in place and bump their revision, so each one is scanned
// again only after it changed.
const scanned = new WeakMap<
  AcpConversationProjection,
  { revision: number; proposals: readonly AgentSqlProposalReference[] }
>();

function proposalsIn(projection: AcpConversationProjection) {
  const cached = scanned.get(projection);
  if (cached?.revision === projection.revision) return cached.proposals;
  const proposals: AgentSqlProposalReference[] = [];
  for (const item of visibleAcpTranscriptItems(projection)) {
    if (item.kind !== "tool" || !isSqlProposalTool(item.data)) continue;
    const proposal = findAgentSqlProposal(item.data.rawOutput ?? item.data.content);
    if (proposal && !isFinalOperationState(proposal.state)) proposals.push(proposal);
  }
  scanned.set(projection, { revision: projection.revision, proposals });
  return proposals;
}

let candidates: {
  key: string;
  scopeKey: string | null;
  list: readonly ProposalCandidate[];
} = { key: "", scopeKey: null, list: NO_CANDIDATES };

// Ending a conversation's Broker session cancels its pending proposals, so only
// live conversations are read. The list keeps its identity until the set of
// receipts changes, so streamed text never re-renders the shell.
function candidateSnapshot() {
  const snapshot = acpSessionStore.getSnapshot();
  const list: ProposalCandidate[] = [];
  const seen = new Set<string>();
  for (const session of snapshot.sessions) {
    if (!isLiveSession(session.lifecycle) || session.writeConnectionId === null) continue;
    const projection = snapshot.projections.get(session.id);
    if (!projection) continue;
    for (const proposal of proposalsIn(projection)) {
      if (proposal.connectionId !== session.writeConnectionId) continue;
      if (seen.has(proposal.operationId)) continue;
      seen.add(proposal.operationId);
      list.push({
        ...proposal,
        sessionId: session.id,
        sessionConnectionId: session.connectionId,
        brokerSessionId: snapshot.brokerSessionIds.get(session.id) ?? null,
      });
    }
  }
  const key = [
    snapshot.scopeKey ?? "",
    ...list.map((candidate) =>
      `${candidate.sessionId}:${candidate.operationId}:${candidate.payloadHash}:${candidate.brokerSessionId ?? ""}`),
  ].join("|");
  if (key !== candidates.key) {
    candidates = {
      key,
      scopeKey: snapshot.scopeKey,
      list: list.length > 0 ? list : NO_CANDIDATES,
    };
  }
  return candidates;
}

/** Proposals in this catalog scope whose stored state still awaits a person. */
export function usePendingAgentApprovals(scopeKey: string): readonly PendingAgentApproval[] {
  const snapshot = useSyncExternalStore(
    acpSessionStore.subscribe,
    candidateSnapshot,
    candidateSnapshot,
  );
  const list = snapshot.scopeKey === scopeKey ? snapshot.list : NO_CANDIDATES;
  const combine = useCallback(
    (results: UseQueryResult<SqlApprovalReview>[]) => {
      const pending = results.flatMap((result, index) => {
        const candidate = list[index];
        const review = result.data;
        if (!candidate || review?.state !== "pending_approval") return [];
        // The card accepts decisions only from its own Broker session.
        if (
          candidate.brokerSessionId !== null &&
          review.proposerSessionId !== candidate.brokerSessionId
        ) {
          return [];
        }
        return [{
          operationId: candidate.operationId,
          sessionId: candidate.sessionId,
          sessionConnectionId: candidate.sessionConnectionId,
          connectionName: review.connectionName,
        }];
      });
      return pending.length > 0 ? pending : NO_APPROVALS;
    },
    [list],
  );
  return useQueries({
    queries: list.map((candidate) => ({
      ...agentSqlProposalReviewQuery(candidate),
      // The card's own observer re-reads on window focus; this one follows
      // only the review's expiry-bound refresh.
      refetchOnWindowFocus: false,
    })),
    combine,
  });
}

/** A person asked to see one pending proposal's card. */
export type AgentApprovalFocusRequest = {
  id: number;
  /** Matched against the panel's sessions; an unknown id selects nothing. */
  sessionId: string;
  operationId: string;
  requestedAt: number;
};

let focusRequest: AgentApprovalFocusRequest | null = null;
let nextFocusRequestId = 0;
const focusListeners = new Set<() => void>();

function publishFocusRequest(next: AgentApprovalFocusRequest | null) {
  focusRequest = next;
  for (const listener of focusListeners) listener();
}

function subscribeFocusRequest(listener: () => void) {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

const currentFocusRequest = () => focusRequest;

/** AI Chat selects this conversation, and its card takes focus once visible. */
export function requestAgentApprovalFocus(sessionId: string, operationId: string) {
  nextFocusRequestId += 1;
  publishFocusRequest({
    id: nextFocusRequestId,
    sessionId,
    operationId,
    requestedAt: Date.now(),
  });
}

/** Clears the request once its card has been revealed. */
export function finishAgentApprovalFocus(id: number) {
  if (focusRequest?.id === id) publishFocusRequest(null);
}

/** The latest request; effects check `approvalFocusRequestLive` before acting. */
export function useAgentApprovalFocusRequest() {
  return useSyncExternalStore(
    subscribeFocusRequest,
    currentFocusRequest,
    currentFocusRequest,
  );
}

/** False once a request found no card in time; it never moves focus later. */
export function approvalFocusRequestLive(request: AgentApprovalFocusRequest) {
  return Date.now() - request.requestedAt <= FOCUS_REQUEST_TTL_MS;
}

/**
 * Selects the conversation a request names, once per request; its card then
 * reveals itself. A selection the person makes afterwards is never undone.
 */
export function useAgentApprovalFocusSelection(
  sessions: readonly AcpSessionSummary[],
  activeId: AcpSessionId | null,
  select: (id: AcpSessionId) => void,
) {
  const request = useAgentApprovalFocusRequest();
  const handledRef = useRef(0);
  useEffect(() => {
    if (!request || handledRef.current === request.id) return;
    if (!approvalFocusRequestLive(request)) return;
    const session = sessions.find((candidate) => candidate.id === request.sessionId);
    if (!session) return;
    handledRef.current = request.id;
    if (activeId !== session.id) select(session.id);
  }, [activeId, request, select, sessions]);
}
