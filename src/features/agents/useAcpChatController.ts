// ACP Chat composes provider readiness, the selected Project resources, the
// active session (useAcpActiveSession), composer state, and viewport effects,
// returning state and commands grouped by view responsibility.

import {
  useCallback,
  useEffect,
  useMemo,
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
  applyPanelModelChoice,
  applyRememberedAcpMode,
  rememberAcpMode,
} from "./approvalModePreference";
import { agentCliReady, agentPluginReady } from "./availability";
import { loginCommand, selectRichTranscriptKeys } from "./acpTranscriptPresentation";
import { agentErrorLabel, agentFailure, type AgentFailure } from "./agentErrorLabels";
import { useAgentDebugDetails } from "./displayPreferences";
import { useAgentApprovalFocusSelection } from "./pendingApprovals";
import type {
  AcpPromptContext,
  AcpSessionConfigOption,
  AcpSessionFocus,
  AcpSessionId,
  AcpSessionSummary,
  AgentComposerRequest,
  AgentProvider,
} from "./domain";
import {
  agentPluginStatusQuery,
  useAgentCliStatusQuery,
} from "./queryOptions";
import {
  isLiveSession,
  ownsAcpComposerRequest,
  selectWorkspaceSessions,
} from "./sessionFocus";
import {
  retryAcpSessionSnapshot,
  useAcpSessionSnapshot,
} from "./sessionStore";
import { observeAgentTurnOutcome } from "./productAnalytics";
import {
  closeAgentAcpSession,
  openAgentExternalLink,
  promptAgentAcpSession,
  setAgentAcpConfigOption,
} from "./tauriAdapter";
import { visibleAcpTranscriptItems } from "./transcript";
import {
  useAgentEnvironmentInventory,
  type AgentResourceReconfirmation,
} from "./useAgentEnvironmentInventory";
import {
  useAgentScopeConnection,
  useAgentScopeSelection,
} from "./useAgentScopeSelection";
import { useAcpActiveSession } from "./useAcpActiveSession";
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
  const [starting, setStarting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] =
    useState<AgentProvider>("claude");
  const [configChanging, setConfigChanging] = useState<string | null>(null);
  const [panelModelChoices, setPanelModelChoices] = useState<
    Partial<Record<AgentProvider, string>>
  >({});
  const [prompt, setPrompt] = useState("");
  const [errorState, setErrorState] = useState<AgentFailure | null>(null);
  // A failure from `agentFailure` carries its stable code and copyable raw
  // text; plain product copy has neither.
  const setError = useCallback((error: AgentFailure | string | null) => {
    setErrorState(
      typeof error === "string" ? { message: error, detail: null, code: null } : error,
    );
  }, []);
  const error = errorState?.message ?? null;
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedSetupCommand, setCopiedSetupCommand] =
    useState<AgentProvider | null>(null);
  const {
    connection: scopedConnection,
    select: selectScopedConnection,
  } = useAgentScopeConnection(connection, connections);
  const [consumedComposerRequestId, setConsumedComposerRequestId] = useState<string | null>(null);
  // Returning from a terminal install or sign-in re-probes only the chosen
  // CLIs that are not ready; a ready CLI is never spawned again on focus.
  const cliStatusQuery = useAgentCliStatusQuery(configuredProviders);
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
  // The chat connection decides whether AI Chat can host a provider at all; the
  // local CLI sign-in only gates the picker and new sessions, so its setup
  // guidance stays reachable and a readiness flap never hides a conversation.
  const pluginReadyProviders = useMemo(
    () =>
      configuredProviders.filter((provider) =>
        agentPluginReady(
          pluginStatusQuery.data?.find(
            (status) => status.pluginId === `dopedb.acp.${provider}`,
          ),
        ),
      ),
    [configuredProviders, pluginStatusQuery.data],
  );
  const enabledProviders = useMemo(
    () =>
      pluginReadyProviders.filter((provider) =>
        agentCliReady(cliStatusQuery.data?.find((status) => status.id === provider)),
      ),
    [pluginReadyProviders, cliStatusQuery.data],
  );

  const workspaceSessions = useMemo(
    () => selectWorkspaceSessions(sessionSnapshot.sessions, configuredProviders),
    [configuredProviders, sessionSnapshot.sessions],
  );
  const activeSession = useAcpActiveSession({
    catalogScope,
    sessions: workspaceSessions,
    projections: sessionSnapshot.projections,
    restoreReady:
      !sessionSnapshot.loading &&
      pluginStatusQuery.isSuccess &&
      cliStatusQuery.isSuccess,
    selectedProvider,
    starting,
    setStarting,
    setError,
  });
  const {
    active,
    activeId,
    activeEventsLoaded,
    selectActiveSession,
    beginFocusRequest,
    currentFocusRequest,
    focusRequestIsCurrent,
  } = activeSession;
  const activeSessionId = active?.id ?? null;
  const activeProvider = active?.provider ?? null;
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
    composerRequest: composerRequest?.id === consumedComposerRequestId ? null : composerRequest,
    connectionId: scopedConnection.id,
    inventory: environmentInventory,
    onClearError: () => setError(null),
    onSelectConnection: selectScopedConnection,
    selectionLocked: !scopeChangeAllowed,
  });
  const richTranscriptKeys = selectRichTranscriptKeys(transcript);
  // While a replacement session prepares, keep showing the provider's last
  // advertised options (disabled) so the composer does not jump or lose them.
  const liveConfigOptions = activeProjection?.configOptions ?? [];
  const configOptions =
    liveConfigOptions.length > 0
      ? liveConfigOptions
      : lastAdvertisedConfigOptions(
          workspaceSessions,
          sessionSnapshot.projections,
          activeProvider ?? selectedProvider,
        );
  const modelOption = configOptions.find(
    (option) =>
      option.category === "model" &&
      option.type === "select" &&
      typeof option.currentValue === "string",
  );
  const modeOption = configOptions.find((option) =>
    option.category === "mode" && option.type === "select" && typeof option.currentValue === "string",
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
    ? agentErrorLabel(errMessage(cliStatusQuery.error), t)
    : selectedCliStatus?.detectionError
      ? agentErrorLabel(selectedCliStatus.detectionError, t)
      : null;
  const selectedPluginReady = pluginReadyProviders.includes(selectedProvider);
  const activeLive = active !== null && isLiveSession(active.lifecycle);
  // A new session needs the chat connection and the signed-in local CLI; an
  // already running conversation keeps working through its own adapter.
  const startPrerequisitesReady = selectedCliReady && selectedPluginReady;
  const prerequisitesReady = activeLive || startPrerequisitesReady;
  const pickerProviders =
    selectedPluginReady && !enabledProviders.includes(selectedProvider)
      ? [...enabledProviders, selectedProvider]
      : enabledProviders;
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
        error: agentErrorLabel(errMessage(sessionSnapshot.error), t),
      })
    : null;
  const environmentLoadError = environmentInventory.loadError;
  // The database open in Explorer may belong to no Project; the Agent cannot
  // use it, so the panel says so and offers the existing binding destination.
  const explorerConnectionUnassigned =
    environmentInventory.success &&
    !environmentInventory.available.some((environment) =>
      environment.bindings.some((binding) => binding.connectionId === connection.id),
    );
  const assignEnvironmentId =
    agentScope.project?.databases[0]?.environmentId ??
    agentScope.project?.sources[0]?.environmentId ??
    environmentInventory.available[0]?.id ??
    null;
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

  const scopeCommands = useAcpScopeCommands({
    active,
    scopeChangeAllowed,
    starting,
    onSelectSession: selectActiveSession,
    setError,
    toggleResource: agentScope.toggle,
    selectWriteTarget: agentScope.selectWriteTarget,
  });
  // A prepared session nobody has prompted holds an adapter process and one of
  // the runtime's session slots. Leaving it for another provider, conversation,
  // or resource must close it instead of only deselecting it.
  const activeUntouched =
    active !== null && active.lifecycle === "ready" && transcript.length === 0;
  const releaseUntouchedActive = useCallback(() => {
    if (!active || !activeUntouched) return;
    void closeAgentAcpSession(active.id).catch(() => undefined);
  }, [active, activeUntouched]);
  const changeProvider = useCallback(
    (provider: AgentProvider) => {
      if (provider === selectedProvider && activeProvider === provider) return;
      setSelectedProvider(provider);
      setCopiedSetupCommand(null);
      if (activeProvider !== null && activeProvider !== provider) {
        releaseUntouchedActive();
        selectActiveSession(null);
        setPrompt("");
        setError(null);
        setNotice(null);
        setHistoryOpen(false);
        setIncludeEditorContext(false);
      }
    },
    [
      activeProvider,
      releaseUntouchedActive,
      selectActiveSession,
      selectedProvider,
      setError,
      setIncludeEditorContext,
    ],
  );

  useEffect(() => {
    if (activeProvider) setSelectedProvider(activeProvider);
  }, [activeProvider]);

  useEffect(() => {
    // Never switch away from an open conversation because a readiness probe
    // flapped; only an idle panel follows the first fully ready provider.
    if (activeProvider !== null || enabledProviders.includes(selectedProvider)) return;
    const next =
      enabledProviders[0] ??
      (pluginReadyProviders.includes(selectedProvider)
        ? undefined
        : pluginReadyProviders[0]);
    if (next) void changeProvider(next);
  }, [
    activeProvider,
    changeProvider,
    enabledProviders,
    pluginReadyProviders,
    selectedProvider,
  ]);

  useEffect(() => {
    // An untouched prepared session that closed (idle limit, provider removal)
    // has nothing to resume; let the panel prepare a fresh one when needed.
    if (
      !active ||
      starting ||
      !activeEventsLoaded ||
      active.lifecycle !== "closed" ||
      active.error !== null ||
      transcript.length > 0
    ) {
      return;
    }
    selectActiveSession(null);
  }, [active, activeEventsLoaded, selectActiveSession, starting, transcript.length]);

  const commitStartedSession = useCallback(
    (focus: AcpSessionFocus, provider: AgentProvider) => {
      selectActiveSession(focus.session.id);
      setSelectedProvider(provider);
      setHistoryOpen(false);
    },
    [selectActiveSession],
  );
  const prepareRememberedMode = useCallback(async (focus: AcpSessionFocus) => {
    try {
      await applyRememberedAcpMode(focus, catalogScope.preferenceKey ?? catalogScope.key);
      await applyPanelModelChoice(focus, panelModelChoices[focus.session.provider]);
    } catch (reason) {
      setError(agentFailure(reason, t, (error) =>
        t("agent.acpConfigFailed", { name: t("agent.acpApprovalMode"), error })));
    }
  }, [catalogScope.key, catalogScope.preferenceKey, panelModelChoices, setError, t]);
  const startSession = useAcpSessionStartup({
    activeSessionId,
    beginFocusRequest,
    catalogScope,
    connectionId: agentScope.anchorConnectionId ?? scopedConnection.id,
    currentFocusRequest,
    resourceScopeReady: newEnvironmentScopeReady,
    focusRequestIsCurrent,
    onError: setError,
    onStarted: commitStartedSession,
    onPrepared: prepareRememberedMode,
    onStartingChange: setStarting,
    prerequisitesReady: startPrerequisitesReady,
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
        const replacingConversation = session !== null && transcript.length > 0;
        const focus = await startSession(selectedProvider);
        session = focus?.session ?? null;
        // Say so when a message opens a new conversation instead of continuing
        // the closed one; its history stays in the session list.
        if (session && replacingConversation) setNotice(t("agent.acpStartedNewSession"));
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
      t,
      transcript.length,
    ],
  );

  useEffect(() => {
    if (
      composerRequest === null ||
      consumedComposerRequestId === composerRequest.id ||
      !environmentInventory.success
    ) return;
    const environment = availableKnowledgeEnvironments.find(
      (candidate) => candidate.id === composerRequest.projectEnvironmentId,
    );
    if (!environment) {
      setConsumedComposerRequestId(composerRequest.id);
      setError(t("agent.acpEnvironmentRequiredBody"));
      return;
    }
    if (active && !ownsAcpComposerRequest(active, composerRequest)) {
      releaseUntouchedActive();
      selectActiveSession(null);
      return;
    }
    if (!agentScope.resourceScopes.some((scope) =>
      scope.projectEnvironmentId === environment.id
      && scope.connectionIds.includes(composerRequest.connectionId),
    )) return;
    if (
      starting ||
      !prerequisitesReady ||
      (active !== null && !["ready", "closed", "failed"].includes(active.lifecycle))
    ) return;
    setConsumedComposerRequestId(composerRequest.id);
    setHistoryOpen(false);
    if (!composerRequest.prompt) return;
    const submitted = composerRequest.prompt.slice(0, MAX_PROMPT_CHARS);
    setPrompt(submitted);
    setError(null);
    setIncludeEditorContext(false);
    void submitPromptText(submitted, EMPTY_ACP_PROMPT_CONTEXT)
      .then((sent) => {
        if (sent) setPrompt("");
      })
      .catch((reason) => {
        setError(agentFailure(reason, t, (error) => t("agent.acpSendFailed", { error })));
      });
  }, [
    active,
    availableKnowledgeEnvironments,
    composerRequest,
    consumedComposerRequestId,
    environmentInventory.success,
    prerequisitesReady,
    releaseUntouchedActive,
    selectActiveSession,
    agentScope.resourceScopes,
    setError,
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
    setNotice(null);
    setIncludeEditorContext(false);
  }

  // A conversation whose pinned resources changed cannot resume. The new
  // draft keeps its selection, because the draft mirrors the last selected
  // conversation's resources; a stale binding still needs reconfirmation.
  function newWithSameResources() {
    beginNewChat();
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-agent-focus-target="composer"]:not(:disabled)')
        ?.focus({ preventScroll: true });
    });
  }

  function selectSession(id: AcpSessionId) {
    const session = workspaceSessions.find((candidate) => candidate.id === id);
    if (activeId !== id) releaseUntouchedActive();
    selectActiveSession(id);
    setError(null);
    setNotice(null);
    if (session) setSelectedProvider(session.provider);
    setHistoryOpen(false);
  }
  // A pending Agent change opened from the status bar shows its conversation.
  useAgentApprovalFocusSelection(workspaceSessions, activeId, selectSession);

  async function sendPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = prompt;
    setError(null);
    setNotice(null);
    try {
      const submittedContext = composerContext.included
        ? composerContext.context
        : EMPTY_ACP_PROMPT_CONTEXT;
      if (await submitPromptText(submitted, submittedContext)) setPrompt("");
    } catch (reason) {
      setError(agentFailure(reason, t, (error) => t("agent.acpSendFailed", { error })));
    }
  }

  async function openSetupGuide(provider: AgentProvider) {
    setError(null);
    try {
      await openUrl(AGENT_SETUP_URLS[provider]);
    } catch (reason) {
      setError(agentFailure(reason, t, (error) => t("agent.acpSetupActionFailed", { error })));
    }
  }

  async function copyLoginCommand(provider: AgentProvider) {
    setError(null);
    try {
      await navigator.clipboard.writeText(loginCommand(provider));
      setCopiedSetupCommand(provider);
    } catch (reason) {
      setError(agentFailure(reason, t, (error) => t("agent.acpSetupActionFailed", { error })));
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
      if (option.category === "mode") {
        rememberAcpMode(catalogScope.preferenceKey ?? catalogScope.key, active.provider, value);
      }
      if (option.category === "model") {
        setPanelModelChoices((current) => ({ ...current, [active.provider]: value }));
      }
    } catch (reason) {
      setError(agentFailure(reason, t, (error) =>
        t("agent.acpConfigFailed", { name: option.name, error })));
    } finally {
      setConfigChanging(null);
    }
  }

  const openMessageLink = useCallback((href: string) => {
    setError(null);
    void openAgentExternalLink(href, lang).catch((reason) => {
      setError(agentFailure(reason, t, (error) => t("agent.acpOpenLinkFailed", { error })));
    });
  }, [lang, setError, t]);

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
      permissionSubmitting: activeSession.permissionSubmitting,
      historyOpen,
      starting,
      busy: agentBusy,
      activeLive,
      // Proposal cards accept decisions only for this live conversation's own
      // Broker session; a stored or ended one has none.
      brokerSessionId:
        activeLive && activeSessionId !== null
          ? sessionSnapshot.brokerSessionIds.get(activeSessionId) ?? null
          : null,
      loading,
      loadError: sessionLoadError,
      debugDetails,
    },
    setup: {
      selectedProvider,
      enabledProviders,
      pluginReadyProviders,
      pickerProviders,
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
        needsReconfirmation: agentScope.needsReconfirmation,
        // What changed in each selected resource, shown before reconfirming.
        reconfirmChanges: uniqueReconfirmations([
          ...agentScope.selectedDatabases,
          ...agentScope.selectedSources,
        ]),
        unassignedConnectionName: explorerConnectionUnassigned
          ? connection.name
          : null,
        assignEnvironmentId,
        reconfirmingEnvironmentId: environmentInventory.updatingEnvironmentId,
      },
    },
    composer: {
      prompt,
      maxPromptChars: MAX_PROMPT_CHARS,
      includeEditorContext: composerContext.included,
      contextLabels: composerContext.labels,
      environmentScopeReady,
      modelOption,
      modeOption,
      configChanging,
    },
    feedback: {
      error,
      errorDetail: errorState?.detail ?? null,
      // Resuming found the pinned resources changed: offer the same selection
      // in a new conversation instead of a dead end.
      offerSameResources:
        errorState?.code === "agent_scope_changed" && active !== null && !activeLive,
      notice,
    },
    commands: {
      session: {
        beginNewChat,
        newWithSameResources,
        select: selectSession,
        resume: activeSession.commands.resume,
        start: startSession,
        cancelStart: activeSession.commands.cancelStart,
        cancelTurn: activeSession.commands.cancelTurn,
        close: activeSession.commands.close,
        toggleHistory: () => setHistoryOpen((current) => !current),
        retryLoad: () => retryAcpSessionSnapshot(catalogScope.key),
      },
      composer: {
        submit: sendPrompt,
        setPrompt,
        toggleEditorContext: composerContext.toggle,
        selectEnvironment: scopeCommands.toggle,
        selectWriteTarget: scopeCommands.write,
        reconfirmResources: () => void agentScope.reconfirmSelected(),
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
        respond: activeSession.commands.respondPermission,
      },
      feedback: {
        dismiss: () => setError(null),
        dismissNotice: () => setNotice(null),
      },
      links: {
        openMessage: openMessageLink,
      },
    },
  };
}

export type AcpChatController = ReturnType<typeof useAcpChatController>;

/** One entry per changed connection, even when a database and a source share it. */
function uniqueReconfirmations(
  resources: readonly { reconfirmation: AgentResourceReconfirmation | null }[],
): AgentResourceReconfirmation[] {
  const changes = new Map<string, AgentResourceReconfirmation>();
  for (const { reconfirmation } of resources) {
    if (reconfirmation) changes.set(reconfirmation.connectionId, reconfirmation);
  }
  return [...changes.values()];
}

function lastAdvertisedConfigOptions(
  sessions: readonly AcpSessionSummary[],
  projections: ReadonlyMap<AcpSessionId, { configOptions: AcpSessionConfigOption[] }>,
  provider: AgentProvider,
): AcpSessionConfigOption[] {
  for (const candidate of sessions) {
    if (candidate.provider !== provider) continue;
    const options = projections.get(candidate.id)?.configOptions;
    if (options && options.length > 0) return options;
  }
  return [];
}
