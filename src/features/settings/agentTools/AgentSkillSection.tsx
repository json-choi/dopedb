// Renders Skill inventory, conflicts, and explicit install/repair/remove actions.
import ConfirmButton from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import InfoTip from "../../../components/InfoTip";
import Skeleton from "../../../components/Skeleton";
import { AgentProviderMark } from "../../../design-system/components/Agent";
import { Button } from "../../../design-system/components/Button";
import {
  SettingsList,
  SettingsRow,
  SettingsSectionHeader,
} from "../../../design-system/components/SettingsList";
import { StatusIndicator } from "../../../design-system/components/Status";
import { errMessage } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import {
  skillStateLabel,
  skillStateIndicator,
  skillStateTone,
} from "../../skills/presentation";
import { skillConflictLabel, skillReasonLabel } from "./model";
import type { AgentToolsController } from "./useAgentToolsController";

interface AgentSkillSectionProps {
  controller: AgentToolsController;
}

export function AgentSkillSection({ controller }: AgentSkillSectionProps) {
  const { t } = useI18n();
  const {
    busy,
    error,
    status,
    statusQuery,
    runInstall,
    runMutation,
  } = controller;

  return (
    <>
      <section className="tw:mt-3">
        <SettingsSectionHeader
          title={t("agentTools.skillTitle")}
          info={<InfoTip label={t("agentTools.skillDescription")} />}
          trailing={status ? (
            <span className="tw:font-mono tw:text-xs tw:text-muted-foreground">
              {t("agentTools.version", {
                version: status.skill.appVersion,
                revision: status.skill.releaseRevision,
              })}
            </span>
          ) : undefined}
        />
      </section>

      {error || statusQuery.error ? (
        <div className="tw:text-ui tw:text-danger" role="alert">
          {t("agentTools.error", {
            error: error ?? errMessage(statusQuery.error),
          })}
        </div>
      ) : null}
      {!status && statusQuery.isPending ? (
        <Skeleton lines={6} />
      ) : status ? (
        <SettingsList>
          {status.targets.map((target) => {
            const canInstall =
              target.state === "missing" || target.state === "managed_older";
            const canRepair =
              target.repairable &&
              [
                "user_modified",
                "newer_known",
                "unknown_conflict",
                "invalid",
              ].includes(target.state);
            const canRemove = [
              "managed_current",
              "managed_older",
              "newer_known",
            ].includes(target.state);
            return (
              <SettingsRow
                key={target.target}
                identity={
                  <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:pl-6">
                    <AgentProviderMark
                      provider={target.target === "codex" ? "codex" : "claude"}
                    />
                    <h3 className="tw:m-0 tw:text-title tw:leading-ui tw:font-bold tw:tracking-normal tw:text-foreground tw:normal-case">
                      {target.displayName}
                    </h3>
                  </div>
                }
                details={
                  <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                    <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                      <StatusIndicator
                        tone={skillStateTone(target.state)}
                        icon={skillStateIndicator(target.state)}
                        label={t(skillStateLabel[target.state])}
                      />
                      <Icon name="folder" className="tw:shrink-0 tw:text-muted-foreground" />
                      <span className="tw:sr-only">{t("agentTools.path")}</span>
                      <code
                        className="tw:min-w-0 tw:truncate tw:text-xs tw:text-muted-foreground"
                        title={target.installPath}
                      >
                        {target.installPath}
                      </code>
                    </div>
                    <span className="tw:h-4 tw:w-px tw:shrink-0 tw:bg-border-subtle" />
                    <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-1.5 tw:text-xs tw:text-muted-foreground">
                      <Icon name="branch" className="tw:shrink-0" />
                      <span className="tw:sr-only">{t("agentTools.currentRevision")}</span>
                      <span
                        className="tw:min-w-0 tw:truncate tw:font-mono"
                        title={String(target.currentRevision)}
                      >
                        {target.installedRevision !== null
                          ? `${target.installedRevision} → ${target.currentRevision}`
                          : target.currentRevision}
                      </span>
                    </div>
                  </div>
                }
                actions={
                  canInstall || canRepair || canRemove ? (
                    <>
                      {canInstall ? (
                        <Button
                          iconOnly
                          size="compact"
                          disabled={busy !== null}
                          onClick={() => void runInstall(target.target)}
                          title={t(
                            target.state === "managed_older"
                              ? "agentTools.update"
                              : "agentTools.install",
                          )}
                        >
                          <Icon
                            name={
                              target.state === "managed_older"
                                ? "refresh"
                                : "download"
                            }
                          />
                        </Button>
                      ) : null}
                      {canRepair ? (
                        <ConfirmButton
                          iconOnly
                          label={t("agentTools.repair")}
                          size="compact"
                          disabled={busy !== null}
                          confirmLabel={t("agentTools.repairConfirm", {
                            count: target.conflicts.length,
                          })}
                          onConfirm={() =>
                            void runMutation("repair", target.target)
                          }
                        >
                          <Icon name="refresh" />
                        </ConfirmButton>
                      ) : null}
                      {canRemove ? (
                        <ConfirmButton
                          iconOnly
                          label={t("agentTools.remove")}
                          size="compact"
                          tone="danger"
                          disabled={busy !== null}
                          confirmLabel={t("agentTools.removeConfirm")}
                          onConfirm={() =>
                            void runMutation("remove", target.target)
                          }
                        >
                          <Icon name="trash" />
                        </ConfirmButton>
                      ) : null}
                    </>
                  ) : undefined
                }
              >
                {target.reason ? (
                  <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
                    {t(skillReasonLabel[target.reason])}
                  </p>
                ) : null}
                {target.conflicts.length > 0 ? (
                  <div className="tw:mt-1 tw:grid tw:gap-1">
                    <p className="tw:m-0 tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:font-semibold tw:text-danger">
                      <Icon name="alert" />
                      {t("agentTools.conflicts", {
                        count: target.conflicts.length,
                      })}
                    </p>
                    {target.conflicts.map((conflict) => (
                      <p
                        className="tw:m-0 tw:flex tw:min-w-0 tw:items-baseline tw:gap-2 tw:text-xs tw:text-muted-foreground"
                        key={`${conflict.kind}:${conflict.path}`}
                      >
                        <span>{t(skillConflictLabel[conflict.kind])}</span>
                        <code className="tw:[overflow-wrap:anywhere]">
                          {conflict.path}
                        </code>
                      </p>
                    ))}
                  </div>
                ) : null}
              </SettingsRow>
            );
          })}
        </SettingsList>
      ) : null}
    </>
  );
}
