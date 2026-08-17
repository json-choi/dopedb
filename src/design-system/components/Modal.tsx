// Canonical modal backdrop and bounded dialog surface. Feature dialogs own
// their content and actions; this primitive owns viewport placement, elevation,
// responsive bounds, background interaction blocking, and the keyboard contract
// (focus containment, focus restore, and topmost-only Escape dismissal).
import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";

import { Icon } from "../../components/Icon";
import { Button } from "./Button";

const MODAL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableModalElements(surface: HTMLElement) {
  return Array.from(
    surface.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.hidden &&
      !element.closest("[inert]") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

// Sibling dialog surfaces gate their own Escape handlers on this so a stacked
// dialog dismisses one layer per keypress. Last mounted dialog in document
// order wins.
export function isTopmostModal(surface: HTMLElement) {
  const modals = document.querySelectorAll<HTMLElement>(
    '[role="dialog"][aria-modal="true"]',
  );
  return modals.item(modals.length - 1) === surface;
}

export function ModalBackdrop({
  children,
  ...props
}: {
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  return createPortal(
    <div
      className="tw:fixed tw:inset-0 tw:z-[var(--ds-z-modal)] tw:grid tw:place-items-center tw:overflow-auto tw:bg-overlay tw:p-4 tw:max-[640px]:p-2"
      role="presentation"
      {...props}
    >
      {children}
    </div>,
    document.body,
  );
}

export const ModalSurface = forwardRef<
  HTMLElement,
  {
    children: ReactNode;
    size?: "medium" | "wide" | "settings" | "dataSources";
    fill?: boolean;
    onEscape?: () => void;
  } & Omit<HTMLAttributes<HTMLElement>, "className" | "children">
>(function ModalSurface(
  {
    children,
    size = "medium",
    fill = false,
    onEscape,
    onKeyDown,
    tabIndex,
    ...props
  },
  ref,
) {
  const surfaceRef = useRef<HTMLElement>(null);
  const onEscapeRef = useRef(onEscape);
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useImperativeHandle(ref, () => surfaceRef.current!);
  useLayoutEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const previousFocus = previousFocusRef.current;

    const focusInside = () => {
      const preferred =
        surface.querySelector<HTMLElement>("[data-modal-initial-focus]") ??
        surface.querySelector<HTMLElement>("[autofocus]") ??
        focusableModalElements(surface)[0] ??
        surface;
      preferred.focus({ preventScroll: true });
    };

    if (!surface.contains(document.activeElement)) focusInside();

    const containFocus = (event: FocusEvent) => {
      if (
        isTopmostModal(surface) &&
        event.target instanceof Node &&
        !surface.contains(event.target)
      ) {
        focusInside();
      }
    };

    // React delegates portal events at the portal container, so a keydown whose
    // target is `document.body` itself has no fiber and never reaches the
    // synthetic handler below. The browser drops focus to `body` whenever the
    // focused control becomes `disabled` mid-flight or a backdrop click lands on
    // a dialog that does not close, and `focusin` never fires for that move, so
    // focus containment cannot recover it either. This listener answers Escape
    // in exactly those cases and keeps the same ownership contract: the
    // `ToolbarMenu` capture listener already stopped propagation before this
    // runs, the synthetic handler stops propagation at the portal container when
    // it closed the dialog, a caller's `preventDefault()` is respected through
    // `defaultPrevented`, and `isTopmostModal` plus that same flag keep stacked
    // dialogs to one close per keypress. `Tooltip` listens on the document
    // bubble too and drops the key once this claimed it.
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const onEscapeNow = onEscapeRef.current;
      if (!onEscapeNow || !isTopmostModal(surface)) return;
      event.preventDefault();
      event.stopPropagation();
      onEscapeNow();
    };

    document.addEventListener("focusin", containFocus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("focusin", containFocus);
      document.removeEventListener("keydown", closeOnEscape);
      if (
        previousFocus?.isConnected &&
        (surface.contains(document.activeElement) ||
          document.activeElement === document.body)
      ) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <section
      ref={surfaceRef}
      role="dialog"
      aria-modal="true"
      data-size={size}
      data-fill={fill}
      tabIndex={tabIndex ?? -1}
      className="ds-panel tw:flex tw:max-h-[calc(100dvh-(var(--ds-space-4)*2))] tw:w-[min(640px,100%)] tw:flex-col tw:overflow-hidden tw:p-0 tw:shadow-popover tw:[container-type:inline-size] tw:data-[fill=true]:h-[min(760px,calc(100dvh-(var(--ds-space-4)*2)))] tw:data-[size=dataSources]:h-[min(731px,calc(100dvh-(var(--ds-space-4)*2)))] tw:data-[size=dataSources]:w-[min(980px,100%)] tw:data-[size=settings]:h-[min(722px,calc(100dvh-(var(--ds-space-4)*2)))] tw:data-[size=settings]:w-[min(982px,100%)] tw:data-[size=wide]:w-[min(1120px,100%)] tw:max-[640px]:max-h-[calc(100dvh-(var(--ds-space-2)*2))] tw:max-[640px]:data-[fill=true]:h-[calc(100dvh-(var(--ds-space-2)*2))] tw:max-[640px]:data-[size=dataSources]:h-[calc(100dvh-(var(--ds-space-2)*2))] tw:max-[640px]:data-[size=settings]:h-[calc(100dvh-(var(--ds-space-2)*2))]"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "Escape") {
          if (!onEscape || !isTopmostModal(event.currentTarget)) return;
          event.preventDefault();
          event.stopPropagation();
          onEscape();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = focusableModalElements(event.currentTarget);
        if (focusable.length === 0) {
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (
          event.shiftKey &&
          (active === first || !event.currentTarget.contains(active))
        ) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
      }}
      {...props}
    >
      {children}
    </section>
  );
});

export function ModalTitleBar({
  title,
  titleId,
  closeLabel,
  onClose,
}: {
  title: ReactNode;
  titleId: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <header className="tw:grid tw:h-[30px] tw:min-h-[30px] tw:shrink-0 tw:grid-cols-[28px_minmax(0,1fr)_28px] tw:items-center tw:border-b tw:border-border-subtle tw:bg-card tw:px-1">
      <span aria-hidden="true" />
      <h1
        id={titleId}
        className="tw:m-0 tw:overflow-hidden tw:text-center tw:text-sm tw:font-semibold tw:text-ellipsis tw:whitespace-nowrap"
      >
        {title}
      </h1>
      <Button
        iconOnly
        size="xs"
        variant="ghost"
        onClick={onClose}
        title={closeLabel}
        aria-label={closeLabel}
      >
        <Icon name="close" />
      </Button>
    </header>
  );
}

export function ModalDetailActionBar({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="tw:flex tw:h-[48px] tw:min-h-[48px] tw:shrink-0 tw:items-center tw:gap-3 tw:border-t tw:border-border-subtle tw:bg-card tw:px-5">
      {children}
    </div>
  );
}

export function ModalFooter({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <footer
      className="tw:flex tw:h-[50px] tw:min-h-[50px] tw:shrink-0 tw:items-center tw:justify-end tw:gap-2 tw:border-t tw:border-border-subtle tw:bg-card tw:px-4"
      data-primary-flow
    >
      {children}
    </footer>
  );
}
