// Reads for the owner-only Backups & deletion section. Listing backups writes an audit
// row on every call, so none of these reads refresh themselves: each opening of the
// section loads them once (gcTime 0 drops them when it closes), and only an explicit
// refresh or a finished command reads them again.
import { queryOptions } from "@tanstack/react-query";
import type { WorkspaceAdminScope } from "../domain";
import { workspaceAdminQueryKey } from "../queryKeys";
import { runWorkspaceAdmin } from "../requests";
import { parseBackupList, parseKeyRotationStatus, parseLifecycleStatus } from "./domain";

type LifecycleScope = Pick<WorkspaceAdminScope, "accountId" | "workspaceId">;

export const LIFECYCLE_AREA = "lifecycle";

export const lifecycleQueryKeys = {
  status: (scope: LifecycleScope) => workspaceAdminQueryKey(scope, LIFECYCLE_AREA, "status"),
  backups: (scope: LifecycleScope) => workspaceAdminQueryKey(scope, LIFECYCLE_AREA, "backups"),
  keyRotation: (scope: LifecycleScope) =>
    workspaceAdminQueryKey(scope, LIFECYCLE_AREA, "keyRotation"),
};

const LOAD_ONCE_PER_OPENING = {
  staleTime: Infinity,
  gcTime: 0,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
} as const;

export function lifecycleStatusQuery(scope: LifecycleScope) {
  return queryOptions({
    queryKey: lifecycleQueryKeys.status(scope),
    queryFn: async () =>
      parseLifecycleStatus(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "getLifecycle",
          workspaceId: scope.workspaceId,
        }),
      ),
    ...LOAD_ONCE_PER_OPENING,
  });
}

export function lifecycleBackupsQuery(scope: LifecycleScope) {
  return queryOptions({
    queryKey: lifecycleQueryKeys.backups(scope),
    queryFn: async () =>
      parseBackupList(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listBackups",
          workspaceId: scope.workspaceId,
        }),
        scope.workspaceId,
      ),
    ...LOAD_ONCE_PER_OPENING,
  });
}

export function keyRotationQuery(scope: LifecycleScope) {
  return queryOptions({
    queryKey: lifecycleQueryKeys.keyRotation(scope),
    queryFn: async () =>
      parseKeyRotationStatus(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "getKeyRotation",
          workspaceId: scope.workspaceId,
        }),
      ),
    ...LOAD_ONCE_PER_OPENING,
  });
}
