// Active workspace/project menu for the title toolbar. Workspace changes clear cached
// resource reads before the shell reloads the newly selected account scope.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  setActiveWorkspace,
  workspaceConsoleUrl,
} from "../tauriAdapter";
import {
  fetchWorkspaceContext,
  invalidateWorkspaceAuth,
  runWorkspaceAuthorityTransition,
} from "../cache";
import { workspaceAuthStateQuery, workspaceContextQuery } from "../queries";
import { onWorkspaceSelectionRequested } from "../selectionRequest";
import {
  buildWorkspaceChoiceGroups,
  parseWorkspaceChoice,
  workspaceChoiceValue,
} from "../choices";
import { errMessage } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import { Icon } from "../../../components/Icon";
import { useToast } from "../../../components/Toast";
import ToolbarMenu, {
  ToolbarMenuItem,
} from "../../../components/ToolbarMenu";

export default function WorkspaceSwitcher({
  onChanged,
  onNew,
}: {
  onChanged: () => void | Promise<void>;
  onNew: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const context = useQuery(workspaceContextQuery());
  const auth = useQuery(workspaceAuthStateQuery());
  const [switching, setSwitching] = useState(false);
  const [dashboardOpening, setDashboardOpening] = useState(false);
  const [openRequest, setOpenRequest] = useState(0);
  useEffect(
    () => onWorkspaceSelectionRequested(() => setOpenRequest((value) => value + 1)),
    [],
  );
  const roleLabels = {
    viewer: t("workspace.accessView"),
    analyst: t("workspace.accessRead"),
    editor: t("workspace.accessWrite"),
    admin: t("workspace.accessManage"),
    owner: t("workspace.accessManage"),
  } as const;
  const choiceGroups = useMemo(
    () => buildWorkspaceChoiceGroups(
      auth.data,
      context.data?.workspaces ?? [],
      t("workspace.localOnly"),
    ),
    [auth.data, context.data?.workspaces, t],
  );
  const activeChoice = context.data
    ? workspaceChoiceValue(
        context.data.active.id,
        context.data.active.kind === "team" ? (auth.data?.user?.id ?? null) : null,
      )
    : "";

  async function changeWorkspace(value: string) {
    if (!context.data?.feature.enabled) return;
    const choice = parseWorkspaceChoice(value);
    if (!choice || value === activeChoice || switching) return;
    const accountUserId = choice.accountUserId ?? auth.data?.user?.id;
    setSwitching(true);
    try {
      await runWorkspaceAuthorityTransition(
        queryClient,
        () => setActiveWorkspace(choice.workspaceId, accountUserId),
        async () => {
          await invalidateWorkspaceAuth(queryClient);
          await fetchWorkspaceContext(queryClient);
          await onChanged();
        },
      );
    } catch (error) {
      toast(t("workspace.switchFailed", { error: errMessage(error) }), "error");
    } finally {
      setSwitching(false);
    }
  }

  async function openDashboard() {
    if (!context.data?.feature.enabled || dashboardOpening) return;
    setDashboardOpening(true);
    try {
      const { active } = context.data;
      const url = await workspaceConsoleUrl(active.kind === "team" ? active.id : undefined);
      await openUrl(url);
    } catch (error) {
      toast(t("workspace.dashboardOpenFailed", { error: errMessage(error) }), "error");
    } finally {
      setDashboardOpening(false);
    }
  }

  const dashboardLabel =
    context.data?.active.kind === "team"
      ? t("workspace.openDashboardFor", { name: context.data.active.name })
      : t("workspace.openDashboard");
  const activeLabel =
    context.data?.active.kind === "team"
      ? context.data.active.name
      : t("workspace.personalName");

  return (
    <ToolbarMenu
      align="start"
      label={t("workspace.select")}
      disabled={context.isLoading || switching}
      openRequest={openRequest}
      trigger={
        <>
          <span className="tw:grid tw:size-5 tw:shrink-0 tw:place-items-center tw:rounded-xs tw:bg-secondary tw:font-mono tw:text-xs tw:font-bold tw:text-foreground">
            D
          </span>
          <span className="tw:max-w-[170px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
            {activeLabel}
          </span>
          <Icon
            name="chevronDown"
            className="tw:shrink-0 tw:text-xs tw:text-muted-foreground"
          />
        </>
      }
    >
      {choiceGroups.map((group) => (
        <div key={group.key} role="presentation">
          <p className="tw:m-0 tw:px-2 tw:pt-2 tw:pb-1 tw:text-2xs tw:font-semibold tw:tracking-[0.04em] tw:text-muted-foreground tw:uppercase">
            {group.label}
          </p>
          {group.choices.map((choice) => {
            const active = choice.value === activeChoice;
            const label =
              choice.workspace.kind === "personal"
                ? t("workspace.personalName")
                : choice.workspace.name;
            return (
              <ToolbarMenuItem
                key={choice.value}
                icon={active ? "check" : "folder"}
                role="menuitemradio"
                aria-checked={active}
                disabled={switching || auth.data === undefined}
                onClick={() => void changeWorkspace(choice.value)}
              >
                <span className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:justify-between tw:gap-4">
                  <span className="tw:truncate">{label}</span>
                  {choice.role ? (
                    <span className="tw:text-2xs tw:text-muted-foreground">
                      {roleLabels[choice.role]}
                    </span>
                  ) : null}
                </span>
              </ToolbarMenuItem>
            );
          })}
        </div>
      ))}
      <div
        className="tw:my-1 tw:h-px tw:bg-border-subtle"
        role="separator"
      />
      <ToolbarMenuItem icon="plus" onClick={() => onNew()}>
        {t("connections.new")}
      </ToolbarMenuItem>
      <ToolbarMenuItem
        icon="externalLink"
        onClick={() => void openDashboard()}
        disabled={!context.data?.feature.enabled || dashboardOpening}
        aria-busy={dashboardOpening}
      >
        {dashboardLabel}
      </ToolbarMenuItem>
    </ToolbarMenu>
  );
}
