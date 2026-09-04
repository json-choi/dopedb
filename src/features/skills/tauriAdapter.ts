// Local CLI and managed Skill inventory command ownership. Provider credentials
// never enter these calls; installed files are verified by the Rust boundary.
import { invoke } from "../../ipc/core";
import type {
  CliInstallReceipt,
  CliInstallationStatus,
  SkillMutationReceipt,
  SkillSelfTestReceipt,
  SkillStatus,
  SkillTargetExpectation,
  SkillTargetSelection,
} from "../../ipc/types";

export function cliInstallationStatus(): Promise<CliInstallationStatus> {
  return invoke("cli_installation_status");
}

export function installCli(
  updatePath: boolean,
  replaceExisting: boolean,
): Promise<CliInstallReceipt> {
  return invoke("install_cli", { updatePath, replaceExisting });
}

export function skillStatus(target: SkillTargetSelection): Promise<SkillStatus> {
  return invoke("skill_status", { target });
}

export function installSkill(
  target: SkillTargetSelection,
  expected: SkillTargetExpectation[],
): Promise<SkillMutationReceipt> {
  return invoke("install_skill", { target, expected });
}

export function repairSkill(
  target: SkillTargetSelection,
  expected: SkillTargetExpectation[],
): Promise<SkillMutationReceipt> {
  return invoke("repair_skill", { target, expected });
}

export function removeSkill(
  target: SkillTargetSelection,
  expected: SkillTargetExpectation[],
): Promise<SkillMutationReceipt> {
  return invoke("remove_skill", { target, expected });
}

export function skillSelfTest(): Promise<SkillSelfTestReceipt> {
  return invoke("skill_self_test");
}
