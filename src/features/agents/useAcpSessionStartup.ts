// Prepare an exact-scope session while the user composes. Background preparation
// never blocks resource selection; obsolete grants are closed before adoption.

import { useCallback, useEffect, useRef } from "react";

import { errMessage } from "../../ipc/types";
import type { CatalogScope } from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import type { ConnectionId } from "../connections/domain";
import { providerLabel } from "./acpTranscriptPresentation";
import type {
  AcpSessionFocus,
  AgentProvider,
  AgentResourceScopeSelection,
} from "./domain";
import {
  ownsStartedAcpSession,
  type AcpFocusRequest,
} from "./sessionFocus";
import { beginAgentInitializationOutcome } from "./productAnalytics";
import { recordAcpSessionFocus } from "./sessionStore";
import { closeAgentAcpSession, startAgentAcpSession } from "./tauriAdapter";

type AcpSessionStartupInput = {
  activeSessionId: string | null;
  beginFocusRequest: () => AcpFocusRequest;
  catalogScope: CatalogScope;
  connectionId: ConnectionId;
  currentFocusRequest: () => AcpFocusRequest;
  resourceScopeReady: boolean;
  ensureSelectedResources: () => Promise<boolean>;
  focusRequestIsCurrent: (request: AcpFocusRequest) => boolean;
  onError: (message: string | null) => void;
  onStarted: (focus: AcpSessionFocus, provider: AgentProvider) => void;
  onStartingChange: (starting: boolean) => void;
  prerequisitesReady: boolean;
  selectedResourceScopes: AgentResourceScopeSelection[];
  writeConnectionId: ConnectionId | null;
  selectedProvider: AgentProvider;
  sessionsLoading: boolean;
};

export function useAcpSessionStartup({
  activeSessionId,
  beginFocusRequest,
  catalogScope,
  connectionId,
  currentFocusRequest,
  resourceScopeReady,
  ensureSelectedResources,
  focusRequestIsCurrent,
  onError,
  onStarted,
  onStartingChange,
  prerequisitesReady,
  selectedResourceScopes,
  writeConnectionId,
  selectedProvider,
  sessionsLoading,
}: AcpSessionStartupInput) {
  const { t } = useI18n();
  const pendingStartRef = useRef<{
    key: string;
    foreground: boolean;
    promise: Promise<AcpSessionFocus | null>;
  } | null>(null);
  const prewarmAttemptRef = useRef<string | null>(null);
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
    (provider = selectedProvider, foreground = true): Promise<AcpSessionFocus | null> => {
      if (!ready || provider !== selectedProvider) {
        return Promise.resolve(null);
      }
      const startKey = selectionKey;
      if (pendingStartRef.current?.key === startKey) {
        if (foreground) {
          pendingStartRef.current.foreground = true;
          onStartingChange(true);
        }
        return pendingStartRef.current.promise;
      }
      const request = beginFocusRequest();
      const completeAnalytics = beginAgentInitializationOutcome(
        catalogScope,
        provider,
      );
      const previousStart = pendingStartRef.current?.promise;
      const pending = (async () => {
        if (foreground) onStartingChange(true);
        onError(null);
        try {
          // Only one adapter initializes at a time. Rapid selection changes
          // collapse to the latest grant without accumulating idle processes.
          await previousStart;
          if (currentSelectionRef.current !== startKey || !focusRequestIsCurrent(request)) {
            return null;
          }
          if (!(await ensureSelectedResources())) {
            completeAnalytics("failed");
            return null;
          }
          if (currentSelectionRef.current !== startKey || !focusRequestIsCurrent(request)) {
            return null;
          }
          const focus = await startAgentAcpSession(
            connectionId,
            provider,
            selectedResourceScopes,
            writeConnectionId,
          );
          completeAnalytics("success");
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
          return focus;
        } catch (reason) {
          completeAnalytics("failed");
          if (currentSelectionRef.current !== startKey || !focusRequestIsCurrent(request)) return null;
          onError(
            t("agent.acpStartFailed", {
              provider: providerLabel(provider),
              error: errMessage(reason),
            }),
          );
          return null;
        }
      })();
      pendingStartRef.current = { key: startKey, foreground, promise: pending };
      void pending.finally(() => {
        if (pendingStartRef.current?.promise !== pending) return;
        const wasForeground = pendingStartRef.current.foreground;
        pendingStartRef.current = null;
        if (wasForeground) onStartingChange(false);
      });
      return pending;
    },
    [
      beginFocusRequest,
      catalogScope,
      connectionId,
      currentFocusRequest,
      ensureSelectedResources,
      focusRequestIsCurrent,
      onError,
      onStarted,
      onStartingChange,
      ready,
      selectionKey,
      selectedResourceScopes,
      selectedProvider,
      t,
      writeConnectionId,
    ],
  );

  const prepareRef = useRef(startSession);
  prepareRef.current = startSession;
  useEffect(() => {
    if (activeSessionId !== null || currentFocusRequest().selectedSessionId !== null) {
      prewarmAttemptRef.current = null;
      return;
    }
    if (sessionsLoading || !ready) {
      prewarmAttemptRef.current = null;
      return;
    }
    if (prewarmAttemptRef.current === selectionKey) return;
    const timeout = window.setTimeout(() => {
      // Record an attempt only when it actually runs. A rerender during the
      // debounce must not cancel preparation permanently for this selection.
      prewarmAttemptRef.current = selectionKey;
      void prepareRef.current(selectedProvider, false);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [
    activeSessionId,
    currentFocusRequest,
    ready,
    selectedProvider,
    selectionKey,
    sessionsLoading,
  ]);

  return startSession;
}
