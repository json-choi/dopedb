/** Responsive geometry policy for the Agent right anchor. */
export const AGENT_DOCK_DEFAULT_WIDTH = 396;
export const AGENT_DOCK_MIN_WIDTH = 360;
export const AGENT_DOCK_MAX_WIDTH = 680;
export const AGENT_DOCK_MIN_WORKBENCH_WIDTH = 420;

export type AgentDockLayout = "compact" | "docked" | "overlay";

export function agentDockLayout(
  compact: boolean,
  overlay: boolean,
): AgentDockLayout {
  return compact ? "compact" : overlay ? "overlay" : "docked";
}

export function agentDockInteraction(layout: AgentDockLayout) {
  return {
    role: layout === "docked" ? undefined : ("dialog" as const),
    ariaModal: layout === "compact" ? true : undefined,
    shellInert: layout === "compact",
  };
}

export function shouldDismissAgentOverlayFromEscape({
  defaultPrevented,
  focusInside,
  nestedModal,
}: {
  defaultPrevented: boolean;
  focusInside: boolean;
  nestedModal: boolean;
}) {
  return !defaultPrevented && focusInside && !nestedModal;
}

export function normalizeAgentDockWidth(requestedWidth: number): number {
  return Math.round(
    Math.min(
      AGENT_DOCK_MAX_WIDTH,
      Math.max(AGENT_DOCK_MIN_WIDTH, requestedWidth),
    ),
  );
}

export function clampAgentDockWidth(
  requestedWidth: number,
  viewportWidth: number,
  leftToolWindowWidth?: number,
): number {
  const availableWidth = leftToolWindowWidth === undefined
    ? viewportWidth
    : viewportWidth - Math.max(0, leftToolWindowWidth) - 12 - AGENT_DOCK_MIN_WORKBENCH_WIDTH;
  const viewportMaximum = Math.max(
    AGENT_DOCK_MIN_WIDTH,
    Math.min(Math.floor(viewportWidth * 0.55), availableWidth),
  );
  return Math.round(
    Math.min(
      viewportMaximum,
      normalizeAgentDockWidth(requestedWidth),
    ),
  );
}

export function shouldOverlayAgentDock({
  viewportWidth,
  leftToolWindowWidth,
  requestedAgentWidth,
}: {
  viewportWidth: number;
  leftToolWindowWidth: number;
  requestedAgentWidth: number;
}): boolean {
  const agentWidth = clampAgentDockWidth(requestedAgentWidth, viewportWidth, leftToolWindowWidth);
  return (
    viewportWidth - Math.max(0, leftToolWindowWidth) - 12 - agentWidth <
    AGENT_DOCK_MIN_WORKBENCH_WIDTH
  );
}
