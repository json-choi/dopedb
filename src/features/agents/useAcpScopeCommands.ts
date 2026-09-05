// Resource changes update the draft immediately and retire its old prepared
// session in the background. A conversation's exact grant remains immutable.

import type { Dispatch, SetStateAction } from "react";

import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
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
  setError: Dispatch<SetStateAction<string | null>>;
  toggleResource: (resourceKey: string) => void;
  selectWriteTarget: (connectionId: ConnectionId | null) => void;
}) {
  const { t } = useI18n();

  async function replacePreparedSession(action: () => void) {
    if (starting || !scopeChangeAllowed) return;
    setError(null);
    onSelectSession(null);
    action();
    if (active) {
      try {
        await closeAgentAcpSession(active.id);
      } catch (reason) {
        setError(t("agent.acpCloseFailed", { error: errMessage(reason) }));
      }
    }
  }

  return {
    toggle(resourceKey: string | null) {
      if (resourceKey === null) return Promise.resolve();
      return replacePreparedSession(() => toggleResource(resourceKey));
    },
    write(connectionId: ConnectionId | null) {
      return replacePreparedSession(() => selectWriteTarget(connectionId));
    },
  };
}
