// Retains and restores shell inert state while a modal Agent surface owns interaction.

import { useLayoutEffect, type RefObject } from "react";

type InertShellChild = {
  element: Pick<HTMLElement, "inert" | "isConnected">;
  agentSurface: boolean;
};

export function retainInertShellChildren(
  children: readonly InertShellChild[],
  enabled: boolean,
) {
  if (!enabled) return () => undefined;
  const prior = new Map<InertShellChild["element"], boolean>();
  for (const { element, agentSurface } of children) {
    if (agentSurface) continue;
    prior.set(element, element.inert);
    element.inert = true;
  }
  return () => {
    for (const [element, wasInert] of prior) {
      if (element.isConnected) element.inert = wasInert;
    }
  };
}

export function retainInertShellBackground(
  shell: HTMLElement,
  enabled: boolean,
) {
  return retainInertShellChildren(
    Array.from(shell.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .map((element) => ({
        element,
        agentSurface: element.matches("[data-agent-surface]"),
      })),
    enabled,
  );
}

export function useInertShellBackground(
  shellRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(
    () =>
      shellRef.current
        ? retainInertShellBackground(shellRef.current, enabled)
        : undefined,
  );
}
