// Owns the external Agent request registry and delegates each active request to
// a bounded review dialog.
import { useCallback, useEffect, useState } from "react";

import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { ConnectionProfile } from "../connections/domain";
import type { ExternalAgentConfig, ExternalAgentRequestSummary } from "./externalAgentDomain";
import {
  listExternalAgentRequests,
  onExternalAgentRequestFinished,
  onExternalAgentRequested,
  respondExternalAgentRequest,
} from "./externalAgentTauriAdapter";
import {
  ExternalAgentProposalDialog,
  ExternalAgentRequestDialog,
  ExternalAgentUnavailableDialog,
} from "./ExternalAgentRequestDialogs";

export function ExternalAgentRequestGate({
  catalogScopeKey,
  connections,
  selectedConnection,
}: {
  catalogScopeKey: string;
  connections: ConnectionProfile[];
  selectedConnection: ConnectionProfile | null;
}) {
  const { t } = useI18n();
  const [requests, setRequests] = useState<ExternalAgentRequestSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRequests(await listExternalAgentRequests());
    } catch (reason) {
      setError(t("agent.externalRequestLoadFailed", { error: errMessage(reason) }));
    }
  }, [t]);

  useEffect(() => {
    let disposed = false;
    let unlistens: (() => void)[] = [];
    void Promise.all([
      onExternalAgentRequested((request) => {
        if (disposed) return;
        setRequests((current) =>
          current.some((candidate) => candidate.id === request.id)
            ? current
            : [...current, request],
        );
      }),
      onExternalAgentRequestFinished((requestId) => {
        if (disposed) return;
        setRequests((current) =>
          current.filter((request) => request.id !== requestId),
        );
      }),
    ])
      .then((stops) => {
        if (disposed) stops.forEach((stop) => stop());
        else {
          unlistens = stops;
          // Subscribe before listing so a CLI request cannot land in the gap
          // between the initial snapshot and event registration.
          void refresh();
        }
      })
      .catch((reason) => {
        if (disposed) return;
        setError(
          t("agent.externalRequestLoadFailed", { error: errMessage(reason) }),
        );
        void refresh();
      });
    return () => {
      disposed = true;
      unlistens.forEach((stop) => stop());
    };
  }, [refresh, t]);

  const active = requests[0] ?? null;
  const requestedAnchor = active?.config?.anchorConnectionId;
  const anchor =
    connections.find((connection) => connection.id === requestedAnchor)
    ?? selectedConnection
    ?? connections[0]
    ?? null;

  const respond = useCallback(
    async (approved: boolean, config: ExternalAgentConfig | null) => {
      if (!active || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        await respondExternalAgentRequest(active.id, approved, config);
        setRequests((current) =>
          current.filter((request) => request.id !== active.id),
        );
      } catch (reason) {
        setError(
          t("agent.externalRequestResponseFailed", { error: errMessage(reason) }),
        );
        // A timeout or exited CLI can race with the click. Reconcile the
        // snapshot so an already-finished request never traps the modal open.
        try {
          setRequests(await listExternalAgentRequests());
        } catch {
          // Keep the response error visible; a lifecycle event reconciles later.
        }
      } finally {
        setSubmitting(false);
      }
    },
    [active, submitting, t],
  );

  if (!active) return null;
  if (active.kind === "proposal" && active.proposal) {
    return (
      <ExternalAgentProposalDialog
        key={active.id}
        request={active}
        proposal={active.proposal}
        error={error}
        submitting={submitting}
        onClose={() => void respond(false, null)}
      />
    );
  }
  if (!anchor) {
    return (
      <ExternalAgentUnavailableDialog
        request={active}
        error={error}
        submitting={submitting}
        onReject={() => void respond(false, null)}
      />
    );
  }
  return (
    <ExternalAgentRequestDialog
      key={active.id}
      request={active}
      anchor={anchor}
      connections={connections}
      catalogScopeKey={catalogScopeKey}
      error={error}
      submitting={submitting}
      onApprove={(config) => void respond(true, config)}
      onReject={() => void respond(false, null)}
    />
  );
}
