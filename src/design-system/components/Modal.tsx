// Canonical modal backdrop and bounded dialog surface. Feature dialogs own
// their content and actions; this primitive owns viewport placement, elevation,
// responsive bounds, and background interaction blocking.
import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";

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

function isTopmostModal(surface: HTMLElement) {
  const modals = document.querySelectorAll<HTMLElement>(
    '[role="dialog"][aria-modal="true"]',
  );
  return modals.item(modals.length - 1) === surface;
}

export function useModalBehavior({
  surfaceRef,
  onRequestClose,
  dismissible = true,
  restoreFocus = true,
  returnFocusRef,
  enabled = true,
}: {
  surfaceRef: RefObject<HTMLElement | null>;
  onRequestClose?: () => void;
  dismissible?: boolean;
  restoreFocus?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  enabled?: boolean;
}) {
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  useLayoutEffect(() => {
    if (!enabled) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const previousFocus = returnFocusRef?.current ?? previousFocusRef.current;

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
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      if (
        restoreFocus &&
        previousFocus?.isConnected &&
        (surface.contains(document.activeElement) ||
          document.activeElement === document.body)
      ) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [enabled, restoreFocus, returnFocusRef, surfaceRef]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const surface = surfaceRef.current;
      if (
        event.defaultPrevented ||
        !surface ||
        !isTopmostModal(surface)
      ) {
        return;
      }
      if (event.key === "Escape") {
        if (!dismissible || !onRequestClose) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onRequestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableModalElements(surface);
      if (focusable.length === 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        surface.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !surface.contains(active))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        event.stopImmediatePropagation();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dismissible, enabled, onRequestClose, surfaceRef]);
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
    onRequestClose?: () => void;
    dismissible?: boolean;
    returnFocusRef?: RefObject<HTMLElement | null>;
  } & Omit<HTMLAttributes<HTMLElement>, "className" | "children">
>(function ModalSurface(
  {
    children,
    size = "medium",
    fill = false,
    onRequestClose,
    dismissible = true,
    returnFocusRef,
    onMouseDown,
    onKeyDown,
    tabIndex,
    ...props
  },
  ref,
) {
  const surfaceRef = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => surfaceRef.current!);
  useModalBehavior({
    surfaceRef,
    onRequestClose,
    dismissible,
    returnFocusRef,
  });

  return (
    <section
      ref={surfaceRef}
      role="dialog"
      aria-modal="true"
      data-size={size}
      data-fill={fill}
      tabIndex={tabIndex ?? -1}
      className="ds-panel tw:flex tw:max-h-[calc(100dvh-(var(--ds-space-4)*2))] tw:w-[min(640px,100%)] tw:flex-col tw:overflow-hidden tw:p-0 tw:shadow-popover tw:[container-type:inline-size] tw:data-[fill=true]:h-[min(760px,calc(100dvh-(var(--ds-space-4)*2)))] tw:data-[size=dataSources]:h-[min(731px,calc(100dvh-(var(--ds-space-4)*2)))] tw:data-[size=dataSources]:w-[min(980px,100%)] tw:data-[size=settings]:h-[min(722px,calc(100dvh-(var(--ds-space-4)*2)))] tw:data-[size=settings]:w-[min(982px,100%)] tw:data-[size=wide]:w-[min(1120px,100%)] tw:max-[640px]:max-h-[calc(100dvh-(var(--ds-space-2)*2))] tw:max-[640px]:data-[fill=true]:h-[calc(100dvh-(var(--ds-space-2)*2))] tw:max-[640px]:data-[size=dataSources]:h-[calc(100dvh-(var(--ds-space-2)*2))] tw:max-[640px]:data-[size=settings]:h-[calc(100dvh-(var(--ds-space-2)*2))]"
      onMouseDown={(event) => {
        event.stopPropagation();
        onMouseDown?.(event);
      }}
      onKeyDown={onKeyDown}
      {...props}
    >
      {children}
    </section>
  );
});

export function ModalHeader({
  title,
  titleId,
}: {
  title: ReactNode;
  titleId: string;
}) {
  return (
    <header className="tw:flex tw:h-[44px] tw:min-h-[44px] tw:shrink-0 tw:items-center tw:border-b tw:border-border-subtle tw:bg-card tw:px-5 tw:max-[640px]:px-4">
      <h1
        id={titleId}
        className="tw:m-0 tw:min-w-0 tw:overflow-hidden tw:text-left tw:text-sm tw:font-semibold tw:text-ellipsis tw:whitespace-nowrap"
      >
        {title}
      </h1>
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
