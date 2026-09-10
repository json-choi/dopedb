import type { StatusTone } from "../../design-system/components/Status";
import type { IconName } from "../../components/Icon";
import type { SkillInstallState } from "../../ipc/types";
import type { I18nKey } from "../../lib/i18n";

export const skillStateLabel: Record<SkillInstallState, I18nKey> = {
  missing: "agentTools.stateMissing",
  managed_current: "agentTools.stateManagedCurrent",
  managed_older: "agentTools.stateManagedOlder",
  user_modified: "agentTools.stateUserModified",
  newer_known: "agentTools.stateNewerKnown",
  unknown_conflict: "agentTools.stateUnknownConflict",
  invalid: "agentTools.stateInvalid",
};

export function skillStateTone(state: SkillInstallState): StatusTone {
  if (state === "managed_current" || state === "newer_known") {
    return "success";
  }
  if (state === "missing" || state === "managed_older") {
    return "warning";
  }
  return "danger";
}

export function skillStateIndicator(state: SkillInstallState): IconName {
  if (state === "managed_current" || state === "newer_known") return "check";
  if (state === "missing") return "download";
  if (state === "managed_older") return "refresh";
  return "alert";
}
