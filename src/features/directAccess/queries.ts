// Query options for direct shared database reads, keyed under the workspace
// administration root so an account or workspace switch clears them. The member's own
// status polls only while the administrator device has not finished creating it.
import { keepPreviousData, queryOptions, type QueryClient } from "@tanstack/react-query";
import { workspaceAdminQueryKey } from "../workspaceAdmin/queryKeys";
import type { ConnectionId } from "../connections/domain";
import type { AccountId, WorkspaceId } from "../workspaces/domain";
import {
  directProvisioningPending,
  type DirectPreflightInput,
  type DirectScope,
} from "./domain";
import {
  listDirectRevocations,
  prefillDirectEndpoint,
  preflightDirectDatabase,
  readDirectStatus,
} from "./tauriAdapter";

const STATUS_AREA = "directStatus";
const REVOCATIONS_AREA = "directRevocations";
const PENDING_STATUS_POLL_MS = 5_000;

export const directAccessQueryKeys = {
  status: (scope: DirectScope) =>
    workspaceAdminQueryKey(scope, STATUS_AREA, scope.connectionId),
  revocations: (scope: { accountId: AccountId; workspaceId: WorkspaceId }) =>
    workspaceAdminQueryKey(scope, REVOCATIONS_AREA),
};

export function directStatusQuery(scope: DirectScope | null) {
  return queryOptions({
    queryKey: scope
      ? directAccessQueryKeys.status(scope)
      : (["workspaceAdmin", "none", "directStatus"] as const),
    queryFn: () => {
      if (!scope) throw new Error("A shared database scope is required.");
      return readDirectStatus(scope);
    },
    enabled: scope !== null,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data && directProvisioningPending(query.state.data.provisioning)
        ? PENDING_STATUS_POLL_MS
        : false,
  });
}

export function directRevocationsQuery(scope: {
  accountId: AccountId;
  workspaceId: WorkspaceId;
}) {
  return queryOptions({
    queryKey: directAccessQueryKeys.revocations(scope),
    queryFn: () => listDirectRevocations(scope.accountId, scope.workspaceId),
  });
}

/** The endpoint of one saved connection; read once per pick, never cached. */
export function directPrefillQuery(connectionId: ConnectionId) {
  return queryOptions({
    queryKey: ["directAccessPrefill", connectionId] as const,
    queryFn: () => prefillDirectEndpoint(connectionId),
    staleTime: 0,
    gcTime: 0,
  });
}

export function invalidateDirectRevocations(
  queryClient: QueryClient,
  scope: { accountId: AccountId; workspaceId: WorkspaceId },
) {
  return queryClient.invalidateQueries({
    queryKey: directAccessQueryKeys.revocations(scope),
  });
}

/**
 * One preflight of a candidate endpoint. The administrator password is read from
 * `input` only when the query runs and is never part of the key, so it cannot reach
 * the cache keys; the report is dropped as soon as the flow stops observing it.
 * `attempt` makes every explicit "Check" a new read.
 */
export function directPreflightQuery(
  input: DirectPreflightInput,
  attempt: number,
  enabled: boolean,
) {
  const { endpoint, scope, writeCeiling } = input;
  return queryOptions({
    queryKey: [
      "directAccessPreflight",
      input.accountId,
      attempt,
      endpoint.engine,
      endpoint.host,
      endpoint.port,
      endpoint.database,
      endpoint.sslmode,
      endpoint.sshAlias,
      input.credential.username,
      scope === null ? null : [...scope].sort().join("\u0000"),
      writeCeiling,
    ] as const,
    queryFn: () => preflightDirectDatabase(input),
    enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}
