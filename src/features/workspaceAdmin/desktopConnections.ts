// Pulls shared connections that an administration change added, re-templated or
// moved to member-local credentials into this Desktop. Memberships and synchronized
// templates reach Desktop only through the shell-owned account lifecycle, so this
// asks it to refresh, re-reads the list the Explorer renders, and drops the affected
// databases' cached catalog and rows. Callers run it in the background: the change
// already succeeded, and the next workspace refresh converges if this pull fails.
import type { QueryClient } from "@tanstack/react-query";
import { resetConnectionResourceQueries } from "../../lib/queryClient";
import { connectionQueryKeys } from "../connections/queries";
import { requestWorkspaceMembershipRefresh } from "../workspaces/membershipRefreshRequest";

export async function refreshDesktopConnections(
  queryClient: QueryClient,
  connectionsScopeKey: string,
  connectionIds: readonly string[] = [],
) {
  await requestWorkspaceMembershipRefresh();
  await queryClient.invalidateQueries({
    queryKey: connectionQueryKeys.all(connectionsScopeKey),
    refetchType: "active",
  });
  if (connectionIds.length > 0) {
    await resetConnectionResourceQueries(queryClient, connectionIds);
  }
}
