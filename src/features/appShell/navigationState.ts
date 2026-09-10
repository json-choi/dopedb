// The shell's central surface has one route owner. Settings is a modal mode that
// retains an explicit background route instead of coexisting with independent
// editor, Knowledge, and schema-diff flags.
import type { ConnectionLaunchPreset } from "../connections/presets";
import type { KnowledgeEnvironmentFocus } from "../knowledge/domain";
import type { SettingsSection } from "../settings/domain";

export type AppShellRoute =
  | { kind: "workbench" }
  | { kind: "welcome" }
  | {
      kind: "connectionEditor";
      target:
        | { kind: "new"; preset: ConnectionLaunchPreset | null }
        | { kind: "existing"; connectionId: string };
    }
  | { kind: "knowledge"; focus: KnowledgeEnvironmentFocus }
  | { kind: "schemaDiff"; groupKey: string };

export type AppShellMode =
  | { kind: "content"; route: AppShellRoute }
  | {
      kind: "settings";
      route: AppShellRoute;
      section: SettingsSection | undefined;
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
  | { type: "focusToolWindow" }
  | { type: "schemaGroupUnavailable"; groupKey: string }
  | { type: "connectionDeleted"; connectionId: string; remainingConnections?: number };

const WORKBENCH_ROUTE: AppShellRoute = { kind: "workbench" };

export const initialAppShellMode: AppShellMode = {
  kind: "content",
  route: WORKBENCH_ROUTE,
};

function backgroundForSettings(route: AppShellRoute): AppShellRoute {
  return route.kind === "connectionEditor" || route.kind === "schemaDiff"
    ? WORKBENCH_ROUTE
    : route;
}

function routeOf(mode: AppShellMode): AppShellRoute {
  return mode.route;
}

function withRoute(
  mode: AppShellMode,
  route: AppShellRoute,
): AppShellMode {
  return mode.kind === "settings"
    ? { ...mode, route }
    : { kind: "content", route };
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
        route: backgroundForSettings(routeOf(mode)),
        section: command.section,
      };
    case "closeSettings":
      return mode.kind === "settings"
        ? { kind: "content", route: mode.route }
        : mode;
    case "focusToolWindow":
      return {
        kind: "content",
        route: backgroundForSettings(routeOf(mode)),
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
