// State and command owner for Settings → Workspace → Backups & deletion. Reads load
// once per opening: the lifecycle status first, then backups and key rotation in
// parallel for an active workspace. One command runs at a time. Key rotation and
// deletion scheduling keep one request id per attempt, so a retry after a lost or
// failed response continues or replays the same server request instead of a new one.
// A scheduled deletion is handed to the panel, which leaves the workspace; a restore
// pulls the restored shared connections into Desktop.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCatalogScope } from "../../../lib/queries";
import { ownedWorkspacesQueryKey } from "../account/queries";
import { refreshDesktopConnections } from "../desktopConnections";
import type { WorkspaceAdminScope } from "../domain";
import { workspaceAdminQueryKey } from "../queryKeys";
import { runWorkspaceAdmin, WorkspaceAdminRequestError } from "../requests";
import {
  classifyLifecycleFailure,
  lifecycleStatusInRefusal,
  LifecycleResponseError,
  readDeletionScheduled,
  readKeyRotationStep,
  readRestoreResult,
  type KeyRotationStatus,
  type LifecycleStatus,
} from "./domain";
import {
  keyRotationQuery,
  LIFECYCLE_AREA,
  lifecycleBackupsQuery,
  lifecycleQueryKeys,
  lifecycleStatusQuery,
} from "./queries";

/** Each rotation request re-encrypts one bounded batch; one run sends at most this many. */
const MAX_ROTATION_STEPS = 32;

export type LifecycleCommand =
  | "create"
  | "restore"
  | "delete"
  | "rotate"
  | "schedule"
  | "refresh";

export interface LifecycleBusy {
  command: LifecycleCommand;
  backupId: string | null;
}

export type BackupsNotice =
  | {
      kind: "failed";
      command: "create" | "restore" | "delete";
      error: unknown;
      /** Set when the server recorded the deletion but asks for the same request again. */
      retryBackupId: string | null;
    }
  | { kind: "created" }
  | { kind: "deleted" }
  | { kind: "restored"; restored: number; conflicts: number };

export type KeyNotice = { kind: "failed"; error: unknown } | { kind: "busy" };

export interface DeletionNotice {
  error: unknown;
  /** The deletion was recorded; resending the same request finishes scheduling. */
  retryable: boolean;
}

type LifecycleRead = keyof typeof lifecycleQueryKeys;

