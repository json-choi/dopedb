"use client";

// Connection grants are intentionally separate from workspace roles: membership
// makes a template visible only when a manager grants view, use, or manage.
import { useCallback, useEffect, useState } from "react";
import { ControlButton } from "../components/Controls";
import { useWorkspaceLocale } from "../components/WorkspaceLocale";
import { candidateConflictResolution } from "../../lib/connection-conflict-decision";
import type { WorkspaceLocale } from "../../lib/workspace-locale";
import { workspaceMessages } from "../../lib/workspace-messages";
import { localizedProviderMessage } from "../../lib/workspace-provider-copy";

type ConnectionCapability = "view" | "use" | "manage";
type SharedConnection = {
  id: string;
  name: string;
  engine: string;
  allowWrites: boolean;
  writeAvailable: boolean;
  credentialMode: "managed" | "member_local";
};
type MemberGrant = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  capability: ConnectionCapability | null;
};
type ConflictPayload = {
  name: string;
  engine: string;
  provider: string;
  driverId: string | null;
  host: string;
  port: number;
  database: string;
  sslmode: string;
  readonlyDefault: true;
  allowWrites: boolean;
  env: string | null;
  schemaGroup: string | null;
  deleted: boolean;
};
type ConflictVersion = {
  id: string;
  revision: number;
  operation: "create" | "update" | "delete" | "restore";
  payload: ConflictPayload;
};
type ConnectionConflict = {
  id: string;
  connectionId: string;
  connectionName: string;
  expectedRevision: number;
  createdAt: string;
  current: ConflictVersion;
  server: ConflictVersion;
  candidate: ConflictVersion;
  currentMatchesServer: boolean;
  currentMatchesCandidate: boolean;
};

