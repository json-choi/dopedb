import type {
  SkillInstallState,
  SkillTarget,
} from "../../ipc/generated/protocol-contracts";

export type SkillSetupAction =
  | "install"
  | "update"
  | "install-and-update"
  | "none"
  | "attention";

export interface SkillSetupTargetStatus {
  target: SkillTarget;
  displayName: string;
  state: SkillInstallState;
  currentRevision: number;
  installedRevision: number | null;
  inventoryFingerprint: string;
}

export interface SkillSetupPlan {
  action: SkillSetupAction;
  selection: SkillTarget | "all" | null;
  targets: SkillSetupTargetStatus[];
  attentionTargets: SkillSetupTargetStatus[];
}

const actionableStates = new Set<SkillInstallState>([
  "missing",
  "managed_older",
]);

export function buildSkillSetupPlan(
  targets: readonly SkillSetupTargetStatus[],
): SkillSetupPlan {
  const actionable = targets.filter((target) =>
    actionableStates.has(target.state),
  );
  const attentionTargets = targets.filter(
    (target) =>
      target.state !== "missing" &&
      target.state !== "managed_current" &&
      target.state !== "managed_older",
  );

  if (actionable.length === 0) {
    return {
      action: attentionTargets.length > 0 ? "attention" : "none",
      selection: null,
      targets: [],
      attentionTargets,
    };
  }

  const targetIds = new Set(actionable.map((target) => target.target));
  const selection =
    targetIds.has("codex") && targetIds.has("claude-code")
      ? "all"
      : actionable[0].target;
  const hasMissing = actionable.some((target) => target.state === "missing");
  const hasOlder = actionable.some(
    (target) => target.state === "managed_older",
  );
  const action =
    hasMissing && hasOlder
      ? "install-and-update"
      : hasOlder
        ? "update"
        : "install";

  return {
    action,
    selection,
    targets: actionable,
    attentionTargets,
  };
}