export function useLifecycleController(
  scope: WorkspaceAdminScope,
  { onDeletionScheduled }: { onDeletionScheduled: (status: LifecycleStatus) => void },
) {
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const status = useQuery(lifecycleStatusQuery(scope));
  // Follow-up reads wait for this opening's own lifecycle answer and never run for a
  // workspace that is already scheduled for deletion.
  const active = status.isFetchedAfterMount && status.data?.lifecycleState === "active";
  const backups = useQuery({ ...lifecycleBackupsQuery(scope), enabled: active });
  const keyRotation = useQuery({ ...keyRotationQuery(scope), enabled: active });

  const [busy, setBusy] = useState<LifecycleBusy | null>(null);
  const [backupsNotice, setBackupsNotice] = useState<BackupsNotice | null>(null);
  const [keyNotice, setKeyNotice] = useState<KeyNotice | null>(null);
  const [deletionNotice, setDeletionNotice] = useState<DeletionNotice | null>(null);
  const [justScheduled, setJustScheduled] = useState(false);
  const busyRef = useRef<LifecycleBusy | null>(null);
  const rotationRunId = useRef<string | null>(null);
  const deletionAttempt = useRef<{ requestId: string; confirmation: string } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function claim(command: LifecycleCommand, backupId: string | null = null) {
    if (busyRef.current) return false;
    const next = { command, backupId };
    busyRef.current = next;
    setBusy(next);
    return true;
  }

  function release() {
    busyRef.current = null;
    setBusy(null);
  }

  function reload(...reads: LifecycleRead[]) {
    return Promise.all(
      reads.map((read) =>
        queryClient.invalidateQueries({ queryKey: lifecycleQueryKeys[read](scope), exact: true }),
      ),
    );
  }

  function currentStatus() {
    return queryClient.getQueryData<LifecycleStatus>(lifecycleQueryKeys.status(scope));
  }

  // A restore adds connections and conflicts that the other administration sections
  // list; mark their reads stale so they load the result when opened.
  function invalidateOtherAdminAreas() {
    const [root, accountId, workspaceId] = workspaceAdminQueryKey(scope, LIFECYCLE_AREA);
    return queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === root
        && queryKey[1] === accountId
        && queryKey[2] === workspaceId
        && queryKey[3] !== LIFECYCLE_AREA,
    });
  }

  async function refresh() {
    if (!claim("refresh")) return;
    setBackupsNotice(null);
    setKeyNotice(null);
    setDeletionNotice(null);
    try {
      await queryClient.refetchQueries({
        queryKey: lifecycleQueryKeys.status(scope),
        exact: true,
        type: "active",
      });
      if (currentStatus()?.lifecycleState === "active") {
        await Promise.all(
          (["backups", "keyRotation"] as const).map((read) =>
            queryClient.refetchQueries({
              queryKey: lifecycleQueryKeys[read](scope),
              exact: true,
              type: "active",
            }),
          ),
        );
      }
      // Once a freshly read status shows no unfinished rotation, the next click starts a
      // new run; a failed re-read keeps the current run id.
      const rotation = queryClient.getQueryState<KeyRotationStatus>(
        lifecycleQueryKeys.keyRotation(scope),
      );
      const run = rotation?.data?.rotation;
      if (rotation?.status === "success" && run?.status !== "running") {
        rotationRunId.current = null;
      }
    } finally {
      release();
    }
  }

  async function createBackup() {
    if (!claim("create")) return;
    setBackupsNotice(null);
    try {
      await runWorkspaceAdmin(scope.accountId, {
        kind: "createBackup",
        workspaceId: scope.workspaceId,
      });
      setBackupsNotice({ kind: "created" });
      // The first backup also creates the workspace key, so every read changes.
      await reload("status", "backups", "keyRotation");
    } catch (error) {
      setBackupsNotice({ kind: "failed", command: "create", error, retryBackupId: null });
    } finally {
      release();
    }
  }

  async function deleteBackup(backupId: string) {
    if (!claim("delete", backupId)) return;
    setBackupsNotice(null);
    try {
      await runWorkspaceAdmin(scope.accountId, {
        kind: "deleteBackup",
        workspaceId: scope.workspaceId,
        backupId,
      });
      setBackupsNotice({ kind: "deleted" });
      await reload("status", "backups");
    } catch (error) {
      const failure = classifyLifecycleFailure(error);
      setBackupsNotice({
        kind: "failed",
        command: "delete",
        error,
        retryBackupId: failure === "backupCleanupPending" ? backupId : null,
      });
      // Both answers mean the visible list is out of date: the backup is already
      // hidden, or it no longer exists.
      if (failure === "backupCleanupPending" || failure === "backupNotFound") {
        await reload("status", "backups");
      }
    } finally {
      release();
    }
  }

  async function restoreBackup(backupId: string) {
    const current = currentStatus();
    if (current?.lifecycleState !== "active" || !claim("restore", backupId)) return;
    setBackupsNotice(null);
    try {
      let body: unknown;
      try {
        body = await runWorkspaceAdmin(scope.accountId, {
          kind: "restoreBackup",
          workspaceId: scope.workspaceId,
          backupId,
          expectedRevision: current.revision,
        });
      } catch (error) {
        const failure = classifyLifecycleFailure(error);
        setBackupsNotice({ kind: "failed", command: "restore", error, retryBackupId: null });
        // A concurrent change needs the new revision before the restore can be retried.
        if (failure === "restoreChanged") await reload("status");
        if (failure === "backupNotFound") await reload("status", "backups");
        return;
      }
      const result = readRestoreResult(body);
      setBackupsNotice(
        result
          ? { kind: "restored", restored: result.restored, conflicts: result.conflictIds.length }
          : {
              kind: "failed",
              command: "restore",
              error: new LifecycleResponseError("restore"),
              retryBackupId: null,
            },
      );
      await Promise.all([reload("status"), invalidateOtherAdminAreas()]);
      // Restored templates reach the Explorer only through a membership refresh. Best
      // effort: the restore already succeeded and the next workspace refresh converges.
      if (result) {
        void refreshDesktopConnections(queryClient, catalogScope.key).catch(() => undefined);
      }
    } finally {
      release();
    }
  }

  async function rotateKey() {
    if (!claim("rotate")) return;
    setKeyNotice(null);
    const requestId = rotationRunId.current ?? crypto.randomUUID();
    rotationRunId.current = requestId;
    let changed = false;
    try {
      for (let step = 0; step < MAX_ROTATION_STEPS && mounted.current; step += 1) {
        const body = await runWorkspaceAdmin(scope.accountId, {
          kind: "rotateKey",
          workspaceId: scope.workspaceId,
          requestId,
        });
        const result = readKeyRotationStep(body);
        // Only a busy answer is known to have changed nothing on the server.
        if (!result?.busy) changed = true;
        if (!result) throw new LifecycleResponseError("key rotation");
        queryClient.setQueryData(lifecycleQueryKeys.keyRotation(scope), result.status);
        if (result.replayed || result.status.rotation?.status === "completed") {
          rotationRunId.current = null;
          break;
        }
        if (result.busy) {
          // Another request holds the claim: stop instead of competing for it.
          setKeyNotice({ kind: "busy" });
          break;
        }
      }
    } catch (error) {
      setKeyNotice({ kind: "failed", error });
    } finally {
      // A rotation changes the active key, every backup's key version and the
      // deletion blockers, so all three reads are refreshed once at the end.
      if (changed && mounted.current) await reload("status", "backups", "keyRotation");
      release();
    }
  }

  // Account lists owned workspaces scheduled for deletion; it must show this one.
  function deletionScheduled(scheduledStatus: LifecycleStatus) {
    void queryClient.invalidateQueries({ queryKey: ownedWorkspacesQueryKey(scope.accountId) });
    onDeletionScheduled(scheduledStatus);
  }

  async function submitDeletion() {
    const attempt = deletionAttempt.current;
    if (!attempt || !claim("schedule")) return;
    setDeletionNotice(null);
    try {
      let body: unknown;
      try {
        body = await runWorkspaceAdmin(scope.accountId, {
          kind: "scheduleWorkspaceDeletion",
          workspaceId: scope.workspaceId,
          requestId: attempt.requestId,
          confirmation: attempt.confirmation,
        });
      } catch (error) {
        // A refusal is final for this request id. Transport failures and 5xx keep it,
        // so a retry replays the same, possibly already recorded, request.
        if (error instanceof WorkspaceAdminRequestError && error.status < 500) {
          deletionAttempt.current = null;
        }
        const failure = classifyLifecycleFailure(error);
        const returned = lifecycleStatusInRefusal(error);
        if (returned) queryClient.setQueryData(lifecycleQueryKeys.status(scope), returned);
        const recorded = returned?.lifecycleState === "deletion_pending";
        if (recorded) setJustScheduled(true);
        // Only the recorded-but-unscheduled cleanup still needs this view. Any other
        // recorded deletion, such as one an earlier lost answer already scheduled, is
        // finished and leaves the workspace like a fresh success.
        if (returned && recorded && failure !== "deletionCleanupPending") {
          deletionScheduled(returned);
        } else {
          setDeletionNotice({ error, retryable: failure === "deletionCleanupPending" });
        }
        if (!returned && failure === "deletionRefused") await reload("status");
        return;
      }
      deletionAttempt.current = null;
      const scheduled = readDeletionScheduled(body);
      if (scheduled) {
        queryClient.setQueryData(lifecycleQueryKeys.status(scope), scheduled.status);
        setJustScheduled(true);
        deletionScheduled(scheduled.status);
      } else {
        setDeletionNotice({ error: new LifecycleResponseError("deletion"), retryable: false });
        await reload("status");
      }
    } finally {
      release();
    }
  }

  async function scheduleDeletion(confirmation: string) {
    const current = currentStatus();
    // The server compares the name exactly; it is never trimmed or normalized here.
    if (
      current?.lifecycleState !== "active"
      || !current.canScheduleDeletion
      || confirmation !== current.workspaceName
      || busyRef.current
    ) {
      return;
    }
    const requestId = deletionAttempt.current?.requestId ?? crypto.randomUUID();
    deletionAttempt.current = { requestId, confirmation };
    await submitDeletion();
  }

  return {
    status,
    backups,
    keyRotation,
    busy,
    backupsNotice,
    keyNotice,
    deletionNotice,
    justScheduled,
    refresh,
    createBackup,
    deleteBackup,
    restoreBackup,
    rotateKey,
    scheduleDeletion,
    retryDeletion: submitDeletion,
  };
}

export type LifecycleController = ReturnType<typeof useLifecycleController>;
