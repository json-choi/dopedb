// The one task-status vocabulary for background work: status key to the label
// the status bar and its task menu show. Owns no state.
import type { I18nKey } from "../../lib/i18n";
import type { BackgroundTask, BackgroundTaskStatus } from "./domain";

const STATUS_KEYS: Record<BackgroundTaskStatus, I18nKey> = {
  cancelling: "ide.backgroundTask.status.cancelling",
  paused: "ide.backgroundTask.status.paused",
  pausing: "ide.backgroundTask.status.pausing",
  running: "ide.backgroundTask.status.running",
  starting: "ide.backgroundTask.status.starting",
  waitingApproval: "ide.backgroundTask.status.waitingApproval",
  waitingPermission: "ide.backgroundTask.status.waitingPermission",
};

export function backgroundTaskStatusKey(task: BackgroundTask): I18nKey {
  return task.kind === "agentApproval"
    ? "ide.backgroundTask.status.agentApproval"
    : STATUS_KEYS[task.status];
}
