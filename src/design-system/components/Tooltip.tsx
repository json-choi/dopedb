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

import { useAnchoredFloatingSurface } from "../floating";

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
  const timerRef = useRef<number | null>(null);
  const hoveringRef = useRef(false);
  const focusedRef = useRef(false);
  const suppressedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const {
    refs,
    floatingStyles,
    placement,
    isPositioned,
    middlewareData,
  } = useAnchoredFloatingSurface({
    open,
    placement: "bottom",
  });

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
  }

  function dismiss() {
    clearPending();
    setOpen(false);
  }

  function suppressAfterCommand() {
    suppressedRef.current = true;
    dismiss();
  }

  useLayoutEffect(() => {
    const trigger = wrapperRef.current?.firstElementChild;
    refs.setReference(trigger instanceof HTMLElement ? trigger : null);
    return () => refs.setReference(null);
  }, [refs]);

  useEffect(() => {
    if (!open || !middlewareData.hide?.referenceHidden) return;
    clearPending();
    setOpen(false);
  }, [middlewareData.hide?.referenceHidden, open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      clearPending();
      setOpen(false);
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
              ref={refs.setFloating}
              id={tooltipId}
              role="tooltip"
              data-placement={placement.split("-")[0]}
              data-ready={isPositioned ? "true" : undefined}
              className="tw:pointer-events-none tw:fixed tw:z-[var(--ds-z-popover)] tw:max-w-[min(320px,calc(100vw_-_var(--ds-space-4)))] tw:rounded-xs tw:border tw:border-border-strong tw:bg-popover tw:px-2 tw:py-1 tw:text-xs tw:leading-ui tw:text-popover-foreground tw:opacity-0 tw:shadow-popover tw:transition-opacity tw:duration-100 tw:data-[ready=true]:opacity-100 tw:motion-reduce:transition-none"
              style={floatingStyles}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
