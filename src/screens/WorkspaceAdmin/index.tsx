// Workspace management dialog for the active team workspace, opened from the workspace
// menu, Action Search, the data source catalog or connection recovery instead of the
// application Settings. The shell route owns the active section, so a request that
// arrives while the dialog is open moves it too, and an "account" request from a panel
// replaces the dialog with Settings → Account. It lists only the sections the
// signed-in member's role can run and closes itself when that authority disappears.
import { Fragment, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  SectionDialog,
  type SectionDialogEntry,
} from "../../design-system/components/SectionDialog";
import ConnectionAccessPanel from "../../features/workspaceAdmin/access/ConnectionAccessPanel";
import LifecyclePanel from "../../features/workspaceAdmin/lifecycle/LifecyclePanel";
import MembersPanel from "../../features/workspaceAdmin/members/MembersPanel";
import ProvidersPanel from "../../features/workspaceAdmin/providers/ProvidersPanel";
import { useWorkspaceAdminScope } from "../../features/workspaceAdmin/scope";
import {
  workspaceAdminSectionsFor,
  type WorkspaceAdminDestination,
  type WorkspaceAdminSection,
} from "../../features/workspaceAdmin/sections";
import {
  workspaceAuthStateQuery,
  workspaceContextQuery,
} from "../../features/workspaces/queries";
import { useI18n } from "../../lib/i18n";

type Group = "workspace";

export default function WorkspaceAdmin({
  section,
  onNavigate,
  onClose,
}: {
  /** Requested section; an unavailable one shows the first section the role can run. */
  section: WorkspaceAdminSection;
  /** Moves to another section, or to Settings → Account for "account". */
  onNavigate: (destination: WorkspaceAdminDestination) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const auth = useQuery(workspaceAuthStateQuery());
  const workspaceContext = useQuery(workspaceContextQuery());
  const scope = useWorkspaceAdminScope();
  const scopeResolved = auth.data !== undefined && workspaceContext.data !== undefined;

  const entries = useMemo(
    () =>
      workspaceAdminSectionsFor(scope).map(
        (section): SectionDialogEntry<WorkspaceAdminSection, Group> => ({
          id: section.id,
          label: t(section.label),
          group: "workspace",
          keywords: section.keywords,
        }),
      ),
    [scope, t],
  );

  // A role change, workspace switch or scheduled deletion can remove this authority
  // while the dialog is open; nothing remains to manage, so the dialog closes.
  useEffect(() => {
    if (scopeResolved && entries.length === 0) onClose();
  }, [entries.length, onClose, scopeResolved]);

  const active = entries.some((entry) => entry.id === section) ? section : entries[0]?.id;
  if (!scope?.canManage || !active) return null;

  return (
    <SectionDialog
      title={t("workspaceAdmin.dialogTitle")}
      titleId="workspace-admin-dialog-title"
      groups={[{ id: "workspace", label: `${t("workspaceAdmin.scope")} · ${scope.workspaceName}` }]}
      entries={entries}
      active={active}
      onSelect={onNavigate}
      onClose={onClose}
      doneLabel={t("common.done")}
      selectLabel={t("workspaceAdmin.dialogTitle")}
    >
      <Fragment key={`${scope.accountId}:${scope.workspaceId}`}>
        {active === "workspace-members" && <MembersPanel scope={scope} onNavigate={onNavigate} />}
        {active === "workspace-access" && (
          <ConnectionAccessPanel scope={scope} onNavigate={onNavigate} />
        )}
        {active === "workspace-providers" && (
          <ProvidersPanel scope={scope} onNavigate={onNavigate} />
        )}
        {active === "workspace-lifecycle" && scope.isOwner && (
          <LifecyclePanel scope={scope} onNavigate={onNavigate} />
        )}
      </Fragment>
    </SectionDialog>
  );
}
