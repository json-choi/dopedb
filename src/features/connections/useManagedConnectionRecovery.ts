// Owns the Desktop-to-Workspace-Web recovery command for one managed shared
// connection. The trusted console origin still comes from the native adapter.
import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "../../components/Toast";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { CatalogScope } from "../../lib/queries";
import { workspaceId as asWorkspaceId } from "../workspaces/domain";
import { onWorkspaceAccessCallback, workspaceManagedConnectionConsoleUrl } from "../workspaces/tauriAdapter";
import type { ConnectionProfile } from "./domain";
import { connectionQueryKeys } from "./queries";

type ReturnAction = () => void;

function managedRecoveryActive(profile: ConnectionProfile) {
  return profile.credentialMode === "managed"
    && profile.workspaceAccess !== "local";
}

export function useManagedConnectionRecoveryLauncher(
  catalogScope: CatalogScope,
) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [openingConnectionId, setOpeningConnectionId] = useState<string | null>(
    null,
  );
  const mounted = useRef(true);
  const scopeEpoch = useRef(0);
  const returnAction = useRef<ReturnAction | null>(null);

  useEffect(() => {
    mounted.current = true;
    setOpeningConnectionId(null);
    const handleFocus = () => {
      const action = returnAction.current;
      if (!action) return;
      returnAction.current = null;
      action();
    };
    window.addEventListener("focus", handleFocus);
    const unlisten = onWorkspaceAccessCallback(handleFocus);
    void unlisten.catch(() => {});
    return () => {
      mounted.current = false;
      scopeEpoch.current += 1;
      returnAction.current = null;
      window.removeEventListener("focus", handleFocus);
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [catalogScope.key]);

  function canOpenSettings(profile: ConnectionProfile) {
    return managedRecoveryActive(profile)
      && profile.workspaceAccess === "manage"
      && catalogScope.workspaceKind === "team"
      && catalogScope.workspaceId !== null;
  }

  async function openSettings(
    profile: ConnectionProfile,
    onReturn?: ReturnAction,
  ) {
    if (
      !canOpenSettings(profile)
      || !catalogScope.workspaceId
      || openingConnectionId !== null
    ) return;
    const epoch = scopeEpoch.current;
    setOpeningConnectionId(profile.id);
    try {
      const url = await workspaceManagedConnectionConsoleUrl(
        asWorkspaceId(catalogScope.workspaceId),
        profile.id,
      );
      if (!mounted.current || scopeEpoch.current !== epoch) return;
      returnAction.current = () => {
        void queryClient.invalidateQueries({ queryKey: connectionQueryKeys.all(catalogScope.key) });
        onReturn?.();
      };
      await openUrl(url);
    } catch (error) {
      if (!mounted.current || scopeEpoch.current !== epoch) return;
      returnAction.current = null;
      toast(t("connections.managedWorkspace.openFailed", {
        error: errMessage(error),
      }), "error");
    } finally {
      if (mounted.current && scopeEpoch.current === epoch) setOpeningConnectionId(null);
    }
  }

  return {
    canOpenSettings,
    openingConnectionId,
    openSettings,
  };
}

export function useManagedConnectionRecovery(
  profile: ConnectionProfile,
  catalogScope: CatalogScope,
) {
  const launcher = useManagedConnectionRecoveryLauncher(catalogScope);
  const active = managedRecoveryActive(profile);
  const canOpenSettings = launcher.canOpenSettings(profile);
  const openingSettings = launcher.openingConnectionId === profile.id;

  return {
    active,
    canOpenSettings,
    openingSettings,
    openSettings: (onReturn?: ReturnAction) => launcher.openSettings(
      profile,
      onReturn,
    ),
  };
}
