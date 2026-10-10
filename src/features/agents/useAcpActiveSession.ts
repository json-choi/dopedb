// Owns the Agent panel's active ACP session: selection follows the person's
// latest intent and restores a live session once per catalog scope, a selected
// session's persisted history is replayed while only the latest focus read may
// change the panel, and lifecycle commands act on exactly that session.

import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "../../lib/i18n";
import type { CatalogScope } from "../../lib/queries";
import { agentFailure, type AgentFailure } from "./agentErrorLabels";
import type {
  AcpSessionFocus,
  AcpSessionId,
  AcpSessionSummary,
  AgentProvider,
} from "./domain";
import { beginAgentInitializationOutcome } from "./productAnalytics";
import {
  isCurrentAcpFocusRequest,
  isLiveSession,
  type AcpFocusRequest,
} from "./sessionFocus";
import { recordAcpSessionFocus } from "./sessionStore";
import {
  cancelAgentAcpSession,
  closeAgentAcpSession,
  focusAgentAcpSession,
  respondAgentAcpPermission,
  resumeAgentAcpSession,
} from "./tauriAdapter";

export type AcpActiveSessionInput = {
  catalogScope: CatalogScope;
  /** Sessions of the configured providers in this catalog scope. */
  sessions: readonly AcpSessionSummary[];
  /** Replayed conversations already held by the session store. */
  projections: ReadonlyMap<AcpSessionId, unknown>;
  /** Sessions, CLI, and plugin status are loaded, so a restore can choose. */
  restoreReady: boolean;
  selectedProvider: AgentProvider;
  starting: boolean;
  setStarting: (starting: boolean) => void;
  setError: (error: AgentFailure | string | null) => void;
};

