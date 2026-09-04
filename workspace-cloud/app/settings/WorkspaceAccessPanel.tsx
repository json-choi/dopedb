"use client";

// Workspace membership administration. Mutations are confirmed by the server and
// the rendered list is then reloaded from Better Auth's organization state.
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ControlButton,
  ControlInput,
  ControlSelect,
} from "../components/Controls";
import { workspaceMessages } from "../../lib/workspace-messages";
import { useWorkspaceLocale } from "../components/WorkspaceLocale";
import { localizedProviderMessage } from "../../lib/workspace-provider-copy";

type WorkspaceMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
};
type PendingInvitation = {
  id: string;
  email: string;
  role: string | null;
  inviteUrl: string;
  expiresAt: string;
};

export function WorkspaceAccessPanel({ workspaceId }: { workspaceId: string }) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].members;
  const roleLabel: Record<string, string> = copy.roles;
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("analyst");
  const [pending, setPending] = useState(false);
  const [mutatingId, setMutatingId] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/members`, {
      cache: "no-store",
      signal,
    }).catch(() => null);
    if (signal?.aborted) return;
    if (!response?.ok) {
      const body = await response?.json().catch(() => null);
      setError(
        typeof body?.error === "string"
          ? localizedProviderMessage(body.error, locale, copy.loadError)
          : copy.loadError,
      );
      return;
    }
    const body = await response.json().catch(() => null);
    if (!body || !Array.isArray(body.members) || !Array.isArray(body.invitations)) {
      setError(copy.shapeError);
      return;
    }
    setError("");
    setMembers(body.members);
    setInvitations(body.invitations);
  }, [copy, locale, workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (pending || mutatingId) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      }).catch(() => null);
      if (!response?.ok) {
        const body = await response?.json().catch(() => null);
        setError(
          typeof body?.error === "string"
            ? localizedProviderMessage(body.error, locale, copy.inviteError)
            : copy.inviteError,
        );
        return;
      }
      setEmail("");
      await load();
    } finally {
      setPending(false);
    }
  }

  async function updateRole(memberId: string, nextRole: string) {
    if (mutatingId) return;
    setMutatingId(memberId);
    setError("");
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/members`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId, role: nextRole }),
      }).catch(() => null);
      if (!response?.ok) {
        const body = await response?.json().catch(() => null);
        setError(
          typeof body?.error === "string"
            ? localizedProviderMessage(body.error, locale, copy.updateError)
            : copy.updateError,
        );
        return;
      }
      await load();
    } finally {
      setMutatingId("");
    }
  }

  async function remove(kind: "member" | "invitation", id: string) {
    if (mutatingId) return;
    setMutatingId(id);
    setError("");
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/members`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "member" ? { memberId: id } : { invitationId: id }),
      }).catch(() => null);
      if (!response?.ok) {
        const body = await response?.json().catch(() => null);
        setError(
          typeof body?.error === "string"
            ? localizedProviderMessage(body.error, locale, copy.requestError)
            : copy.requestError,
        );
        return;
      }
      await load();
    } finally {
      setMutatingId("");
    }
  }

  async function resend(item: PendingInvitation) {
    if (mutatingId) return;
    setMutatingId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: item.email, role: item.role ?? "analyst" }),
      }).catch(() => null);
      if (!response?.ok) {
        const body = await response?.json().catch(() => null);
        setError(
          typeof body?.error === "string"
            ? localizedProviderMessage(body.error, locale, copy.resendError)
            : copy.resendError,
        );
        return;
      }
      await load();
    } finally {
      setMutatingId("");
    }
  }

  async function copyInvitation(item: PendingInvitation) {
    setError("");
    try {
      await navigator.clipboard.writeText(item.inviteUrl);
      setCopiedId(item.id);
      window.setTimeout(
        () => setCopiedId((current) => current === item.id ? "" : current),
        1800,
      );
    } catch {
      setError(copy.copyError);
    }
  }

  return (
    <section className="tw:grid tw:gap-3 tw:p-6 tw:max-[640px]:p-4">
      <header className="tw:flex tw:items-start tw:justify-between tw:gap-3">
        <h2 className="tw:m-0 tw:text-sm tw:font-semibold tw:text-foreground">
          {copy.title}
        </h2>
        <small className="tw:text-right tw:text-2xs tw:leading-body tw:text-muted-foreground">
          {copy.description}
        </small>
      </header>
      <div className="tw:grid tw:border-t tw:border-border">
        {members.map((item) => (
          <div
            className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-b tw:border-border tw:py-2.5"
            key={item.id}
          >
            <div className="tw:grid tw:gap-1">
              <strong className="tw:text-sm tw:text-foreground">
                {item.name}
              </strong>
              <small className="tw:text-2xs tw:text-muted-foreground">
                {item.email}
              </small>
            </div>
            {item.role === "owner" ? (
              <span className="tw:text-xs tw:text-muted-foreground">
                {roleLabel.owner}
              </span>
            ) : (
              <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                <ControlSelect
                  value={item.role}
                  onChange={(event) =>
                    void updateRole(item.id, event.target.value)
                  }
                  disabled={mutatingId !== ""}
                >
                  <option value="viewer">{copy.roles.viewerNoRun}</option>
                  <option value="analyst">{copy.roles.analyst}</option>
                  <option value="editor">{copy.roles.editor}</option>
                  <option value="admin">{copy.roles.admin}</option>
                </ControlSelect>
                <ControlButton
                  tone="danger"
                  onClick={() => void remove("member", item.id)}
                  disabled={mutatingId !== ""}
                >
                  {copy.remove}
                </ControlButton>
              </div>
            )}
          </div>
        ))}
      </div>
      <form
        className="tw:grid tw:grid-cols-1 tw:gap-2 tw:md:grid-cols-[minmax(0,1fr)_auto_auto]"
        onSubmit={invite}
      >
        <ControlInput
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="member@company.com"
          required
        />
        <ControlSelect
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="viewer">{copy.roles.viewerNoRun}</option>
          <option value="analyst">{copy.roles.analyst}</option>
          <option value="editor">{copy.roles.editor}</option>
          <option value="admin">{copy.roles.admin}</option>
        </ControlSelect>
        <ControlButton
          type="submit"
          tone="primary"
          size="field"
          disabled={pending || mutatingId !== ""}
        >
          {pending ? copy.creating : copy.createInvite}
        </ControlButton>
      </form>
      {invitations.length > 0 ? (
        <div className="tw:grid tw:border-t tw:border-border">
          {invitations.map((item) => (
            <div
              className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-b tw:border-border tw:py-2.5"
              key={item.id}
            >
              <div className="tw:grid tw:gap-1">
                <strong className="tw:text-sm tw:text-foreground">
                  {item.email}
                </strong>
                <small className="tw:text-2xs tw:text-muted-foreground">
                  {roleLabel[item.role ?? ""] ?? item.role} ·{" "}
                  {new Date(item.expiresAt).toLocaleDateString(
                    locale === "ko" ? "ko-KR" : "en-US",
                  )} {copy.expires}
                </small>
              </div>
              <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                <ControlButton onClick={() => void copyInvitation(item)}>
                  {copiedId === item.id ? copy.copied : copy.copy}
                </ControlButton>
                <ControlButton
                  onClick={() => void resend(item)}
                  disabled={mutatingId !== ""}
                >
                  {copy.resend}
                </ControlButton>
                <ControlButton
                  tone="danger"
                  onClick={() => void remove("invitation", item.id)}
                  disabled={mutatingId !== ""}
                >
                  {copy.cancel}
                </ControlButton>
              </div>
            </div>
          ))}
          <p className="tw:mt-2 tw:mb-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
            {copy.invitationNote}
          </p>
        </div>
      ) : null}
      {error ? (
        <small className="tw:text-2xs tw:text-danger" role="alert">
          {error}
        </small>
      ) : null}
    </section>
  );
}
