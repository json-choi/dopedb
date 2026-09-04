"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ControlButton, ControlInput, ControlLink } from "../components/Controls";
import { useWorkspaceLocale } from "../components/WorkspaceLocale";
import { localizedWorkspacePath } from "../../lib/workspace-locale";
import { workspaceMessages } from "../../lib/workspace-messages";

type LifecycleState = {
  workspaceName: string;
  revision: number;
  lifecycleState: "active" | "deletion_pending";
  deletionReceiptId: string | null;
  deletionRequestedAt: string | null;
  purgeAfter: string | null;
  retentionDays: number;
  backupRetentionDays: number;
  backupCount: number;
  tombstonedBackupCount: number;
  blockers: {
    providerIntegrations: number;
    credentialLeases: number;
    providerOperations: number;
    keyRotations: number;
    memberRevocations: number;
  };
  canScheduleDeletion: boolean;
};

type Backup = {
  id: string;
  sourceRevision: number;
  keyReference: string;
  keyVersion: string;
  snapshotHash: string;
  createdAt: string;
};

type KeyRotation = {
  activeVersion: number | null;
  backupCount: number;
  rotation: null | {
    id: string;
    status: "running" | "completed";
    fromVersion: number | null;
    toVersion: number;
    processedBackups: number;
    remainingBackups: number;
    createdAt: string;
    completedAt: string | null;
  };
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function dateOrNull(value: unknown): value is string | null {
  return value === null
    || (typeof value === "string" && !Number.isNaN(new Date(value).valueOf()));
}

function parseLifecycle(value: unknown): LifecycleState | null {
  const row = record(value);
  const blockers = record(row?.blockers);
  if (!row || !blockers
    || typeof row.workspaceName !== "string"
    || !nonnegativeInteger(row.revision)
    || (row.lifecycleState !== "active" && row.lifecycleState !== "deletion_pending")
    || (row.deletionReceiptId !== null
      && (typeof row.deletionReceiptId !== "string" || !uuid.test(row.deletionReceiptId)))
    || !dateOrNull(row.deletionRequestedAt)
    || !dateOrNull(row.purgeAfter)
    || !nonnegativeInteger(row.retentionDays)
    || !nonnegativeInteger(row.backupRetentionDays)
    || !nonnegativeInteger(row.backupCount)
    || !nonnegativeInteger(row.tombstonedBackupCount)
    || !nonnegativeInteger(blockers.providerIntegrations)
    || !nonnegativeInteger(blockers.credentialLeases)
    || !nonnegativeInteger(blockers.providerOperations)
    || !nonnegativeInteger(blockers.keyRotations)
    || !nonnegativeInteger(blockers.memberRevocations)
    || typeof row.canScheduleDeletion !== "boolean") return null;
  return {
    workspaceName: row.workspaceName,
    revision: row.revision,
    lifecycleState: row.lifecycleState,
    deletionReceiptId: row.deletionReceiptId,
    deletionRequestedAt: row.deletionRequestedAt,
    purgeAfter: row.purgeAfter,
    retentionDays: row.retentionDays,
    backupRetentionDays: row.backupRetentionDays,
    backupCount: row.backupCount,
    tombstonedBackupCount: row.tombstonedBackupCount,
    blockers: {
      providerIntegrations: blockers.providerIntegrations,
      credentialLeases: blockers.credentialLeases,
      providerOperations: blockers.providerOperations,
      keyRotations: blockers.keyRotations,
      memberRevocations: blockers.memberRevocations,
    },
    canScheduleDeletion: row.canScheduleDeletion,
  };
}

function parseBackup(value: unknown): Backup | null {
  const row = record(value);
  if (!row
    || typeof row.id !== "string" || !uuid.test(row.id)
    || !nonnegativeInteger(row.sourceRevision) || row.sourceRevision < 1
    || typeof row.keyReference !== "string"
    || typeof row.keyVersion !== "string" || !/^v[1-9][0-9]*$/.test(row.keyVersion)
    || typeof row.snapshotHash !== "string" || !/^[a-f0-9]{64}$/i.test(row.snapshotHash)
    || typeof row.createdAt !== "string" || Number.isNaN(new Date(row.createdAt).valueOf())) {
    return null;
  }
  return row as Backup;
}

function parseRotation(value: unknown): KeyRotation | null {
  const row = record(value);
  if (!row
    || (row.activeVersion !== null
      && (!nonnegativeInteger(row.activeVersion) || row.activeVersion < 1))
    || !nonnegativeInteger(row.backupCount)) return null;
  if (row.rotation === null) {
    return {
      activeVersion: row.activeVersion as number | null,
      backupCount: row.backupCount,
      rotation: null,
    };
  }
  const rotation = record(row.rotation);
  if (!rotation
    || typeof rotation.id !== "string" || !uuid.test(rotation.id)
    || (rotation.status !== "running" && rotation.status !== "completed")
    || (rotation.fromVersion !== null
      && (!nonnegativeInteger(rotation.fromVersion) || rotation.fromVersion < 1))
    || !nonnegativeInteger(rotation.toVersion) || rotation.toVersion < 1
    || !nonnegativeInteger(rotation.processedBackups)
    || !nonnegativeInteger(rotation.remainingBackups)
    || typeof rotation.createdAt !== "string"
    || Number.isNaN(new Date(rotation.createdAt).valueOf())
    || !dateOrNull(rotation.completedAt)) return null;
  return {
    activeVersion: row.activeVersion as number | null,
    backupCount: row.backupCount,
    rotation: rotation as KeyRotation["rotation"],
  };
}

export function WorkspaceLifecyclePanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].workspaceLifecycle;
  const [lifecycle, setLifecycle] = useState<LifecycleState | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [rotation, setRotation] = useState<KeyRotation | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutation, setMutation] = useState("");
  const [rotationRequestId, setRotationRequestId] = useState("");
  const [error, setError] = useState("");
  const base = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`;
  const formatter = useMemo(() => new Intl.DateTimeFormat(
    locale === "ko" ? "ko-KR" : "en-US",
    { dateStyle: "medium", timeStyle: "short" },
  ), [locale]);

  const responseError = useCallback(async (response: Response | null) => {
    const body = await response?.json().catch(() => null);
    return typeof body?.error === "string" ? body.error : copy.mutationError;
  }, [copy.mutationError]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const lifecycleResponse = await fetch(`${base}/lifecycle`, {
      cache: "no-store",
      signal,
    }).catch(() => null);
    if (signal?.aborted) return;
    if (!lifecycleResponse?.ok) {
      setError(await responseError(lifecycleResponse));
      setLoading(false);
      return;
    }
    const nextLifecycle = parseLifecycle(
      await lifecycleResponse.json().catch(() => null),
    );
    if (!nextLifecycle) {
      setError(copy.shapeError);
      setLoading(false);
      return;
    }
    setLifecycle(nextLifecycle);
    if (nextLifecycle.lifecycleState === "deletion_pending") {
      setBackups([]);
      setRotation(null);
      setError("");
      setLoading(false);
      return;
    }
    const [backupResponse, rotationResponse] = await Promise.all([
      fetch(`${base}/backups`, { cache: "no-store", signal }).catch(() => null),
      fetch(`${base}/backups/key-rotation`, { cache: "no-store", signal }).catch(() => null),
    ]);
    if (signal?.aborted) return;
    if (!backupResponse?.ok || !rotationResponse?.ok) {
      setError(await responseError(!backupResponse?.ok ? backupResponse : rotationResponse));
      setLoading(false);
      return;
    }
    const [backupBody, rotationBody] = await Promise.all([
      backupResponse.json().catch(() => null),
      rotationResponse.json().catch(() => null),
    ]);
    const backupEnvelope = record(backupBody);
    const parsedBackups = Array.isArray(backupEnvelope?.backups)
      ? backupEnvelope.backups.map(parseBackup)
      : null;
    const parsedRotation = parseRotation(rotationBody);
    if (!parsedBackups || parsedBackups.some((item) => !item) || !parsedRotation) {
      setError(copy.shapeError);
      setLoading(false);
      return;
    }
    setBackups(parsedBackups as Backup[]);
    setRotation(parsedRotation);
    if (parsedRotation.rotation?.status === "completed") setRotationRequestId("");
    setError("");
    setLoading(false);
  }, [base, copy.shapeError, responseError]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function mutate(
    key: string,
    path: string,
    init: RequestInit,
    confirmationText?: string,
  ) {
    if (confirmationText && !window.confirm(confirmationText)) return;
    setMutation(key);
    setError("");
    const response = await fetch(`${base}${path}`, init).catch(() => null);
    if (!response?.ok) {
      setError(await responseError(response));
      setMutation("");
      return;
    }
    await load();
    setMutation("");
  }

  async function rotateKey() {
    const requestId = rotationRequestId || crypto.randomUUID();
    setRotationRequestId(requestId);
    setMutation("rotate");
    setError("");
    let shouldReload = false;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const response = await fetch(`${base}/backups/key-rotation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId }),
      }).catch(() => null);
      if (!response?.ok) {
        setError(await responseError(response));
        break;
      }
      const body = await response.json().catch(() => null);
      const parsed = parseRotation(body);
      if (!parsed) {
        setError(copy.shapeError);
        break;
      }
      setRotation(parsed);
      shouldReload = true;
      if (parsed.rotation?.status === "completed") {
        setRotationRequestId("");
        break;
      }
      if (record(body)?.busy === true) break;
    }
    if (shouldReload) await load();
    setMutation("");
  }

  async function scheduleDeletion() {
    if (!lifecycle || confirmation !== lifecycle.workspaceName
      || !window.confirm(copy.scheduleConfirm)) return;
    setMutation("schedule");
    setError("");
    const response = await fetch(`${base}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "schedule_deletion",
        requestId: crypto.randomUUID(),
        confirmation,
      }),
    }).catch(() => null);
    if (!response?.ok) {
      setError(await responseError(response));
      setMutation("");
      return;
    }
    setConfirmation("");
    await load();
    setMutation("");
  }

  async function cancelDeletion() {
    if (!lifecycle?.deletionReceiptId) return;
    await mutate("cancel", "/lifecycle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "cancel_deletion",
        requestId: lifecycle.deletionReceiptId,
      }),
    });
  }

  if (loading && !lifecycle) {
    return <p className="tw:m-0 tw:px-6 tw:py-14 tw:text-center tw:text-xs tw:text-muted-foreground">{copy.loading}</p>;
  }

  if (!lifecycle) {
    return <p className="tw:m-0 tw:px-6 tw:py-14 tw:text-center tw:text-xs tw:text-danger" role="alert">{error || copy.loadError}</p>;
  }

  const blockerRows = [
    [copy.blockerProviderIntegrations, lifecycle.blockers.providerIntegrations],
    [copy.blockerCredentialLeases, lifecycle.blockers.credentialLeases],
    [copy.blockerProviderOperations, lifecycle.blockers.providerOperations],
    [copy.blockerKeyRotations, lifecycle.blockers.keyRotations],
    [copy.blockerMemberRevocations, lifecycle.blockers.memberRevocations],
  ] as const;

  if (lifecycle.lifecycleState === "deletion_pending") {
    return (
      <div className="tw:grid tw:gap-5 tw:p-6 tw:max-[640px]:p-4">
        <section className="tw:rounded-panel tw:border tw:border-danger/30 tw:bg-danger/5 tw:p-6 tw:max-[640px]:p-5">
          <span className="tw:font-mono tw:text-2xs tw:font-medium tw:tracking-[0.08em] tw:text-danger tw:uppercase">{copy.ownerBoundary}</span>
          <h3 className="tw:mt-2 tw:mb-0 tw:text-lg tw:font-medium tw:text-foreground">{copy.deletionPending}</h3>
          <p className="tw:mt-3 tw:mb-0 tw:max-w-[720px] tw:text-xs tw:leading-body tw:text-muted-foreground">{copy.deletionPendingDescription}</p>
          <dl className="tw:mt-6 tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:gap-x-6 tw:gap-y-2 tw:border-t tw:border-danger/20 tw:pt-4 tw:text-xs">
            <dt className="tw:text-muted-foreground">{copy.purgeAt}</dt>
            <dd className="tw:m-0 tw:text-right tw:font-medium tw:text-foreground">{lifecycle.purgeAfter ? formatter.format(new Date(lifecycle.purgeAfter)) : "—"}</dd>
          </dl>
          <div className="tw:mt-6">
            <ControlButton tone="danger" onClick={() => void cancelDeletion()} disabled={mutation !== ""}>
              {mutation === "cancel" ? copy.cancellingDeletion : copy.cancelDeletion}
            </ControlButton>
          </div>
        </section>
        {error ? <p className="tw:m-0 tw:text-xs tw:text-danger" role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="tw:grid tw:gap-5 tw:p-6 tw:max-[640px]:p-4">
      <div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-4">
        <div>
          <h2 className="tw:m-0 tw:text-base tw:font-semibold tw:text-foreground">{copy.title}</h2>
          <p className="tw:mt-2 tw:mb-0 tw:max-w-[720px] tw:text-xs tw:leading-body tw:text-muted-foreground">{copy.description}</p>
        </div>
        <span className="tw:rounded-full tw:border tw:border-primary/20 tw:bg-selection tw:px-3 tw:py-1.5 tw:font-mono tw:text-2xs tw:text-primary">{copy.proof}</span>
      </div>

      {error ? <p className="tw:m-0 tw:rounded-surface tw:border tw:border-danger/25 tw:bg-danger/5 tw:px-4 tw:py-3 tw:text-xs tw:text-danger" role="alert">{error}</p> : null}

      <div className="tw:grid tw:grid-cols-2 tw:gap-8 tw:max-[900px]:grid-cols-1">
        <section className="tw:min-w-0">
          <div className="tw:flex tw:items-start tw:justify-between tw:gap-4">
            <div>
              <h3 className="tw:m-0 tw:text-sm tw:font-medium tw:text-foreground">{copy.backupTitle}</h3>
              <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:leading-body tw:text-muted-foreground">{copy.backupDescription}</p>
            </div>
            <ControlButton tone="primary" onClick={() => void mutate("create", "/backups", { method: "POST" })} disabled={mutation !== ""}>
              {mutation === "create" ? copy.creatingBackup : copy.createBackup}
            </ControlButton>
          </div>
          <div className="tw:mt-5 tw:grid tw:gap-2">
            {backups.length === 0 ? (
              <p className="tw:m-0 tw:rounded-surface tw:border tw:border-dashed tw:border-border tw:px-4 tw:py-8 tw:text-center tw:text-xs tw:text-muted-foreground">{copy.noBackups}</p>
            ) : backups.map((backup) => (
              <article className="tw:grid tw:gap-3 tw:rounded-surface tw:border tw:border-border tw:bg-surface tw:p-4" key={backup.id}>
                <div className="tw:flex tw:items-start tw:justify-between tw:gap-3">
                  <div className="tw:min-w-0">
                    <strong className="tw:block tw:text-xs tw:font-medium tw:text-foreground">{copy.sourceRevision} {backup.sourceRevision}</strong>
                    <span className="tw:mt-1 tw:block tw:font-mono tw:text-2xs tw:text-muted-foreground">{formatter.format(new Date(backup.createdAt))} · {backup.keyVersion}</span>
                  </div>
                </div>
                <div className="tw:flex tw:flex-wrap tw:gap-2">
                  <ControlButton onClick={() => void mutate(
                    `restore:${backup.id}`,
                    `/backups/${backup.id}/restore`,
                    {
                      method: "POST",
                      headers: {
                        "x-dopedb-expected-revision": String(lifecycle.revision),
                      },
                    },
                    copy.restoreConfirm,
                  )} disabled={mutation !== ""}>
                    {mutation === `restore:${backup.id}` ? copy.restoring : copy.restore}
                  </ControlButton>
                  <ControlButton tone="danger" onClick={() => void mutate(
                    `delete:${backup.id}`,
                    `/backups/${backup.id}`,
                    { method: "DELETE" },
                    copy.deleteBackupConfirm,
                  )} disabled={mutation !== ""}>
                    {mutation === `delete:${backup.id}` ? copy.deletingBackup : copy.deleteBackup}
                  </ControlButton>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="tw:grid tw:content-start tw:gap-7">
          <section>
            <h3 className="tw:m-0 tw:text-sm tw:font-medium tw:text-foreground">{copy.encryptionTitle}</h3>
            <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:leading-body tw:text-muted-foreground">{copy.encryptionDescription}</p>
            {rotation?.activeVersion ? (
              <div className="tw:mt-5 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-4 tw:rounded-surface tw:border tw:border-border tw:bg-surface tw:p-4">
                <div>
                  <span className="tw:block tw:font-mono tw:text-2xs tw:text-muted-foreground">{copy.activeKeyVersion}</span>
                  <strong className="tw:mt-1 tw:block tw:text-lg tw:font-medium tw:text-foreground">v{rotation.activeVersion}</strong>
                </div>
                <ControlButton onClick={() => void rotateKey()} disabled={mutation !== ""}>
                  {mutation === "rotate" ? copy.rotatingKey : copy.rotateKey}
                </ControlButton>
              </div>
            ) : <p className="tw:mt-5 tw:mb-0 tw:rounded-surface tw:border tw:border-dashed tw:border-border tw:px-4 tw:py-5 tw:text-xs tw:text-muted-foreground">{copy.keyNotInitialized}</p>}
            {rotation?.rotation ? (
              <p className="tw:mt-3 tw:mb-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
                {rotation.rotation.status === "running" ? copy.rotationRunning : copy.rotationCompleted}
                {" · "}{rotation.rotation.processedBackups} {copy.rotationProgress}
                {rotation.rotation.remainingBackups > 0 ? ` · ${rotation.rotation.remainingBackups} ${copy.rotationRemaining}` : ""}
              </p>
            ) : null}
          </section>

          <section className="tw:border-t tw:border-border tw:pt-6">
            <h3 className="tw:m-0 tw:text-sm tw:font-medium tw:text-foreground">{copy.retentionTitle}</h3>
            <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:leading-body tw:text-muted-foreground">{copy.retentionDescription}</p>
            <dl className="tw:mt-5 tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:gap-x-5 tw:gap-y-3 tw:text-xs">
              <dt className="tw:text-muted-foreground">{copy.activeBackups}</dt><dd className="tw:m-0 tw:font-medium">{lifecycle.backupCount}</dd>
              <dt className="tw:text-muted-foreground">{copy.pendingBackupPurge}</dt><dd className="tw:m-0 tw:font-medium">{lifecycle.tombstonedBackupCount}</dd>
              <dt className="tw:text-muted-foreground">{copy.retentionWindow}</dt><dd className="tw:m-0 tw:font-medium">{lifecycle.backupRetentionDays} {copy.days}</dd>
            </dl>
          </section>
        </div>
      </div>

      <details className="tw:group tw:overflow-hidden tw:rounded-surface tw:border tw:border-danger/30 tw:bg-danger/5">
        <summary className="tw:flex tw:cursor-pointer tw:list-none tw:items-center tw:justify-between tw:gap-5 tw:p-5 tw:[&::-webkit-details-marker]:hidden tw:focus-visible:outline-2 tw:focus-visible:outline-offset-[-3px] tw:focus-visible:outline-ring">
          <span className="tw:grid tw:gap-1">
            <strong className="tw:text-sm tw:font-medium tw:text-danger">{copy.dangerTitle}</strong>
            <small className="tw:max-w-[800px] tw:text-xs tw:leading-body tw:text-muted-foreground">{copy.dangerDescription}</small>
          </span>
          <span className="tw:grid tw:size-7 tw:shrink-0 tw:place-items-center tw:rounded-full tw:border tw:border-danger/30 tw:text-base tw:text-danger tw:transition-transform tw:group-open:rotate-45" aria-hidden="true">+</span>
        </summary>
        <div className="tw:border-t tw:border-danger/20 tw:p-5">
          {blockerRows.some(([, count]) => count > 0) ? (
            <div className="tw:rounded-surface tw:border tw:border-danger/20 tw:bg-surface tw:p-4">
              <strong className="tw:text-xs tw:font-medium tw:text-foreground">{copy.blockersTitle}</strong>
              <ul className="tw:mt-3 tw:mb-0 tw:grid tw:gap-2 tw:pl-5 tw:text-xs tw:text-muted-foreground">
                {blockerRows.filter(([, count]) => count > 0).map(([label, count]) => <li key={label}>{count} · {label}</li>)}
              </ul>
              <div className="tw:mt-4 tw:flex tw:flex-wrap tw:gap-2">
                {lifecycle.blockers.providerIntegrations > 0 || lifecycle.blockers.credentialLeases > 0 || lifecycle.blockers.providerOperations > 0 ? (
                  <ControlLink href={localizedWorkspacePath(`/settings?workspace=${encodeURIComponent(workspaceId)}&section=providers`, locale)}>{copy.manageCloudAccounts}</ControlLink>
                ) : null}
                {lifecycle.blockers.memberRevocations > 0 ? (
                  <ControlLink href={localizedWorkspacePath(`/settings?workspace=${encodeURIComponent(workspaceId)}&section=access`, locale)}>{copy.manageMembers}</ControlLink>
                ) : null}
              </div>
            </div>
          ) : null}
          <label className="tw:mt-5 tw:grid tw:max-w-[520px] tw:gap-2">
            <span className="tw:font-mono tw:text-2xs tw:font-medium tw:tracking-[0.06em] tw:text-muted-foreground tw:uppercase">{copy.exactName}</span>
            <ControlInput value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={lifecycle.workspaceName} autoComplete="off" />
          </label>
          <div className="tw:mt-4">
            <ControlButton tone="danger" onClick={() => void scheduleDeletion()} disabled={mutation !== "" || !lifecycle.canScheduleDeletion || confirmation !== lifecycle.workspaceName}>
              {mutation === "schedule" ? copy.schedulingDeletion : copy.scheduleDeletion}
            </ControlButton>
          </div>
        </div>
      </details>
    </div>
  );
}
