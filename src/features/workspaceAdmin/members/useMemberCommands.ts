// Owns the members area's write lifecycle: one invitation or membership command runs at
// a time, the row it targets shows progress, and a refusal stays beside that target until
// the next command. Success refreshes every administration read of the workspace. The
// short-lived invitation-link copy feedback is owned here too, so presentation holds no timers.
import { useEffect, useRef, useState } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n, type I18nKey, type Lang } from "../../../lib/i18n";
import type { AssignableWorkspaceRole, WorkspaceAdminScope } from "../domain";
import {
  runWorkspaceAdmin,
  workspaceAdminErrorMessage,
  WorkspaceAdminRequestError,
} from "../requests";
import {
  MemberDirectoryShapeError,
  parseCreatedInvitation,
  type CreatedInvitation,
} from "./domain";
import { memberDirectoryQuery } from "./queries";

export type MemberCommand =
  | { kind: "invite"; email: string; role: AssignableWorkspaceRole }
  | { kind: "changeRole"; memberId: string; role: AssignableWorkspaceRole }
  | { kind: "remove"; memberId: string }
  | { kind: "revokeInvitation"; invitationId: string }
  | {
      kind: "recreateInvitation";
      invitationId: string;
      email: string;
      role: AssignableWorkspaceRole;
    };

export type MemberAction = MemberCommand["kind"] | "load" | "refresh";

export interface InviteOutcome {
  email: string;
  requestedRole: AssignableWorkspaceRole;
  invitation: CreatedInvitation | null;
}

export type LinkCopyState = { target: string; status: "copied" | "failed" } | null;

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

const GENERIC_FAILURE: Record<MemberAction, I18nKey> = {
  load: "workspaceMembers.loadFailed",
  refresh: "workspaceMembers.refreshFailed",
  invite: "workspaceMembers.inviteFailed",
  changeRole: "workspaceMembers.roleChangeFailed",
  remove: "workspaceMembers.removeFailed",
  revokeInvitation: "workspaceMembers.revokeFailed",
  recreateInvitation: "workspaceMembers.recreateFailed",
};

// Identity-provider refusal codes name the situation exactly, so product wording
// replaces the provider's sentence in both languages.
const REFUSAL_CODES = new Map<string, I18nKey>([
  ["USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION", "workspaceMembers.errorAlreadyMember"],
  ["INVITATION_LIMIT_REACHED", "workspaceMembers.errorInvitationLimit"],
  ["ORGANIZATION_MEMBERSHIP_LIMIT_REACHED", "workspaceMembers.errorMembershipLimit"],
  ["INVITATION_NOT_FOUND", "workspaceMembers.errorInvitationGone"],
]);

// The English UI shows the control plane's own sentence. These rules only pick the
// translated fallback where a refusal changes what the administrator should do next.
const REFUSAL_SENTENCES: ReadonlyArray<{ status: number; includes: string; key: I18nKey }> = [
  { status: 409, includes: "Analysis Articles before changing", key: "workspaceMembers.errorTransferArticles" },
  { status: 409, includes: "Analysis Articles before removing", key: "workspaceMembers.errorDeleteArticles" },
  { status: 409, includes: "already in progress", key: "workspaceMembers.errorChangeInProgress" },
  { status: 409, includes: "changed concurrently", key: "workspaceMembers.errorChangedConcurrently" },
  { status: 409, includes: "lease expires", key: "workspaceMembers.errorCredentialActive" },
  { status: 403, includes: "Insufficient workspace permission", key: "workspaceMembers.errorNoPermission" },
  { status: 404, includes: "Member not found", key: "workspaceMembers.errorMemberGone" },
  { status: 404, includes: "Invitation not found", key: "workspaceMembers.errorInvitationGone" },
];

export function memberFailureMessage(
  error: unknown,
  action: MemberAction,
  i18n: { lang: Lang; t: Translate },
): string {
  if (error instanceof MemberDirectoryShapeError) {
    return i18n.t("workspaceMembers.loadIncompatible");
  }
  let fallback = GENERIC_FAILURE[action];
  if (error instanceof WorkspaceAdminRequestError) {
    const coded = error.code ? REFUSAL_CODES.get(error.code) : undefined;
    if (coded) return i18n.t(coded);
    const sentence = error.serverMessage ?? "";
    fallback = REFUSAL_SENTENCES.find(
      (rule) => rule.status === error.status && sentence.includes(rule.includes),
    )?.key ?? fallback;
  }
  return workspaceAdminErrorMessage(error, i18n, fallback);
}

