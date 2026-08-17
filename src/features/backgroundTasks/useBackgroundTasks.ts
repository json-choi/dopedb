import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ConnectionProfile } from "../connections/domain";
import {
  type QueryServiceStore,
  useQueryServiceActivities,
} from "../queryServices/store";
import type { AcpSessionSummary } from "../agents/domain";
import {
  cancelAgentAcpSession,
} from "../agents/tauriAdapter";
import { useAcpSessionSnapshot } from "../agents/sessionStore";
import type { Job } from "../jobs/domain";
import { cancelJob } from "../jobs/tauriAdapter";
import { jobsQuery, qk } from "../../lib/queries";
import { usePostPaintReady } from "../../lib/usePostPaintReady";
import {
  knowledgeSyncOverallPercent,
  knowledgeSyncProgressQuery,
  knowledgeSyncRemainingFiles,
} from "../knowledge/syncProgress";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";
import { cancelKnowledgeSourceSync } from "../knowledge/tauriAdapter";
import type { BackgroundTask, BackgroundTaskStatus } from "./domain";

const ACTIVE_JOB_STATES = new Set<Job["state"]>([
  "running",
  "pause_requested",
  "paused",
  "cancel_requested",
]);

const ACTIVE_AGENT_STATES = new Set<AcpSessionSummary["lifecycle"]>([
  "starting",
  "running",
  "waitingPermission",
]);

function jobProgress(job: Job) {
  if (job.rowsTotal && job.rowsTotal > 0) {
    return Math.min(100, (job.rowsProcessed / job.rowsTotal) * 100);
  }
  if (job.bytesTotal && job.bytesTotal > 0) {
    return Math.min(100, (job.bytesProcessed / job.bytesTotal) * 100);
  }
  return null;
}

function jobStatus(state: Job["state"]): BackgroundTaskStatus {
  if (state === "pause_requested") return "pausing";
  if (state === "paused") return "paused";
  if (state === "cancel_requested") return "cancelling";
  return "running";
}

function agentStatus(
  lifecycle: AcpSessionSummary["lifecycle"],
): BackgroundTaskStatus {
  if (lifecycle === "starting") return "starting";
  if (lifecycle === "waitingPermission") return "waitingPermission";
  return "running";
}

