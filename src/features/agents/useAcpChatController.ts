// ACP Chat owns session selection, lifecycle, permissions, composer state, and
// viewport effects while returning state grouped by view responsibility.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { CatalogTable } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { AGENT_SETUP_URLS } from "../../lib/externalLinks";
import { useCatalogScope } from "../../lib/queries";
import type { ConnectionProfile } from "../connections/domain";
import type { KnowledgeEnvironmentFocus } from "../knowledge/domain";
import {
  openAgentSetup,
  useEnabledAgentProviders,
} from "../skills/agentPreferences";
import type { WorkbenchDocument } from "../workbench/domain";
import { EMPTY_ACP_PROMPT_CONTEXT } from "./acpPromptContext";
import {
  loginCommand,
  selectRichTranscriptKeys,
} from "./acpTranscriptPresentation";
import { useAgentDebugDetails } from "./displayPreferences";
import type {
  AcpPromptContext,
  AcpSessionConfigOption,
  AcpSessionFocus,
  AcpSessionId,
  AgentComposerRequest,
  AgentProvider,
} from "./domain";
import {
  agentCliDetectionQuery,
  agentPluginStatusQuery,
} from "./queryOptions";
import {
  isCurrentAcpFocusRequest,
  isLiveSession,
  selectWorkspaceSessions,
  type AcpFocusRequest,
} from "./sessionFocus";
import {
  recordAcpSessionFocus,
  retryAcpSessionSnapshot,
  useAcpSessionSnapshot,
} from "./sessionStore";
import {
  beginAgentInitializationOutcome,
  observeAgentTurnOutcome,
} from "./productAnalytics";
import {
  cancelAgentAcpSession,
  closeAgentAcpSession,
  focusAgentAcpSession,
  openAgentExternalLink,
  promptAgentAcpSession,
  respondAgentAcpPermission,
  resumeAgentAcpSession,
  setAgentAcpConfigOption,
} from "./tauriAdapter";
import { visibleAcpTranscriptItems } from "./transcript";
import { useAgentEnvironmentInventory } from "./useAgentEnvironmentInventory";
import {
  useAgentScopeConnection,
  useAgentScopeSelection,
} from "./useAgentScopeSelection";
import { useAcpSessionStartup } from "./useAcpSessionStartup";
import { useAcpScopeCommands } from "./useAcpScopeCommands";
import { useAcpChatViewport } from "./useAcpChatViewport";
import { useAcpComposerContext } from "./useAcpComposerContext";

const MAX_PROMPT_CHARS = 8 * 1024;
export type AcpChatControllerInput = {
  connection: ConnectionProfile;
  connections: ConnectionProfile[];
  composerRequest: AgentComposerRequest | null;
  knowledgeFocus: KnowledgeEnvironmentFocus | null;
  documents: WorkbenchDocument[];
  activeDocumentId: string | null;
  selectedTable: CatalogTable | null;
  overlay: boolean;
  compact?: boolean;
  width: number;
  onWidthChange: (width: number) => void;
};

