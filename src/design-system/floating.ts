// Shared Floating UI middleware for portalled design-system surfaces. CSS
// tokens remain the source of truth for viewport gutter and surface spacing.
import {
  autoUpdate,
  flip,
  hide,
  offset,
  shift,
  size,
  type Middleware,
  type Placement,
  useFloating,
} from "@floating-ui/react-dom";

function cssLength(name: string, fallback: number) {
  if (typeof document === "undefined") return fallback;
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(value) ? value : fallback;
}

function viewportGutter() {
  return cssLength("--ds-viewport-gutter", 8);
}

export function floatingSurfaceMiddleware(): Middleware[] {
  return [
    offset(() => cssLength("--ds-popover-offset-lg", 6)),
    flip(() => ({ padding: viewportGutter() })),
    shift(() => ({ padding: viewportGutter() })),
    size(() => ({
      padding: viewportGutter(),
      apply({ availableHeight, elements }) {
        elements.floating.style.maxHeight = `${Math.max(0, Math.floor(availableHeight))}px`;
      },
    })),
    hide({ strategy: "referenceHidden" }),
  ];
}

export function useAnchoredFloatingSurface({
  open,
  placement,
}: {
  open: boolean;
  placement: Placement;
}) {
  return useFloating({
    open,
    placement,
    strategy: "fixed",
    middleware: floatingSurfaceMiddleware(),
    whileElementsMounted: autoUpdate,
  });
}

export function floatingPortalOwnerId(anchor: Element | null) {
  return (
    anchor?.closest<HTMLElement>(
      '[role="menu"][id], [role="dialog"][aria-modal="true"][id], [role="alertdialog"][aria-modal="true"][id]',
    )?.id ?? undefined
  );
}

export function floatingPortalIsModalOwned(anchor: Element | null) {
  if (
    anchor?.closest(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
    )
  ) return true;

  let ownerId = floatingPortalOwnerId(anchor);
  const visited = new Set<string>();
  while (ownerId && !visited.has(ownerId)) {
    visited.add(ownerId);
    const owner = document.getElementById(ownerId);
    if (!owner) return false;
    if (
      owner.matches(
        '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
      )
    ) return true;
    ownerId = owner.dataset.floatingOwnerId;
  }
  return false;
}

export function ownsFloatingTarget(owner: HTMLElement, target: Node) {
  if (owner.contains(target)) return true;
  if (!(target instanceof Element) || !owner.id) return false;

  let portal = target.closest<HTMLElement>("[data-floating-owner-id]");
  const visited = new Set<string>();
  while (portal) {
    const ownerId = portal.dataset.floatingOwnerId;
    if (!ownerId || visited.has(ownerId)) return false;
    if (ownerId === owner.id) return true;
    visited.add(ownerId);
    const parentOwner = document.getElementById(ownerId);
    if (!parentOwner) return false;
    if (owner.contains(parentOwner)) return true;
    portal = parentOwner.closest<HTMLElement>("[data-floating-owner-id]");
  }
  return false;
}