export function useAcpActiveSession({
  catalogScope,
  sessions,
  projections,
  restoreReady,
  selectedProvider,
  starting,
  setStarting,
  setError,
}: AcpActiveSessionInput) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<AcpSessionId | null>(null);
  const [permissionSubmitting, setPermissionSubmitting] = useState<
    string | null
  >(null);
  const activeIdRef = useRef<AcpSessionId | null>(null);
  const restoredScopeRef = useRef<string | null>(null);
  const selectionGenerationRef = useRef(0);
  const focusRequestIdRef = useRef(0);
  const catalogScopeKeyRef = useRef(catalogScope.key);
  catalogScopeKeyRef.current = catalogScope.key;
  const active = sessions.find((session) => session.id === activeId) ?? null;
  const activeSessionId = active?.id ?? null;
  const activeEventsLoaded =
    activeSessionId !== null && projections.has(activeSessionId);

  const selectActiveSession = useCallback((next: AcpSessionId | null) => {
    if (activeIdRef.current === next) return;
    activeIdRef.current = next;
    selectionGenerationRef.current += 1;
    setActiveId(next);
  }, []);
  const beginFocusRequest = useCallback(
    (): AcpFocusRequest => ({
      requestId: ++focusRequestIdRef.current,
      scopeKey: catalogScopeKeyRef.current,
      selectionGeneration: selectionGenerationRef.current,
      selectedSessionId: activeIdRef.current,
    }),
    [],
  );
  const currentFocusRequest = useCallback(
    (): AcpFocusRequest => ({
      requestId: focusRequestIdRef.current,
      scopeKey: catalogScopeKeyRef.current,
      selectionGeneration: selectionGenerationRef.current,
      selectedSessionId: activeIdRef.current,
    }),
    [],
  );
  const focusRequestIsCurrent = useCallback(
    (request: AcpFocusRequest) =>
      isCurrentAcpFocusRequest(request, currentFocusRequest()),
    [currentFocusRequest],
  );
  const recordFocus = useCallback(
    (focus: AcpSessionFocus) => recordAcpSessionFocus(catalogScope.key, focus),
    [catalogScope.key],
  );
  const loadFocusReplay = useCallback(
    async (sessionId: AcpSessionId) => {
      const focus = await focusAgentAcpSession(sessionId);
      // A late replay still belongs in the external store, but selection is
      // owned by the user's latest intent and is never changed by this read.
      recordFocus(focus);
      return focus;
    },
    [recordFocus],
  );

  // A new catalog scope starts unselected and idle; the restore below then
  // chooses its first live session once.
  useEffect(() => {
    selectActiveSession(null);
    setStarting(false);
  }, [catalogScope.key, selectActiveSession, setStarting]);

  useEffect(() => {
    if (!restoreReady || restoredScopeRef.current === catalogScope.key) return;
    restoredScopeRef.current = catalogScope.key;
    const next = sessions.find((session) => isLiveSession(session.lifecycle));
    if (activeIdRef.current === null) {
      selectActiveSession(next?.id ?? null);
    }
  }, [catalogScope.key, restoreReady, selectActiveSession, sessions]);

  useEffect(() => {
    const next =
      sessions.find((session) => isLiveSession(session.lifecycle))?.id ?? null;
    if (activeId && !sessions.some((session) => session.id === activeId)) {
      selectActiveSession(next);
    }
  }, [activeId, selectActiveSession, sessions]);

  useEffect(() => {
    if (activeSessionId === null || activeEventsLoaded) return;
    const request = beginFocusRequest();
    void loadFocusReplay(activeSessionId).catch((reason) => {
      if (!focusRequestIsCurrent(request)) return;
      // Without a replay the transcript would stay in its loading state; fall
      // back to the session list and keep an actionable error visible.
      selectActiveSession(null);
      setError(agentFailure(reason, t, (error) => t("agent.acpLoadFailed", { error })));
    });
    return () => {
      if (focusRequestIdRef.current === request.requestId) {
        focusRequestIdRef.current += 1;
      }
    };
  }, [
    activeEventsLoaded,
    activeSessionId,
    beginFocusRequest,
    focusRequestIsCurrent,
    loadFocusReplay,
    selectActiveSession,
    setError,
    t,
  ]);

  async function resume() {
    if (!active || starting || active.acpSessionId === null) return;
    const request = beginFocusRequest();
    const completeAnalytics = beginAgentInitializationOutcome(
      catalogScope,
      active.provider,
    );
    setStarting(true);
    setError(null);
    try {
      const focus = await resumeAgentAcpSession(active.id);
      completeAnalytics("success");
      recordFocus(focus);
    } catch (reason) {
      completeAnalytics("failed");
      if (!focusRequestIsCurrent(request)) return;
      setError(agentFailure(reason, t, (error) => t("agent.acpResumeFailed", { error })));
      try {
        const recoveryRequest = beginFocusRequest();
        await loadFocusReplay(active.id);
        if (!focusRequestIsCurrent(recoveryRequest)) return;
      } catch {
        // Keep the actionable resume error when the persisted focus also vanished.
      }
    } finally {
      setStarting(false);
    }
  }

  const respondPermission = useCallback(
    async (requestId: string, optionId: string | null) => {
      if (!activeId || permissionSubmitting) return;
      setPermissionSubmitting(requestId);
      setError(null);
      try {
        await respondAgentAcpPermission(activeId, requestId, optionId);
      } catch (reason) {
        setError(agentFailure(reason, t, (error) => t("agent.acpPermissionFailed", { error })));
      } finally {
        setPermissionSubmitting(null);
      }
    },
    [activeId, permissionSubmitting, setError, t],
  );

  async function cancelTurn() {
    if (!active) return;
    setError(null);
    try {
      await cancelAgentAcpSession(active.id);
      // The live ACP event stream owns the turn-end and ready transition.
      // Replaying focus here races that stream and can merge an incomplete frame.
    } catch (reason) {
      setError(agentFailure(reason, t, (error) => t("agent.acpCancelFailed", { error })));
    }
  }

  async function cancelStart() {
    // The start command resolves only after initialization, but the runtime
    // announces the starting session at once; cancel that exact session.
    const startingSession =
      active?.lifecycle === "starting"
        ? active
        : sessions.find(
            (candidate) =>
              candidate.lifecycle === "starting" &&
              candidate.provider === selectedProvider,
          );
    if (!startingSession) return;
    setError(null);
    try {
      await cancelAgentAcpSession(startingSession.id);
    } catch (reason) {
      setError(agentFailure(reason, t, (error) => t("agent.acpCancelFailed", { error })));
    }
  }

  async function close() {
    if (!active || active.lifecycle === "closed") return;
    setError(null);
    try {
      await closeAgentAcpSession(active.id);
    } catch (reason) {
      setError(agentFailure(reason, t, (error) => t("agent.acpCloseFailed", { error })));
    }
  }

  return {
    active,
    activeId,
    activeEventsLoaded,
    permissionSubmitting,
    selectActiveSession,
    beginFocusRequest,
    currentFocusRequest,
    focusRequestIsCurrent,
    commands: { resume, cancelTurn, cancelStart, close, respondPermission },
  };
}
