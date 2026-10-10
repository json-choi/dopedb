// Combines Job, Agent, pending and approved Agent change, SQL activity, and
// stored-result exports into one background-task projection. Stop uses each
// owner's real cancel path: Job and Agent commands here, for SQL the cancel the
// workbench registered for that run, and for an export the result export
// registry's own cancel (PD-10). A pending Agent change is listed first and is
// only opened from here: its decision belongs to its approval card.

import { useCallback, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";

import type { ConnectionProfile } from "../connections/domain";
import {
  cancelResultExport,
  useResultExportTasks,
} from "../queryResults/resultExports";
import {
  type QueryServiceStore,
  useQueryServiceActivities,
} from "../queryServices/store";
import type { AcpSessionSummary } from "../agents/domain";
import {
  cancelAgentAcpSession,
} from "../agents/tauriAdapter";
import {
  agentStartKey,
  stopAgentApprovalRun,
  useAgentApprovalRuns,
  useForegroundAgentStarts,
} from "../agents/approvalActivity";
import { usePendingAgentApprovals } from "../agents/pendingApprovals";
import { sessionTitle } from "../agents/sessionPresentation";
import { useAcpSessionSnapshot } from "../agents/sessionStore";
import type { Job } from "../jobs/domain";
import { cancelJob } from "../jobs/tauriAdapter";
import { useI18n } from "../../lib/i18n";
import { jobsQuery, qk } from "../../lib/queries";
import { usePostPaintReady } from "../../lib/usePostPaintReady";
import { queryTaskKey, useBackgroundTaskCancels } from "./cancelRegistry";
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
}: {
  connections: ConnectionProfile[];
  queryServiceStore: QueryServiceStore;
  workspaceScopeKey: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const postPaintReady = usePostPaintReady();
  const querySessions = useQueryServiceActivities(queryServiceStore);
  const queryCancels = useBackgroundTaskCancels();
  const resultExports = useResultExportTasks();
  const approvalRuns = useAgentApprovalRuns();
  const foregroundStarts = useForegroundAgentStarts();
  const pendingApprovals = usePendingAgentApprovals(workspaceScopeKey);
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
        cancellable: queryCancels.has(queryTaskKey(session.id)),
      }];
    });
    const agentTasks: BackgroundTask[] = agentSessions.flatMap((session) => {
      if (!ACTIVE_AGENT_STATES.has(session.lifecycle)) return [];
      // A silent pre-warm (starting, no prompt yet, so still untitled) is not
      // work the user started and stays out of the status bar; an untitled
      // start the person is waiting on is shown so it can be cancelled.
      const title = sessionTitle(session, t);
      if (
        session.lifecycle === "starting"
        && title === sessionTitle({ title: "" }, t)
        && !foregroundStarts.has(agentStartKey(session.connectionId, session.provider))
      ) {
        return [];
      }
      return [{
        kind: "agent",
        key: `agent:${session.id}`,
        sessionId: session.id,
        connectionId: session.connectionId,
        connectionName:
          connectionNames.get(session.connectionId) || session.connectionId,
        title,
        status: agentStatus(session.lifecycle),
        progress: null,
        rowsProcessed: null,
        updatedAt: Date.parse(session.updatedAt) || 0,
        cancellable: true,
      }];
    });
    const proposalTasks: BackgroundTask[] = pendingApprovals.map((approval) => ({
      kind: "agentProposal",
      key: `agent-proposal:${approval.operationId}`,
      operationId: approval.operationId,
      sessionId: approval.sessionId,
      sessionConnectionId: approval.sessionConnectionId,
      connectionName: approval.connectionName,
      title: t("agent.acpSqlApprovalTitle"),
      status: "waitingApproval",
      progress: null,
      rowsProcessed: null,
      updatedAt: 0,
      cancellable: false,
    }));
    const approvalTasks: BackgroundTask[] = approvalRuns.map((run) => ({
      kind: "agentApproval",
      key: `agent-approval:${run.operationId}`,
      operationId: run.operationId,
      connectionId: run.connectionId,
      connectionName:
        connectionNames.get(run.connectionId) || run.connectionName,
      title: run.connectionName,
      status: run.stopping ? "cancelling" : "running",
      progress: null,
      rowsProcessed: null,
      updatedAt: run.startedAt,
      cancellable: !run.stopping,
    }));
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
    // Listed only while rows are being written, never while its dialog is open.
    const exportTasks: BackgroundTask[] = resultExports.map((entry) => ({
      kind: "resultExport",
      key: `result-export:${entry.operationId}`,
      operationId: entry.operationId,
      connectionName: "",
      title: entry.title,
      status: entry.cancelled ? "cancelling" : "running",
      progress: entry.totalRows > 0
        ? Math.min(100, (entry.rowsWritten / entry.totalRows) * 100)
        : null,
      rowsProcessed: entry.rowsWritten,
      updatedAt: entry.startedAt,
      cancellable: !entry.cancelled,
    }));
    return [
      ...proposalTasks,
      ...[
        ...queryTasks,
        ...approvalTasks,
        ...agentTasks,
        ...jobTasks,
        ...exportTasks,
      ].sort((left, right) => right.updatedAt - left.updatedAt),
    ];
  }, [
    agentSessions,
    approvalRuns,
    connections,
    foregroundStarts,
    jobQueries,
    pendingApprovals,
    queryCancels,
    querySessions,
    resultExports,
    t,
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
        } else if (task.kind === "query") {
          await queryCancels.get(task.key)?.();
        } else if (task.kind === "agentApproval") {
          // The same executor cancel path the approval card's Stop uses.
          await stopAgentApprovalRun(task.operationId);
        } else if (task.kind === "resultExport") {
          cancelResultExport(task.operationId);
        }
      } catch {
        // The shell shows this message; never surface backend text.
        throw new Error(t("ide.backgroundTask.stopFailed"));
      } finally {
        setCancellingKeys((current) => {
          const next = new Set(current);
          next.delete(task.key);
          return next;
        });
      }
    },
    [cancellingKeys, queryCancels, queryClient, t],
  );

  return {
    tasks,
    cancellingKeys,
    cancelTask,
  };
}
