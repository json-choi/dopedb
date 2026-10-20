// Presents provider credentials and workspace binding dialogs from dialog
// controller state.
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { ProviderCredentialDialog } from "../../features/providers/ProviderCredentialDialog";
import WorkspaceConnectionDialog from "../../features/workspaces/components/WorkspaceConnectionDialog";

export function ConnectionEditorDialogs({
  profile,
  dialogs,
  bindWorkspaceConnection,
}: {
  profile: ConnectionEditorController["profile"];
  dialogs: ConnectionEditorController["dialogs"];
  bindWorkspaceConnection: ConnectionEditorController["commands"]["bindWorkspaceConnection"];
}) {
  return (
    <>
      {dialogs.providerCredentials.open ? (
        <ProviderCredentialDialog
          initialProvider={
            dialogs.providerCredentials.open === "all"
              ? undefined
              : dialogs.providerCredentials.open
          }
          onClose={dialogs.providerCredentials.close}
          returnFocusRef={dialogs.providerCredentials.returnFocusRef}
        />
      ) : null}
      {dialogs.workspace.open && !profile.identity.isNew ? (
        <WorkspaceConnectionDialog
          connection={profile.form}
          onBound={bindWorkspaceConnection}
          onClose={() => dialogs.workspace.setOpen(false)}
          returnFocusRef={dialogs.workspace.buttonRef}
        />
      ) : null}
    </>
  );
}
