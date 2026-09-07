const workspaceRoleNames = [
  "viewer",
  "analyst",
  "editor",
  "admin",
  "owner",
] as const;

export type WorkspaceRoleName = (typeof workspaceRoleNames)[number];
export type WorkspaceCapability = "view" | "read" | "write" | "manage" | "delete";
export type WorkspaceConnectionCapability = "view" | "read" | "use" | "manage";

const workspaceConnectionCapabilityRank: Record<WorkspaceConnectionCapability, number> = {
  view: 0,
  read: 1,
  use: 2,
  manage: 3,
};

const roleRank: Record<WorkspaceRoleName, number> = {
  viewer: 0,
  analyst: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

const requiredRank: Record<WorkspaceCapability, number> = {
  view: roleRank.viewer,
  read: roleRank.analyst,
  write: roleRank.editor,
  manage: roleRank.admin,
  delete: roleRank.owner,
};

export function isWorkspaceRole(value: string): value is WorkspaceRoleName {
  return workspaceRoleNames.includes(value as WorkspaceRoleName);
}

export function isWorkspaceConnectionCapability(
  value: string,
): value is WorkspaceConnectionCapability {
  return value === "view" || value === "read" || value === "use" || value === "manage";
}

export function hasWorkspaceConnectionCapability(
  actual: WorkspaceConnectionCapability,
  required: WorkspaceConnectionCapability,
): boolean {
  return workspaceConnectionCapabilityRank[actual]
    >= workspaceConnectionCapabilityRank[required];
}

export function hasWorkspaceCapability(
  role: WorkspaceRoleName,
  capability: WorkspaceCapability,
): boolean {
  return roleRank[role] >= requiredRank[capability];
}

export function accessModeForRole(role: WorkspaceRoleName) {
  if (hasWorkspaceCapability(role, "manage")) return "manage" as const;
  if (hasWorkspaceCapability(role, "write")) return "write" as const;
  if (hasWorkspaceCapability(role, "read")) return "read" as const;
  return "view" as const;
}

export function accessModeForConnectionGrant(
  role: WorkspaceRoleName,
  capability: WorkspaceConnectionCapability,
) {
  if (capability === "manage" && hasWorkspaceCapability(role, "manage")) {
    return "manage" as const;
  }
  if (
    (capability === "use" || capability === "manage")
    && hasWorkspaceCapability(role, "write")
  ) {
    return "write" as const;
  }
  if (capability === "read" || capability === "use" || capability === "manage") return "read" as const;
  return "view" as const;
}
