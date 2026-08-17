import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "../../components/Icon";
import { AgentProviderMark } from "../../design-system/components/Agent";
import { Button } from "../../design-system/components/Button";
import { CheckboxField } from "../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalFooter,
  ModalSurface,
  ModalTitleBar,
} from "../../design-system/components/Modal";
import { ProgressBar } from "../../design-system/components/Progress";
import { StatusBadge } from "../../design-system/components/Status";
import {
  AgentCliDetectionNotice,
  AgentCliStatusBadges,
} from "../agents/AgentCliStatus";
import type {
  AcpPluginId,
  AcpPluginInstallationState,
} from "../agents/domain";
import {
  agentCliDetectionQuery,
  agentPluginStatusQuery,
} from "../agents/queryOptions";
import { installAgentAcpPlugin } from "../agents/tauriAdapter";
import { errMessage, type SkillTarget } from "../../ipc/types";
import { useI18n, type I18nKey } from "../../lib/i18n";
import { usePostPaintReady } from "../../lib/usePostPaintReady";
import {
  hasSavedAgentTargets,
  loadAgentTargets,
  OPEN_AGENT_SETUP_EVENT,
  saveAgentTargets,
  SUPPORTED_AGENT_TARGETS,
} from "./agentPreferences";

const pluginStateLabel: Record<AcpPluginInstallationState, I18nKey> = {
  not_installed: "agentTools.pluginState.notInstalled",
  checking: "agentTools.pluginState.checking",
  downloading: "agentTools.pluginState.downloading",
  verifying: "agentTools.pluginState.verifying",
  staged: "agentTools.pluginState.staged",
  ready: "agentTools.pluginState.ready",
  update_available: "agentTools.pluginState.updateAvailable",
  removing: "agentTools.pluginState.removing",
  failed: "agentTools.pluginState.failed",
  rollback_required: "agentTools.pluginState.rollbackRequired",
};

function pluginId(target: SkillTarget): AcpPluginId {
  return target === "claude-code" ? "dopedb.acp.claude" : "dopedb.acp.codex";
}

