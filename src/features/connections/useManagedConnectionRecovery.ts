// Owns the Desktop-to-Workspace-Web recovery command for one managed shared
// connection. The trusted console origin still comes from the native adapter.
import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { useToast } from "../../components/Toast";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { CatalogScope } from "../../lib/queries";
import { workspaceId as asWorkspaceId } from "../workspaces/domain";
import { workspaceManagedConnectionConsoleUrl } from "../workspaces/tauriAdapter";
import type { ConnectionProfile } from "./domain";

export function useManagedConnectionRecovery(
  profile: ConnectionProfile,
  catalogScope: CatalogScope,
) {
  const { t } = useI18n();
  const toast = useToast();
  const [openingSettings, setOpeningSettings] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const active = profile.credentialMode === "managed"
    && profile.workspaceAccess !== "local";
  const canOpenSettings = active
    && profile.workspaceAccess === "manage"
    && catalogScope.workspaceKind === "team"
    && catalogScope.workspaceId !== null;

  async function openSettings() {
    if (!canOpenSettings || !catalogScope.workspaceId || openingSettings) return;
    setOpeningSettings(true);
    try {
      const url = await workspaceManagedConnectionConsoleUrl(
        asWorkspaceId(catalogScope.workspaceId),
        profile.id,
      );
      await openUrl(url);
    } catch (error) {
      toast(t("connections.managedWorkspace.openFailed", {
        error: errMessage(error),
      }), "error");
    } finally {
      if (mounted.current) setOpeningSettings(false);
    }
  }

  return { active, canOpenSettings, openingSettings, openSettings };
}
