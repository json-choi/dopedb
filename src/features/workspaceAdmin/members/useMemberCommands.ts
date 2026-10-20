// Owns the members area's write lifecycle: one invitation, membership or database-grant
// command runs at a time, the row it targets shows progress, and a refusal stays beside
// that target until the next command. Every change that lowers a member's database
// access (role change, removal, lowered or removed grant) is handed to the shared
// access-lowering hook, which revokes provisioned accounts first. Success refreshes
// every administration read of the workspace.
import { useRef } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import { accessErrorMessage } from "../access/errors";
import type { SharedDatabase } from "../access/domain";
import type { AccessLowering } from "../accessLowering/useAccessLowering";
import type {
  AssignableWorkspaceRole,
  ConnectionCapability,
  WorkspaceAdminOperation,
  WorkspaceAdminScope,
} from "../domain";
import {
  runWorkspaceAdmin,
  workspaceAdminErrorMessage,
  WorkspaceAdminRequestError,
  type WorkspaceAdminI18n,
} from "../requests";
import {
  MemberDirectoryShapeError,
  parseCreatedInvitation,
  type CreatedInvitation,
} from "./domain";
import {
  grantLoweringPlan,
  planGrantChange,
  removalPlan,
  roleLoweringPlan,
  type MemberGrantsRow,
} from "./memberGrants";
import { memberDirectoryQuery } from "./queries";

export type MemberCommand =
  | { kind: "invite"; email: string; role: AssignableWorkspaceRole }
  | { kind: "changeRole"; memberId: string; role: AssignableWorkspaceRole }
  | { kind: "remove"; memberId: string }
  | {
      kind: "setGrant";
      memberId: string;
      connectionId: string;
      previous: ConnectionCapability | null;
      next: ConnectionCapability | null;
    }
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

const GENERIC_FAILURE: Record<MemberAction, I18nKey> = {
  load: "workspaceMembers.loadFailed",
  refresh: "workspaceMembers.refreshFailed",
  invite: "workspaceMembers.inviteFailed",
  changeRole: "workspaceMembers.roleChangeFailed",
  remove: "workspaceMembers.removeFailed",
  setGrant: "workspaceMembers.grantFailed",
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
  ["direct_revocation_required", "workspaceMembers.errorRevocationRequired"],
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
  i18n: WorkspaceAdminI18n,
): string {
  if (error instanceof MemberDirectoryShapeError) {
    return i18n.t("workspaceMembers.loadIncompatible");
  }
  let fallback = GENERIC_FAILURE[action];
  const coded = error instanceof WorkspaceAdminRequestError && error.code
    ? REFUSAL_CODES.get(error.code)
    : undefined;
  if (coded) return i18n.t(coded);
  // Grant refusals have their own documented sentences.
  if (action === "setGrant") return accessErrorMessage(error, i18n, fallback);
  if (error instanceof WorkspaceAdminRequestError) {
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
    case "setGrant":
      return command.memberId;
    case "revokeInvitation":
    case "recreateInvitation":
      return command.invitationId;
    case "invite":
      return null;
  }
}

/** What the controller reads at run time to decide whether a change lowers provisioned access. */
export interface MemberCommandContext {
  lowering: AccessLowering;
  grants: readonly MemberGrantsRow[] | undefined;
  /** The team connections the acting administrator manages, by id. */
  databases: ReadonlyMap<string, SharedDatabase>;
}

async function executeMemberCommand(
  scope: WorkspaceAdminScope,
  command: MemberCommand,
  context: MemberCommandContext,
): Promise<InviteOutcome | null> {
  const { accountId, workspaceId } = scope;
  const { lowering } = context;
  const grantsOf = (memberId: string) => context.grants?.find((row) => row.memberId === memberId);
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
    case "changeRole": {
      const mutation: WorkspaceAdminOperation = {
        kind: "changeMemberRole",
        workspaceId,
        memberId: command.memberId,
        role: command.role,
      };
      const row = grantsOf(command.memberId);
      const plan = row ? roleLoweringPlan(row, command.role, context.databases) : null;
      if (plan) await lowering.run({ kind: "role_lowered", ...plan, mutation });
      else await runWorkspaceAdmin(accountId, mutation);
      return null;
    }
    case "remove": {
      const mutation: WorkspaceAdminOperation = {
        kind: "removeMember",
        workspaceId,
        memberId: command.memberId,
      };
      const row = grantsOf(command.memberId);
      const plan = row ? removalPlan(row, context.databases) : null;
      if (plan) await lowering.run({ kind: "member_removed", ...plan, mutation });
      else await runWorkspaceAdmin(accountId, mutation);
      return null;
    }
    case "setGrant": {
      const plan = planGrantChange(command.previous, command.next);
      if (!plan) return null;
      const target = {
        workspaceId,
        connectionId: command.connectionId,
        memberId: command.memberId,
      };
      const mutation: WorkspaceAdminOperation =
        plan.kind === "remove"
          ? { kind: "removeConnectionAccess", ...target }
          : plan.kind === "lower"
            ? { kind: "lowerConnectionAccess", ...target, capability: plan.capability }
            : { kind: "grantConnectionAccess", ...target, capability: plan.capability };
      // A lowering keeps the grant row (and a provisioned member's database account);
      // the account is revoked to the level it ends on first, or not at all when the
      // effective level does not drop.
      const row = grantsOf(command.memberId);
      const revocation = plan.kind !== "grant" && row
        ? grantLoweringPlan(row, command.connectionId, command.next, context.databases)
        : null;
      if (revocation) await lowering.run({ kind: "grant_lowered", ...revocation, mutation });
      else await runWorkspaceAdmin(accountId, mutation);
      return null;
    }
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

export function useMemberCommands(scope: WorkspaceAdminScope, context: MemberCommandContext) {
  const i18n = useI18n();
  const queryClient = useQueryClient();
  // Guards the gap between a click and the re-render that disables every action.
  const inFlight = useRef(false);
  const mutationKey = ["workspaceAdmin", scope.accountId, scope.workspaceId, "memberCommand"];
  // A command started before Settings was closed or the section remounted still counts.
  const running = useIsMutating({ mutationKey }) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: (command: MemberCommand) => executeMemberCommand(scope, command, context),
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
