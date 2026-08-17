// Canonical tooltip for icon-only commands and compact help affordances.
// The trigger keeps its own accessible name; this primitive owns delayed
// hover/focus presentation, viewport-safe portal geometry, and Escape dismissal.
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  placeFloatingMenu,
  type FloatingMenuPosition,
} from "../../lib/floatingMenu";

type DescribedElement = ReactElement<{
  "aria-describedby"?: string;
}>;

export function Tooltip({
  label,
  children,
  delay = 350,
}: {
  label: string;
  children: ReactNode;
  delay?: number;
}) {
  const generatedId = useId();
  const tooltipId = `tooltip-${generatedId.replace(/:/g, "")}`;
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const hoveringRef = useRef(false);
  const focusedRef = useRef(false);
  const suppressedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null);

  function clearPending() {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function openSoon() {
    if (suppressedRef.current) return;
    clearPending();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setOpen(true);
    }, Math.max(0, delay));
  }

  function closeIfIdle() {
    if (hoveringRef.current || focusedRef.current) return;
    clearPending();
    setOpen(false);
    setPosition(null);
  }

  function dismiss() {
    clearPending();
    setOpen(false);
    setPosition(null);
  }

  function suppressAfterCommand() {
    suppressedRef.current = true;
    dismiss();
  }

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const trigger = wrapperRef.current?.firstElementChild;
        const tooltip = tooltipRef.current;
        if (!(trigger instanceof HTMLElement) || !tooltip) return;
        const rootStyle = getComputedStyle(document.documentElement);
        const gap =
          Number.parseFloat(
            rootStyle.getPropertyValue("--ds-popover-offset-lg"),
          ) || 6;
        const margin =
          Number.parseFloat(
            rootStyle.getPropertyValue("--ds-viewport-gutter"),
          ) || 8;
        setPosition(
          placeFloatingMenu(
            trigger.getBoundingClientRect(),
            tooltip.getBoundingClientRect(),
            { width: window.innerWidth, height: window.innerHeight },
            { align: "center", gap, margin },
          ),
        );
      });
    };
    update();
    const observer = new ResizeObserver(update);
    const trigger = wrapperRef.current?.firstElementChild;
    if (trigger instanceof HTMLElement) observer.observe(trigger);
    if (tooltipRef.current) observer.observe(tooltipRef.current);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // A tooltip is the outermost dismissible surface on its trigger, so it only
    // consumes Escape that no menu or dialog already claimed.
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      clearPending();
      setOpen(false);
      setPosition(null);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [open]);

  useEffect(
    () => () => {
      clearPending();
    },
    [],
  );

  let describedChild = children;
  if (isValidElement(children)) {
    const child = children as DescribedElement;
    const existingDescription = child.props["aria-describedby"];
    describedChild = cloneElement(child, {
      "aria-describedby": open
        ? [existingDescription, tooltipId].filter(Boolean).join(" ")
        : existingDescription,
    });
  }

  return (
    <>
      <span
        ref={wrapperRef}
        className="tw:contents"
        onPointerEnter={() => {
          hoveringRef.current = true;
          suppressedRef.current = false;
          openSoon();
        }}
        onPointerLeave={() => {
          hoveringRef.current = false;
          suppressedRef.current = false;
          closeIfIdle();
        }}
        onPointerDownCapture={suppressAfterCommand}
        onClickCapture={suppressAfterCommand}
        onFocusCapture={() => {
          focusedRef.current = true;
          openSoon();
        }}
        onBlurCapture={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          focusedRef.current = false;
          suppressedRef.current = false;
          closeIfIdle();
        }}
      >
        {describedChild}
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              data-placement={position?.placement}
              data-ready={position ? "true" : undefined}
              className="tw:pointer-events-none tw:fixed tw:z-[var(--ds-z-popover)] tw:max-w-[min(320px,calc(100vw_-_var(--ds-space-4)))] tw:rounded-xs tw:border tw:border-border-strong tw:bg-popover tw:px-2 tw:py-1 tw:text-xs tw:leading-ui tw:text-popover-foreground tw:opacity-0 tw:shadow-popover tw:transition-opacity tw:duration-100 tw:data-[ready=true]:opacity-100 tw:motion-reduce:transition-none"
              style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
                maxHeight: position?.maxHeight,
              }}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
