// Owns the repair command for one managed shared connection: it opens Settings →
// Workspace → Providers focused on that database, where the provider re-approval
// and repair happen in this app. When Settings saves a repair for the database,
// the caller's refresh runs once so a stale connection error clears.
import { useEffect, useRef } from "react";

import type { CatalogScope } from "../../lib/queries";
import { requestWorkspaceAdmin } from "../workspaceAdmin/navigationRequest";
import { onManagedConnectionsRepaired } from "../workspaceAdmin/providers/gcp/repairSignal";
import type { ConnectionProfile } from "./domain";

type ReturnAction = () => void;

function managedRecoveryActive(profile: ConnectionProfile) {
  return profile.credentialMode === "managed"
    && profile.workspaceAccess !== "local";
}

export function useManagedConnectionRecoveryLauncher(
  catalogScope: CatalogScope,
) {
  const returnActions = useRef(new Map<string, ReturnAction>());

  useEffect(() => {
    const pending = returnActions.current;
    // A repair saved for another account or workspace never refreshes this scope.
    pending.clear();
    const stop = onManagedConnectionsRepaired((connectionIds) => {
      for (const connectionId of connectionIds) {
        const action = pending.get(connectionId);
        if (!action) continue;
        pending.delete(connectionId);
        action();
      }
    });
    return () => {
      stop();
      pending.clear();
    };
  }, [catalogScope.key]);

  function canOpenSettings(profile: ConnectionProfile) {
    return managedRecoveryActive(profile)
      && profile.workspaceAccess === "manage"
      && catalogScope.workspaceKind === "team"
      && catalogScope.workspaceId !== null;
  }

  function openSettings(profile: ConnectionProfile, onReturn?: ReturnAction) {
    if (!canOpenSettings(profile)) return;
    if (onReturn) returnActions.current.set(profile.id, onReturn);
    else returnActions.current.delete(profile.id);
    requestWorkspaceAdmin("workspace-providers", {
      kind: "connection",
      connectionId: profile.id,
    });
  }

  return {
    canOpenSettings,
    openSettings,
  };
}

export function useManagedConnectionRecovery(
  profile: ConnectionProfile,
  catalogScope: CatalogScope,
) {
  const launcher = useManagedConnectionRecoveryLauncher(catalogScope);

  return {
    active: managedRecoveryActive(profile),
    canOpenSettings: launcher.canOpenSettings(profile),
    openSettings: (onReturn?: ReturnAction) => launcher.openSettings(
      profile,
      onReturn,
    ),
  };
}
