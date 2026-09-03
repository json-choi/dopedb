// Coordinates the four bounded setup workflows rendered by Agent Tools settings.
// Keeping effects and native commands here leaves the screen as a composition root.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  agentCliDetectionQuery,
  agentPluginStatusQuery,
} from "../../agents/queryOptions";
import {
  checkAgentAcpPluginUpdates,
  installAgentAcpPlugin,
  removeAgentAcpPlugin,
  setAgentAcpPluginEnabled,
} from "../../agents/tauriAdapter";
import type { AcpPluginId } from "../../agents/domain";
import {
  legacyMcpCleanupApply,
  installSkill,
  removeSkill,
  repairSkill,
  skillSelfTest,
} from "../../skills/tauriAdapter";
import { buildSkillSetupPlan } from "../../skills/setupPolicy";
import {
  errMessage,
  type SkillMutationReceipt,
  type SkillTargetExpectation,
  type SkillTargetSelection,
} from "../../../ipc/types";
import { useToast } from "../../../components/Toast";
import {
  legacyMcpCleanupStatusQuery,
  qk,
  skillStatusQuery,
} from "../../../lib/queries";
import { useI18n } from "../../../lib/i18n";
import type { AgentToolsBusyAction, AgentToolsMutation } from "./model";

export function useAgentToolsController() {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const statusQuery = useQuery(skillStatusQuery());
  const pluginQuery = useQuery(agentPluginStatusQuery());
  const refetchPlugins = pluginQuery.refetch;
  const cliQuery = useQuery({
    ...agentCliDetectionQuery(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const cleanupQuery = useQuery(legacyMcpCleanupStatusQuery());
  const [busy, setBusy] = useState<AgentToolsBusyAction | null>(null);
  const [selectedPlugins, setSelectedPlugins] = useState<AcpPluginId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const status = statusQuery.data ?? null;

  useEffect(() => {
    if (busy !== "plugin-batch" && !busy?.startsWith("dopedb.acp.")) return;
    const timer = window.setInterval(() => void refetchPlugins(), 500);
    return () => window.clearInterval(timer);
  }, [busy, refetchPlugins]);

  useEffect(() => {
    if (!pluginQuery.data || selectedPlugins.length > 0) return;
    setSelectedPlugins(
      pluginQuery.data
        .filter((plugin) => plugin.state === "not_installed")
        .map((plugin) => plugin.pluginId),
    );
  }, [pluginQuery.data, selectedPlugins.length]);

  async function installPlugins(pluginIds: AcpPluginId[]) {
    if (pluginIds.length === 0) return;
    setBusy(pluginIds.length === 1 ? pluginIds[0] : "plugin-batch");
    setError(null);
    const failures: string[] = [];
    try {
      for (const pluginId of pluginIds) {
        try {
          await installAgentAcpPlugin(pluginId);
        } catch (reason) {
          failures.push(errMessage(reason));
        } finally {
          await pluginQuery.refetch();
        }
      }
      if (failures.length > 0) throw new Error(failures.join("\n"));
      setSelectedPlugins([]);
      toast(t("agentTools.pluginsInstalled", { count: pluginIds.length }));
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(null);
    }
  }

  async function removePlugin(pluginId: AcpPluginId) {
    setBusy(pluginId);
    setError(null);
    try {
      await removeAgentAcpPlugin(pluginId);
      await pluginQuery.refetch();
      toast(t("agentTools.pluginRemoved"));
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(null);
    }
  }

  async function togglePlugin(pluginId: AcpPluginId, enabled: boolean) {
    setBusy(pluginId);
    setError(null);
    try {
      await setAgentAcpPluginEnabled(pluginId, enabled);
      await pluginQuery.refetch();
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(null);
    }
  }

  function expectations(target: SkillTargetSelection): SkillTargetExpectation[] {
    const selected =
      target === "all"
        ? status?.targets
        : status?.targets.filter((item) => item.target === target);
    return (selected ?? []).map((item) => ({
      target: item.target,
      inventoryFingerprint: item.inventoryFingerprint,
    }));
  }

  async function runMutation(
    mutation: AgentToolsMutation,
    target: SkillTargetSelection,
  ) {
    if (!status) return;
    setBusy(target);
    setError(null);
    try {
      const expected = expectations(target);
      let receipt: SkillMutationReceipt;
      if (mutation === "repair") {
        receipt = await repairSkill(target, expected);
      } else {
        receipt = await removeSkill(target, expected);
      }
      await statusQuery.refetch();
      showBackups(receipt);
      if (mutation === "remove") {
        toast(t("agentTools.removed"));
      } else {
        await runVerifiedSkillSuccess();
      }
    } catch (reason) {
      reportError(reason);
      await statusQuery.refetch();
    } finally {
      setBusy(null);
    }
  }

  async function runInstall(target: SkillTargetSelection) {
    if (!status) return;
    setBusy(target);
    setError(null);
    try {
      const receipt = await installSkill(target, expectations(target));
      await statusQuery.refetch();
      showBackups(receipt);
      await runVerifiedSkillSuccess();
    } catch (reason) {
      reportError(reason);
      await statusQuery.refetch();
    } finally {
      setBusy(null);
    }
  }

  async function runSelfTest() {
    setBusy("self-test");
    setError(null);
    try {
      const tested = await skillSelfTest();
      toast(
        t("agentTools.selfTestPassed", {
          revision: tested.releaseRevision,
          bytes: tested.guideBytes,
        }),
      );
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(null);
    }
  }

  async function runLegacyCleanup() {
    const expectations =
      cleanupQuery.data?.targets.flatMap((target) =>
        target.state === "ready" && target.fingerprint
          ? [{ id: target.id, fingerprint: target.fingerprint }]
          : [],
      ) ?? [];
    if (expectations.length === 0) return;
    setBusy("legacy-cleanup");
    setError(null);
    try {
      const receipt = await legacyMcpCleanupApply(expectations);
      queryClient.setQueryData(qk.legacyMcpCleanup(), receipt.status);
      for (const backup of receipt.backups) {
        toast(t("agentTools.legacyCleanupBackup", { path: backup.path }));
      }
      toast(
        t("agentTools.legacyCleanupComplete", {
          count: receipt.removedTargetIds.length,
        }),
      );
    } catch (reason) {
      reportError(reason);
      await cleanupQuery.refetch();
    } finally {
      setBusy(null);
    }
  }

  function showBackups(receipt: SkillMutationReceipt) {
    for (const backup of receipt.backups) {
      toast(t("agentTools.backupCreated", { path: backup.path }));
    }
  }

  async function runVerifiedSkillSuccess() {
    const tested = await skillSelfTest();
    toast(t("agentTools.updated"));
    toast(
      t("agentTools.selfTestPassed", {
        revision: tested.releaseRevision,
        bytes: tested.guideBytes,
      }),
    );
  }

  function reportError(reason: unknown) {
    const message = errMessage(reason);
    setError(message);
    toast(message, "error");
  }

  async function refresh() {
    setBusy("plugin-check");
    setError(null);
    try {
      await Promise.all([
        statusQuery.refetch(),
        checkAgentAcpPluginUpdates(),
        cliQuery.refetch(),
        cleanupQuery.refetch(),
      ]);
      await pluginQuery.refetch();
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(null);
    }
  }

  const cleanupReady =
    cleanupQuery.data?.targets.filter((target) => target.state === "ready") ?? [];
  const cleanupManual =
    cleanupQuery.data?.targets.filter(
      (target) => target.state === "manual_review",
    ) ?? [];

  return {
    busy,
    error,
    status,
    statusQuery,
    pluginQuery,
    cliQuery,
    cleanupQuery,
    selectedPlugins,
    setSelectedPlugins,
    installPlugins,
    removePlugin,
    togglePlugin,
    runMutation,
    runInstall,
    runSelfTest,
    runLegacyCleanup,
    refresh,
    combinedSetupPlan: status ? buildSkillSetupPlan(status.targets) : null,
    anyCurrent: status?.targets.some(
      (target) => target.state === "managed_current",
    ),
    cleanupReady,
    cleanupManual,
  };
}

export type AgentToolsController = ReturnType<typeof useAgentToolsController>;
