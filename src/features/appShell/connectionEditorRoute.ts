// Keeps the connection editor's side of shell navigation in one place: which
// profile, launch preset, and entry focus the editor route names, the dialog
// commands that respect the editor, and credential requests from other surfaces.
// Settings and Workspace management replace a top-level editor only after it
// confirms unsaved edits, while a Workspace management request the editor makes
// itself opens over it and returns to it.
import { useEffect } from "react";

import { useEventCallback } from "../../lib/useEventCallback";
import {
  leaveConnectionEditor,
  onConnectionCredentialsRequested,
  takeConnectionEditorReturn,
} from "../connections/connectionEditorShellBridge";
import type { ConnectionProfile } from "../connections/domain";
import type { ConnectionLaunchPreset } from "../connections/presets";
import type { SettingsSection } from "../settings/domain";
import type { WorkspaceAdminDestination } from "../workspaceAdmin/sections";
import type {
  AppShellMode,
  AppShellNavigationCommand,
  AppShellRoute,
} from "./navigationState";

type EditorRoute = {
  editing: ConnectionProfile | "new" | null;
  preset: ConnectionLaunchPreset | null;
  /** Set when the editor opened to re-enter a credential this device lost. */
  initialFocus: "credentials" | undefined;
};

/** The profile, launch preset, and entry focus the current route gives the editor. */
export function connectionEditorRoute(
  route: AppShellRoute,
  connections: readonly ConnectionProfile[],
): EditorRoute {
  if (route.kind !== "connectionEditor") {
    return { editing: null, preset: null, initialFocus: undefined };
  }
  const target = route.target;
  if (target.kind === "new") {
    return { editing: "new", preset: target.preset, initialFocus: undefined };
  }
  return {
    editing:
      connections.find((connection) => connection.id === target.connectionId) ??
      null,
    preset: null,
    initialFocus: target.initialFocus,
  };
}

/** Settings and Workspace management commands that respect an open editor. */
export function connectionEditorDialogCommands(
  mode: AppShellMode,
  navigate: (command: AppShellNavigationCommand) => void,
) {
  function openSettings(section?: SettingsSection) {
    const open = () => navigate({ type: "openSettings", section });
    // Settings replaces a top-level connection editor; it confirms unsaved edits.
    if (mode.kind === "content") leaveConnectionEditor(open);
    else open();
  }

  function openWorkspaceAdmin(destination: WorkspaceAdminDestination) {
    // The open editor marks its own requests (managed recovery, shared database
    // add); Workspace management then opens over it and returns to it.
    const returnToEditor = takeConnectionEditorReturn();
    const open = () =>
      navigate({ type: "openWorkspaceAdmin", destination, returnToEditor });
    if (returnToEditor || mode.kind !== "content") open();
    else leaveConnectionEditor(open);
  }

  return { openSettings, openWorkspaceAdmin };
}

/** Opens the editor at the credential another surface, such as a SQL result, asks for. */
export function useConnectionCredentialRequests(
  connections: readonly ConnectionProfile[],
  editConnection: (connection: ConnectionProfile, initialFocus?: "credentials") => void,
) {
  const open = useEventCallback((connectionId: string) => {
    const connection = connections.find((candidate) => candidate.id === connectionId);
    if (connection) editConnection(connection, "credentials");
  });
  useEffect(() => onConnectionCredentialsRequested(open), [open]);
}