export default function SkillStartupGate() {
  const { t } = useI18n();
  const postPaintReady = usePostPaintReady();
  const pluginsQ = useQuery({
    ...agentPluginStatusQuery(),
    enabled: postPaintReady,
  });
  const refetchPlugins = pluginsQ.refetch;
  const agentsQ = useQuery({
    ...agentCliDetectionQuery(),
    enabled: postPaintReady,
  });
  const [selected, setSelected] = useState<SkillTarget[]>(loadAgentTargets);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<AcpPluginId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSavedAgentTargets()) setOpen(true);
  }, []);

  useEffect(() => {
    const show = () => {
      setSelected(loadAgentTargets());
      setError(null);
      setOpen(true);
    };
    window.addEventListener(OPEN_AGENT_SETUP_EVENT, show);
    return () => window.removeEventListener(OPEN_AGENT_SETUP_EVENT, show);
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void refetchPlugins(), 500);
    return () => window.clearInterval(timer);
  }, [busy, refetchPlugins]);

  async function installSelected() {
    if (selected.length === 0) {
      setError(t("agentTools.startupSelectOne"));
      return;
    }
    setError(null);
    const failures: string[] = [];
    for (const target of selected) {
      const id = pluginId(target);
      const current = pluginsQ.data?.find((plugin) => plugin.pluginId === id);
      if (
        current?.enabled &&
        (current.state === "ready" || current.state === "staged")
      ) {
        continue;
      }
      setBusy(id);
      try {
        await installAgentAcpPlugin(id);
      } catch (reason) {
        failures.push(`${target}: ${errMessage(reason)}`);
      } finally {
        await pluginsQ.refetch();
      }
    }
    setBusy(null);
    saveAgentTargets(selected);
    if (failures.length > 0) {
      setError(failures.join("\n"));
      return;
    }
    setOpen(false);
  }

  function saveForLater() {
    setError(null);
    setOpen(false);
  }

  function toggleTarget(target: SkillTarget, checked: boolean) {
    setError(null);
    setSelected((current) =>
      checked
        ? [...new Set([...current, target])]
        : current.filter((candidate) => candidate !== target),
    );
  }

  if (!open) return null;

  return (
    <ModalBackdrop>
      <ModalSurface
        aria-labelledby="agent-startup-title"
        aria-describedby="agent-startup-description"
        onEscape={busy === null ? saveForLater : undefined}
      >
        <ModalTitleBar
          title={t("agentTools.startupTitle")}
          titleId="agent-startup-title"
          closeLabel={t("common.close")}
          onClose={busy ? () => undefined : saveForLater}
        />
        <div className="tw:min-h-0 tw:flex-1 tw:overflow-auto tw:px-5 tw:py-5">
          <div className="tw:flex tw:items-start tw:gap-3">
            <span className="tw:grid tw:size-9 tw:shrink-0 tw:place-items-center tw:rounded-md tw:bg-muted tw:text-foreground">
              <Icon name="shield" className="tw:size-5" />
            </span>
            <div className="tw:min-w-0">
              <h2 className="tw:m-0 tw:text-title tw:text-foreground">
                {t("agentTools.startupHeading")}
              </h2>
              <p
                id="agent-startup-description"
                className="tw:mt-1 tw:mb-0 tw:text-ui tw:leading-body tw:text-muted-foreground"
              >
                {t("agentTools.startupBody")}
              </p>
            </div>
          </div>

          <div className="tw:mt-5 tw:divide-y tw:divide-border-subtle tw:rounded-md tw:border tw:border-border-subtle">
            {SUPPORTED_AGENT_TARGETS.map((agent) => {
              const id = pluginId(agent.target);
              const status = pluginsQ.data?.find((plugin) => plugin.pluginId === id);
              const cli = agentsQ.data?.find((item) => item.id === agent.provider);
              return (
                <div key={agent.target} className="tw:grid tw:gap-2 tw:px-3 tw:py-3">
                  <div className="tw:flex tw:min-h-8 tw:items-center tw:justify-between tw:gap-3 tw:@max-[520px]:items-start">
                    <CheckboxField
                      data-modal-initial-focus={
                        agent.target === SUPPORTED_AGENT_TARGETS[0].target
                          ? true
                          : undefined
                      }
                      checked={selected.includes(agent.target)}
                      disabled={busy !== null}
                      onChange={(event) =>
                        toggleTarget(agent.target, event.target.checked)
                      }
                      label={
                        <span className="tw:flex tw:items-center tw:gap-2">
                          <AgentProviderMark provider={agent.provider} />
                          <strong>{agent.label}</strong>
                        </span>
                      }
                    />
                    <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2">
                      {status ? (
                        <StatusBadge
                          tone={
                            status.state === "ready" || status.state === "staged"
                              ? "success"
                              : "warning"
                          }
                        >
                          {t(pluginStateLabel[status.state])}
                        </StatusBadge>
                      ) : null}
                      <AgentCliStatusBadges
                        cli={cli}
                        detecting={agentsQ.isPending || agentsQ.isFetching}
                        queryFailed={agentsQ.isError}
                      />
                    </div>
                  </div>
                  {busy === id ? (
                    <ProgressBar
                      value={null}
                      density="compact"
                      label={t("agentTools.pluginProgress", { provider: agent.label })}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          <AgentCliDetectionNotice
            clis={agentsQ.data}
            queryError={agentsQ.error}
            onRetry={() => void agentsQ.refetch()}
            retrying={agentsQ.isFetching}
          />

          <p className="tw:mt-4 tw:mb-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
            {t("agentTools.startupSafety")}
          </p>
          {error ? (
            <p className="tw:mt-3 tw:mb-0 tw:whitespace-pre-line tw:text-ui tw:leading-body tw:text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <ModalFooter>
          <Button variant="ghost" disabled={busy !== null} onClick={saveForLater}>
            {t("agentTools.startupLater")}
          </Button>
          <Button variant="primary" disabled={busy !== null} onClick={() => void installSelected()}>
            <Icon name="download" />
            {t(busy ? "agentTools.startupInstalling" : "agentTools.startupInstallSelected")}
          </Button>
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}
