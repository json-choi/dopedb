// The shell's central surface has one route owner. Settings and Workspace management
// are modal modes that retain an explicit background route instead of coexisting
// with independent editor, Knowledge, and schema-diff flags; opening one replaces
// the other. A Workspace management request for the account opens Settings → Account,
// because the account belongs to the person rather than to one workspace. Only a
// Workspace management request the open connection editor makes itself keeps that
// editor as the background, so closing the dialog returns to its intact draft.
import type { ConnectionLaunchPreset } from "../connections/presets";
import type { KnowledgeEnvironmentFocus } from "../knowledge/domain";
import type { SettingsSection } from "../settings/domain";
import type {
  WorkspaceAdminDestination,
  WorkspaceAdminSection,
} from "../workspaceAdmin/sections";

export type AppShellRoute =
  | { kind: "workbench" }
  | { kind: "welcome" }
  | {
      kind: "connectionEditor";
      target:
        | { kind: "new"; preset: ConnectionLaunchPreset | null }
        | {
            kind: "existing";
            connectionId: string;
            /** Opened to re-enter a credential this device no longer holds. */
            initialFocus?: "credentials";
          };
    }
  | { kind: "knowledge"; focus: KnowledgeEnvironmentFocus }
  | { kind: "schemaDiff"; groupKey: string };

export type AppShellMode =
  | { kind: "content"; route: AppShellRoute }
  | {
      kind: "settings";
      route: AppShellRoute;
      section: SettingsSection | undefined;
    }
  | {
      kind: "workspaceAdmin";
      route: AppShellRoute;
      section: WorkspaceAdminSection;
    };

export type AppShellNavigationCommand =
  | { type: "workspaceScopeChanged" }
  | { type: "showWorkbench" }
  | { type: "showWelcome" }
  | {
      type: "openConnectionEditor";
      target: Extract<AppShellRoute, { kind: "connectionEditor" }>[
        "target"
      ];
    }
  | { type: "openKnowledge"; focus: KnowledgeEnvironmentFocus }
  | { type: "openSchemaDiff"; groupKey: string }
  | { type: "openSettings"; section?: SettingsSection }
  | { type: "closeSettings" }
  | {
      type: "openWorkspaceAdmin";
      destination: WorkspaceAdminDestination;
      /** The open connection editor made this request and stays underneath. */
      returnToEditor?: boolean;
    }
  | { type: "closeWorkspaceAdmin" }
  | { type: "focusToolWindow" }
  | { type: "schemaGroupUnavailable"; groupKey: string }
  | { type: "connectionDeleted"; connectionId: string; remainingConnections?: number };

const WORKBENCH_ROUTE: AppShellRoute = { kind: "workbench" };

export const initialAppShellMode: AppShellMode = {
  kind: "content",
  route: WORKBENCH_ROUTE,
};

function backgroundForDialog(route: AppShellRoute): AppShellRoute {
  return route.kind === "connectionEditor" || route.kind === "schemaDiff"
    ? WORKBENCH_ROUTE
    : route;
}

function routeOf(mode: AppShellMode): AppShellRoute {
  return mode.route;
}

/**
 * The background a dialog opens over. A dialog that is already open keeps its
 * own background, and an editor that asked for Workspace management stays.
 */
function dialogBackground(mode: AppShellMode, keepEditor = false): AppShellRoute {
  const current = routeOf(mode);
  if (mode.kind !== "content") return current;
  return keepEditor && current.kind === "connectionEditor"
    ? current
    : backgroundForDialog(current);
}

function withRoute(
  mode: AppShellMode,
  route: AppShellRoute,
): AppShellMode {
  return mode.kind === "content"
    ? { kind: "content", route }
    : { ...mode, route };
}

export function appShellNavigationReducer(
  mode: AppShellMode,
  command: AppShellNavigationCommand,
): AppShellMode {
  switch (command.type) {
    case "workspaceScopeChanged":
    case "showWorkbench":
      return initialAppShellMode;
    case "showWelcome":
      return { kind: "content", route: { kind: "welcome" } };
    case "openConnectionEditor":
      return {
        kind: "content",
        route: { kind: "connectionEditor", target: command.target },
      };
    case "openKnowledge":
      return {
        kind: "content",
        route: { kind: "knowledge", focus: command.focus },
      };
    case "openSchemaDiff":
      return {
        kind: "content",
        route: { kind: "schemaDiff", groupKey: command.groupKey },
      };
    case "openSettings":
      return {
        kind: "settings",
        route: dialogBackground(mode),
        section: command.section,
      };
    case "closeSettings":
      return mode.kind === "settings"
        ? { kind: "content", route: mode.route }
        : mode;
    case "openWorkspaceAdmin": {
      const route = dialogBackground(mode, command.returnToEditor === true);
      return command.destination === "account"
        ? { kind: "settings", route, section: "account" }
        : { kind: "workspaceAdmin", route, section: command.destination };
    }
    case "closeWorkspaceAdmin":
      return mode.kind === "workspaceAdmin"
        ? { kind: "content", route: mode.route }
        : mode;
    case "focusToolWindow":
      return {
        kind: "content",
        route: backgroundForDialog(routeOf(mode)),
      };
    case "schemaGroupUnavailable": {
      const route = routeOf(mode);
      return route.kind === "schemaDiff" &&
        route.groupKey === command.groupKey
        ? withRoute(mode, WORKBENCH_ROUTE)
        : mode;
    }
    case "connectionDeleted": {
      if (command.remainingConnections === 0) {
        return { kind: "content", route: { kind: "welcome" } };
      }
      const route = routeOf(mode);
      const editingDeletedConnection =
        route.kind === "connectionEditor" &&
        route.target.kind === "existing" &&
        route.target.connectionId === command.connectionId;
      return editingDeletedConnection || route.kind === "schemaDiff"
        ? withRoute(mode, WORKBENCH_ROUTE)
        : mode;
    }
  }
}
