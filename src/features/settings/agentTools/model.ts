// Shared presentation vocabulary for the bounded Agent tool setup workflow.
// The settings screen consumes these values without owning provider or Skill state.
import type {
  AcpPluginId,
  AcpPluginInstallationState,
  AgentProvider,
} from "../../agents/domain";
import type {
  SkillConflictKind,
  SkillStatusReason,
  SkillTargetSelection,
} from "../../../ipc/types";
import type { I18nKey } from "../../../lib/i18n";

export type AgentToolsMutation = "repair" | "remove";

export type AgentToolsBusyAction =
  | SkillTargetSelection
  | AcpPluginId
  | "plugin-batch"
  | "plugin-check"
  | "self-test";

export interface AgentToolPluginDescriptor {
  id: AcpPluginId;
  provider: AgentProvider;
  label: string;
  download: string;
}

export const agentToolPlugins: readonly AgentToolPluginDescriptor[] = [
  {
    id: "dopedb.acp.claude",
    provider: "claude",
    label: "Claude",
    download: "≤ 30 MB",
  },
  {
    id: "dopedb.acp.codex",
    provider: "codex",
    label: "Codex",
    download: "≤ 30 MB",
  },
];

export const activePluginStates = new Set<AcpPluginInstallationState>([
  "checking",
  "downloading",
  "verifying",
  "removing",
]);

export const pluginStateLabel: Record<AcpPluginInstallationState, I18nKey> = {
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

export function pluginTone(state: AcpPluginInstallationState) {
  if (state === "ready" || state === "staged") return "success" as const;
  if (state === "failed" || state === "rollback_required") return "danger" as const;
  if (state === "not_installed") return "neutral" as const;
  return "warning" as const;
}

export const skillConflictLabel: Record<SkillConflictKind, I18nKey> = {
  invalid_provenance: "agentTools.conflictInvalidProvenance",
  missing: "agentTools.conflictMissing",
  modified: "agentTools.conflictModified",
  unexpected: "agentTools.conflictUnexpected",
};

export const skillReasonLabel: Record<SkillStatusReason, I18nKey> = {
  files_differ_from_managed_snapshot:
    "agentTools.reasonFilesDifferFromManagedSnapshot",
  install_path_inspection_failed:
    "agentTools.reasonInstallPathInspectionFailed",
  install_path_symlink: "agentTools.reasonInstallPathSymlink",
  install_root_not_directory: "agentTools.reasonInstallRootNotDirectory",
  install_target_not_directory: "agentTools.reasonInstallTargetNotDirectory",
  install_target_outside_home: "agentTools.reasonInstallTargetOutsideHome",
  install_target_symlink: "agentTools.reasonInstallTargetSymlink",
  installed_file_changed: "agentTools.reasonInstalledFileChanged",
  installed_file_too_large: "agentTools.reasonInstalledFileTooLarge",
  installed_skill_byte_limit: "agentTools.reasonInstalledSkillByteLimit",
  installed_skill_file_count_limit:
    "agentTools.reasonInstalledSkillFileCountLimit",
  installed_skill_nesting_limit:
    "agentTools.reasonInstalledSkillNestingLimit",
  installed_skill_non_unicode_path:
    "agentTools.reasonInstalledSkillNonUnicodePath",
  installed_skill_read_failed: "agentTools.reasonInstalledSkillReadFailed",
  installed_skill_symlink: "agentTools.reasonInstalledSkillSymlink",
  installed_skill_unsafe_path: "agentTools.reasonInstalledSkillUnsafePath",
  installed_skill_unsupported_file:
    "agentTools.reasonInstalledSkillUnsupportedFile",
  inventory_escaped_root: "agentTools.reasonInventoryEscapedRoot",
  provenance_marker_malformed:
    "agentTools.reasonProvenanceMarkerMalformed",
  provenance_marker_not_file: "agentTools.reasonProvenanceMarkerNotFile",
  provenance_marker_unreadable:
    "agentTools.reasonProvenanceMarkerUnreadable",
  unknown_managed_snapshot: "agentTools.reasonUnknownManagedSnapshot",
  unmanaged_files: "agentTools.reasonUnmanagedFiles",
  unsafe_path_component: "agentTools.reasonUnsafePathComponent",
};
