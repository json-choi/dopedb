"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ControlButton,
  ControlField,
  ControlSelect,
} from "../components/Controls";
import { useWorkspaceLocale } from "../components/WorkspaceLocale";

type WorkspaceMember = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type KnowledgeEnvironment = {
  id: string;
  name: string;
  riskClass: "production" | "staging" | "development" | "test" | "custom";
  revision: number;
};

type KnowledgeProject = {
  id: string;
  name: string;
  environments: KnowledgeEnvironment[];
};

type KnowledgeGrant = {
  id: string;
  memberId: string;
  projectId: string;
  projectEnvironmentId: string;
  environmentRevision: number;
  graphRevisionIds: string[];
  expiresAt: string;
};

const copy = {
  en: {
    title: "Agent knowledge access",
    description: "Choose which exact Project Environment graph a member's Agent may use.",
    proof: "Short-lived · exact revision",
    member: "Member",
    environment: "Project environment",
    duration: "Access duration",
    oneHour: "1 hour",
    eightHours: "8 hours",
    oneDay: "24 hours",
    issue: "Grant knowledge access",
    issuing: "Granting…",
    active: "Active knowledge grants",
    empty: "No active knowledge grants",
    noMembers: "No members are available",
    noEnvironments: "No synced Project Environment is available",
    graphs: "graphs",
    revision: "environment revision",
    expires: "Expires",
    revoke: "Revoke",
    revoking: "Revoking…",
    loadError: "Could not load Agent knowledge access.",
    mutationError: "Could not update Agent knowledge access.",
  },
  ko: {
    title: "Agent 지식 접근",
    description: "구성원의 Agent가 사용할 정확한 프로젝트 환경 그래프를 선택합니다.",
    proof: "단기 권한 · revision 고정",
    member: "구성원",
    environment: "프로젝트 환경",
    duration: "접근 시간",
    oneHour: "1시간",
    eightHours: "8시간",
    oneDay: "24시간",
    issue: "지식 접근 허용",
    issuing: "허용 중…",
    active: "활성 지식 권한",
    empty: "활성 지식 권한이 없습니다",
    noMembers: "선택할 구성원이 없습니다",
    noEnvironments: "동기화된 프로젝트 환경이 없습니다",
    graphs: "개 그래프",
    revision: "환경 revision",
    expires: "만료",
    revoke: "회수",
    revoking: "회수 중…",
    loadError: "Agent 지식 접근을 불러오지 못했습니다.",
    mutationError: "Agent 지식 접근을 변경하지 못했습니다.",
  },
} as const;

