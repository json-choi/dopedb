// Shared Floating UI middleware for portalled design-system surfaces. CSS
// tokens remain the source of truth for viewport gutter and surface spacing.
import {
  flip,
  hide,
  offset,
  shift,
  size,
  type Middleware,
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
