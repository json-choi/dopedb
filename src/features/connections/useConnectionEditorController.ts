// Composes the Connection editor's profile, catalog, schema, dialog, and
// command controllers into a grouped presentation model.
import type { ConnectionProfile } from "./domain";
import type { ConnectionLaunchPreset } from "./presets";
import { useBigQueryOnboardingController } from "./useBigQueryOnboardingController";
import { useConnectionCatalogController } from "./useConnectionCatalogController";
import { useConnectionEditorDialogs } from "./useConnectionEditorDialogs";
import { useConnectionProfileController } from "./useConnectionProfileController";
import { useConnectionProfileState } from "./useConnectionProfileState";
import { useConnectionSchemaController } from "./useConnectionSchemaController";

export type { ConnectionInputMode } from "./connectionEditorModel";

export type ConnectionEditorProps = {
  initial: ConnectionProfile | null;
  preset: ConnectionLaunchPreset | null;
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
  const catalog = useConnectionCatalogController({
    connections: props.connections,
    onNewConnection: props.onNewConnection,
    openProviderCredentials: dialogState.providerCredentials.show,
    profileState,
  });
  const bigQuery = useBigQueryOnboardingController(
    profileState,
    catalog.view.drivers.active?.installState === "installed",
  );
  const schema = useConnectionSchemaController(profileState);
  const profileController = useConnectionProfileController({
    connections: props.connections,
    onDeletedConnection: props.onDeletedConnection,
    onSaved: props.onSaved,
    onCancel: props.onCancel,
    profileState,
    catalog,
    dialogs: dialogState,
    bigQuery,
  });

  return {
    profile: profileController.view,
    catalog: catalog.view,
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
