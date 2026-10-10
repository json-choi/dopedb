// Read-only query options for local Agent CLI and adapter status and for the
// trusted review behind each Agent SQL proposal card. These keep the feature's
// Tauri boundary local while sharing TanStack Query cache entries.
import { useEffect } from "react";
import {
  focusManager,
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { reviewAgentSqlProposal } from "../queries/tauriAdapter";
import { agentCliReady } from "./availability";
import type { AgentCliInfo, AgentProvider } from "./domain";
import { agentQueryKeys } from "./queryKeys";
import {
  isFinalOperationState,
  type AgentSqlProposalReference,
} from "./sqlProposal";
import {
  detectAgentClis,
  listAgentAcpPlugins,
} from "./tauriAdapter";

// Returning from a terminal sign-in re-probes only CLIs that were not ready,
// after focus settles and never more often than this.
const CLI_REPROBE_DEBOUNCE_MS = 600;
const CLI_REPROBE_MIN_INTERVAL_MS = 15_000;

// A pending proposal is re-read at its expiry and at least this often, so a
// revoked session, an external decision, or an execution outcome replaces the
// card's state without a local guess.
const PENDING_REVIEW_REFRESH_MS = 5_000;

export function agentPluginStatusQuery() {
  return queryOptions({
    queryKey: agentQueryKeys.pluginStatus(),
    staleTime: 15_000,
    queryFn: listAgentAcpPlugins,
  });
}

// Short staleTime keeps an explicit refresh responsive without re-spawning local CLIs on render.
export function agentCliDetectionQuery() {
  return queryOptions({
    queryKey: agentQueryKeys.cliStatus(),
    staleTime: 15_000,
    queryFn: () => detectAgentClis(),
  });
}

/**
 * The CLI status for the chosen providers. Window focus never re-probes every
 * CLI: after focus settles, only the chosen providers that are not ready are
 * probed again, at most once per interval, and merged into the shared entry.
 */
export function useAgentCliStatusQuery(configuredProviders: readonly AgentProvider[]) {
  const queryClient = useQueryClient();
  const query = useQuery({ ...agentCliDetectionQuery(), refetchOnWindowFocus: false });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = focusManager.subscribe((focused) => {
      if (!focused) {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const key = agentQueryKeys.cliStatus();
        const state = queryClient.getQueryState<AgentCliInfo[]>(key);
        if (!state?.data || Date.now() - state.dataUpdatedAt < CLI_REPROBE_MIN_INTERVAL_MS) return;
        const statuses = state.data;
        const notReady = configuredProviders.filter(
          (provider) => !agentCliReady(statuses.find((status) => status.id === provider)),
        );
        if (notReady.length === 0) return;
        void detectAgentClis(notReady)
          .then((probed) => {
            queryClient.setQueryData<AgentCliInfo[]>(key, (current) =>
              (current ?? []).map(
                (status) => probed.find((next) => next.id === status.id) ?? status,
              ),
            );
          })
          .catch(() => undefined);
      }, CLI_REPROBE_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [configuredProviders, queryClient]);
  return query;
}

/** The trusted stored proposal is the single owner of an approval card's state. */
export function agentSqlProposalReviewQuery(proposal: AgentSqlProposalReference) {
  return queryOptions({
    queryKey: agentQueryKeys.sqlProposalReview(proposal.operationId, proposal.payloadHash),
    queryFn: () =>
      reviewAgentSqlProposal(
        proposal.operationId,
        proposal.connectionId,
        proposal.payloadHash,
      ),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const review = query.state.data;
      if (!review || isFinalOperationState(review.state)) return false;
      const expiresAt = review.expiresAt ? Date.parse(review.expiresAt) : Number.NaN;
      if (!Number.isFinite(expiresAt)) return PENDING_REVIEW_REFRESH_MS;
      return Math.min(
        PENDING_REVIEW_REFRESH_MS,
        Math.max(250, expiresAt - Date.now() + 250),
      );
    },
  });
}
