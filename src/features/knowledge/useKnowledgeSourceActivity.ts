// Reconciles live Knowledge indexing events with inventory snapshots and analytics.
import { useEffect, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";

import type { KnowledgeSource } from "./domain";
import { knowledgeQueryKeys } from "./queryKeys";
import { onKnowledgeSourceChanged } from "./tauriAdapter";
import {
  finishKnowledgeSyncOutcome,
  type KnowledgeSourceActivity,
  type PendingKnowledgeSyncAnalytics,
} from "./workspaceModel";

export function useKnowledgeSourceActivity(
  sources: KnowledgeSource[] | undefined,
  queryClient: QueryClient,
) {
  const pendingSyncAnalytics = useRef(
    new Map<string, PendingKnowledgeSyncAnalytics>(),
  );
  const [activity, setActivity] = useState(
    new Map<string, KnowledgeSourceActivity>(),
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onKnowledgeSourceChanged((change) => {
      if (disposed) return;
      setActivity((current) => {
        const next = new Map(current);
        const previous = next.get(change.sourceId);
        next.set(change.sourceId, {
          state: change.state,
          errorKind: change.errorKind,
          previousGraphRevisionId: previous?.previousGraphRevisionId,
        });
        return next;
      });
      if (change.state === "ready") {
        finishKnowledgeSyncOutcome(
          pendingSyncAnalytics.current,
          change.sourceId,
          "success",
        );
        void queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.inventory(),
        });
        void queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.agentEnvironments(),
        });
      } else if (change.state === "failed") {
        finishKnowledgeSyncOutcome(
          pendingSyncAnalytics.current,
          change.sourceId,
          "failed",
        );
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!sources) return;
    for (const [sourceId, pending] of pendingSyncAnalytics.current) {
      const source = sources.find(
        (candidate) => candidate.sourceId === sourceId,
      );
      if (!source) continue;
      if (source.health === "failed" || source.health === "stale") {
        finishKnowledgeSyncOutcome(
          pendingSyncAnalytics.current,
          sourceId,
          "failed",
        );
        continue;
      }
      if (
        source.health === "ready" &&
        source.graphRevisionId !== pending.previousGraphRevisionId
      ) {
        finishKnowledgeSyncOutcome(
          pendingSyncAnalytics.current,
          sourceId,
          "success",
        );
      }
    }
    setActivity((current) => {
      let changed = false;
      const next = new Map(current);
      for (const [sourceId, sourceActivity] of current) {
        if (
          sourceActivity.state !== "syncing" ||
          sourceActivity.previousGraphRevisionId === undefined
        ) continue;
        const source = sources.find(
          (candidate) => candidate.sourceId === sourceId,
        );
        if (!source) {
          next.delete(sourceId);
          changed = true;
          continue;
        }
        if (source.health === "failed" || source.health === "stale") {
          next.set(sourceId, { state: "failed", errorKind: "cloud_index" });
          changed = true;
          continue;
        }
        if (
          source.provider === "github" &&
          source.graphRevisionId !== null &&
          source.graphRevisionId !== sourceActivity.previousGraphRevisionId
        ) {
          next.set(sourceId, { state: "ready", errorKind: null });
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [sources]);

  return {
    pendingSyncAnalytics,
    activity,
  };
}