async function errorMessage(response: Response | null, fallback: string) {
  const body = await response?.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

export function KnowledgeAccessPanel({ workspaceId }: { workspaceId: string }) {
  const locale = useWorkspaceLocale();
  const text = copy[locale];
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [projects, setProjects] = useState<KnowledgeProject[]>([]);
  const [grants, setGrants] = useState<KnowledgeGrant[]>([]);
  const [memberId, setMemberId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState("28800");
  const [loading, setLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState("");
  const [error, setError] = useState("");

  const environments = useMemo(() => projects.flatMap((project) =>
    project.environments.map((environment) => ({
      ...environment,
      projectId: project.id,
      projectName: project.name,
    }))), [projects]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const [membersResponse, projectsResponse, grantsResponse] = await Promise.all([
      fetch(`/api/v1/workspaces/${workspaceId}/members`, { cache: "no-store", signal })
        .catch(() => null),
      fetch(`/api/v1/workspaces/${workspaceId}/knowledge/projects`, {
        cache: "no-store",
        signal,
      }).catch(() => null),
      fetch(`/api/v1/workspaces/${workspaceId}/knowledge/grants`, {
        cache: "no-store",
        signal,
      }).catch(() => null),
    ]);
    if (signal?.aborted) return;
    if (!membersResponse?.ok || !projectsResponse?.ok || !grantsResponse?.ok) {
      const failed = [membersResponse, projectsResponse, grantsResponse]
        .find((response) => !response?.ok) ?? null;
      setError(await errorMessage(failed, text.loadError));
      setLoading(false);
      return;
    }
    const [membersBody, projectsBody, grantsBody] = await Promise.all([
      membersResponse.json().catch(() => null),
      projectsResponse.json().catch(() => null),
      grantsResponse.json().catch(() => null),
    ]);
    if (
      !Array.isArray(membersBody?.members)
      || !Array.isArray(projectsBody?.projects)
      || !Array.isArray(grantsBody?.grants)
    ) {
      setError(text.loadError);
      setLoading(false);
      return;
    }
    const nextMembers = membersBody.members as WorkspaceMember[];
    const nextProjects = projectsBody.projects as KnowledgeProject[];
    setMembers(nextMembers);
    setProjects(nextProjects);
    setGrants(grantsBody.grants as KnowledgeGrant[]);
    setMemberId((current) => nextMembers.some((item) => item.id === current)
      ? current
      : nextMembers[0]?.id ?? "");
    const nextEnvironmentIds = new Set(nextProjects.flatMap((project) =>
      project.environments.map((environment) => environment.id)));
    setEnvironmentId((current) => nextEnvironmentIds.has(current)
      ? current
      : nextProjects[0]?.environments[0]?.id ?? "");
    setError("");
    setLoading(false);
  }, [text.loadError, workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function issueGrant() {
    if (!memberId || !environmentId || mutatingId) return;
    setMutatingId("issue");
    setError("");
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/knowledge/grants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberId,
          projectEnvironmentId: environmentId,
          ttlSeconds: Number(ttlSeconds),
        }),
      }).catch(() => null);
      if (!response?.ok) {
        setError(await errorMessage(response, text.mutationError));
        return;
      }
      await load();
    } finally {
      setMutatingId("");
    }
  }

  async function revokeGrant(grantId: string) {
    if (mutatingId) return;
    setMutatingId(grantId);
    setError("");
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/knowledge/grants`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grantId }),
      }).catch(() => null);
      if (!response?.ok) {
        setError(await errorMessage(response, text.mutationError));
        return;
      }
      await load();
    } finally {
      setMutatingId("");
    }
  }

  function memberLabel(id: string) {
    const item = members.find((member) => member.id === id);
    return item ? `${item.name} · ${item.email}` : id;
  }

  function environmentLabel(id: string) {
    const item = environments.find((environment) => environment.id === id);
    return item ? `${item.projectName} / ${item.name}` : id;
  }

  return (
    <section className="tw:grid tw:gap-4 tw:border-t tw:border-border tw:p-6 tw:max-[640px]:p-4">
      <header className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:max-[720px]:grid">
        <div className="tw:grid tw:gap-1">
          <strong className="tw:text-sm tw:text-foreground">{text.title}</strong>
          <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
            {text.description}
          </small>
        </div>
        <span className="tw:shrink-0 tw:font-mono tw:text-2xs tw:text-primary">
          {text.proof}
        </span>
      </header>

      <div className="tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(120px,0.42fr)_auto] tw:items-end tw:gap-3 tw:max-[840px]:grid-cols-2 tw:max-[560px]:grid-cols-1">
        <ControlField label={text.member}>
          <ControlSelect
            value={memberId}
            disabled={loading || members.length === 0 || mutatingId !== ""}
            onChange={(event) => setMemberId(event.target.value)}
          >
            {members.length === 0 ? <option value="">{text.noMembers}</option> : null}
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} · {member.role}
              </option>
            ))}
          </ControlSelect>
        </ControlField>
        <ControlField label={text.environment}>
          <ControlSelect
            value={environmentId}
            disabled={loading || environments.length === 0 || mutatingId !== ""}
            onChange={(event) => setEnvironmentId(event.target.value)}
          >
            {environments.length === 0 ? (
              <option value="">{text.noEnvironments}</option>
            ) : null}
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.projectName} / {environment.name} · {environment.riskClass}
              </option>
            ))}
          </ControlSelect>
        </ControlField>
        <ControlField label={text.duration}>
          <ControlSelect
            value={ttlSeconds}
            disabled={mutatingId !== ""}
            onChange={(event) => setTtlSeconds(event.target.value)}
          >
            <option value="3600">{text.oneHour}</option>
            <option value="28800">{text.eightHours}</option>
            <option value="86400">{text.oneDay}</option>
          </ControlSelect>
        </ControlField>
        <ControlButton
          size="field"
          tone="primary"
          disabled={loading || !memberId || !environmentId || mutatingId !== ""}
          onClick={() => void issueGrant()}
        >
          {mutatingId === "issue" ? text.issuing : text.issue}
        </ControlButton>
      </div>

      <section className="tw:grid tw:gap-2">
        <strong className="tw:text-xs tw:text-foreground">{text.active}</strong>
        <div className="tw:grid tw:divide-y tw:divide-border tw:border-y tw:border-border">
          {!loading && grants.length === 0 ? (
            <p className="tw:m-0 tw:py-4 tw:text-xs tw:text-muted-foreground">{text.empty}</p>
          ) : null}
          {grants.map((grant) => (
            <article
              className="tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:py-3"
              key={grant.id}
            >
              <div className="tw:grid tw:min-w-0 tw:gap-1">
                <strong className="tw:truncate tw:text-xs tw:text-foreground">
                  {memberLabel(grant.memberId)}
                </strong>
                <span className="tw:text-2xs tw:text-muted-foreground">
                  {environmentLabel(grant.projectEnvironmentId)} · {text.revision} {grant.environmentRevision}
                  {" · "}{grant.graphRevisionIds.length} {text.graphs}
                </span>
                <time className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
                  {text.expires} · {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(grant.expiresAt))}
                </time>
              </div>
              <ControlButton
                tone="danger"
                disabled={mutatingId !== ""}
                onClick={() => void revokeGrant(grant.id)}
              >
                {mutatingId === grant.id ? text.revoking : text.revoke}
              </ControlButton>
            </article>
          ))}
        </div>
      </section>
      {error ? <small className="tw:text-xs tw:text-danger" role="alert">{error}</small> : null}
    </section>
  );
}
