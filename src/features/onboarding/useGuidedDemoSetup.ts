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
import { connectionVerificationRecorder } from "../connections/connectionVerificationAnalytics";
import {
  demoSqliteConnection,
  findDemoSqliteConnection,
} from "../connections/presets";
import { captureProductEvent } from "../productAnalytics/client";
import {
  productAnalyticsAccessMode,
  productAnalyticsConnectionEngine,
  productAnalyticsWorkspaceContext,
} from "../productAnalytics/outcomes";
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
      const recordVerification = connectionVerificationRecorder(scope, saved);
      const receipt = await testConnection(saved.id).catch((error) => {
        recordVerification("failed");
        throw error;
      });
      if (!receipt.ok) {
        recordVerification("failed");
        throw new Error(receipt.failure.detail);
      }
      recordVerification("success");

      if (scope.workspaceKind === "personal") {
        const setup = await ensureGuidedDemoEnvironment(saved);
        await refreshGuidedDemoQueries(queryClient, scope, saved.id);
        const analyticsContext = productAnalyticsWorkspaceContext(scope);
        if (analyticsContext && setup.createdEnvironmentId) {
          void captureProductEvent({
            name: "knowledge_environment_created",
            properties: { creationKind: "project_default" },
            context: analyticsContext,
            dedupeId: setup.createdEnvironmentId,
          });
        }
        if (analyticsContext && setup.binding) {
          void captureProductEvent({
            name: "environment_connection_bound",
            properties: {
              accessMode: productAnalyticsAccessMode(saved.credentialMode),
              engine: productAnalyticsConnectionEngine(saved.engine),
            },
            context: analyticsContext,
            dedupeId: setup.binding.id,
          });
        }
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
