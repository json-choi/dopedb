// Google Cloud SQL setup reads. Every discovery read is keyed by its one-use
// setup session, so a new authorization never reuses another session's inventory.
import { queryOptions } from "@tanstack/react-query";
import type { WorkspaceAdminScope } from "../../domain";
import { workspaceAdminQueryKey } from "../../queryKeys";
import { runWorkspaceAdmin } from "../../requests";
import {
  parseGcpInstanceInventory,
  parseGcpPermissionResponse,
  parseGcpProjectInventory,
  parseGcpSetups,
} from "./gcpModel";

const GCP_SETUP_AREA = "gcpSetup";

/** The caller's unconsumed Google Cloud setup authorizations, newest first. */
export function gcpSetupsQuery(scope: WorkspaceAdminScope) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, "gcpSetups"),
    queryFn: async () =>
      parseGcpSetups(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listGcpSetups",
          workspaceId: scope.workspaceId,
        }),
      ),
  });
}

export function gcpProjectsQuery(scope: WorkspaceAdminScope, setupId: string) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, GCP_SETUP_AREA, setupId, "projects"),
    queryFn: async () =>
      parseGcpProjectInventory(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listGcpSetupInventory",
          workspaceId: scope.workspaceId,
          setupId,
          inventory: "projects",
          projectId: null,
        }),
      ),
  });
}

export function gcpInstancesQuery(
  scope: WorkspaceAdminScope,
  setupId: string,
  projectId: string,
) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, GCP_SETUP_AREA, setupId, "instances", projectId),
    queryFn: async () =>
      parseGcpInstanceInventory(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listGcpSetupInventory",
          workspaceId: scope.workspaceId,
          setupId,
          inventory: "instances",
          projectId,
        }),
      ),
  });
}

export function gcpPermissionsQuery(
  scope: WorkspaceAdminScope,
  setupId: string,
  projectId: string,
) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, GCP_SETUP_AREA, setupId, "permissions", projectId),
    queryFn: async () =>
      parseGcpPermissionResponse(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listGcpSetupInventory",
          workspaceId: scope.workspaceId,
          setupId,
          inventory: "permissions",
          projectId,
        }),
      ),
  });
}
