// Resource changes update the draft immediately and retire an unprompted session
// left by a failed send. A conversation's exact grant remains immutable.

import { useI18n } from "../../lib/i18n";
import { agentFailure, type AgentFailure } from "./agentErrorLabels";
import type { ConnectionId } from "../connections/domain";
import type { AcpSessionId, AcpSessionSummary } from "./domain";
import { closeAgentAcpSession } from "./tauriAdapter";

export function useAcpScopeCommands({
  active,
  scopeChangeAllowed,
  starting,
  onSelectSession,
  setError,
  toggleResource,
  selectWriteTarget,
}: {
  active: AcpSessionSummary | null;
  scopeChangeAllowed: boolean;
  starting: boolean;
  onSelectSession: (id: AcpSessionId | null) => void;
  setError: (error: AgentFailure | string | null) => void;
  toggleResource: (resourceKey: string) => void;
  selectWriteTarget: (connectionId: ConnectionId | null) => void;
}) {
  const { t } = useI18n();

  async function updateDraft(action: () => void) {
    if (starting || !scopeChangeAllowed) return;
    setError(null);
    onSelectSession(null);
    action();
    if (active) {
      try {
        await closeAgentAcpSession(active.id);
      } catch (reason) {
        setError(agentFailure(reason, t, (error) => t("agent.acpCloseFailed", { error })));
      }
    }
  }

  return {
    toggle(resourceKey: string | null) {
      if (resourceKey === null) return Promise.resolve();
      return updateDraft(() => toggleResource(resourceKey));
    },
    write(connectionId: ConnectionId | null) {
      return updateDraft(() => selectWriteTarget(connectionId));
    },
  };
}