/** The listed row a command acts on; an invitation from the form has no row yet. */
export function commandTarget(command: MemberCommand): string | null {
  switch (command.kind) {
    case "changeRole":
    case "remove":
      return command.memberId;
    case "revokeInvitation":
    case "recreateInvitation":
      return command.invitationId;
    case "invite":
      return null;
  }
}

async function executeMemberCommand(
  scope: WorkspaceAdminScope,
  command: MemberCommand,
): Promise<InviteOutcome | null> {
  const { accountId, workspaceId } = scope;
  switch (command.kind) {
    case "invite": {
      const body = await runWorkspaceAdmin(accountId, {
        kind: "inviteMember",
        workspaceId,
        email: command.email,
        role: command.role,
      });
      return {
        email: command.email,
        requestedRole: command.role,
        invitation: parseCreatedInvitation(body),
      };
    }
    case "changeRole":
      await runWorkspaceAdmin(accountId, {
        kind: "changeMemberRole",
        workspaceId,
        memberId: command.memberId,
        role: command.role,
      });
      return null;
    case "remove":
      await runWorkspaceAdmin(accountId, {
        kind: "removeMember",
        workspaceId,
        memberId: command.memberId,
      });
      return null;
    case "revokeInvitation":
      await runWorkspaceAdmin(accountId, {
        kind: "cancelInvitation",
        workspaceId,
        invitationId: command.invitationId,
      });
      return null;
    case "recreateInvitation": {
      const created = parseCreatedInvitation(await runWorkspaceAdmin(accountId, {
        kind: "inviteMember",
        workspaceId,
        email: command.email,
        role: command.role,
      }));
      // An expired invitation can no longer be accepted. Once a different replacement
      // exists, retire the expired one so each invitee keeps one row; if that fails,
      // the expired row simply stays available for a manual revoke.
      if (created && created.id !== command.invitationId) {
        await runWorkspaceAdmin(accountId, {
          kind: "cancelInvitation",
          workspaceId,
          invitationId: command.invitationId,
        }).catch(() => undefined);
      }
      return null;
    }
  }
}

export function useMemberCommands(scope: WorkspaceAdminScope) {
  const i18n = useI18n();
  const queryClient = useQueryClient();
  // Guards the gap between a click and the re-render that disables every action.
  const inFlight = useRef(false);
  const mutationKey = ["workspaceAdmin", scope.accountId, scope.workspaceId, "memberCommand"];
  // A command started before Settings was closed or the section remounted still counts.
  const running = useIsMutating({ mutationKey }) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: (command: MemberCommand) => executeMemberCommand(scope, command),
    // Grants and access lists depend on roles, so every administration read of this
    // workspace (the member directory included) is refreshed. Returning the promise
    // keeps the command pending until the refreshed directory is on screen.
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["workspaceAdmin", scope.accountId, scope.workspaceId],
      }),
    // A refusal can follow a concurrent change or an unknown outcome, so the
    // directory is reloaded to show what actually holds now.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: memberDirectoryQuery(scope).queryKey });
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  function run(command: MemberCommand, onSuccess?: () => void) {
    if (inFlight.current || running) return;
    inFlight.current = true;
    mutation.mutate(command, onSuccess ? { onSuccess: () => onSuccess() } : undefined);
  }

  const command = mutation.variables ?? null;
  return {
    run,
    busy: mutation.isPending || running,
    pending: mutation.isPending ? command : null,
    failure: mutation.isError && command
      ? { command, message: memberFailureMessage(mutation.error, command.kind, i18n) }
      : null,
    inviteOutcome: mutation.isSuccess ? mutation.data : null,
  };
}

/** Copies an invitation link and keeps a brief "copied" or a lasting "failed" state per target. */
export function useInvitationLinkCopy() {
  const [state, setState] = useState<LinkCopyState>(null);
  const timer = useRef<{ id?: number }>({});
  useEffect(() => {
    const pending = timer.current;
    return () => window.clearTimeout(pending.id);
  }, []);

  async function copyLink(target: string, url: string) {
    window.clearTimeout(timer.current.id);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable");
      await navigator.clipboard.writeText(url);
      setState({ target, status: "copied" });
      timer.current.id = window.setTimeout(() => {
        setState((current) =>
          current?.target === target && current.status === "copied" ? null : current,
        );
      }, 2_000);
    } catch {
      setState({ target, status: "failed" });
    }
  }

  return { state, copyLink };
}
