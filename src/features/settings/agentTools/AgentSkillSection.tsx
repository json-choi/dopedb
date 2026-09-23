// Shows the optional external-Agent Skill for one provider inside its setup row.
import ConfirmButton from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { Button } from "../../../design-system/components/Button";
import { StatusIndicator } from "../../../design-system/components/Status";
import type { SkillTarget } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import {
  skillStateIndicator,
  skillStateLabel,
  skillStateTone,
} from "../../skills/presentation";
import { skillConflictLabel, skillReasonLabel } from "./model";
import type { AgentToolsController } from "./useAgentToolsController";

export function AgentSkillSection({
  controller,
  target,
}: {
  controller: AgentToolsController;
  target: SkillTarget;
}) {
  const { t } = useI18n();
  const { busy, status, runInstall, runMutation } = controller;
  const skill = status?.targets.find((entry) => entry.target === target);
  if (!skill) return null;

  const canInstall = skill.state === "missing" || skill.state === "managed_older";
  const canRepair = skill.repairable && [
    "user_modified", "newer_known", "unknown_conflict", "invalid",
  ].includes(skill.state);
  const canRemove = ["managed_current", "managed_older", "newer_known"].includes(skill.state);

  return (
    <div className="tw:grid tw:gap-2 tw:border-t tw:border-border-subtle tw:pt-3">
      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
        <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
          <strong className="tw:text-ui">{t("agentTools.externalSkill")}</strong>
          <StatusIndicator
            tone={skillStateTone(skill.state)}
            icon={skillStateIndicator(skill.state)}
            label={t(skillStateLabel[skill.state])}
          />
        </div>
        <div className="tw:flex tw:items-center tw:gap-2">
          {canInstall ? (
            <Button size="compact" disabled={busy !== null} onClick={() => void runInstall(target)}>
              {t(skill.state === "managed_older" ? "agentTools.update" : "agentTools.install")}
            </Button>
          ) : null}
          {canRepair ? (
            <ConfirmButton
              size="compact"
              disabled={busy !== null}
              label={t("agentTools.repair")}
              confirmLabel={t("agentTools.repairConfirm", { count: skill.conflicts.length })}
              onConfirm={() => void runMutation("repair", target)}
            >
              <Icon name="refresh" />
              {t("agentTools.repair")}
            </ConfirmButton>
          ) : null}
          {canRemove ? (
            <ConfirmButton
              iconOnly
              size="compact"
              tone="danger"
              disabled={busy !== null}
              label={t("agentTools.remove")}
              confirmLabel={t("agentTools.removeConfirm")}
              onConfirm={() => void runMutation("remove", target)}
            >
              <Icon name="trash" />
            </ConfirmButton>
          ) : null}
        </div>
      </div>
      <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
        {t("agentTools.externalSkillDescription")}
      </p>
      <code className="tw:truncate tw:text-xs tw:text-muted-foreground" title={skill.installPath}>
        {skill.installPath}
      </code>
      {skill.reason ? (
        <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">{t(skillReasonLabel[skill.reason])}</p>
      ) : null}
      {skill.conflicts.map((conflict) => (
        <p className="tw:m-0 tw:text-xs tw:text-danger" key={`${conflict.kind}:${conflict.path}`}>
          {t(skillConflictLabel[conflict.kind])}: <code className="tw:[overflow-wrap:anywhere]">{conflict.path}</code>
        </p>
      ))}
    </div>
  );
}
