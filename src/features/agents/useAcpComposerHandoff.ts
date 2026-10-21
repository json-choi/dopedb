// Delivers one screen-owned composer handoff into the exact Agent scope it
// names. The controller owns the consumed-request state and the composer; this
// hook only decides when the request is sent, kept queued, or rejected. A write
// handoff waits for its writable target and a stale binding waits for the
// composer's explicit reconfirm action instead of being dropped.

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { useI18n } from "../../lib/i18n";
import { EMPTY_ACP_PROMPT_CONTEXT } from "./acpPromptContext";
import { agentFailure, type AgentFailure } from "./agentErrorLabels";
import type {
  AcpPromptContext,
  AcpSessionId,
  AcpSessionSummary,
  AgentComposerRequest,
} from "./domain";
import { ownsAcpComposerRequest } from "./sessionFocus";
import type { useAgentScopeSelection } from "./useAgentScopeSelection";

type AgentScope = ReturnType<typeof useAgentScopeSelection>;

export function useAcpComposerHandoff({
  request,
  consumedId,
  consume,
  active,
  inventoryReady,
  environments,
  scope,
  environmentScopeReady,
  prerequisitesReady,
  starting,
  maxPromptChars,
  composerPrompt,
  releaseUntouchedActive,
  selectActiveSession,
  setError,
  setPrompt,
  setHistoryOpen,
  setIncludeEditorContext,
  submitPromptText,
}: {
  request: AgentComposerRequest | null;
  consumedId: string | null;
  consume: (requestId: string) => void;
  active: AcpSessionSummary | null;
  inventoryReady: boolean;
  environments: ReadonlyArray<{ id: string }>;
  scope: Pick<
    AgentScope,
    "needsReconfirmation" | "resourceScopes" | "selectedDatabases" | "writeConnectionId"
  >;
  environmentScopeReady: boolean;
  prerequisitesReady: boolean;
  starting: boolean;
  maxPromptChars: number;
  /** The composer text, which the person may edit while a request waits. */
  composerPrompt: string;
  releaseUntouchedActive: () => void;
  selectActiveSession: (id: AcpSessionId | null) => void;
  setError: (error: AgentFailure | string | null) => void;
  setPrompt: Dispatch<SetStateAction<string>>;
  setHistoryOpen: (open: boolean) => void;
  setIncludeEditorContext: (include: boolean) => void;
  submitPromptText: (text: string, context: AcpPromptContext) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const { needsReconfirmation, resourceScopes, selectedDatabases, writeConnectionId } = scope;
  // The queued prompt is copied into the composer once, so edits made while
  // the person reconfirms are not overwritten by later effect passes.
  const prefilledId = useRef<string | null>(null);

  useEffect(() => {
    if (request === null || consumedId === request.id || !inventoryReady) return;
    const environment = environments.find(
      (candidate) => candidate.id === request.projectEnvironmentId,
    );
    if (!environment) {
      consume(request.id);
      setError(t("agent.acpEnvironmentRequiredBody"));
      return;
    }
    if (active && !ownsAcpComposerRequest(active, request)) {
      releaseUntouchedActive();
      selectActiveSession(null);
      return;
    }
    if (!resourceScopes.some((candidate) =>
      candidate.projectEnvironmentId === environment.id
      && candidate.connectionIds.includes(request.connectionId),
    )) return;
    if (
      starting ||
      !prerequisitesReady ||
      (active !== null && !["ready", "closed", "failed"].includes(active.lifecycle))
    ) return;
    const requestedWrite = request.writeConnectionId;
    if (requestedWrite !== null && writeConnectionId !== requestedWrite) {
      // The scope selection adopts a writable target on its next pass; a
      // database that cannot enter the write path is never granted one.
      if (selectedDatabases.some((database) =>
        database.connectionId === requestedWrite &&
        database.environmentId === request.projectEnvironmentId &&
        database.writable,
      )) return;
      consume(request.id);
      setError(t("agent.acpComposerWriteUnavailable"));
      return;
    }
    if (!environmentScopeReady) {
      // Only the composer's reconfirm action rebinds a stale resource; the
      // request stays queued in the composer and is sent once it is ready.
      if (needsReconfirmation && request.prompt && prefilledId.current !== request.id) {
        prefilledId.current = request.id;
        setPrompt(request.prompt.slice(0, maxPromptChars));
      }
      return;
    }
    consume(request.id);
    setHistoryOpen(false);
    // A prompt shown during reconfirmation is the person's draft by now: send
    // what the composer holds, and nothing if they cleared it.
    const submitted = (
      prefilledId.current === request.id ? composerPrompt : request.prompt
    ).slice(0, maxPromptChars);
    if (!submitted.trim()) return;
    setPrompt(submitted);
    setError(null);
    setIncludeEditorContext(false);
    void submitPromptText(submitted, EMPTY_ACP_PROMPT_CONTEXT)
      .then((sent) => {
        if (sent) setPrompt((current) => current === submitted ? "" : current);
      })
      .catch((reason) => {
        setError(agentFailure(reason, t, (error) => t("agent.acpSendFailed", { error })));
      });
  }, [
    active,
    composerPrompt,
    consume,
    consumedId,
    environmentScopeReady,
    environments,
    inventoryReady,
    maxPromptChars,
    needsReconfirmation,
    prerequisitesReady,
    releaseUntouchedActive,
    request,
    resourceScopes,
    selectActiveSession,
    selectedDatabases,
    setError,
    setHistoryOpen,
    setIncludeEditorContext,
    setPrompt,
    starting,
    submitPromptText,
    t,
    writeConnectionId,
  ]);

  // A handoff waiting for a ready Agent or for reconfirmation stays visible
  // and cancellable.
  const pending =
    request !== null &&
    consumedId !== request.id &&
    request.prompt !== "" &&
    (!prerequisitesReady || needsReconfirmation);
  return {
    pending,
    cancel: () => {
      if (request) consume(request.id);
    },
  };
}
