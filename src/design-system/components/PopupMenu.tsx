// Canonical flat popup-menu surface and items. Menus use rows, not nested
// button boxes, and own the same hover/focus/disabled behavior everywhere.
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  KeyboardEventHandler,
  MouseEventHandler,
  ReactNode,
  RefObject,
} from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { useAnchoredFloatingSurface } from "../floating";

type PopupMenuPlacement = "bottom-end" | "right-end" | "top-start";

export function PopupMenu({
  id,
  children,
  anchorRef,
  placement = "bottom-end",
  size = "default",
  ariaLabel,
  onClick,
  onKeyDown,
  onReferenceHidden,
}: {
  id?: string;
  children: ReactNode;
  anchorRef: RefObject<HTMLElement | null>;
  placement?: PopupMenuPlacement;
  size?: "account" | "default";
  ariaLabel?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onReferenceHidden?: () => void;
}) {
  const {
    refs,
    floatingStyles,
    placement: resolvedPlacement,
    isPositioned,
    middlewareData,
  } = useAnchoredFloatingSurface({ open: true, placement });

  useEffect(() => {
    refs.setReference(anchorRef.current);
    return () => refs.setReference(null);
  }, [anchorRef, refs]);

  useEffect(() => {
    if (!middlewareData.hide?.referenceHidden) return;
    onReferenceHidden?.();
  }, [middlewareData.hide?.referenceHidden, onReferenceHidden]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={refs.setFloating}
      id={id}
      role="menu"
      aria-label={ariaLabel}
      data-placement={resolvedPlacement.split("-")[0]}
      data-popup-menu=""
      data-size={size}
      className="tw:fixed tw:z-[var(--ds-z-popover)] tw:grid tw:max-h-[min(420px,calc(100dvh-(var(--ds-viewport-gutter)*2)))] tw:w-[min(220px,calc(100vw-(var(--ds-viewport-gutter)*2)))] tw:min-w-[var(--ds-menu-min-width)] tw:gap-[2px] tw:overflow-y-auto tw:overscroll-contain tw:rounded-sm tw:border tw:border-border-subtle tw:bg-popover tw:p-1 tw:text-popover-foreground tw:shadow-popover tw:data-[size=account]:w-[min(284px,calc(100vw-(var(--ds-viewport-gutter)*2)))]"
      style={{
        ...floatingStyles,
        visibility: isPositioned ? "visible" : "hidden",
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}

export function PopupMenuItem({
  children,
  ...props
}: {
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  return (
    <button
      type="button"
      role="menuitem"
      className="tw:flex tw:min-h-control-md tw:w-full tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:border-0 tw:bg-transparent tw:px-2 tw:font-sans tw:text-left tw:text-sm tw:leading-body tw:text-foreground tw:data-[tone=danger]:text-danger tw:disabled:cursor-default tw:disabled:opacity-40 tw:hover:bg-muted tw:focus-visible:bg-muted tw:focus-visible:outline-none"
      {...props}
    >
      {children}
    </button>
  );
}

export function PopupMenuCheckbox({
  children,
  ...props
}: {
  children: ReactNode;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "children" | "type"
>) {
  return (
    <label
      role="menuitemcheckbox"
      aria-checked={Boolean(props.checked)}
      className="tw:flex tw:min-h-control-md tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:px-2 tw:text-sm tw:leading-body tw:text-foreground tw:hover:bg-muted"
    >
      <input type="checkbox" className="tw:size-4 tw:accent-primary" {...props} />
      <span>{children}</span>
    </label>
  );
}
