// Pure account/workspace projection used by the desktop switcher and secure-copy
// dialog. Composite option values keep duplicate cross-account memberships distinct.
import {
  accountId,
  workspaceId,
  type AccountId,
  type Workspace,
  type WorkspaceAuthState,
  type WorkspaceId,
  type WorkspaceRole,
} from "./domain";

interface WorkspaceChoice {
  value: string;
  workspace: Workspace;
  accountUserId: AccountId | null;
  role: WorkspaceRole | null;
}

export interface WorkspaceChoiceGroup {
  key: string;
  label: string;
  choices: WorkspaceChoice[];
}

const LOCAL_ACCOUNT = "local";

/** Editors and above add team connections and place them in Project environments; viewers and analysts only use them. */
export function canAddWorkspaceConnections(role: WorkspaceRole | null) {
  return role === "editor" || role === "admin" || role === "owner";
}

export function workspaceChoiceValue(id: WorkspaceId, accountUserId: AccountId | null) {
  return `${accountUserId ?? LOCAL_ACCOUNT}:${id}`;
}

export function parseWorkspaceChoice(value: string) {
  const separator = value.indexOf(":");
  if (separator < 1 || separator === value.length - 1) return null;
  const account = value.slice(0, separator);
  return {
    workspaceId: workspaceId(value.slice(separator + 1)),
    accountUserId: account === LOCAL_ACCOUNT ? null : accountId(account),
  };
}

export function buildWorkspaceChoiceGroups(
  auth: WorkspaceAuthState | undefined,
  workspaces: Workspace[],
  localLabel: string,
): WorkspaceChoiceGroup[] {
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const personal = workspaces.find((workspace) => workspace.kind === "personal");
  const groups: WorkspaceChoiceGroup[] = personal
    ? [{
        key: LOCAL_ACCOUNT,
        label: localLabel,
        choices: [{
          value: workspaceChoiceValue(personal.id, null),
          workspace: personal,
          accountUserId: null,
          role: null,
        }],
      }]
    : [];

  for (const account of auth?.accounts ?? []) {
    const choices = account.memberships.flatMap((membership) => {
      const workspace = byId.get(membership.workspaceId);
      return workspace?.kind === "team"
        ? [{
            value: workspaceChoiceValue(workspace.id, account.user.id),
            workspace,
            accountUserId: account.user.id,
            role: membership.role,
          }]
        : [];
    });
    if (choices.length > 0) {
      groups.push({
        key: account.user.id,
        label: account.user.email,
        choices,
      });
    }
  }
  return groups;
}