function ConflictVersionCard({
  title,
  version,
  comparison,
  copy,
}: {
  title: string;
  version: ConflictVersion;
  comparison: ConflictVersion;
  copy: typeof workspaceMessages.en.connectionAccess;
}) {
  const fields: Array<{
    key: keyof ConflictPayload;
    label: string;
    value: (payload: ConflictPayload) => string;
  }> = [
    { key: "name", label: copy.conflictFieldName, value: (payload) => payload.name },
    { key: "engine", label: copy.conflictFieldEngine, value: (payload) => payload.engine },
    { key: "provider", label: copy.conflictFieldProvider, value: (payload) => payload.provider },
    { key: "driverId", label: copy.conflictFieldDriver, value: (payload) => payload.driverId || "—" },
    { key: "host", label: copy.conflictFieldHost, value: (payload) => payload.host },
    { key: "port", label: copy.conflictFieldPort, value: (payload) => String(payload.port) },
    { key: "database", label: copy.conflictFieldDatabase, value: (payload) => payload.database || "—" },
    { key: "sslmode", label: copy.conflictFieldSsl, value: (payload) => payload.sslmode },
    { key: "env", label: copy.conflictFieldEnvironment, value: (payload) => payload.env || "—" },
    { key: "schemaGroup", label: copy.conflictFieldSchema, value: (payload) => payload.schemaGroup || "—" },
    {
      key: "allowWrites",
      label: copy.conflictFieldWrites,
      value: (payload) => payload.allowWrites ? copy.conflictEnabled : copy.conflictDisabled,
    },
    {
      key: "deleted",
      label: copy.conflictFieldState,
      value: (payload) => payload.deleted ? copy.conflictDeleted : copy.conflictActive,
    },
  ];
  return (
    <section className="tw:min-w-0">
      <header className="tw:mb-2 tw:flex tw:items-center tw:justify-between tw:gap-3">
        <strong className="tw:text-xs tw:text-foreground">{title}</strong>
        <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
          r{version.revision}
        </span>
      </header>
      <dl className="tw:grid tw:divide-y tw:divide-border">
        {fields.map((field) => {
          const value = field.value(version.payload);
          const changed = value !== field.value(comparison.payload);
          return (
            <div
              className="tw:grid tw:grid-cols-[minmax(84px,0.34fr)_minmax(0,1fr)] tw:gap-2 tw:py-2"
              key={field.key}
            >
              <dt className="tw:text-2xs tw:text-muted-foreground">{field.label}</dt>
              <dd
                className="tw:m-0 tw:min-w-0 tw:break-words tw:font-mono tw:text-2xs tw:text-foreground tw:data-[changed=true]:font-semibold tw:data-[changed=true]:text-primary"
                data-changed={changed}
              >
                {value}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

async function responseError(
  response: Response | null,
  fallback: string,
  locale: WorkspaceLocale,
) {
  const body = await response?.json().catch(() => null);
  return typeof body?.error === "string"
    ? localizedProviderMessage(body.error, locale, fallback)
    : fallback;
}

export function ConnectionAccessPanel({ workspaceId }: { workspaceId: string }) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].connectionAccess;
  const common = workspaceMessages[locale].common;
  const [connections, setConnections] = useState<SharedConnection[]>([]);
  const [conflicts, setConflicts] = useState<ConnectionConflict[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [grants, setGrants] = useState<MemberGrant[]>([]);
  const [actorMemberId, setActorMemberId] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState("");
  const [error, setError] = useState("");

  const loadConflicts = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(
      `/api/v1/workspaces/${workspaceId}/connections/conflicts`,
      { cache: "no-store", signal },
    ).catch(() => null);
    if (signal?.aborted) return;
    if (!response?.ok) {
      setError(await responseError(response, copy.loadConflictsError, locale));
      return;
    }
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body?.conflicts)) {
      setError(copy.conflictsShapeError);
      return;
    }
    setConflicts(body.conflicts as ConnectionConflict[]);
    setError("");
  }, [copy, locale, workspaceId]);

  const loadConnections = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const response = await fetch(
      `/api/v1/workspaces/${workspaceId}/connections`,
      { cache: "no-store", signal },
    ).catch(() => null);
    if (signal?.aborted) return;
    if (!response?.ok) {
      setError(await responseError(response, copy.loadConnectionsError, locale));
      setLoading(false);
      return;
    }
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body?.connections)) {
      setError(copy.connectionsShapeError);
      setLoading(false);
      return;
    }
    const next = body.connections as SharedConnection[];
    setConnections(next);
    setSelectedId((current) => (
      next.some((item) => item.id === current)
        ? current
        : next[0]?.id ?? ""
    ));
    setError("");
    setLoading(false);
  }, [copy, locale, workspaceId]);

  const loadGrants = useCallback(async (
    connectionId: string,
    signal?: AbortSignal,
  ) => {
    if (!connectionId) {
      setGrants([]);
      setActorMemberId("");
      return;
    }
    const response = await fetch(
      `/api/v1/workspaces/${workspaceId}/connections/${connectionId}/grants`,
      { cache: "no-store", signal },
    ).catch(() => null);
    if (signal?.aborted) return;
    if (!response?.ok) {
      setError(await responseError(response, copy.loadGrantsError, locale));
      return;
    }
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body?.grants) || typeof body?.actorMemberId !== "string") {
      setError(copy.grantsShapeError);
      return;
    }
    setGrants(body.grants);
    setActorMemberId(body.actorMemberId);
    setError("");
  }, [copy, locale, workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadConnections(controller.signal);
    return () => controller.abort();
  }, [loadConnections]);

  useEffect(() => {
    const controller = new AbortController();
    void loadConflicts(controller.signal);
    return () => controller.abort();
  }, [loadConflicts]);

  useEffect(() => {
    const controller = new AbortController();
    void loadGrants(selectedId, controller.signal);
    return () => controller.abort();
  }, [loadGrants, selectedId]);

  async function changeGrant(
    memberId: string,
    capability: ConnectionCapability | "",
  ) {
    if (!selectedId || mutatingId) return;
    setMutatingId(memberId);
    setError("");
    try {
      const endpoint =
        `/api/v1/workspaces/${workspaceId}/connections/${selectedId}/grants`;
      const response = await fetch(
        capability ? endpoint : `${endpoint}?memberId=${encodeURIComponent(memberId)}`,
        capability
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ memberId, capability }),
            }
          : { method: "DELETE" },
      ).catch(() => null);
      if (!response?.ok) {
        setError(await responseError(response, copy.changeGrantError, locale));
        return;
      }
      await loadGrants(selectedId);
    } finally {
      setMutatingId("");
    }
  }

  const selected = connections.find((item) => item.id === selectedId) ?? null;

  async function postConflictResolution(
    conflictId: string,
    resolution: "server" | "candidate" | "dismissed",
  ) {
    return fetch(
      `/api/v1/workspaces/${workspaceId}/connections/conflicts/${conflictId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution }),
      },
    ).catch(() => null);
  }

  async function keepCurrentConflict(conflict: ConnectionConflict) {
    if (mutatingId) return;
    setMutatingId(`conflict:${conflict.id}`);
    setError("");
    try {
      const response = await postConflictResolution(
        conflict.id,
        conflict.currentMatchesServer ? "server" : "dismissed",
      );
      if (!response?.ok) {
        setError(await responseError(response, copy.resolveConflictError, locale));
        return;
      }
      await loadConflicts();
    } finally {
      setMutatingId("");
    }
  }

  async function applyConflictCandidate(conflict: ConnectionConflict) {
    if (mutatingId) return;
    if (
      conflict.candidate.payload.deleted
      && !window.confirm(copy.applyDeleteConfirmation)
    ) return;
    setMutatingId(`conflict:${conflict.id}`);
    setError("");
    try {
      if (!conflict.currentMatchesCandidate) {
        const { deleted, ...payload } = conflict.candidate.payload;
        const mutation = await fetch(
          `/api/v1/workspaces/${workspaceId}/connections/${conflict.connectionId}`,
          deleted
            ? {
                method: "DELETE",
                headers: {
                  "x-dopedb-expected-revision": String(conflict.current.revision),
                },
              }
            : {
                method: "PATCH",
                headers: {
                  "content-type": "application/json",
                  "x-dopedb-expected-revision": String(conflict.current.revision),
                },
                body: JSON.stringify(payload),
              },
        ).catch(() => null);
        if (!mutation?.ok) {
          setError(await responseError(mutation, copy.applyConflictError, locale));
          await loadConflicts();
          return;
        }
      }
      const resolution = await postConflictResolution(
        conflict.id,
        candidateConflictResolution(conflict),
      );
      if (!resolution?.ok) {
        setError(await responseError(resolution, copy.resolveConflictError, locale));
        await loadConflicts();
        return;
      }
      await Promise.all([loadConnections(), loadConflicts()]);
    } finally {
      setMutatingId("");
    }
  }

  return (
    <section className="tw:grid tw:gap-3 tw:p-6 tw:max-[640px]:p-4">
      <header className="tw:flex tw:items-start tw:justify-between tw:gap-3">
        <div className="tw:grid tw:gap-1">
          <h2 className="tw:m-0 tw:text-ui tw:font-semibold tw:text-foreground">
            {copy.title}
          </h2>
          <small className="tw:text-xs tw:leading-body tw:text-muted-foreground">
            {copy.description}
          </small>
        </div>
        <span className="tw:shrink-0 tw:rounded-full tw:border tw:border-border tw:px-2 tw:py-1 tw:font-mono tw:text-2xs tw:text-muted-foreground">
          {copy.proof}
        </span>
      </header>

      {conflicts.length > 0 ? (
        <section className="tw:grid tw:gap-3 tw:border-t tw:border-warning/45 tw:bg-warning/5 tw:px-3.5 tw:py-4">
          <header className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:max-[640px]:grid tw:max-[640px]:justify-stretch">
            <div className="tw:grid tw:gap-1">
              <strong className="tw:text-ui tw:text-foreground">
                {copy.conflictsTitle}
              </strong>
              <small className="tw:text-xs tw:leading-body tw:text-muted-foreground">
                {copy.conflictsDescription}
              </small>
            </div>
            <span className="tw:shrink-0 tw:rounded-full tw:border tw:border-warning/45 tw:px-2 tw:py-1 tw:font-mono tw:text-2xs tw:text-warning">
              {conflicts.length} {copy.conflictsOpen}
            </span>
          </header>
          <div className="tw:grid tw:gap-3">
            {conflicts.map((conflict) => {
              const busy = mutatingId === `conflict:${conflict.id}`;
              return (
                <article
                  className="tw:grid tw:gap-4 tw:rounded-surface tw:border tw:border-border tw:bg-surface tw:p-4"
                  key={conflict.id}
                >
                  <header className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:max-[640px]:grid">
                    <div className="tw:grid tw:min-w-0 tw:gap-0.5">
                      <strong className="tw:truncate tw:text-xs tw:text-foreground">
                        {conflict.connectionName}
                      </strong>
                      <small className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
                        {copy.conflictExpected} r{conflict.expectedRevision}
                        {" · "}{copy.conflictServerAtDetection} r{conflict.server.revision}
                        {" · "}<time dateTime={conflict.createdAt}>
                          {conflict.createdAt.slice(0, 16).replace("T", " ")} UTC
                        </time>
                      </small>
                    </div>
                    {!conflict.currentMatchesServer ? (
                      <span className="tw:rounded-full tw:border tw:border-warning/45 tw:bg-warning/10 tw:px-2 tw:py-1 tw:text-2xs tw:font-medium tw:text-warning">
                        {copy.conflictChangedAgain}
                      </span>
                    ) : null}
                  </header>
                  <div className="tw:grid tw:grid-cols-2 tw:gap-5 tw:max-[760px]:grid-cols-1">
                    <ConflictVersionCard
                      title={copy.conflictCurrentVersion}
                      version={conflict.current}
                      comparison={conflict.candidate}
                      copy={copy}
                    />
                    <ConflictVersionCard
                      title={copy.conflictCandidateVersion}
                      version={conflict.candidate}
                      comparison={conflict.current}
                      copy={copy}
                    />
                  </div>
                  <footer className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
                    <ControlButton
                      disabled={mutatingId !== ""}
                      onClick={() => void keepCurrentConflict(conflict)}
                    >
                      {busy ? copy.resolvingConflict : copy.keepCurrentVersion}
                    </ControlButton>
                    <ControlButton
                      disabled={mutatingId !== ""}
                      onClick={() => void applyConflictCandidate(conflict)}
                      tone="primary"
                    >
                      {busy
                        ? copy.resolvingConflict
                        : conflict.candidate.payload.deleted
                          ? copy.applyCandidateDelete
                          : copy.applyCandidateVersion}
                    </ControlButton>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <label className="tw:grid tw:gap-1">
        <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground tw:uppercase">
          {copy.sharedConnection}
        </span>
        <select
          className="tw:h-control-field tw:w-full tw:border tw:border-border tw:bg-surface-inset tw:px-3 tw:text-ui tw:text-foreground tw:outline-none tw:focus:border-primary"
          value={selectedId}
          disabled={loading || connections.length === 0}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {connections.length === 0 ? (
            <option value="">{copy.noConnections}</option>
          ) : null}
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name} · {connection.engine}
            </option>
          ))}
        </select>
      </label>

      {selected ? (
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {selected.credentialMode === "managed"
            ? copy.managedDescription
            : copy.localDescription}
        </p>
      ) : null}

      {selected?.credentialMode === "managed" ? (
        <section className="tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-start tw:gap-3 tw:border-y tw:border-border tw:bg-surface-inset tw:px-3 tw:py-3">
          <span className="tw:grid tw:gap-1 tw:text-xs tw:text-foreground">
            {copy.writePolicyStatus}
            <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
              {!selected.writeAvailable
                ? copy.noWriteAccount
                : copy.writePolicyDesktop}
            </small>
          </span>
          <strong
            className="tw:inline-flex tw:min-h-5 tw:items-center tw:rounded-full tw:border tw:border-border tw:bg-surface tw:px-2 tw:text-2xs tw:font-semibold tw:text-muted-foreground tw:data-[enabled=true]:border-warning/40 tw:data-[enabled=true]:bg-warning/10 tw:data-[enabled=true]:text-warning"
            data-enabled={selected.allowWrites && selected.writeAvailable}
          >
            {selected.allowWrites && selected.writeAvailable
              ? copy.writePolicyEnabled
              : copy.writePolicyDisabled}
          </strong>
        </section>
      ) : null}

      <div className="tw:grid tw:divide-y tw:divide-border tw:border-y tw:border-border">
        {grants.map((grant) => {
          const isActor = grant.memberId === actorMemberId;
          return (
            <div
              className="tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(170px,0.48fr)] tw:items-center tw:gap-3 tw:py-2 tw:max-[720px]:grid-cols-1"
              key={grant.memberId}
            >
              <div className="tw:grid tw:min-w-0 tw:gap-0.5">
                <strong className="tw:overflow-hidden tw:text-ui tw:text-ellipsis tw:whitespace-nowrap tw:text-foreground">
                  {grant.name}
                  {isActor ? ` · ${common.me}` : ""}
                </strong>
                <small className="tw:overflow-hidden tw:text-xs tw:text-ellipsis tw:whitespace-nowrap tw:text-muted-foreground">
                  {grant.email} · {grant.role}
                </small>
              </div>
              <select
                className="tw:h-control-sm tw:w-full tw:border tw:border-border tw:bg-surface-inset tw:px-2 tw:text-xs tw:text-foreground tw:outline-none tw:focus:border-primary tw:disabled:cursor-not-allowed tw:disabled:opacity-[var(--ds-disabled-opacity)]"
                aria-label={`${grant.name} ${copy.permissionLabel}`}
                value={grant.capability ?? ""}
                disabled={mutatingId !== "" || isActor}
                onChange={(event) => void changeGrant(
                  grant.memberId,
                  event.target.value as ConnectionCapability | "",
                )}
              >
                <option value="">{copy.noAccess}</option>
                <option value="view">{copy.view}</option>
                <option value="use">
                  {selected?.credentialMode === "managed"
                    ? copy.useManaged
                    : copy.useLocal}
                </option>
                <option value="manage">{copy.manage}</option>
              </select>
            </div>
          );
        })}
      </div>
      {error ? (
        <small className="tw:text-xs tw:text-danger" role="alert">
          {error}
        </small>
      ) : null}
    </section>
  );
}
