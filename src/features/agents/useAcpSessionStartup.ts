// Starts an exact-scope session only when the first prompt is submitted. Pending
// starts are shared; a changed scope or focus retires the obsolete grant.

import { useCallback, useEffect, useRef } from "react";

import { errMessage } from "../../ipc/types";
import type { CatalogScope } from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import type { ConnectionId } from "../connections/domain";
import { providerLabel } from "./acpTranscriptPresentation";
import { agentFailure, stableAgentErrorCode, type AgentFailure } from "./agentErrorLabels";
import { beginForegroundAgentStart } from "./approvalActivity";
import type {
  AcpSessionFocus,
  AgentProvider,
  AgentResourceScopeSelection,
} from "./domain";
import {
  ownsStartedAcpSession,
  type AcpFocusRequest,
} from "./sessionFocus";
import { recordAcpSessionFocus } from "./sessionStore";
import { closeAgentAcpSession, startAgentAcpSession } from "./tauriAdapter";

const AGENT_START_CANCELLED = "agent_start_cancelled";

type AcpSessionStartupInput = {
  beginFocusRequest: () => AcpFocusRequest;
  catalogScope: CatalogScope;
  connectionId: ConnectionId;
  currentFocusRequest: () => AcpFocusRequest;
  resourceScopeReady: boolean;
  focusRequestIsCurrent: (request: AcpFocusRequest) => boolean;
  onError: (error: AgentFailure | null) => void;
  onStarted: (focus: AcpSessionFocus, provider: AgentProvider) => void;
  onPrepared: (focus: AcpSessionFocus) => Promise<void>;
  onStartingChange: (starting: boolean) => void;
  prerequisitesReady: boolean;
  selectedResourceScopes: AgentResourceScopeSelection[];
  writeConnectionId: ConnectionId | null;
  selectedProvider: AgentProvider;
};

export function useAcpSessionStartup({
  beginFocusRequest,
  catalogScope,
  connectionId,
  currentFocusRequest,
  resourceScopeReady,
  focusRequestIsCurrent,
  onError,
  onStarted,
  onPrepared,
  onStartingChange,
  prerequisitesReady,
  selectedResourceScopes,
  writeConnectionId,
  selectedProvider,
}: AcpSessionStartupInput) {
  const { t } = useI18n();
  const pendingStartRef = useRef<{
    key: string;
    promise: Promise<AcpSessionFocus | null>;
    /** Ends the status bar's record of a start a person is waiting on. */
    finishForeground: () => void;
  } | null>(null);
  const selectionKey = [
    catalogScope.key,
    connectionId,
    selectedProvider,
    JSON.stringify(selectedResourceScopes),
    writeConnectionId ?? "read-only",
  ].join(":");
  const ready = prerequisitesReady && resourceScopeReady && selectedResourceScopes.length > 0;
  const currentSelectionRef = useRef<string | null>(null);
  currentSelectionRef.current = ready ? selectionKey : null;

  useEffect(() => {
    currentSelectionRef.current = ready ? selectionKey : null;
    return () => { currentSelectionRef.current = null; };
  }, [ready, selectionKey]);

  const startSession = useCallback(
    (provider = selectedProvider): Promise<AcpSessionFocus | null> => {
      if (!ready || provider !== selectedProvider) {
        return Promise.resolve(null);
      }
      const startKey = selectionKey;
      if (pendingStartRef.current?.key === startKey) {
        return pendingStartRef.current.promise;
      }
      const request = beginFocusRequest();
      const previousStart = pendingStartRef.current?.promise;
      const pending = (async () => {
        onStartingChange(true);
        onError(null);
        try {
          // Only one adapter initializes at a time. A changed grant cannot
          // adopt the response of an earlier first-message submission.
          await previousStart;
          if (currentSelectionRef.current !== startKey || !focusRequestIsCurrent(request)) {
            return null;
          }
          const focus = await startAgentAcpSession(
            connectionId,
            provider,
            selectedResourceScopes,
            writeConnectionId,
          );
          if (
            currentSelectionRef.current !== startKey ||
            !ownsStartedAcpSession(
              request,
              currentFocusRequest(),
              focus.session.id,
            )
          ) {
            await closeAgentAcpSession(focus.session.id);
            return null;
          }
          if (!recordAcpSessionFocus(catalogScope.key, focus)) {
            await closeAgentAcpSession(focus.session.id);
            return null;
          }
          onStarted(focus, provider);
          await onPrepared(focus);
          if (currentSelectionRef.current !== startKey || !ownsStartedAcpSession(request, currentFocusRequest(), focus.session.id)) {
            await closeAgentAcpSession(focus.session.id);
            return null;
          }
          return focus;
        } catch (reason) {
          // A person cancelled the slow start (status bar or chat): neither an
          // adapter failure nor an error worth reporting.
          // The code arrives behind the error variant's prefix, so it is
          // parsed rather than compared with the whole message.
          if (stableAgentErrorCode(errMessage(reason))?.code === AGENT_START_CANCELLED) return null;
          if (currentSelectionRef.current !== startKey || !focusRequestIsCurrent(request)) return null;
          onError(agentFailure(reason, t, (error) =>
            t("agent.acpStartFailed", { provider: providerLabel(provider), error })));
          return null;
        }
      })();
      const entry = {
        key: startKey,
        promise: pending,
        finishForeground: beginForegroundAgentStart(connectionId, provider),
      };
      pendingStartRef.current = entry;
      void pending.finally(() => {
        // Even a start replaced by a newer selection stops being shown.
        entry.finishForeground();
        if (pendingStartRef.current?.promise !== pending) return;
        pendingStartRef.current = null;
        onStartingChange(false);
      });
      return pending;
    },
    [
      beginFocusRequest,
      catalogScope,
      connectionId,
      currentFocusRequest,
      focusRequestIsCurrent,
      onError,
      onStarted,
      onPrepared,
      onStartingChange,
      ready,
      selectionKey,
      selectedResourceScopes,
      selectedProvider,
      t,
      writeConnectionId,
    ],
  );

  return startSession;
}
