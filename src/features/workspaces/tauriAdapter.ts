// The only frontend owner of workspace Tauri command names. Bearer sessions remain
// behind the Rust adapter and no function here accepts or returns token material.
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "../../ipc/core";

import type {
  ConnectionId,
  ConnectionProfile,
} from "../connections/domain";
import type {
  AccountId,
  Workspace,
  WorkspaceAuthState,
  WorkspaceDeviceAuthorization,
  WorkspaceFeatureState,
  WorkspaceId,
  WorkspaceLoginPoll,
} from "./domain";
import { workspaceManagedConnectionSettingsUrl } from "./navigation";

const WORKSPACE_LOGIN_CALLBACK_EVENT = "workspace-login:callback";

export function workspaceFeatureState(): Promise<WorkspaceFeatureState> {
  return invoke("workspace_feature_state");
}

export function workspaceAuthState(): Promise<WorkspaceAuthState> {
  return invoke("workspace_auth_state");
}

export function refreshWorkspaceAuthState(): Promise<WorkspaceAuthState> {
  return invoke("refresh_workspace_auth_state");
}

export function signOutWorkspace(userId?: AccountId): Promise<WorkspaceAuthState> {
  return invoke("workspace_sign_out", { userId: userId ?? null });
}

export function signOutAllWorkspaces(): Promise<WorkspaceAuthState> {
  return invoke("workspace_sign_out_all");
}

export function beginWorkspaceLogin(): Promise<WorkspaceDeviceAuthorization> {
  return invoke("begin_workspace_login");
}

export function pollWorkspaceLogin(deviceCode: string): Promise<WorkspaceLoginPoll> {
  return invoke("poll_workspace_login", { deviceCode });
}

export function onWorkspaceLoginCallback(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen(WORKSPACE_LOGIN_CALLBACK_EVENT, handler);
}

export function workspaceConsoleUrl(workspaceId?: WorkspaceId): Promise<string> {
  return invoke("workspace_console_url", { workspaceId: workspaceId ?? null });
}

export async function workspaceManagedConnectionConsoleUrl(
  workspaceId: WorkspaceId,
  connectionId: ConnectionId,
): Promise<string> {
  const consoleUrl = await workspaceConsoleUrl(workspaceId);
  return workspaceManagedConnectionSettingsUrl(consoleUrl, connectionId);
}

export function listWorkspaces(): Promise<Workspace[]> {
  return invoke("list_workspaces");
}

export function getActiveWorkspace(): Promise<Workspace> {
  return invoke("get_active_workspace");
}

export function setActiveWorkspace(
  id: WorkspaceId,
  accountUserId?: AccountId,
): Promise<Workspace> {
  return invoke("set_active_workspace", {
    id,
    accountUserId: accountUserId ?? null,
  });
}

export function setActiveWorkspaceAccount(userId: AccountId): Promise<Workspace> {
  return invoke("set_active_workspace_account", { userId });
}

export function copyConnectionToWorkspace(
  connectionId: ConnectionId,
  workspaceId: WorkspaceId,
  accountUserId: AccountId,
): Promise<ConnectionProfile> {
  return invoke("copy_connection_to_workspace", {
    connectionId,
    workspaceId,
    accountUserId,
  });
}

export function bindWorkspaceConnectionCredentials(
  id: ConnectionId,
  username: string,
  password: string,
  sshAlias: string,
): Promise<ConnectionProfile> {
  return invoke("bind_workspace_connection_credentials", {
    id,
    username,
    password,
    sshAlias,
  });
}

export function updateWorkspaceConnection(
  profile: ConnectionProfile,
): Promise<ConnectionProfile> {
  return invoke("update_workspace_connection", { profile });
}

export function setWorkspaceConnectionWritePolicy(
  id: ConnectionId,
  allowWrites: boolean,
): Promise<ConnectionProfile> {
  return invoke("set_workspace_connection_write_policy", { id, allowWrites });
}

export function deleteWorkspaceConnection(
  id: ConnectionId,
): Promise<ConnectionProfile> {
  return invoke("delete_workspace_connection", { id });
}
