/** Workspace wire/domain contracts. */

declare const workspaceIdBrand: unique symbol;
declare const accountIdBrand: unique symbol;

export type WorkspaceId = string & {
  readonly [workspaceIdBrand]: "WorkspaceId";
};

export type AccountId = string & {
  readonly [accountIdBrand]: "AccountId";
};

export function workspaceId(value: string): WorkspaceId {
  return value as WorkspaceId;
}

export function accountId(value: string): AccountId {
  return value as AccountId;
}

export type WorkspaceRole = "viewer" | "analyst" | "editor" | "admin" | "owner";
export type WorkspaceKind = "personal" | "team";
export type WorkspaceLifecycleState = "active" | "archived" | "deleted";

export interface Workspace {
  id: WorkspaceId;
  name: string;
  kind: WorkspaceKind;
  lifecycleState: WorkspaceLifecycleState;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFeatureState {
  enabled: boolean;
}

export interface WorkspaceAuthUser {
  id: AccountId;
  email: string;
  displayName: string;
}

export interface WorkspaceAccountMembership {
  workspaceId: WorkspaceId;
  role: WorkspaceRole;
}

export interface WorkspaceAuthAccount {
  user: WorkspaceAuthUser;
  memberships: WorkspaceAccountMembership[];
}

export interface WorkspaceAuthState {
  authenticated: boolean;
  user: WorkspaceAuthUser | null;
  accounts: WorkspaceAuthAccount[];
  /** Monotonic native authority generation shared by every private cache owner. */
  authorityGeneration: number;
}

/** Public attempt handle only; native owns the listener and PKCE secrets. */
export interface DesktopWorkspaceAuthorization {
  attemptId: string;
  authorizationUrl: string;
  expiresIn: number;
}

export type WorkspaceLoginStatus =
  | "signedIn"
  | "denied"
  | "expired";

export interface WorkspaceLoginResult {
  status: WorkspaceLoginStatus;
  user: WorkspaceAuthUser | null;
}
