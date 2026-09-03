import { Icon, type IconName } from "../../components/Icon";
import ToolbarMenu from "../../components/ToolbarMenu";
import { Button } from "../../design-system/components/Button";
import { ProgressBar } from "../../design-system/components/Progress";
import { StatusDot, type StatusTone } from "../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../lib/i18n";
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

function taskIcon(task: BackgroundTask): IconName {
  if (task.kind === "agent") return "user";
  if (task.kind === "query") return "terminal";
  return task.operation === "import" ? "download" : "upload";
}

function taskTone(status: BackgroundTaskStatus): StatusTone {
  if (
    status === "waitingApproval" ||
    status === "waitingPermission" ||
    status === "paused" ||
    status === "pausing"
  ) {
    return "warning";
  }
  return "neutral";
}

export default function BackgroundTasksMenu({
  tasks,
  cancellingKeys,
  onCancel,
  onOpenAgent,
  onOpenQuery,
}: {
  tasks: BackgroundTask[];
  cancellingKeys: ReadonlySet<string>;
  onCancel: (task: BackgroundTask) => Promise<void>;
  onOpenAgent: (connectionId: string) => void;
  onOpenQuery: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const label = t("ide.backgroundProcesses", { count: tasks.length });
  const hasRunningTask = tasks.some(
    (task) =>
      task.status === "running" ||
      task.status === "starting" ||
      task.status === "pausing" ||
      task.status === "cancelling",
  );

  return (
    <ToolbarMenu
      align="end"
      label={label}
      menuSize="tasks"
      triggerVariant="statusBar"
      trigger={
        <>
          <Icon
            name="refresh"
            className={
              hasRunningTask
                ? "tw:animate-spin tw:motion-reduce:animate-none"
                : undefined
            }
          />
          <span className="tw:tabular-nums">{tasks.length}</span>
        </>
      }
    >
      <div
        role="presentation"
        className="tw:flex tw:min-h-control-md tw:items-center tw:justify-between tw:gap-3 tw:border-b tw:border-border-subtle tw:px-2 tw:pb-2 tw:text-ui"
      >
        <strong className="tw:text-foreground">
          {t("ide.backgroundTask.title")}
        </strong>
        <span className="tw:text-xs tw:text-muted-foreground">{label}</span>
      </div>
      <div role="presentation" className="tw:grid">
        {tasks.map((task) => {
          const cancelling = cancellingKeys.has(task.key);
          const canOpen = task.kind === "agent" || task.kind === "query";
          const context = `${task.connectionName} · ${t(STATUS_KEYS[task.status])}${
            task.rowsProcessed !== null
              ? ` · ${t("ide.backgroundTask.rows", {
                  count: task.rowsProcessed.toLocaleString(),
                })}`
              : ""
          }`;
          return (
            <div
              key={task.key}
              role="group"
              aria-label={task.title}
              className="tw:grid tw:min-w-0 tw:gap-2 tw:border-b tw:border-border-subtle tw:px-2 tw:py-2 tw:last:border-b-0"
            >
              <div className="tw:flex tw:min-w-0 tw:items-start tw:gap-2">
                <Icon
                  name={taskIcon(task)}
                  className="tw:mt-0.5 tw:shrink-0 tw:text-muted-foreground"
                />
                <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-1">
                  <strong className="tw:truncate tw:text-ui tw:text-foreground">
                    {task.title}
                  </strong>
                  <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-1.5 tw:text-xs tw:text-muted-foreground">
                    <StatusDot tone={taskTone(task.status)} />
                    <span className="tw:truncate">{context}</span>
                  </span>
                </span>
              </div>
              {task.progress !== null ? (
                <ProgressBar
                  density="compact"
                  value={task.progress}
                  label={t("ide.backgroundTask.progress", {
                    count: task.progress.toFixed(0),
                  })}
                />
              ) : null}
              {canOpen || task.cancellable ? (
                <div
                  role="presentation"
                  className="tw:flex tw:justify-end tw:gap-1"
                >
                  {task.kind === "query" ? (
                    <Button
                      role="menuitem"
                      size="xs"
                      variant="ghost"
                      onClick={() => onOpenQuery(task.sessionId)}
                    >
                      <Icon name="externalLink" />
                      {t("ide.backgroundTask.open")}
                    </Button>
                  ) : task.kind === "agent" ? (
                    <Button
                      role="menuitem"
                      size="xs"
                      variant="ghost"
                      onClick={() => onOpenAgent(task.connectionId)}
                    >
                      <Icon name="externalLink" />
                      {t("ide.backgroundTask.open")}
                    </Button>
                  ) : null}
                  {task.cancellable ? (
                    <Button
                      role="menuitem"
                      size="xs"
                      variant="dangerGhost"
                      disabled={cancelling}
                      onClick={() => void onCancel(task)}
                    >
                      <Icon name="stop" />
                      {cancelling
                        ? t("ide.backgroundTask.stopping")
                        : t("ide.backgroundTask.stop")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </ToolbarMenu>
  );
}
