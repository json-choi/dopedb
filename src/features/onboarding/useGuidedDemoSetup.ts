// Creates or reuses and verifies the demo connection before opening its guided workflow.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { CatalogScope } from "../../lib/queries";
import { useToast } from "../../components/Toast";
import { agentSessionErrorLabel } from "../agents/agentErrorLabels";
import {
  catalogLoadIssueMessage,
  isCatalogLoadIssue,
} from "../catalogExplorer/catalogDomain";
import type { ConnectionProfile } from "../connections/domain";
import {
  createDemoSqlite,
  testConnection,
  upsertConnection,
} from "../connections/tauriAdapter";
import {
  demoSqliteConnection,
  findDemoSqliteConnection,
} from "../connections/presets";
import {
  ensureGuidedDemoEnvironment,
  GuidedDemoEnvironmentMissingError,
  refreshGuidedDemoQueries,
} from "./demoSetup";

type GuidedDemoSetupInput = {
  scope: CatalogScope;
  connections: ConnectionProfile[];
  refreshConnections: () => Promise<ConnectionProfile[] | null>;
  selectConnection: (connectionId: string) => void;
  showWorkbench: () => void;
};

/** Owns the idempotent local database and exact Environment demo setup. */
export function useGuidedDemoSetup({
  scope,
  connections,
  refreshConnections,
  selectConnection,
  showWorkbench,
}: GuidedDemoSetupInput) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const path = await createDemoSqlite();
      const existing = findDemoSqliteConnection(connections, path);
      const saved =
        existing ?? (await upsertConnection(demoSqliteConnection(path)));
      const receipt = await testConnection(saved.id);
      if (!receipt.ok) throw new Error(receipt.failure.detail);

      if (scope.workspaceKind === "personal") {
        await ensureGuidedDemoEnvironment(saved);
        await refreshGuidedDemoQueries(queryClient, scope, saved.id);
      }

      if (!existing) await refreshConnections();
      selectConnection(saved.id);
      showWorkbench();
      toast(
        t(
          scope.workspaceKind === "personal"
            ? "onboarding.demoReady"
            : "connections.demoCreatedLocalOnly",
        ),
      );
    } catch (error) {
      toast(
        error instanceof GuidedDemoEnvironmentMissingError
          ? t("onboarding.demoEnvironmentMissing")
          : isCatalogLoadIssue(error)
            ? catalogLoadIssueMessage(t, error)
            : agentSessionErrorLabel(errMessage(error), t),
        "error",
      );
    } finally {
      setCreating(false);
    }
  }

  return { creating, create };
}