export function useBackgroundTasks({
  connections,
  queryServiceStore,
  workspaceScopeKey,
  knowledgeSyncEnabled,
}: {
  connections: ConnectionProfile[];
  queryServiceStore: QueryServiceStore;
  workspaceScopeKey: string;
  knowledgeSyncEnabled: boolean;
}) {
  const queryClient = useQueryClient();
  const postPaintReady = usePostPaintReady();
  const querySessions = useQueryServiceActivities(queryServiceStore);
  const agentSessions = useAcpSessionSnapshot(
    workspaceScopeKey,
    postPaintReady,
  ).sessions;
  const [cancellingKeys, setCancellingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const jobQueries = useQueries({
    queries: connections.map((connection) => ({
      ...jobsQuery(connection.id),
      enabled: postPaintReady,
    })),
  });
  const knowledgeSyncProgress = useQuery(
    knowledgeSyncProgressQuery(
      workspaceScopeKey,
      postPaintReady && knowledgeSyncEnabled,
    ),
  );
  const previousKnowledgeProgressIds = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!knowledgeSyncProgress.data) return;
    const next = new Set(
      knowledgeSyncProgress.data.map((progress) => progress.sourceId),
    );
    const completed = [...previousKnowledgeProgressIds.current].some(
      (sourceId) => !next.has(sourceId),
    );
    previousKnowledgeProgressIds.current = next;
    if (!completed) return;
    void queryClient.invalidateQueries({
      queryKey: knowledgeQueryKeys.sources(workspaceScopeKey),
    });
    void queryClient.invalidateQueries({
      queryKey: knowledgeQueryKeys.agentEnvironments(),
    });
  }, [knowledgeSyncProgress.data, queryClient, workspaceScopeKey]);

  const tasks = useMemo(() => {
    const connectionNames = new Map(
      connections.map((connection) => [
        connection.id as string,
        connection.name || connection.database,
      ]),
    );
    const queryTasks: BackgroundTask[] = querySessions.flatMap((session) => {
      if (session.status !== "running" && session.status !== "waiting") {
        return [];
      }
      return [{
        kind: "query",
        key: `query:${session.id}`,
        sessionId: session.id,
        connectionId: session.connectionId,
        connectionName:
          connectionNames.get(session.connectionId) ||
          session.connectionName,
        title: session.consoleTitle,
        status:
          session.status === "waiting" ? "waitingApproval" : "running",
        progress: null,
        rowsProcessed: null,
        updatedAt: session.updatedAt,
        cancellable: false,
      }];
    });
    const agentTasks: BackgroundTask[] = agentSessions.flatMap((session) => {
      if (!ACTIVE_AGENT_STATES.has(session.lifecycle)) return [];
      return [{
        kind: "agent",
        key: `agent:${session.id}`,
        sessionId: session.id,
        connectionId: session.connectionId,
        connectionName:
          connectionNames.get(session.connectionId) || session.connectionId,
        title: session.title,
        status: agentStatus(session.lifecycle),
        progress: null,
        rowsProcessed: null,
        updatedAt: Date.parse(session.updatedAt) || 0,
        cancellable: true,
      }];
    });
    const jobTasks: BackgroundTask[] = jobQueries.flatMap((query) =>
      (query.data ?? []).flatMap((job) => {
        if (!ACTIVE_JOB_STATES.has(job.state)) return [];
        return [{
          kind: "job",
          key: `job:${job.id}`,
          jobId: job.id,
          connectionId: job.connectionId,
          connectionName:
            connectionNames.get(job.connectionId) || job.connectionId,
          title:
            job.kind === "export"
              ? job.targetSummary
              : job.sourceSummary,
          status: jobStatus(job.state),
          progress: jobProgress(job),
          rowsProcessed: job.rowsProcessed,
          updatedAt: Date.parse(job.updatedAt) || 0,
          operation: job.kind,
          cancellable: job.state !== "cancel_requested",
        }];
      })
    );
    const knowledgeTasks: BackgroundTask[] =
      (knowledgeSyncProgress.data ?? []).map((progress) => ({
        kind: "knowledge",
        key: `knowledge:${progress.sourceId}`,
        sourceId: progress.sourceId,
        projectEnvironmentId: progress.projectEnvironmentId,
        projectName: progress.projectName,
        environmentName: progress.environmentName,
        title: progress.displayName,
        status: progress.retryAt === null ? "running" : "starting",
        progress: knowledgeSyncOverallPercent(progress),
        rowsProcessed: null,
        updatedAt: Date.parse(progress.updatedAt) || 0,
        phase: progress.phase,
        totalFiles: progress.totalFiles,
        completedFiles: progress.completedFiles,
        remainingFiles: knowledgeSyncRemainingFiles(progress),
        attempt: progress.attempt,
        retryAt: progress.retryAt,
        cancellable: true,
      }));

    return [...queryTasks, ...agentTasks, ...jobTasks, ...knowledgeTasks].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
  }, [
    agentSessions,
    connections,
    jobQueries,
    knowledgeSyncProgress.data,
    querySessions,
  ]);

  const cancelTask = useCallback(
    async (task: BackgroundTask) => {
      if (!task.cancellable || cancellingKeys.has(task.key)) return;
      setCancellingKeys((current) => new Set(current).add(task.key));
      try {
        if (task.kind === "agent") {
          await cancelAgentAcpSession(task.sessionId);
        } else if (task.kind === "job") {
          await cancelJob(task.connectionId, task.jobId);
          await queryClient.invalidateQueries({
            queryKey: qk.jobs(task.connectionId),
          });
        } else if (task.kind === "knowledge") {
          await cancelKnowledgeSourceSync(task.sourceId);
          await queryClient.invalidateQueries({
            queryKey: knowledgeQueryKeys.sourceSyncProgress(workspaceScopeKey),
          });
          await queryClient.invalidateQueries({
            queryKey: knowledgeQueryKeys.sources(workspaceScopeKey),
          });
        }
      } finally {
        setCancellingKeys((current) => {
          const next = new Set(current);
          next.delete(task.key);
          return next;
        });
      }
    },
    [cancellingKeys, queryClient, workspaceScopeKey],
  );

  return {
    tasks,
    cancellingKeys,
    cancelTask,
  };
}