export function useAcpChatController({
  connection,
  connections,
  composerRequest,
  knowledgeFocus,
  documents,
  activeDocumentId,
  selectedTable,
  overlay,
  compact = false,
  width,
  onWidthChange,
}: AcpChatControllerInput) {
  const { lang, t } = useI18n();
  const catalogScope = useCatalogScope();
  const sessionSnapshot = useAcpSessionSnapshot(catalogScope.key);
  const debugDetails = useAgentDebugDetails();
  const configuredProviders = useEnabledAgentProviders();
  const [activeId, setActiveId] = useState<AcpSessionId | null>(null);
  const [starting, setStarting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] =
    useState<AgentProvider>("claude");
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [configChanging, setConfigChanging] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [permissionSubmitting, setPermissionSubmitting] = useState<
    string | null
  >(null);
  const [copiedSetupCommand, setCopiedSetupCommand] =
    useState<AgentProvider | null>(null);
  const {
    connection: scopedConnection,
    select: selectScopedConnection,
  } = useAgentScopeConnection(connection, connections);
  const activeIdRef = useRef<AcpSessionId | null>(null);
  const restoredScopeRef = useRef<string | null>(null);
  const selectionGenerationRef = useRef(0);
  const focusRequestIdRef = useRef(0);
  const catalogScopeKeyRef = useRef(catalogScope.key);
  catalogScopeKeyRef.current = catalogScope.key;
  const consumedComposerRequestRef = useRef<string | null>(null);
  const cliStatusQuery = useQuery({
    ...agentCliDetectionQuery(),
    refetchOnWindowFocus: false,
  });
  const pluginStatusQuery = useQuery({
    ...agentPluginStatusQuery(),
    refetchOnWindowFocus: false,
  });
  const environmentInventory = useAgentEnvironmentInventory({
    catalogScopeKey: catalogScope.key,
    connection: scopedConnection,
    connections,
    onError: setError,
  });
  const availableKnowledgeEnvironments = environmentInventory.available;
  const enabledProviders = useMemo(
    () =>
      configuredProviders.filter((provider) => {
        const pluginId = `dopedb.acp.${provider}`;
        const plugin = pluginStatusQuery.data?.find(
          (status) => status.pluginId === pluginId,
        );
        return (
          plugin?.enabled === true &&
          plugin.state !== "failed" &&
          (plugin.installedVersion !== null ||
            plugin.candidateVersion !== null ||
            plugin.lastKnownGoodVersion !== null)
        );
      }),
    [configuredProviders, pluginStatusQuery.data],
  );

  const workspaceSessions = useMemo(
    () => selectWorkspaceSessions(sessionSnapshot.sessions, enabledProviders),
    [enabledProviders, sessionSnapshot.sessions],
  );
  const active =
    workspaceSessions.find((session) => session.id === activeId) ?? null;
  const activeSessionId = active?.id ?? null;
  const activeProvider = active?.provider ?? null;
  const activeEventsLoaded =
    activeSessionId !== null &&
    sessionSnapshot.projections.has(activeSessionId);
  const activeProjection = activeSessionId
    ? sessionSnapshot.projections.get(activeSessionId)
    : undefined;
  // Conversation projections append chunks in place and publish a revisioned
  // store snapshot. Derive these bounded views on render so neither can retain
  // a stale mutable projection behind an incomplete memo dependency.
  const transcript = visibleAcpTranscriptItems(activeProjection);
  const scopeChangeAllowed = active === null || (active.lifecycle === "ready" && transcript.length === 0);
  const agentScope = useAgentScopeSelection({
    active,
    composerRequest,
    connectionId: scopedConnection.id,
    inventory: environmentInventory,
    onClearError: () => setError(null),
    onSelectConnection: selectScopedConnection,
    selectionLocked: !scopeChangeAllowed,
  });
  const richTranscriptKeys = selectRichTranscriptKeys(transcript);
  const configOptions = activeProjection?.configOptions ?? [];
  const modelOption = configOptions.find(
    (option) =>
      option.category === "model" &&
      option.type === "select" &&
      typeof option.currentValue === "string",
  );
  const composerContext = useAcpComposerContext({
    scopeKey: catalogScope.key, focus: knowledgeFocus, scopes: active?.knowledgeScopes ?? [],
    connection, documents, activeDocumentId, selectedTable,
    editorConnectionSelected: agentScope.selectedDatabases.some((database) => database.connectionId === connection.id),
  });
  const { setIncludeEditorContext } = composerContext;
  const pendingPermissionId =
    active?.lifecycle === "waitingPermission"
      ? activeProjection?.pendingPermissionId ?? null
      : null;
  const agentBusy =
    starting ||
    active?.lifecycle === "starting" ||
    active?.lifecycle === "running" ||
    active?.lifecycle === "waitingPermission";
  const selectedCliStatus =
    cliStatusQuery.data?.find((cli) => cli.id === selectedProvider) ?? null;
  const selectedCliReady =
    selectedCliStatus?.installed === true &&
    selectedCliStatus.authenticated === true;
  const cliDetectionError = cliStatusQuery.isError
    ? errMessage(cliStatusQuery.error)
    : selectedCliStatus?.detectionError ?? null;
  const selectedPluginReady = enabledProviders.includes(selectedProvider);
  const prerequisitesReady = selectedCliReady && selectedPluginReady;
  const newEnvironmentScopeReady = agentScope.newScopeReady;
  const activeEnvironmentScopeReady =
    active !== null &&
    active.lifecycle !== "closed" &&
    active.lifecycle !== "failed";
  const environmentScopeReady =
    activeEnvironmentScopeReady || newEnvironmentScopeReady;
  const loading = sessionSnapshot.loading;
  const sessionLoadError = sessionSnapshot.error
    ? t("agent.acpLoadFailed", {
        error: errMessage(sessionSnapshot.error),
      })
    : null;
  const environmentLoadError = environmentInventory.loadError;
  const viewport = useAcpChatViewport({
    activeSessionId,
    projectionRevision: activeProjection?.revision,
    overlay,
    compact,
    width,
    onWidthChange,
  });

  useEffect(() => {
    selectScopedConnection(active?.connectionId ?? agentScope.anchorConnectionId ?? connection.id);
  }, [active?.connectionId, agentScope.anchorConnectionId, connection.id, selectScopedConnection]);

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
  const scopeCommands = useAcpScopeCommands({
    active,
    scopeChangeAllowed,
    starting,
    onSelectSession: selectActiveSession,
    setError,
    toggleResource: agentScope.toggle,
    selectWriteTarget: agentScope.selectWriteTarget,
  });
  const recordFocus = useCallback(
    (focus: AcpSessionFocus) =>
      recordAcpSessionFocus(catalogScope.key, focus),
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
  const changeProvider = useCallback(
    (provider: AgentProvider) => {
      if (provider === selectedProvider && activeProvider === provider) return;
      setSelectedProvider(provider);
      setCopiedSetupCommand(null);
      if (activeProvider !== null && activeProvider !== provider) {
        selectActiveSession(null);
        setPrompt("");
        setError(null);
        setHistoryOpen(false);
        setIncludeEditorContext(false);
      }
    },
    [activeProvider, selectActiveSession, selectedProvider, setIncludeEditorContext],
  );

  useEffect(() => {
    selectActiveSession(null);
    setStarting(false);
  }, [catalogScope.key, selectActiveSession]);

  useEffect(() => {
    if (sessionSnapshot.loading || !pluginStatusQuery.isSuccess || restoredScopeRef.current === catalogScope.key) return;
    restoredScopeRef.current = catalogScope.key;
    const next = workspaceSessions.find((session) =>
      isLiveSession(session.lifecycle),
    );
    if (activeIdRef.current === null) {
      selectActiveSession(next?.id ?? null);
    }
  }, [catalogScope.key, pluginStatusQuery.isSuccess, selectActiveSession, sessionSnapshot.loading, workspaceSessions]);

  useEffect(() => {
    const next =
      workspaceSessions.find((session) =>
        isLiveSession(session.lifecycle)
      )?.id ?? null;
    if (
      activeId &&
      !workspaceSessions.some((session) => session.id === activeId)
    ) {
      selectActiveSession(next);
    }
  }, [activeId, selectActiveSession, workspaceSessions]);

  useEffect(() => {
    if (activeProvider) setSelectedProvider(activeProvider);
  }, [activeProvider]);

  useEffect(() => {
    if (enabledProviders.includes(selectedProvider)) return;
    const next = enabledProviders[0];
    if (next) void changeProvider(next);
  }, [changeProvider, enabledProviders, selectedProvider]);

  useEffect(() => {
    if (activeSessionId === null || activeEventsLoaded) return;
    const request = beginFocusRequest();
    void loadFocusReplay(activeSessionId).catch((reason) => {
      if (!focusRequestIsCurrent(request)) return;
      setError(t("agent.acpLoadFailed", { error: errMessage(reason) }));
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
    t,
  ]);

  const commitStartedSession = useCallback(
    (focus: AcpSessionFocus, provider: AgentProvider) => {
      selectActiveSession(focus.session.id);
      setSelectedProvider(provider);
      setHistoryOpen(false);
    },
    [selectActiveSession],
  );
  const startSession = useAcpSessionStartup({
    activeSessionId,
    beginFocusRequest,
    catalogScope,
    connectionId: agentScope.anchorConnectionId ?? scopedConnection.id,
    currentFocusRequest,
    resourceScopeReady: newEnvironmentScopeReady,
    ensureSelectedResources: agentScope.ensureSelected,
    focusRequestIsCurrent,
    onError: setError,
    onStarted: commitStartedSession,
    onStartingChange: setStarting,
    prerequisitesReady,
    selectedResourceScopes: agentScope.resourceScopes,
    writeConnectionId: agentScope.writeConnectionId,
    selectedProvider,
    sessionsLoading: sessionSnapshot.loading,
  });

  const submitPromptText = useCallback(
    async (submitted: string, submittedContext: AcpPromptContext) => {
      if (starting || !submitted.trim()) return false;
      if (!prerequisitesReady || !environmentScopeReady) return false;
      let session = active;
      if (
        !session ||
        session.lifecycle === "closed" ||
        session.lifecycle === "failed"
      ) {
        const focus = await startSession(selectedProvider);
        session = focus?.session ?? null;
      }
      if (!session || session.lifecycle !== "ready") return false;
      const stopObservingTurn = observeAgentTurnOutcome(
        catalogScope,
        session.id,
        session.provider,
      );
      try {
        await promptAgentAcpSession(session.id, submitted, {
          ...submittedContext, responseLanguage: lang,
        });
      } catch (reason) {
        stopObservingTurn?.();
        throw reason;
      }
      return true;
    }, [
      active,
      catalogScope,
      environmentScopeReady, lang,
      prerequisitesReady,
      selectedProvider,
      startSession,
      starting,
    ],
  );

  useEffect(() => {
    if (
      composerRequest === null ||
      composerRequest.connectionId !== scopedConnection.id ||
      consumedComposerRequestRef.current === composerRequest.id ||
      !environmentInventory.success
    ) return;
    const environment = availableKnowledgeEnvironments.find(
      (candidate) => candidate.id === composerRequest.projectEnvironmentId,
    );
    if (!environment) {
      consumedComposerRequestRef.current = composerRequest.id;
      setError(t("agent.acpEnvironmentRequiredBody"));
      return;
    }
    if (
      !agentScope.resourceScopes.some(
        (scope) => scope.projectEnvironmentId === environment.id,
      )
    ) return;
    if (
      active?.knowledgeScopes.length &&
      !active.knowledgeScopes.some(
        (scope) => scope.projectEnvironmentId === environment.id,
      )
    ) {
      selectActiveSession(null);
      return;
    }
    if (
      starting ||
      !prerequisitesReady ||
      (active !== null && !["ready", "closed", "failed"].includes(active.lifecycle))
    ) return;
    consumedComposerRequestRef.current = composerRequest.id;
    setHistoryOpen(false);
    if (!composerRequest.prompt) return;
    const submitted = composerRequest.prompt.slice(0, MAX_PROMPT_CHARS);
    setPrompt(submitted);
    setError(null);
    setComposerExpanded(false);
    setIncludeEditorContext(false);
    void submitPromptText(submitted, EMPTY_ACP_PROMPT_CONTEXT)
      .then((sent) => {
        if (sent) setPrompt("");
      })
      .catch((reason) => {
        setError(t("agent.acpSendFailed", { error: errMessage(reason) }));
      });
  }, [
    active,
    availableKnowledgeEnvironments,
    composerRequest,
    scopedConnection.id,
    environmentInventory.success,
    prerequisitesReady,
    selectActiveSession,
    agentScope.resourceScopes,
    setIncludeEditorContext,
    starting,
    submitPromptText,
    t,
  ]);

  function beginNewChat() {
    if (starting) return;
    if (active?.lifecycle !== "ready" || transcript.length > 0) {
      selectActiveSession(null);
    }
    setHistoryOpen(false);
    setPrompt("");
    setError(null);
    setComposerExpanded(false);
    setIncludeEditorContext(false);
  }

  function selectSession(id: AcpSessionId) {
    const session = workspaceSessions.find((candidate) => candidate.id === id);
    selectActiveSession(id);
    setError(null);
    if (session) setSelectedProvider(session.provider);
    setHistoryOpen(false);
  }

  async function resumeSession() {
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
      setError(t("agent.acpResumeFailed", { error: errMessage(reason) }));
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

  async function sendPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = prompt;
    setError(null);
    try {
      const submittedContext = composerContext.included
        ? composerContext.context
        : EMPTY_ACP_PROMPT_CONTEXT;
      if (await submitPromptText(submitted, submittedContext)) setPrompt("");
    } catch (reason) {
      setError(t("agent.acpSendFailed", { error: errMessage(reason) }));
    }
  }

  async function openSetupGuide(provider: AgentProvider) {
    setError(null);
    try {
      await openUrl(AGENT_SETUP_URLS[provider]);
    } catch (reason) {
      setError(t("agent.acpSetupActionFailed", { error: errMessage(reason) }));
    }
  }

  async function copyLoginCommand(provider: AgentProvider) {
    setError(null);
    try {
      await navigator.clipboard.writeText(loginCommand(provider));
      setCopiedSetupCommand(provider);
    } catch (reason) {
      setError(t("agent.acpSetupActionFailed", { error: errMessage(reason) }));
    }
  }

  async function changeConfigOption(
    option: AcpSessionConfigOption,
    value: string,
  ) {
    if (!active || configChanging || option.currentValue === value) return;
    setConfigChanging(option.id);
    setError(null);
    try {
      await setAgentAcpConfigOption(active.id, option.id, value);
    } catch (reason) {
      setError(
        t("agent.acpConfigFailed", {
          name: option.name,
          error: errMessage(reason),
        }),
      );
    } finally {
      setConfigChanging(null);
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
        setError(t("agent.acpPermissionFailed", { error: errMessage(reason) }));
      } finally {
        setPermissionSubmitting(null);
      }
    },
    [activeId, permissionSubmitting, t],
  );

  async function cancelTurn() {
    if (!active) return;
    setError(null);
    try {
      await cancelAgentAcpSession(active.id);
      // The live ACP event stream owns the turn-end and ready transition.
      // Replaying focus here races that stream and can merge an incomplete frame.
    } catch (reason) {
      setError(t("agent.acpCancelFailed", { error: errMessage(reason) }));
    }
  }

  async function closeSession() {
    if (!active || active.lifecycle === "closed") return;
    setError(null);
    try {
      await closeAgentAcpSession(active.id);
    } catch (reason) {
      setError(t("agent.acpCloseFailed", { error: errMessage(reason) }));
    }
  }

  const openMessageLink = useCallback((href: string) => {
    setError(null);
    void openAgentExternalLink(href, lang).catch((reason) => {
      setError(t("agent.acpOpenLinkFailed", { error: errMessage(reason) }));
    });
  }, [lang, t]);

  return {
    viewport,
    session: {
      active,
      sessions: workspaceSessions,
      transcript,
      richTranscriptKeys,
      activeEventsLoaded,
      replayTruncated: activeProjection?.replayTruncated ?? false,
      pendingPermissionId,
      permissionSubmitting,
      historyOpen,
      starting,
      busy: agentBusy,
      loading,
      loadError: sessionLoadError,
      debugDetails,
    },
    setup: {
      selectedProvider,
      enabledProviders,
      selectedCliStatus,
      selectedCliReady,
      selectedPluginReady,
      prerequisitesReady,
      cliDetectionError,
      cliPending: cliStatusQuery.isPending,
      cliFetching: cliStatusQuery.isFetching,
      pluginPending: pluginStatusQuery.isPending,
      copiedSetupCommand,
      knowledge: {
        projects: environmentInventory.projects,
        selectedProject: agentScope.project,
        selectedDatabases: agentScope.selectedDatabases,
        selectedSources: agentScope.selectedSources,
        selectedResourceKeys: agentScope.selectedResourceKeys,
        writeConnectionId: agentScope.writeConnectionId,
        scopeChangeAllowed,
        pending: environmentInventory.pending,
        success: environmentInventory.success,
        loadError: environmentLoadError,
        newScopeReady: newEnvironmentScopeReady,
        reconfirmingEnvironmentId: environmentInventory.updatingEnvironmentId,
      },
    },
    composer: {
      prompt,
      maxPromptChars: MAX_PROMPT_CHARS,
      expanded: composerExpanded,
      includeEditorContext: composerContext.included,
      contextLabels: composerContext.labels,
      environmentScopeReady,
      modelOption,
      configChanging,
    },
    feedback: {
      error,
    },
    commands: {
      session: {
        beginNewChat,
        select: selectSession,
        resume: resumeSession,
        start: startSession,
        cancelTurn,
        close: closeSession,
        toggleHistory: () => setHistoryOpen((current) => !current),
        retryLoad: () => retryAcpSessionSnapshot(catalogScope.key),
      },
      composer: {
        submit: sendPrompt,
        setPrompt,
        toggleExpanded: () => setComposerExpanded((current) => !current),
        toggleEditorContext: composerContext.toggle,
        selectEnvironment: scopeCommands.toggle,
        selectWriteTarget: scopeCommands.write,
        changeConfigOption,
      },
      setup: {
        changeProvider,
        openAgentSetup,
        openSetupGuide,
        copyLoginCommand,
        refreshCli: () => cliStatusQuery.refetch(),
        refreshKnowledgeEnvironments: () =>
          environmentInventory.refresh(),
      },
      permission: {
        respond: respondPermission,
      },
      feedback: {
        dismiss: () => setError(null),
      },
      links: {
        openMessage: openMessageLink,
      },
    },
  };
}

export type AcpChatController = ReturnType<typeof useAcpChatController>;
