// Active workspace/project menu for the title toolbar. Workspace changes clear cached
// resource reads before the shell reloads the newly selected account scope; creating a
// workspace and opening workspace administration start from the same menu.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { setActiveWorkspace } from "../tauriAdapter";
import {
  runWorkspaceAuthorityTransition,
  synchronizeWorkspaceScope,
} from "../cache";
import type { AccountId, WorkspaceId } from "../domain";
import { workspaceAuthStateQuery, workspaceContextQuery } from "../queries";
import { onWorkspaceSelectionRequested } from "../selectionRequest";
import {
  buildWorkspaceChoiceGroups,
  parseWorkspaceChoice,
  workspaceChoiceValue,
} from "../choices";
import CreateWorkspaceDialog from "../../workspaceAdmin/workspaces/CreateWorkspaceDialog";
import { requestWorkspaceAdmin } from "../../workspaceAdmin/navigationRequest";
import { useWorkspaceAdminScope } from "../../workspaceAdmin/scope";
import { errMessage } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import { Icon } from "../../../components/Icon";
import { useToast } from "../../../components/Toast";
import { DopeDBMark } from "../../../design-system/components/DopeDBMark";
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
  const adminScope = useWorkspaceAdminScope();
  const [switching, setSwitching] = useState(false);
  // The account that opened "New workspace"; the dialog closes if it stops being active.
  const [creatingFor, setCreatingFor] = useState<AccountId | null>(null);
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
  const signedInUser = auth.data?.user ?? null;
  const signedInUserId = signedInUser?.id ?? null;
  useEffect(() => {
    if (creatingFor !== null && signedInUserId !== creatingFor) setCreatingFor(null);
  }, [creatingFor, signedInUserId]);

  async function switchWorkspace(id: WorkspaceId, accountUserId: AccountId | undefined) {
    await runWorkspaceAuthorityTransition(
      queryClient,
      () => setActiveWorkspace(id, accountUserId),
      async () => {
        await synchronizeWorkspaceScope(queryClient);
        await onChanged();
      },
    );
  }

  async function changeWorkspace(value: string) {
    if (!context.data?.feature.enabled) return;
    const choice = parseWorkspaceChoice(value);
    if (!choice || value === activeChoice || switching) return;
    setSwitching(true);
    try {
      await switchWorkspace(
        choice.workspaceId,
        choice.accountUserId ?? auth.data?.user?.id,
      );
    } catch (error) {
      toast(t("workspace.switchFailed", { error: errMessage(error) }), "error");
    } finally {
      setSwitching(false);
    }
  }

  const activeLabel =
    context.data?.active.kind === "team"
      ? context.data.active.name
      : t("workspace.personalName");

  return (
    <>
      <ToolbarMenu
        align="start"
        label={t("workspace.select")}
        disabled={context.isLoading || switching}
        openRequest={openRequest}
        trigger={
          <>
            <span className="tw:grid tw:size-5 tw:shrink-0 tw:place-items-center tw:rounded-xs tw:bg-secondary tw:text-foreground">
              <DopeDBMark size="compact" />
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
        {/* Both commands open surfaces outside this menu, so selection closes the menu
            first and the opened dialog returns focus to the menu trigger. */}
        {context.data?.feature.enabled && signedInUser ? (
          <ToolbarMenuItem
            icon="folderPlus"
            onClick={() => setCreatingFor(signedInUser.id)}
          >
            {t("workspaceAdmin.newWorkspace")}
          </ToolbarMenuItem>
        ) : null}
        {adminScope?.canManage ? (
          <ToolbarMenuItem
            icon="gear"
            onClick={() => requestWorkspaceAdmin("workspace-members")}
          >
            {t("workspaceAdmin.manage")}
          </ToolbarMenuItem>
        ) : null}
      </ToolbarMenu>
      {creatingFor !== null && signedInUserId === creatingFor ? (
        <CreateWorkspaceDialog
          accountId={creatingFor}
          onSwitch={(id) => switchWorkspace(id, creatingFor)}
          onClose={() => setCreatingFor(null)}
        />
      ) : null}
    </>
  );
}
