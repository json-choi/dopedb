// Routes guided-demo actions through existing catalog, Project, Agent, and Safety commands.

import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "../../components/Toast";
import type { CatalogTable } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { type CatalogScope } from "../../lib/queries";
import { catalogQuery } from "../../lib/catalogQueries";
import { agentSessionErrorLabel } from "../agents/agentErrorLabels";
import type { ConnectionProfile } from "../connections/domain";
import {
  catalogLoadIssueMessage,
  isCatalogLoadIssue,
} from "../catalogExplorer/catalogDomain";
import { isDemoSqliteConnection } from "../connections/presets";
import {
  ensureGuidedDemoEnvironment,
  GuidedDemoEnvironmentMissingError,
  refreshGuidedDemoQueries,
} from "./demoSetup";

export type GuidedDemoCommands = {
  browseOrders: () => void;
  analyzeRevenue: () => void;
  practiceApproval: () => void;
  openSafety: () => void;
  /** Returns to the demo's Welcome from another connection; null when already there. */
  resume: (() => void) | null;
} | null;

type GuidedDemoCommandsInput = {
  scope: CatalogScope;
  connection: ConnectionProfile | null;
  connections: ConnectionProfile[];
  selectConnection: (connectionId: string) => void;
  showWelcome: () => void;
  openTable: (connection: ConnectionProfile, table: CatalogTable) => void;
  openAgentTask: (
    connectionId: string,
    environmentId?: string,
    prompt?: string,
    articleId?: string,
    options?: { write?: boolean },
  ) => void;
  openSafety: () => void;
};

/** Resolves the real demo resources before handing work to their screen owner. */
export function useGuidedDemoCommands({
  scope,
  connection,
  connections,
  selectConnection,
  showWelcome,
  openTable,
  openAgentTask,
  openSafety,
}: GuidedDemoCommandsInput): GuidedDemoCommands {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();

  async function environmentId(target: ConnectionProfile) {
    const setup = await ensureGuidedDemoEnvironment(target);
    await refreshGuidedDemoQueries(queryClient, scope, target.id);
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
          : agentSessionErrorLabel(errMessage(error), t),
        "error",
      );
    }
  }

  async function openAgent(prompt: string, options?: { write?: boolean }) {
    if (!connection || !isDemoSqliteConnection(connection)) return;
    try {
      const environment = await environmentId(connection);
      openAgentTask(connection.id, environment, prompt, undefined, options);
    } catch (error) {
      toast(
        error instanceof GuidedDemoEnvironmentMissingError
          ? t("onboarding.demoEnvironmentMissing")
          : isCatalogLoadIssue(error)
            ? catalogLoadIssueMessage(t, error)
            : agentSessionErrorLabel(errMessage(error), t),
        "error",
      );
    }
  }

  if (scope.workspaceKind !== "personal") return null;
  const demo = connections.find(isDemoSqliteConnection) ?? null;
  return {
    browseOrders: () => void browseOrders(),
    analyzeRevenue: () =>
      void openAgent(t("onboarding.demoAgentReadPrompt")),
    practiceApproval: () =>
      void openAgent(t("onboarding.demoAgentWritePrompt"), { write: true }),
    openSafety,
    resume:
      demo && connection?.id !== demo.id
        ? () => {
            selectConnection(demo.id);
            showWelcome();
          }
        : null,
  };
}
