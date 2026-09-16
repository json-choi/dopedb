// Routes guided-demo actions through existing catalog, Project, Agent, and Safety commands.

import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "../../components/Toast";
import type { CatalogTable } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { catalogQuery, type CatalogScope } from "../../lib/queries";
import type { ConnectionProfile } from "../connections/domain";
import {
  catalogLoadIssueMessage,
  isCatalogLoadIssue,
} from "../catalogExplorer/catalogDomain";
import { isDemoSqliteConnection } from "../connections/presets";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";
import { ensureGuidedDemoEnvironment } from "./demoSetup";

export type GuidedDemoCommands = {
  browseOrders: () => void;
  analyzeRevenue: () => void;
  practiceApproval: () => void;
  openSafety: () => void;
} | null;

type GuidedDemoCommandsInput = {
  scope: CatalogScope;
  connection: ConnectionProfile | null;
  openTable: (connection: ConnectionProfile, table: CatalogTable) => void;
  openAgentTask: (
    connectionId: string,
    environmentId?: string,
    prompt?: string,
  ) => void;
  openSafety: () => void;
};

/** Resolves the real demo resources before handing work to their screen owner. */
export function useGuidedDemoCommands({
  scope,
  connection,
  openTable,
  openAgentTask,
  openSafety,
}: GuidedDemoCommandsInput): GuidedDemoCommands {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();

  async function environmentId(target: ConnectionProfile) {
    const setup = await ensureGuidedDemoEnvironment(target);
    await queryClient.invalidateQueries({
      queryKey: knowledgeQueryKeys.agentEnvironments(target.id, scope.key),
    });
    return setup.environmentId;
  }

  async function browseOrders() {
    if (!connection || !isDemoSqliteConnection(connection)) return;
    try {
      const catalog = await queryClient.fetchQuery(
        catalogQuery(connection.id, scope),
      );
      const orders = catalog.tables.find((table) => table.name === "orders");
      if (!orders) throw new Error(t("onboarding.demoOrdersMissing"));
      openTable(connection, orders);
    } catch (error) {
      toast(
        isCatalogLoadIssue(error)
          ? catalogLoadIssueMessage(t, error)
          : errMessage(error),
        "error",
      );
    }
  }

  async function openAgent(prompt: string) {
    if (!connection || !isDemoSqliteConnection(connection)) return;
    try {
      openAgentTask(connection.id, await environmentId(connection), prompt);
    } catch (error) {
      toast(errMessage(error), "error");
    }
  }

  if (scope.workspaceKind !== "personal") return null;
  return {
    browseOrders: () => void browseOrders(),
    analyzeRevenue: () =>
      void openAgent(t("onboarding.demoAgentReadPrompt")),
    practiceApproval: () =>
      void openAgent(t("onboarding.demoAgentWritePrompt")),
    openSafety,
  };
}
