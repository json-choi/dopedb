// Composes the Connection editor's profile, catalog, schema, dialog, and
// command controllers into a grouped presentation model, and keeps the shell's
// entry and leave contract: credential recovery opens at the fix, and every
// route that replaces the editor first confirms unsaved edits.
import {
  useConnectionEditorLeaveGuard,
  useCredentialRecoveryEntry,
} from "./connectionEditorShellBridge";
import type { ConnectionProfile } from "./domain";
import type { ConnectionLaunchPreset } from "./presets";
import { useBigQueryOnboardingController } from "./useBigQueryOnboardingController";
import { useConnectionCatalogController } from "./useConnectionCatalogController";
import { useCloudflareD1OnboardingController } from "./useCloudflareD1OnboardingController";
import { useConnectionEditorDialogs } from "./useConnectionEditorDialogs";
import { useConnectionProfileController } from "./useConnectionProfileController";
import { useConnectionProfileState } from "./useConnectionProfileState";
import { useConnectionSchemaController } from "./useConnectionSchemaController";

export type { ConnectionInputMode } from "./connectionEditorModel";

export type ConnectionEditorProps = {
  initial: ConnectionProfile | null;
  preset: ConnectionLaunchPreset | null;
  /**
   * Opened to recover a credential this device no longer holds: a local profile
   * focuses its password field, a shared member-local one opens its binding.
   */
  initialFocus?: "credentials";
  connections: ConnectionProfile[];
  creatingDemo: boolean;
  onCreateDemoDatabase: () => void;
  onNewConnection: (preset?: ConnectionLaunchPreset) => void;
  onEditConnection: (connection: ConnectionProfile) => void;
  onDeletedConnection: (id: string) => Promise<void>;
  onSaved: (
    profile: ConnectionProfile,
    closeEditor: boolean,
  ) => Promise<void>;
  onCancel: () => void;
};

export function useConnectionEditorController(props: ConnectionEditorProps) {
  const profileState = useConnectionProfileState({
    initial: props.initial,
    preset: props.preset,
  });
  const dialogState = useConnectionEditorDialogs();
  // Opening another draft replaces this editor, so unsaved edits are confirmed
  // before every route that leaves it. The shell asks the same guard before
  // Settings or Workspace management replace the editor.
  const leave = profileState.changes.guardDiscard;
  useConnectionEditorLeaveGuard(leave);
  useCredentialRecoveryEntry(
    props.initialFocus === "credentials" && props.initial !== null,
    profileState,
    dialogState.workspace,
  );
  const editConnection = (connection: ConnectionProfile) =>
    leave(() => props.onEditConnection(connection));
  const newConnection = (preset?: ConnectionLaunchPreset) =>
    leave(() => props.onNewConnection(preset));
  const catalog = useConnectionCatalogController({
    connections: props.connections,
    onNewConnection: newConnection,
    openProviderCredentials: dialogState.providerCredentials.show,
    profileState,
    selectSourceOnOpen: props.initial === null && !props.preset?.engine,
  });
  const bigQuery = useBigQueryOnboardingController(
    profileState,
    catalog.view.drivers.active?.installState === "installed",
  );
  const cloudflareD1 = useCloudflareD1OnboardingController(
    profileState,
    catalog.view.drivers.active?.installState === "installed",
  );
  const schema = useConnectionSchemaController(profileState);
  const profileController = useConnectionProfileController({
    connections: props.connections,
    onDeletedConnection: props.onDeletedConnection,
    onSaved: props.onSaved,
    projectEnvironmentId: props.preset?.projectEnvironmentId,
    onCancel: props.onCancel,
    profileState,
    catalog,
    dialogs: dialogState,
    bigQuery,
    cloudflareD1,
  });

  return {
    profile: profileController.view,
    catalog: catalog.view,
    navigation: { editConnection, newConnection },
    schema,
    dialogs: {
      providerCredentials: dialogState.providerCredentials,
      workspace: dialogState.workspace,
      problems: {
        ...dialogState.problems,
        ...profileController.problems,
      },
    },
    commands: profileController.commands,
  };
}

export type ConnectionEditorController = ReturnType<
  typeof useConnectionEditorController
>;
