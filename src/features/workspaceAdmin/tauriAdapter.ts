// The only frontend owner of workspace administration command names. Requests carry
// the acting account explicitly; the Bearer session and provider state stay in Rust.
import { invoke } from "../../ipc/core";
import type { AccountId, WorkspaceId } from "../workspaces/domain";
import type {
  OAuthProvider,
  ProviderAuthorizationRequest,
  WorkspaceAdminOperation,
  WorkspaceAdminRequest,
  WorkspaceAdminResponse,
} from "./domain";

export function workspaceAdminRequest(
  accountId: AccountId,
  operation: WorkspaceAdminOperation,
): Promise<WorkspaceAdminResponse> {
  const request: WorkspaceAdminRequest = { accountId, operation };
  return invoke("workspace_admin_request", { request });
}

/** Opens the provider's same-origin start page in the system browser. */
export function startWorkspaceProviderAuthorization(
  accountId: AccountId,
  workspaceId: WorkspaceId,
  provider: OAuthProvider,
): Promise<WorkspaceAdminResponse> {
  const request: ProviderAuthorizationRequest = { accountId, workspaceId, provider };
  return invoke("start_workspace_provider_authorization", { request });
}
