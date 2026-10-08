// Database access reads. Every key sits under one area root, so a refusal can
// re-read the whole panel while a confirmed change refreshes only what it touched.
import { queryOptions } from "@tanstack/react-query";
import type { WorkspaceAdminScope } from "../domain";
import { workspaceAdminQueryKey } from "../queryKeys";
import { runWorkspaceAdmin } from "../requests";
import {
  parseConnectionConflicts,
  parseGrantSnapshot,
  parseSharedDatabases,
} from "./parsers";

const AREA = "access";

type ScopeKey = Pick<WorkspaceAdminScope, "accountId" | "workspaceId">;

export function accessQueryRoot(scope: ScopeKey) {
  return workspaceAdminQueryKey(scope, AREA);
}

/** Shared databases visible to the acting member, with their effective access. */
export function sharedDatabasesQuery(scope: WorkspaceAdminScope) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, AREA, "databases"),
    queryFn: async () =>
      parseSharedDatabases(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listConnections",
          workspaceId: scope.workspaceId,
        }),
      ),
  });
}

/** Every active member's grant on one database the acting member manages. */
export function databaseGrantsQuery(scope: WorkspaceAdminScope, connectionId: string) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, AREA, "grants", connectionId),
    queryFn: async () =>
      parseGrantSnapshot(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listConnectionGrants",
          workspaceId: scope.workspaceId,
          connectionId,
        }),
        connectionId,
      ),
  });
}

/** Unresolved offline edit conflicts on databases the acting member manages. */
export function connectionConflictsQuery(scope: WorkspaceAdminScope) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, AREA, "conflicts"),
    queryFn: async () =>
      parseConnectionConflicts(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listConnectionConflicts",
          workspaceId: scope.workspaceId,
        }),
      ),
  });
}
